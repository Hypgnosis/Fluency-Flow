const fakeAuth = vi.hoisted(() => ({ currentUser: null as null | { getIdToken: () => Promise<string> } }));
vi.mock('../services/firebase', () => ({ auth: fakeAuth, db: null, isFirebaseConfigured: false }));

import {
    _setGenaiConfig, generateText, generateWithFallback, lowLatencyThinking, splitSseEvents, streamText, streamWithFallback,
    textFromResponse, isRetryableModelError, GenAiError, orderByHealth, _resetModelCooldown, TEXT_MODELS,
} from '../services/genaiClient';
import { _setLiveConfig, resolveLiveWebSocketUrl } from '../services/geminiService';

beforeEach(() => {
    _setGenaiConfig({ apiKey: 'test-key', apiBase: '' });
    _resetModelCooldown();
});

describe('splitSseEvents', () => {
    it('returns complete data events and keeps the partial rest', () => {
        const { events, rest } = splitSseEvents('data: {"a":1}\r\n\r\ndata: {"b":2}\n\ndata: {"c"');
        expect(events).toEqual(['{"a":1}', '{"b":2}']);
        expect(rest).toBe('data: {"c"');
    });
});

describe('textFromResponse', () => {
    it('joins visible text parts and skips thoughts', () => {
        expect(textFromResponse({
            candidates: [{ content: { parts: [{ text: 'thinking', thought: true }, { text: 'Hola' }, { text: '!' }] } }],
        })).toBe('Hola!');
        expect(textFromResponse({})).toBe('');
    });

    it('throws on errors and blocked prompts', () => {
        expect(() => textFromResponse({ error: { message: 'quota', code: 429 } })).toThrow('quota');
        expect(() => textFromResponse({ promptFeedback: { blockReason: 'SAFETY' } })).toThrow('SAFETY');
    });
});

describe('lowLatencyThinking', () => {
    it('uses a budget for 2.5 models and a level for newer ones', () => {
        expect(lowLatencyThinking('gemini-2.5-flash')).toEqual({ thinkingBudget: 0 });
        expect(lowLatencyThinking('gemini-3.8-flash')).toEqual({ thinkingLevel: 'low' });
        expect(lowLatencyThinking('gemini-3.5-flash-lite')).toEqual({ thinkingLevel: 'minimal' });
    });
});

function sseResponse(chunks: string[]): Response {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
        start(controller) {
            chunks.forEach(c => controller.enqueue(encoder.encode(c)));
            controller.close();
        },
    });
    return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

describe('streamText (direct dev mode)', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('yields text across chunk boundaries', async () => {
        const event = (t: string) => `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: t }] } }] })}\n\n`;
        const full = event('<reply>Hola ') + event('mundo</reply>');
        const fetchMock = vi.fn().mockResolvedValue(sseResponse([full.slice(0, 25), full.slice(25, 70), full.slice(70)]));
        vi.stubGlobal('fetch', fetchMock);

        const out: string[] = [];
        for await (const t of streamText({ model: 'gemini-3.8-flash', contents: [{ role: 'user', parts: [{ text: 'hi' }] }] })) out.push(t);

        expect(out.join('')).toBe('<reply>Hola mundo</reply>');
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toMatch(/models\/gemini-3\.8-flash:streamGenerateContent\?alt=sse$/);
        expect(JSON.parse(init.body).contents[0].parts[0].text).toBe('hi');
    });

    it('surfaces API errors with their message', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: 'API key not valid' } }), { status: 400 })));
        await expect(generateText({ model: 'gemini-3.8-flash', contents: [] })).rejects.toThrow('API key not valid');
    });
});

describe('production mode (Netlify functions)', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        fakeAuth.currentUser = null;
    });

    it('calls the same-origin /api function with the Firebase ID token and no Gemini key', async () => {
        _setGenaiConfig({ apiKey: '' });
        fakeAuth.currentUser = { getIdToken: async () => 'id-token-123' };
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            candidates: [{ content: { parts: [{ text: 'ok' }] } }],
        }), { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);

        await expect(generateText({ model: 'gemini-3.5-flash-lite', contents: [{ role: 'user', parts: [{ text: 'hi' }] }] })).resolves.toBe('ok');
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('/api/generate');
        expect(init.headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer id-token-123' });
        expect(init.headers['x-goog-api-key']).toBeUndefined();
        expect(JSON.parse(init.body).model).toBe('gemini-3.5-flash-lite');
    });

    it('asks the user to sign in when there is no Firebase user', async () => {
        _setGenaiConfig({ apiKey: '' });
        vi.stubGlobal('fetch', vi.fn());
        await expect(generateText({ model: 'gemini-3.5-flash-lite', contents: [] })).rejects.toThrow('Please sign in');
    });
});

