/**
 * Minimal Gemini generateContent client for everything that is not the Live voice session.
 *
 * - Production: calls the site's own Netlify Functions (`/api/generate`, `/api/stream`) with the
 *   user's Firebase ID token. The Gemini API key lives only in the function environment.
 * - Local `npm run dev`: calls Gemini directly with GEMINI_API_KEY from .env.local (the key is
 *   only defined for the dev server, never in production builds; see vite.config.ts).
 */

import { auth } from './firebase';

const DIRECT_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Quality model for teacher replies. Override with GEMINI_TEXT_MODEL. */
export const TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || 'gemini-3.8-flash';
/** Cheap, fast model for extraction tasks. Override with GEMINI_FAST_MODEL. */
export const FAST_MODEL = process.env.GEMINI_FAST_MODEL || 'gemini-3.5-flash-lite';

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
    } catch { /* not JSON */ }
    return new GenAiError(String(message), res.status);
}

export async function generateText(req: GenerateRequest): Promise<string> {
    const [url, init] = await buildRequest('generate', req);
    const res = await fetch(url, init);
    if (!res.ok) throw await errorFrom(res);
    return textFromResponse(await res.json());
}

/** Streams the response text, yielding each new chunk as it arrives. */
export async function* streamText(req: GenerateRequest): AsyncGenerator<string> {
    const [url, init] = await buildRequest('stream', req);
    const res = await fetch(url, init);
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
