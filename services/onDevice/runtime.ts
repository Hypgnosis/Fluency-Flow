/**
 * On-device inference with LiteRT-LM Web (Google's browser runtime, the one Gallery's models are
 * built for). Runs Gemma on the GPU through WebGPU; nothing leaves the device.
 */

import { Engine, loadLiteRtLm, SamplerType, type Conversation, type Message } from '@litert-lm/core';
import type { OnDeviceModel } from './models';
import { getModelBlob } from './modelStore';

/** Where the WebAssembly runtime is served (see vite-plugins/offlineAssets.ts). */
export const LITERT_WASM_URL = '/litert-lm/';

export interface WebGpuStatus {
    supported: boolean;
    reason?: string;
    adapter?: string;
}

export async function webGpuStatus(): Promise<WebGpuStatus> {
    const gpu = typeof navigator !== 'undefined' ? (navigator as any).gpu : undefined;
    if (!gpu) {
        return { supported: false, reason: 'This browser does not support WebGPU. Use a recent Chrome or Edge on a laptop, or Chrome on a recent Android phone.' };
    }
    try {
        const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
        if (!adapter) return { supported: false, reason: 'WebGPU is available but no compatible GPU was found.' };
        const info = adapter.info ?? {};
        return { supported: true, adapter: [info.vendor, info.architecture, info.description].filter(Boolean).join(' ') || 'GPU' };
    } catch (err) {
        return { supported: false, reason: `WebGPU failed to start: ${(err as Error).message}` };
    }
}

export type RuntimeStatus =
    | { state: 'idle' }
    | { state: 'loading'; modelId: string; step: string }
    | { state: 'ready'; modelId: string; initMs: number }
    | { state: 'error'; modelId: string; message: string };

export interface ChatTurn {
    role: 'user' | 'model';
    text: string;
}

export interface SamplingParams {
    temperature?: number;
    topK?: number;
    topP?: number;
    maxOutputTokens?: number;
}

export interface DeviceRunStats {
    ttftMs: number;
    totalMs: number;
    prefillTokensPerSec?: number;
    prefillTokens?: number;
    decodeTokensPerSec?: number;
    decodeTokens?: number;
}

type Listener = (status: RuntimeStatus) => void;

class OnDeviceRuntime {
    private engine: Engine | null = null;
    private model: OnDeviceModel | null = null;
    private loading: Promise<Engine> | null = null;
    private wasmLoaded: Promise<unknown> | null = null;
    private listeners = new Set<Listener>();
    status: RuntimeStatus = { state: 'idle' };

    subscribe(listener: Listener): () => void {
        this.listeners.add(listener);
        listener(this.status);
        return () => this.listeners.delete(listener);
    }

    private setStatus(status: RuntimeStatus) {
        this.status = status;
        this.listeners.forEach(l => l(status));
    }

    get loadedModel(): OnDeviceModel | null {
        return this.engine ? this.model : null;
    }

    /** Loads `model` (already downloaded) onto the GPU. Reuses the engine if it is already loaded. */
    async load(model: OnDeviceModel): Promise<Engine> {
        if (this.engine && this.model?.id === model.id) return this.engine;
        if (this.loading && this.model?.id === model.id) return this.loading;
        await this.unload();
        this.model = model;
        this.loading = (async () => {
            const started = performance.now();
            try {
                this.setStatus({ state: 'loading', modelId: model.id, step: 'Starting the runtime…' });
                this.wasmLoaded ??= loadLiteRtLm(LITERT_WASM_URL).catch(err => {
                    this.wasmLoaded = null; // allow a retry
                    throw err;
                });
                await this.wasmLoaded;
                this.setStatus({ state: 'loading', modelId: model.id, step: 'Reading the model from this device…' });
                const blob = await getModelBlob(model);
                if (!blob) throw new Error(`${model.name} is not downloaded yet.`);
                this.setStatus({ state: 'loading', modelId: model.id, step: 'Loading the model onto the GPU…' });
                const engine = await Engine.create({
                    model: blob,
                    mainExecutorSettings: { maxNumTokens: model.defaults.contextTokens },
                    benchmarkEnabled: true,
                });
                this.engine = engine;
                this.setStatus({ state: 'ready', modelId: model.id, initMs: Math.round(performance.now() - started) });
                return engine;
            } catch (err) {
                this.setStatus({ state: 'error', modelId: model.id, message: (err as Error).message || 'Could not load the model.' });
                throw err;
            } finally {
                this.loading = null;
            }
        })();
        return this.loading;
    }

    async unload(): Promise<void> {
        const engine = this.engine;
        this.engine = null;
        this.model = null;
        if (engine) await engine.delete().catch(() => undefined);
        this.setStatus({ state: 'idle' });
    }

    /**
     * Streams a reply. Each call uses a fresh conversation seeded with the system prompt and the
     * history (like Gallery's Prompt Lab, which resets per turn), so calls never interfere.
     */
    async *stream(opts: {
        system?: string;
        history?: ChatTurn[];
        message: string;
        params?: SamplingParams;
        signal?: AbortSignal;
        onStats?: (stats: DeviceRunStats) => void;
    }): AsyncGenerator<string> {
        const engine = this.engine;
        const model = this.model;
        if (!engine || !model) throw new Error('Load an on-device model first.');
        const p = { ...model.defaults, ...stripUndefined(opts.params ?? {}) };
        const preface: Message[] = [
            ...(opts.system ? [{ role: 'system', content: opts.system }] : []),
            ...(opts.history ?? []).map(t => ({ role: t.role, content: t.text })),
        ];
        const conversation: Conversation = await engine.createConversation({
            preface: { messages: preface },
            sessionConfig: {
                maxOutputTokens: p.maxOutputTokens,
                samplerParams: { type: SamplerType.TOP_P, temperature: p.temperature, k: p.topK, p: p.topP },
            },
        });

        const started = performance.now();
        let firstAt = 0;
        const onAbort = () => conversation.cancel();
        opts.signal?.addEventListener('abort', onAbort, { once: true });
        // A reader loop rather than `for await` over the stream: Safari lacks ReadableStream iteration.
        const reader = conversation.sendMessageStreaming(opts.message).getReader();
        try {
            while (true) {
                const { value: chunk, done } = await reader.read();
                if (done || opts.signal?.aborted) break;
                const parts = Array.isArray(chunk.content) ? chunk.content : [];
                for (const part of parts) {
                    if (part.type === 'text' && part.text) {
                        if (!firstAt) firstAt = performance.now();
                        yield part.text;
                    }
                }
            }
            if (opts.signal?.aborted) await reader.cancel().catch(() => undefined);
            const info = await conversation.getBenchmarkInfo().catch(() => null);
            opts.onStats?.({
                ttftMs: Math.round((firstAt || performance.now()) - started),
                totalMs: Math.round(performance.now() - started),
                prefillTokensPerSec: info?.lastPrefillTokensPerSecond,
                prefillTokens: info?.lastPrefillTokenCount,
                decodeTokensPerSec: info?.lastDecodeTokensPerSecond,
                decodeTokens: info?.lastDecodeTokenCount,
            });
        } finally {
            opts.signal?.removeEventListener('abort', onAbort);
            reader.releaseLock();
            await conversation.delete().catch(() => undefined);
        }
    }
}

function stripUndefined<T extends object>(obj: T): Partial<T> {
    return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export const onDeviceRuntime = new OnDeviceRuntime();