describe('resolveLiveWebSocketUrl', () => {
    afterEach(() => {
        fakeAuth.currentUser = null;
    });

    it('uses an ephemeral token from /api/live-token in production', async () => {
        _setLiveConfig({ proxyUrl: '', devApiKey: '' });
        fakeAuth.currentUser = { getIdToken: async () => 'id-token-123' };
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ token: 'auth_tokens/a b' }), { status: 200 }));

        const url = await resolveLiveWebSocketUrl(fetchMock);
        expect(url).toBe('wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=auth_tokens%2Fa%20b');
        expect(url).not.toContain('key=');
        expect(fetchMock).toHaveBeenCalledWith('/api/live-token', expect.objectContaining({
            method: 'POST', headers: expect.objectContaining({ Authorization: 'Bearer id-token-123' }),
        }));
    });

    it('reports token errors from the function', async () => {
        _setLiveConfig({ proxyUrl: '', devApiKey: '' });
        fakeAuth.currentUser = { getIdToken: async () => 't' };
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: 'The Glossos server is not configured yet.' } }), { status: 503 }));
        await expect(resolveLiveWebSocketUrl(fetchMock)).rejects.toThrow('not configured');
    });

    it('uses the dev key directly, or a self-hosted proxy when configured', async () => {
        _setLiveConfig({ proxyUrl: '', devApiKey: 'dev-key' });
        expect(await resolveLiveWebSocketUrl(vi.fn())).toMatch(/BidiGenerateContent\?key=dev-key$/);
        _setLiveConfig({ proxyUrl: 'wss://proxy.example/', devApiKey: '' });
        expect(await resolveLiveWebSocketUrl(vi.fn())).toBe('wss://proxy.example/ws');
    });
});

describe('model fallback', () => {
    afterEach(() => vi.unstubAllGlobals());
    const ok = (text: string) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 });
    const overloaded = () => new Response(JSON.stringify({ error: { message: 'high demand' } }), { status: 503 });

    it('classifies retryable errors', () => {
        expect(isRetryableModelError(new GenAiError('x', 503))).toBe(true);
        expect(isRetryableModelError(new GenAiError('x', 404))).toBe(true);
        expect(isRetryableModelError(new GenAiError('x', 400))).toBe(false);
        expect(isRetryableModelError(new Error('x'))).toBe(false);
    });

    it('moves to the next model when one is overloaded, with per-model settings', async () => {
        const fetchMock = vi.fn().mockResolvedValueOnce(overloaded()).mockResolvedValueOnce(ok('hola'));
        vi.stubGlobal('fetch', fetchMock);
        const build = vi.fn((model: string) => ({ model, contents: [], generationConfig: { thinkingConfig: lowLatencyThinking(model) } }));
        await expect(generateWithFallback(['gemini-3.8-flash', 'gemini-2.5-flash'], build)).resolves.toBe('hola');
        expect(fetchMock.mock.calls[1][0]).toContain('gemini-2.5-flash:generateContent');
        expect(JSON.parse(fetchMock.mock.calls[1][1].body).generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0 });
    });

    it('does not retry other errors, and rethrows when every model fails', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: 'bad request' } }), { status: 400 })));
        await expect(generateWithFallback(['a', 'b'], m => ({ model: m, contents: [] }))).rejects.toThrow('bad request');
        vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => overloaded()));
        await expect(generateWithFallback(['a', 'b'], m => ({ model: m, contents: [] }))).rejects.toThrow('high demand');
    });

    it('streams from the fallback when the first model fails before any text', async () => {
        const sse = new Response('data: ' + JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }) + '\n\n', { status: 200 });
        vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(overloaded()).mockResolvedValueOnce(sse));
        const out: string[] = [];
        for await (const t of streamWithFallback(['a', 'b'], m => ({ model: m, contents: [] }))) out.push(t);
        expect(out).toEqual(['ok']);
    });
});

describe('timeouts', () => {
    afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

    it('turns a stalled model into a retryable 504 and falls back', async () => {
        const hang = (_url: string, init: RequestInit) => new Promise<Response>((_, reject) => {
            init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        });
        const fetchMock = vi.fn().mockImplementationOnce(hang).mockResolvedValueOnce(
            new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'rescued' }] } }] }), { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        const out = await generateWithFallback(['slow-model', 'gemini-2.5-flash'], model => ({ model, contents: [], timeoutMs: 30 }));
        expect(out).toBe('rescued');
        await expect(generateText({ model: 'slow-model', contents: [], timeoutMs: 20 })).rejects.toThrow();
    });

    it('lets the caller cancel without reporting a timeout', async () => {
        const controller = new AbortController();
        // Like real fetch: reject at once if the signal is already aborted, otherwise when it aborts.
        vi.stubGlobal('fetch', vi.fn().mockImplementation((_u: string, init: RequestInit) => new Promise((_, reject) => {
            const abort = () => reject(new DOMException('aborted', 'AbortError'));
            if (init.signal?.aborted) abort();
            else init.signal?.addEventListener('abort', abort);
        })));
        const pending = generateText({ model: 'm', contents: [], timeoutMs: 10_000, signal: controller.signal });
        controller.abort();
        await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    });
});

describe('model cooldown', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('tries the best model first and keeps 2.5 Flash ahead of the lite model', () => {
        expect(TEXT_MODELS).toEqual(['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-2.5-flash', 'gemini-3.5-flash-lite']);
    });

    it('skips a model that just failed, but never drops it entirely', async () => {
        const overloaded = () => new Response(JSON.stringify({ error: { message: 'busy' } }), { status: 503 });
        const ok = () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }), { status: 200 });
        const fetchMock = vi.fn().mockResolvedValueOnce(overloaded()).mockImplementation(async () => ok());
        vi.stubGlobal('fetch', fetchMock);
        const build = (model: string) => ({ model, contents: [] });

        await generateWithFallback(['busy-model', 'good-model'], build);
        expect(orderByHealth(['busy-model', 'good-model'])).toEqual(['good-model', 'busy-model']);

        fetchMock.mockClear();
        await generateWithFallback(['busy-model', 'good-model'], build);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][0]).toContain('good-model');

        // After the cooldown the preferred model is tried first again.
        expect(orderByHealth(['busy-model', 'good-model'], Date.now() + 4 * 60 * 1000)).toEqual(['busy-model', 'good-model']);
    });
});

