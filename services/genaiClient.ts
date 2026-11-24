/**
 * Minimal Gemini generateContent client for everything that is not the Live voice session.
 *
 * - Production: calls the site's own Netlify Functions (`/api/generate`, `/api/stream`) with the
 *   user's Firebase ID token. The Gemini API key lives only in the function environment.
 * - Local `npm run dev`: calls Gemini directly with GEMINI_API_KEY from .env.local (the key is
 *   only defined for the dev server, never in production builds; see vite.config.ts).
 */

import { auth } from './firebase';
import { handlePaymentRequired } from './billing';

const DIRECT_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Quality model for teacher replies. Override with GEMINI_TEXT_MODEL. */
export const TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || 'gemini-3.8-flash';
/** Cheap, fast model for extraction tasks. Override with GEMINI_FAST_MODEL. */
export const FAST_MODEL = process.env.GEMINI_FAST_MODEL || 'gemini-3.5-flash-lite';
/** Reliable fallback when the newer models are overloaded (available to existing 2.5 users). */
export const FALLBACK_MODEL = 'gemini-2.5-flash';

const unique = (models: string[]) => [...new Set(models.filter(Boolean))];
/**
 * Try order for quality tasks (Lens teacher replies). In November 2026 the 3.x Flash models were
 * often overloaded (503 after up to 13 s), while gemini-2.5-flash answered in under a second.
 */
export const TEXT_MODELS = unique([TEXT_MODEL, 'gemini-3.5-flash', FALLBACK_MODEL, FAST_MODEL]);
/** Try order for fast tasks (extraction, reviews). */
export const FAST_MODELS = unique([FAST_MODEL, FALLBACK_MODEL]);
/** Per-model wait before moving on, for interactive calls. */
export const MODEL_TIMEOUT_MS = 8_000;

// ─── Model cooldown ───────────────────────────────────────────────────────
// After a model fails with an overload/unavailable error, skip it for a while so every request does
// not pay the same delay again.
const COOLDOWN_MS = 3 * 60 * 1000;
const cooldownUntil = new Map<string, number>();

function markUnavailable(model: string, now = Date.now()) {
    cooldownUntil.set(model, now + COOLDOWN_MS);
}

/** Models in try order, with cooled-down ones moved to the end (never dropped entirely). */
export function orderByHealth(models: string[], now = Date.now()): string[] {
    const healthy = models.filter(m => (cooldownUntil.get(m) ?? 0) <= now);
    const cooling = models.filter(m => (cooldownUntil.get(m) ?? 0) > now);
    return [...healthy, ...cooling];
}

/** Test hook. */
export function _resetModelCooldown() {
    cooldownUntil.clear();
}

export interface Part {
    text?: string;
    inlineData?: { mimeType: string; data: string };
    thought?: boolean;
}

export interface Content {
    role: 'user' | 'model';
    parts: Part[];
}

export interface GenerateRequest {
    model: string;
    contents: Content[];
    systemInstruction?: string;
    generationConfig?: Record<string, unknown>;
    signal?: AbortSignal;
    /**
     * Give up on this model if it has not responded within this time (overloaded models sometimes
     * stall instead of answering 503). A timeout throws GenAiError 504, which fallbacks retry.
     */
    timeoutMs?: number;
}

export class GenAiError extends Error {
    constructor(message: string, readonly status?: number) {
        super(message);
        this.name = 'GenAiError';
    }
}

/**
 * Thinking settings that keep latency low. Gemini 2.5 models take a token budget; Gemini 3+ models
 * take a level (3.x Flash rejects "minimal", Flash-Lite accepts it).
 */
export function lowLatencyThinking(model: string): Record<string, unknown> {
    if (/^gemini-2\.5/.test(model)) return { thinkingBudget: 0 };
    return { thinkingLevel: /lite/.test(model) ? 'minimal' : 'low' };
}

/** Splits buffered server-sent-event text into complete `data:` payloads and the unfinished rest. */
export function splitSseEvents(buffer: string): { events: string[]; rest: string } {
    const blocks = buffer.replace(/\r\n/g, '\n').split('\n\n');
    const rest = blocks.pop() ?? '';
    const events = blocks
        .map(block => block
            .split('\n')
            .filter(line => line.startsWith('data:'))
            .map(line => line.slice(5).trimStart())
            .join('\n'))
        .filter(Boolean);
    return { events, rest };
}

/** Concatenates the visible (non-thought) text of a GenerateContentResponse. */
export function textFromResponse(response: any): string {
    if (response?.error) throw new GenAiError(response.error.message || 'Gemini error', response.error.code);
    const block = response?.promptFeedback?.blockReason;
    if (block) throw new GenAiError(`Request blocked (${block})`);
    const parts: Part[] = response?.candidates?.[0]?.content?.parts ?? [];
    return parts.filter(p => !p.thought && typeof p.text === 'string').map(p => p.text).join('');
}

const config = {
    /** Dev-only key; always empty in production builds. */
    apiKey: process.env.GEMINI_API_KEY || process.env.API_KEY || '',
    /** Where the /api functions live. Empty = same origin (Netlify). */
    apiBase: '',
};

/** Test hook: overrides the build-time API key / API base. */
export function _setGenaiConfig(overrides: Partial<typeof config>) {
    Object.assign(config, overrides);
}

