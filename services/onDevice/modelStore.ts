/**
 * Stores downloaded on-device models in the Origin Private File System (OPFS), the browser's
 * private disk area for each site (the Glossos equivalent of Gallery's model downloads).
 *
 * LiteRT-LM 0.19 does not cache models itself, so without this the 2+ GB file would be downloaded
 * on every visit. OPFS (rather than Cache Storage) because it streams straight to disk, discards an
 * unfinished write automatically, and hands back a disk-backed File the engine can read directly.
 */

import { modelUrl, type OnDeviceModel } from './models';

const MODELS_DIR = 'glossos-models';

export interface DownloadProgress {
    loadedBytes: number;
    totalBytes: number;
}

export class StorageFullError extends Error {
    constructor(readonly neededBytes: number, readonly availableBytes: number) {
        super('Not enough free storage on this device for this model.');
        this.name = 'StorageFullError';
    }
}

/** File name in OPFS; includes part of the hash so a new model version never reuses an old file. */
export function modelFileName(model: OnDeviceModel): string {
    return `${model.id}-${model.sha256.slice(0, 12)}.litertlm`;
}

async function modelsDir(): Promise<FileSystemDirectoryHandle> {
    const root = await navigator.storage?.getDirectory?.();
    if (!root) throw new Error('This browser cannot store models on the device (no Origin Private File System).');
    return root.getDirectoryHandle(MODELS_DIR, { create: true });
}

async function existingFile(model: OnDeviceModel): Promise<File | null> {
    try {
        const handle = await (await modelsDir()).getFileHandle(modelFileName(model));
        return await handle.getFile();
    } catch {
        return null;
    }
}

export async function isDownloaded(model: OnDeviceModel): Promise<boolean> {
    const file = await existingFile(model);
    return file !== null && file.size === model.sizeBytes;
}

/** The stored model as a disk-backed File (a Blob), or null if it is missing or incomplete. */
export async function getModelBlob(model: OnDeviceModel): Promise<Blob | null> {
    const file = await existingFile(model);
    return file && file.size === model.sizeBytes ? file : null;
}

export async function deleteModel(model: OnDeviceModel): Promise<void> {
    try {
        await (await modelsDir()).removeEntry(modelFileName(model));
    } catch { /* already gone */ }
}

export interface StorageInfo {
    usageBytes?: number;
    quotaBytes?: number;
    persisted?: boolean;
}

export async function storageInfo(): Promise<StorageInfo> {
    const s = typeof navigator !== 'undefined' ? navigator.storage : undefined;
    if (!s?.estimate) return {};
    const [estimate, persisted] = await Promise.all([s.estimate(), s.persisted?.().catch(() => undefined)]);
    return { usageBytes: estimate.usage, quotaBytes: estimate.quota, persisted };
}

/**
 * Downloads a model into OPFS. The file only becomes visible once it is complete: an aborted or
 * failed download leaves nothing behind (createWritable writes to a temporary file until close()).
 */
export async function downloadModel(
    model: OnDeviceModel,
    opts: { onProgress?: (p: DownloadProgress) => void; signal?: AbortSignal; fetchImpl?: typeof fetch } = {},
): Promise<void> {
    // Ask the browser not to evict a multi-gigabyte download under storage pressure.
    await navigator.storage?.persist?.().catch(() => false);
    const info = await storageInfo();
    if (info.quotaBytes !== undefined && info.usageBytes !== undefined) {
        const available = info.quotaBytes - info.usageBytes;
        if (available < model.sizeBytes * 1.05) throw new StorageFullError(model.sizeBytes, available);
    }

    const dir = await modelsDir();
    const res = await (opts.fetchImpl ?? fetch)(modelUrl(model), { signal: opts.signal });
    if (!res.ok || !res.body) throw new Error(`Download failed (${res.status} ${res.statusText})`);

    const handle = await dir.getFileHandle(modelFileName(model), { create: true });
    const writable = await handle.createWritable({ keepExistingData: false });

    let loaded = 0;
    let lastReport = 0;
    const counted = res.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
            loaded += chunk.byteLength;
            const now = Date.now();
            if (now - lastReport > 200) {
                lastReport = now;
                opts.onProgress?.({ loadedBytes: loaded, totalBytes: model.sizeBytes });
            }
            controller.enqueue(chunk);
        },
    }));

    try {
        // pipeTo closes the writable on success and aborts it (discarding the data) on failure.
        await counted.pipeTo(writable, { signal: opts.signal });
    } catch (err) {
        await removeIfIncomplete(dir, model);
        throw err;
    }
    opts.onProgress?.({ loadedBytes: loaded, totalBytes: model.sizeBytes });

    if (loaded !== model.sizeBytes) {
        await dir.removeEntry(modelFileName(model)).catch(() => undefined);
        throw new Error(`Download incomplete (${loaded} of ${model.sizeBytes} bytes). Please try again.`);
    }
}

async function removeIfIncomplete(dir: FileSystemDirectoryHandle, model: OnDeviceModel) {
    try {
        const file = await (await dir.getFileHandle(modelFileName(model))).getFile();
        if (file.size !== model.sizeBytes) await dir.removeEntry(modelFileName(model));
    } catch { /* nothing to clean up */ }
}
