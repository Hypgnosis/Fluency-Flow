const fakeAuth = vi.hoisted(() => ({ currentUser: null as null | { getIdToken: () => Promise<string> } }));
vi.mock('../services/firebase', () => ({ auth: fakeAuth, db: null, isFirebaseConfigured: false }));

import {
    _setGenaiConfig, generateText, lowLatencyThinking, splitSseEvents, streamText, textFromResponse,
} from '../services/genaiClient';
import { _setLiveConfig, resolveLiveWebSocketUrl } from '../services/geminiService';

beforeEach(() => _setGenaiConfig({ apiKey: 'test-key', apiBase: '' }));

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