async function buildRequest(kind: 'generate' | 'stream', req: GenerateRequest): Promise<[string, RequestInit]> {
    const payload = {
        contents: req.contents,
        ...(req.systemInstruction ? { systemInstruction: { parts: [{ text: req.systemInstruction }] } } : {}),
        ...(req.generationConfig ? { generationConfig: req.generationConfig } : {}),
    };

    if (config.apiKey) {
        const suffix = kind === 'stream' ? ':streamGenerateContent?alt=sse' : ':generateContent';
        return [`${DIRECT_BASE}/${encodeURIComponent(req.model)}${suffix}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.apiKey },
            body: JSON.stringify(payload),
            signal: req.signal,
        }];
    }

    return [`${config.apiBase}/api/${kind}`, {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ model: req.model, ...payload }),
        signal: req.signal,
    }];
}

/** JSON headers plus the signed-in user's Firebase ID token for the /api functions. */
export async function authHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = await auth?.currentUser?.getIdToken();
    if (!token) throw new GenAiError('Please sign in to use this feature.', 401);
    headers.Authorization = `Bearer ${token}`;
    return headers;
}

async function errorFrom(res: Response): Promise<GenAiError> {
    let message = `${res.status} ${res.statusText}`;
    try {
        const body = await res.json();
        message = body?.error?.message || body?.error || message;
        // Out of AI minutes: open the plans screen.
        if (res.status === 402) message = handlePaymentRequired(body);
    } catch { /* not JSON */ }
    return new GenAiError(String(message), res.status);
}

/** An abort signal that fires on the caller's signal or after `timeoutMs`. */
function withDeadline(req: GenerateRequest) {
    if (!req.timeoutMs) return { signal: req.signal, timedOut: () => false, clear: () => undefined };
    const controller = new AbortController();
    let fired = false;
    const timer = setTimeout(() => { fired = true; controller.abort(); }, req.timeoutMs);
    if (req.signal?.aborted) controller.abort();
    else req.signal?.addEventListener('abort', () => controller.abort(), { once: true });
    return { signal: controller.signal, timedOut: () => fired, clear: () => clearTimeout(timer) };
}

function timeoutError(req: GenerateRequest): GenAiError {
    return new GenAiError(`${req.model} did not respond within ${Math.round((req.timeoutMs ?? 0) / 1000)} s`, 504);
}

export async function generateText(req: GenerateRequest): Promise<string> {
    const deadline = withDeadline(req);
    const [url, init] = await buildRequest('generate', { ...req, signal: deadline.signal });
    try {
        const res = await fetch(url, init);
        if (!res.ok) throw await errorFrom(res);
        return textFromResponse(await res.json());
    } catch (err) {
        if (deadline.timedOut()) throw timeoutError(req);
        throw err;
    } finally {
        deadline.clear();
    }
}

/** Streams the response text, yielding each new chunk as it arrives. */
export async function* streamText(req: GenerateRequest): AsyncGenerator<string> {
    // The deadline covers the wait for the response to start; once it streams, it may take its time.
    const deadline = withDeadline(req);
    const [url, init] = await buildRequest('stream', { ...req, signal: deadline.signal });
    let res: Response;
    try {
        res = await fetch(url, init);
    } catch (err) {
        if (deadline.timedOut()) throw timeoutError(req);
        throw err;
    } finally {
        deadline.clear();
    }
    if (!res.ok || !res.body) throw await errorFrom(res);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finished = false;
    try {
        while (!finished) {
            const { value, done } = await reader.read();
            finished = done;
            buffer += decoder.decode(value, { stream: !done });
            const { events, rest } = splitSseEvents(done ? `${buffer}\n\n` : buffer);
            buffer = rest;
            for (const event of events) {
                const text = textFromResponse(JSON.parse(event));
                if (text) yield text;
            }
        }
    } finally {
        // The consumer stopped early (or an error was thrown): close the HTTP stream.
        if (!finished) await reader.cancel().catch(() => undefined);
        reader.releaseLock();
    }
}

/** Splits a data URL into the inlineData shape Gemini expects. */
export function inlineImage(dataUrl: string): Part {
    const match = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
    if (!match) throw new GenAiError('Invalid image data');
    return { inlineData: { mimeType: match[1], data: match[2] } };
}

/** Whether trying another model could help: overloaded (503/500/504) or unavailable (404). */
export function isRetryableModelError(err: unknown): boolean {
    return err instanceof GenAiError && [404, 500, 503, 504].includes(err.status ?? 0);
}

/**
 * Calls `generateText` with each model in turn until one answers. `build` creates the request for a
 * model (thinking settings differ between model families).
 */
export async function generateWithFallback(models: string[], build: (model: string) => GenerateRequest): Promise<string> {
    let lastError: unknown;
    for (const model of orderByHealth(models)) {
        try {
            return await generateText(build(model));
        } catch (err) {
            lastError = err;
            if (!isRetryableModelError(err)) throw err;
            markUnavailable(model);
            console.warn(`[GLOSSOS] ${model} unavailable (${(err as GenAiError).status}), trying the next model`);
        }
    }
    throw lastError;
}

/** Streaming version: falls back only if a model fails before sending any text. */
export async function* streamWithFallback(models: string[], build: (model: string) => GenerateRequest): AsyncGenerator<string> {
    let lastError: unknown;
    for (const model of orderByHealth(models)) {
        let sentAny = false;
        try {
            for await (const chunk of streamText(build(model))) {
                sentAny = true;
                yield chunk;
            }
            return;
        } catch (err) {
            lastError = err;
            if (sentAny || !isRetryableModelError(err)) throw err;
            markUnavailable(model);
            console.warn(`[GLOSSOS] ${model} unavailable (${(err as GenAiError).status}), trying the next model`);
        }
    }
    throw lastError;
}
