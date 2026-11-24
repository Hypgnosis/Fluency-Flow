/**
 * One streaming interface for text features (Chat, Writing Lab), backed by either Gemini in the
 * cloud or Gemma on this device. Mirrors how Gallery lets every task run on any compatible model.
 */

import { TEXT_MODELS, MODEL_TIMEOUT_MS, lowLatencyThinking, streamWithFallback, type Content } from './genaiClient';
import { onDeviceRuntime, type ChatTurn, type SamplingParams } from './onDevice/runtime';

export type EngineKind = 'cloud' | 'device';

export interface ReplyStats {
    engine: EngineKind;
    label: string;
    ttftMs: number;
    totalMs: number;
    decodeTokensPerSec?: number;
    prefillTokensPerSec?: number;
    outputTokens?: number;
}

export interface ReplyRequest {
    system?: string;
    history?: ChatTurn[];
    message: string;
    params?: SamplingParams;
    signal?: AbortSignal;
    onStats?: (stats: ReplyStats) => void;
}

export function engineLabel(kind: EngineKind): string {
    if (kind === 'cloud') return 'Gemini (cloud)';
    return onDeviceRuntime.loadedModel ? `${onDeviceRuntime.loadedModel.name} (on this device)` : 'On-device model';
}

/** Whether the engine can answer right now (the on-device model must be loaded first). */
export function engineReady(kind: EngineKind): boolean {
    return kind === 'cloud' || onDeviceRuntime.loadedModel !== null;
}

async function* streamCloud(req: ReplyRequest): AsyncGenerator<string> {
    const contents: Content[] = [
        ...(req.history ?? []).map(t => ({ role: t.role, parts: [{ text: t.text }] })),
        { role: 'user', parts: [{ text: req.message }] },
    ];
    const started = performance.now();
    let firstAt = 0;
    for await (const chunk of streamWithFallback(TEXT_MODELS, model => ({
        model,
        systemInstruction: req.system,
        contents,
        generationConfig: {
            ...(req.params?.temperature !== undefined ? { temperature: req.params.temperature } : {}),
            ...(req.params?.topK !== undefined ? { topK: req.params.topK } : {}),
            ...(req.params?.topP !== undefined ? { topP: req.params.topP } : {}),
            maxOutputTokens: req.params?.maxOutputTokens ?? 1024,
            thinkingConfig: lowLatencyThinking(model),
        },
        signal: req.signal,
        timeoutMs: MODEL_TIMEOUT_MS,
    }))) {
        if (!firstAt) firstAt = performance.now();
        yield chunk;
    }
    req.onStats?.({
        engine: 'cloud',
        label: engineLabel('cloud'),
        ttftMs: Math.round((firstAt || performance.now()) - started),
        totalMs: Math.round(performance.now() - started),
    });
}

async function* streamDevice(req: ReplyRequest): AsyncGenerator<string> {
    yield* onDeviceRuntime.stream({
        system: req.system,
        history: req.history,
        message: req.message,
        params: req.params,
        signal: req.signal,
        onStats: s => req.onStats?.({
            engine: 'device',
            label: engineLabel('device'),
            ttftMs: s.ttftMs,
            totalMs: s.totalMs,
            decodeTokensPerSec: s.decodeTokensPerSec,
            prefillTokensPerSec: s.prefillTokensPerSec,
            outputTokens: s.decodeTokens,
        }),
    });
}

export function streamReply(kind: EngineKind, req: ReplyRequest): AsyncGenerator<string> {
    return kind === 'device' ? streamDevice(req) : streamCloud(req);
}
