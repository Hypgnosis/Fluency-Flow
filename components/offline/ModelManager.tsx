import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ON_DEVICE_MODELS, formatBytes, type OnDeviceModel } from '../../services/onDevice/models';
import { deleteModel, downloadModel, isDownloaded, storageInfo, StorageFullError, type StorageInfo } from '../../services/onDevice/modelStore';
import { onDeviceRuntime, webGpuStatus, type WebGpuStatus } from '../../services/onDevice/runtime';
import { useOnDeviceStatus } from './useOnDevice';

const MONO = { fontFamily: "'IBM Plex Mono', monospace" };

interface ModelManagerProps {
    onOpenBenchmark?: () => void;
}

/** Download, load and remove on-device models (Gallery's model manager, for the browser). */
export const ModelManager: React.FC<ModelManagerProps> = ({ onOpenBenchmark }) => {
    const status = useOnDeviceStatus();
    const [gpu, setGpu] = useState<WebGpuStatus | null>(null);
    const [downloaded, setDownloaded] = useState<Record<string, boolean>>({});
    const [progress, setProgress] = useState<Record<string, number>>({});
    const [storage, setStorage] = useState<StorageInfo>({});
    const [error, setError] = useState<string | null>(null);
    const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
    const aborts = useRef<Record<string, AbortController>>({});

    const refresh = useCallback(async () => {
        const entries = await Promise.all(ON_DEVICE_MODELS.map(async m => [m.id, await isDownloaded(m).catch(() => false)] as const));
        setDownloaded(Object.fromEntries(entries));
        setStorage(await storageInfo());
    }, []);

    useEffect(() => {
        webGpuStatus().then(setGpu);
        refresh();
        return () => Object.values(aborts.current).forEach(a => a.abort());
    }, [refresh]);

    const download = async (model: OnDeviceModel) => {
        setError(null);
        const controller = new AbortController();
        aborts.current[model.id] = controller;
        setProgress(p => ({ ...p, [model.id]: 0 }));
        try {
            await downloadModel(model, {
                signal: controller.signal,
                onProgress: ({ loadedBytes, totalBytes }) => setProgress(p => ({ ...p, [model.id]: loadedBytes / totalBytes })),
            });
        } catch (err) {
            if ((err as Error).name !== 'AbortError') {
                setError(err instanceof StorageFullError
                    ? `Not enough free space: ${model.name} needs ${formatBytes(err.neededBytes)}, but only ${formatBytes(Math.max(0, err.availableBytes))} is available.`
                    : `Download failed: ${(err as Error).message}`);
            }
        } finally {
            delete aborts.current[model.id];
            setProgress(p => {
                const { [model.id]: _, ...rest } = p;
                return rest;
            });
            refresh();
        }
    };

    const remove = async (model: OnDeviceModel) => {
        setConfirmDelete(null);
        if (onDeviceRuntime.loadedModel?.id === model.id) await onDeviceRuntime.unload();
        await deleteModel(model);
        refresh();
    };

    const load = async (model: OnDeviceModel) => {
        setError(null);
        try {
            await onDeviceRuntime.load(model);
        } catch (err) {
            setError(`Could not load ${model.name}: ${(err as Error).message}`);
        }
    };

    const loadedId = status.state === 'ready' ? status.modelId : null;
    const loadingId = status.state === 'loading' ? status.modelId : null;

    return (
        <div className="p-4 sm:p-6 max-w-2xl mx-auto space-y-4">
            <div>
                <h2 className="text-white text-lg font-bold">Offline models</h2>
                <p className="text-slate-500 text-sm mt-1">
                    Download a model once and Chat and Writing Lab work with no internet connection. Everything runs on your
                    device's GPU, and nothing you type leaves it.
                </p>
            </div>

            <div className={`rounded-2xl border p-3 text-xs ${gpu?.supported ? 'border-[#00FF41]/20 bg-[#00FF41]/[0.04] text-[#00FF41]' : 'border-amber-500/20 bg-amber-500/[0.05] text-amber-200'}`} style={MONO}>
                {gpu === null ? 'Checking your GPU…' : gpu.supported ? `✓ WebGPU ready · ${gpu.adapter}` : `⚠ ${gpu.reason}`}
            </div>

            {error && <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 p-3 text-rose-200 text-xs">{error}</div>}

            <ul className="space-y-3">
                {ON_DEVICE_MODELS.map(model => {
                    const isDown = downloaded[model.id];
                    const pct = progress[model.id];
                    const downloading = pct !== undefined;
                    const isLoaded = loadedId === model.id;
                    const isLoading = loadingId === model.id;
                    return (
                        <li key={model.id} className="rounded-2xl border border-white/[0.08] bg-[#0d0d0e]/95 p-4">
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <div className="flex items-center gap-2">
                                        <h3 className="text-white font-semibold">{model.name}</h3>
                                        {model.recommended && <span className="text-[9px] uppercase tracking-[0.15em] px-2 py-0.5 rounded-full bg-[#FFBF00]/15 text-[#FFBF00]" style={MONO}>Recommended</span>}
                                        {isLoaded && <span className="text-[9px] uppercase tracking-[0.15em] px-2 py-0.5 rounded-full bg-[#00FF41]/15 text-[#00FF41]" style={MONO}>Loaded</span>}
                                    </div>
                                    <p className="text-slate-400 text-xs mt-1">{model.description}</p>
                                    <p className="text-slate-600 text-[11px] mt-1" style={MONO}>
                                        {formatBytes(model.sizeBytes)} · needs about {model.minMemoryGb} GB of memory · {model.license}
                                    </p>
                                </div>
                                <div className="flex flex-col items-end gap-2 flex-shrink-0">
                                    {!isDown && !downloading && (
                                        <button onClick={() => download(model)} disabled={!gpu?.supported}
                                            className="px-3 py-1.5 rounded-full text-xs font-bold bg-[#00FF41]/15 border border-[#00FF41]/40 text-[#00FF41] disabled:opacity-40" style={MONO}>
                                            Download
                                        </button>
                                    )}
                                    {downloading && (
                                        <button onClick={() => aborts.current[model.id]?.abort()}
                                            className="px-3 py-1.5 rounded-full text-xs bg-white/[0.04] border border-white/[0.1] text-slate-300" style={MONO}>
                                            Cancel
                                        </button>
                                    )}
                                    {isDown && !isLoaded && (
                                        <button onClick={() => load(model)} disabled={isLoading || !gpu?.supported}
                                            className="px-3 py-1.5 rounded-full text-xs font-bold bg-[#FFBF00]/15 border border-[#FFBF00]/40 text-[#FFBF00] disabled:opacity-50" style={MONO}>
                                            {isLoading ? 'Loading…' : 'Load'}
                                        </button>
                                    )}
                                    {isLoaded && (
                                        <button onClick={() => onDeviceRuntime.unload()} className="px-3 py-1.5 rounded-full text-xs bg-white/[0.04] border border-white/[0.1] text-slate-300" style={MONO}>
                                            Unload
                                        </button>
                                    )}
                                    {isDown && !downloading && (confirmDelete === model.id ? (
                                        <span className="text-[11px] text-rose-300" style={MONO}>
                                            Delete?{' '}
                                            <button onClick={() => remove(model)} className="font-bold hover:text-rose-200">Yes</button>{' '}
                                            <button onClick={() => setConfirmDelete(null)} className="text-slate-400 hover:text-slate-200">No</button>
                                        </span>
                                    ) : (
                                        <button onClick={() => setConfirmDelete(model.id)} className="text-[11px] text-slate-500 hover:text-rose-300" style={MONO}>Delete</button>
                                    ))}
                                </div>
                            </div>
                            {downloading && (
                                <div className="mt-3">
                                    <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                                        <div className="h-full bg-gradient-to-r from-[#00FF41] to-[#FFBF00] transition-all" style={{ width: `${Math.round(pct * 100)}%` }} />
                                    </div>
                                    <p className="text-[11px] text-slate-500 mt-1" style={MONO}>
                                        {Math.round(pct * 100)}% · {formatBytes(pct * model.sizeBytes)} of {formatBytes(model.sizeBytes)} · keep this tab open
                                    </p>
                                </div>
                            )}
                            {isLoading && status.state === 'loading' && <p className="text-[11px] text-[#FFBF00] mt-2" style={MONO}>{status.step}</p>}
                            {status.state === 'error' && status.modelId === model.id && <p className="text-[11px] text-rose-300 mt-2">{status.message}</p>}
                            {isLoaded && status.state === 'ready' && <p className="text-[11px] text-slate-500 mt-2" style={MONO}>Loaded in {(status.initMs / 1000).toFixed(1)} s</p>}
                        </li>
                    );
                })}
            </ul>

            <div className="flex items-center justify-between text-[11px] text-slate-600" style={MONO}>
                <span>
                    {storage.usageBytes !== undefined && storage.quotaBytes !== undefined
                        ? `Storage used: ${formatBytes(storage.usageBytes)} of ${formatBytes(storage.quotaBytes)}${storage.persisted ? ' · protected from cleanup' : ''}`
                        : ''}
                </span>
                {onOpenBenchmark && loadedId && (
                    <button onClick={onOpenBenchmark} className="text-[#FFBF00] hover:underline">Run benchmark →</button>
                )}
            </div>
        </div>
    );
};
