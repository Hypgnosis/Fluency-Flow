// @vitest-environment node
import crypto from 'crypto';
import { configFromEnv, createGenaiHandler, createLiveTokenHandler } from '../netlify/lib/api';
import { verifyFirebaseIdToken, _resetCertCache } from '../netlify/lib/firebaseAuth';

const silent = { warn: () => undefined, error: () => undefined };
const goodToken = async (token: string) => {
    if (token !== 'good') throw new Error('bad');
    return { uid: 'u1', anonymous: false };
};

const request = (path: string, body: unknown, headers: Record<string, string> = { Authorization: 'Bearer good' }, method = 'POST') =>
    new Request(`https://glossos.example${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...headers },
        body: method === 'POST' ? JSON.stringify(body) : undefined,
    });

const validBody = { model: 'gemini-3.8-flash', contents: [{ role: 'user', parts: [{ text: 'hi' }] }], tools: [{ evil: true }] };

describe('configFromEnv', () => {
    it('reads key, project, models and rate limit', () => {
        expect(configFromEnv({ GEMINI_API_KEY: 'k', FIREBASE_PROJECT_ID: 'p', GEMINI_TEXT_MODELS: 'a, b', API_RATE_LIMIT_PER_MIN: '5' }))
            .toEqual({ apiKey: 'k', projectId: 'p', allowedModels: ['a', 'b'], rateLimitPerMinute: 5 });
    });
});

describe('/api/generate and /api/stream', () => {
    it('requires sign-in and forwards only allowed fields with the server key', async () => {
        const upstream = vi.fn().mockResolvedValue(new Response(JSON.stringify({ candidates: [] }), { status: 200 }));
        const handle = createGenaiHandler({ apiKey: 'server-key', projectId: 'proj', fetchImpl: upstream, verifyToken: goodToken, log: silent });

        expect((await handle(request('/api/generate', validBody, {}))).status).toBe(401);
        expect((await handle(request('/api/generate', validBody, { Authorization: 'Bearer nope' }))).status).toBe(401);

        const ok = await handle(request('/api/generate', validBody));
        expect(ok.status).toBe(200);
        const [url, init] = upstream.mock.calls[0];
        expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent');
        expect(init.headers['x-goog-api-key']).toBe('server-key');
        expect(JSON.parse(init.body)).toEqual({ contents: validBody.contents });
    });

    it('refuses to run without server configuration', async () => {
        const handle = createGenaiHandler({ apiKey: '', projectId: '', fetchImpl: vi.fn(), log: silent });
        expect((await handle(request('/api/generate', validBody))).status).toBe(503);
    });

    it('validates method, model and body, and rate-limits per user', async () => {
        const upstream = vi.fn().mockImplementation(async () => new Response('{}', { status: 200 }));
        const handle = createGenaiHandler({
            apiKey: 'k', projectId: 'p', fetchImpl: upstream, verifyToken: goodToken, rateLimitPerMinute: 2, log: silent,
        });
        expect((await handle(request('/api/generate', null, undefined, 'GET'))).status).toBe(405);
        expect((await handle(request('/api/generate', { ...validBody, model: 'gemini-ultra-secret' }))).status).toBe(400);
        expect((await handle(request('/api/generate', { model: 'gemini-3.8-flash', contents: [] }))).status).toBe(400);
        // Two requests from u1 already counted; the limit is 2 per minute.
        expect((await handle(request('/api/generate', validBody))).status).toBe(429);
        expect(upstream).not.toHaveBeenCalled();
    });

    it('passes upstream errors through and streams SSE', async () => {
        const sse = 'data: {"candidates":[{"content":{"parts":[{"text":"Hola"}]}}]}\n\n';
        const upstream = vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'quota exceeded' } }), { status: 429 }))
            .mockResolvedValueOnce(new Response(sse, { status: 200 }));
        const handle = createGenaiHandler({ apiKey: 'k', projectId: 'p', fetchImpl: upstream, verifyToken: goodToken, log: silent });

        const err = await handle(request('/api/generate', validBody));
        expect(err.status).toBe(429);
        expect((await err.json()).error.message).toBe('quota exceeded');

        const stream = await handle(request('/api/stream', validBody));
        expect(stream.headers.get('content-type')).toContain('text/event-stream');
        expect(await stream.text()).toBe(sse);
        expect(upstream.mock.calls[1][0]).toMatch(/:streamGenerateContent\?alt=sse$/);
    });

    it('reports an unreachable upstream as 502', async () => {
        const handle = createGenaiHandler({
            apiKey: 'k', projectId: 'p', fetchImpl: vi.fn().mockRejectedValue(new Error('ECONNRESET')), verifyToken: goodToken, log: silent,
        });
        expect((await handle(request('/api/generate', validBody))).status).toBe(502);
    });
});

describe('/api/live-token', () => {
    it('mints a one-use token with a short start window and returns only the token', async () => {
        const upstream = vi.fn().mockResolvedValue(new Response(JSON.stringify({ name: 'auth_tokens/abc123' }), { status: 200 }));
        const now = Date.UTC(2026, 10, 23, 12, 0, 0);
        const handle = createLiveTokenHandler({
            apiKey: 'server-key', projectId: 'p', fetchImpl: upstream, verifyToken: goodToken, now: () => now, log: silent,
        });

        expect((await handle(request('/api/live-token', {}, {}))).status).toBe(401);

        const res = await handle(request('/api/live-token', {}));
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ token: 'auth_tokens/abc123', expiresAt: now + 30 * 60 * 1000 });

        const [url, init] = upstream.mock.calls[0];
        expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/auth_tokens');
        expect(init.headers['x-goog-api-key']).toBe('server-key');
        expect(JSON.parse(init.body)).toEqual({
            uses: 1,
            expireTime: '2026-11-23T12:30:00.000Z',
            newSessionExpireTime: '2026-11-23T12:01:00.000Z',
        });
    });

    it('surfaces Gemini errors and missing tokens', async () => {
        const upstream = vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'API key not valid' } }), { status: 400 }))
            .mockResolvedValueOnce(new Response('{}', { status: 200 }));
        const handle = createLiveTokenHandler({ apiKey: 'k', projectId: 'p', fetchImpl: upstream, verifyToken: goodToken, log: silent });
        const bad = await handle(request('/api/live-token', {}));
        expect(bad.status).toBe(400);
        expect((await bad.json()).error.message).toBe('API key not valid');
        expect((await handle(request('/api/live-token', {}))).status).toBe(502);
    });
});

describe('verifyFirebaseIdToken', () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

    const sign = (payload: Record<string, unknown>, kid = 'k1') => {
        const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
        const head = `${enc({ alg: 'RS256', kid })}.${enc(payload)}`;
        return `${head}.${crypto.sign('RSA-SHA256', Buffer.from(head), privateKey).toString('base64url')}`;
    };
    const now = Math.floor(Date.now() / 1000);
    const claims = { aud: 'proj', iss: 'https://securetoken.google.com/proj', sub: 'user-1', iat: now - 10, exp: now + 3600, firebase: { sign_in_provider: 'anonymous' } };

    beforeEach(() => {
        _resetCertCache();
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ k1: publicPem }), {
            status: 200, headers: { 'cache-control': 'public, max-age=100' },
        })));
    });
    afterEach(() => vi.unstubAllGlobals());

    it('accepts a correctly signed token', async () => {
        await expect(verifyFirebaseIdToken(sign(claims), 'proj')).resolves.toEqual({ uid: 'user-1', anonymous: true });
    });

    it('rejects wrong audience or issuer, expiry, unknown key and tampering', async () => {
        await expect(verifyFirebaseIdToken(sign({ ...claims, aud: 'other' }), 'proj')).rejects.toThrow('Wrong audience');
        await expect(verifyFirebaseIdToken(sign({ ...claims, iss: 'https://evil' }), 'proj')).rejects.toThrow('Wrong issuer');
        await expect(verifyFirebaseIdToken(sign({ ...claims, exp: now - 3600 }), 'proj')).rejects.toThrow('Token expired');
        await expect(verifyFirebaseIdToken(sign(claims, 'k2'), 'proj')).rejects.toThrow('Unknown signing key');
        const [h, , s] = sign(claims).split('.');
        const forged = Buffer.from(JSON.stringify({ ...claims, sub: 'admin' })).toString('base64url');
        await expect(verifyFirebaseIdToken(`${h}.${forged}.${s}`, 'proj')).rejects.toThrow('Bad signature');
        await expect(verifyFirebaseIdToken('garbage', 'proj')).rejects.toThrow('Malformed token');
    });
});
