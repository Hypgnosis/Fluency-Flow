/**
 * Server-side Gemini access for Glossos, run as Netlify Functions. The Gemini API key never
 * leaves the server.
 *
 *   POST /api/generate    -> models/{model}:generateContent         (JSON)
 *   POST /api/stream      -> models/{model}:streamGenerateContent   (server-sent events, passed through)
 *   POST /api/live-token  -> a one-use ephemeral token for the Gemini Live voice session
 *
 * Every route requires a signed-in Firebase user (Authorization: Bearer <Firebase ID token>).
 * The handlers take plain Request/Response objects, so they are tested without Netlify.
 */

import { verifyFirebaseIdToken, type VerifiedUser } from './firebaseAuth.ts';

const GEMINI_REST = 'https://generativelanguage.googleapis.com/v1beta';
export const DEFAULT_TEXT_MODELS = ['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-2.5-flash', 'gemini-3.5-transcribe'];
const MAX_BODY_BYTES = 6 * 1024 * 1024; // Netlify's buffered request limit
const RATE_WINDOW_MS = 60 * 1000;
/** Time a client has to open the Live session after getting a token. */
const LIVE_TOKEN_START_WINDOW_MS = 60 * 1000;
/** Lifetime of a Live token (an open session can run this long). */
const LIVE_TOKEN_LIFETIME_MS = 30 * 60 * 1000;

export interface ApiConfig {
    apiKey: string;
    projectId: string;
    allowedModels?: string[];
    rateLimitPerMinute?: number;
    fetchImpl?: typeof fetch;
    verifyToken?: (token: string, projectId: string) => Promise<VerifiedUser>;
    now?: () => number;
    log?: Pick<Console, 'warn' | 'error'>;
}

/** Reads the function configuration from Netlify environment variables. */
export function configFromEnv(env: Record<string, string | undefined> = process.env): ApiConfig {
    return {
        apiKey: env.GEMINI_API_KEY || '',
        projectId: env.FIREBASE_PROJECT_ID || '',
        allowedModels: env.GEMINI_TEXT_MODELS
            ? env.GEMINI_TEXT_MODELS.split(',').map(m => m.trim()).filter(Boolean)
            : DEFAULT_TEXT_MODELS,
        rateLimitPerMinute: Number(env.API_RATE_LIMIT_PER_MIN || 30),
    };
}

function jsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
}

export function errorResponse(status: number, message: string): Response {
    return jsonResponse(status, { error: { code: status, message } });
}

/**
 * Best-effort per-user limit. Function instances are short-lived, so this only stops bursts
 * within one instance; the Firebase sign-in requirement is the main protection.
 */
function createRateLimiter(limit: number, now: () => number) {
    const buckets = new Map<string, { start: number; count: number }>();
    return (key: string): boolean => {
        const t = now();
        const bucket = buckets.get(key);
        if (!bucket || t - bucket.start > RATE_WINDOW_MS) {
            if (buckets.size > 5000) buckets.clear();
            buckets.set(key, { start: t, count: 1 });
            return false;
        }
        bucket.count += 1;
        return bucket.count > limit;
    };
}

function createGuard(config: ApiConfig) {
    const verify = config.verifyToken ?? verifyFirebaseIdToken;
    const log = config.log ?? console;
    const isLimited = createRateLimiter(config.rateLimitPerMinute ?? 30, config.now ?? Date.now);

    /** Returns the caller's uid, or an error Response to send back. */
    return async (req: Request): Promise<string | Response> => {
        if (req.method !== 'POST') return errorResponse(405, 'Use POST');
        if (!config.apiKey || !config.projectId) {
            log.error('[api] GEMINI_API_KEY and FIREBASE_PROJECT_ID must be set for Netlify Functions');
            return errorResponse(503, 'The Glossos server is not configured yet.');
        }
        const match = /^Bearer\s+(.+)$/i.exec(req.headers.get('authorization') || '');
        if (!match) return errorResponse(401, 'Sign in required');
        let uid: string;
        try {
            uid = (await verify(match[1], config.projectId)).uid;
        } catch (err) {
            log.warn(`[api] Rejected token: ${(err as Error).message}`);
            return errorResponse(401, 'Your sign-in expired. Please sign in again.');
        }
        if (isLimited(uid)) return errorResponse(429, 'Too many requests. Please wait a moment.');
        return uid;
    };
}

async function readJson(req: Request): Promise<Record<string, unknown> | Response> {
    const length = Number(req.headers.get('content-length') || 0);
    if (length > MAX_BODY_BYTES) return errorResponse(413, 'Request too large');
    try {
        const text = await req.text();
        if (text.length > MAX_BODY_BYTES) return errorResponse(413, 'Request too large');
        const body = JSON.parse(text);
        return body && typeof body === 'object' && !Array.isArray(body) ? body : errorResponse(400, 'Invalid JSON body');
    } catch {
        return errorResponse(400, 'Invalid JSON body');
    }
}

async function upstreamError(res: Response): Promise<Response> {
    const text = await res.text().catch(() => '');
    let message = text.slice(0, 300) || res.statusText;
    try {
        message = JSON.parse(text).error.message || message;
    } catch { /* not JSON */ }
    return errorResponse(res.status, message);
}

/** Handler for /api/generate and /api/stream. */
export function createGenaiHandler(config: ApiConfig) {
    const guard = createGuard(config);
    const fetchImpl = config.fetchImpl ?? fetch;
    const allowedModels = config.allowedModels ?? DEFAULT_TEXT_MODELS;
    const log = config.log ?? console;

    return async (req: Request): Promise<Response> => {
        const { pathname } = new URL(req.url);
        const route = pathname.endsWith('/api/stream') ? 'stream' : pathname.endsWith('/api/generate') ? 'generate' : null;
        if (!route) return errorResponse(404, 'Not found');

        const caller = await guard(req);
        if (caller instanceof Response) return caller;

        const body = await readJson(req);
        if (body instanceof Response) return body;
        if (typeof body.model !== 'string' || !allowedModels.includes(body.model)) {
            return errorResponse(400, `Model not allowed: ${String(body.model).slice(0, 80)}`);
        }
        if (!Array.isArray(body.contents) || body.contents.length === 0) return errorResponse(400, 'contents is required');

        // Forward only these fields (no tools, safety overrides or cached content).
        const payload: Record<string, unknown> = { contents: body.contents };
        if (body.systemInstruction) payload.systemInstruction = body.systemInstruction;
        if (body.generationConfig) payload.generationConfig = body.generationConfig;

        const suffix = route === 'stream' ? ':streamGenerateContent?alt=sse' : ':generateContent';
        let upstream: Response;
        try {
            upstream = await fetchImpl(`${GEMINI_REST}/models/${encodeURIComponent(body.model)}${suffix}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.apiKey },
                body: JSON.stringify(payload),
                signal: req.signal,
            });
        } catch (err) {
            log.error(`[api] Upstream request failed: ${(err as Error).message}`);
            return errorResponse(502, 'Gemini is unreachable right now');
        }
        if (!upstream.ok) return upstreamError(upstream);

        if (route === 'generate') {
            return new Response(await upstream.text(), {
                status: 200,
                headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
            });
        }
        return new Response(upstream.body, {
            status: 200,
            headers: {
                'Content-Type': 'text/event-stream; charset=utf-8',
                'Cache-Control': 'no-cache, no-transform',
                'X-Accel-Buffering': 'no',
            },
        });
    };
}

/** Handler for /api/live-token: mints a one-use Gemini Live ephemeral token. */
export function createLiveTokenHandler(config: ApiConfig) {
    const guard = createGuard(config);
    const fetchImpl = config.fetchImpl ?? fetch;
    const now = config.now ?? Date.now;
    const log = config.log ?? console;

    return async (req: Request): Promise<Response> => {
        const caller = await guard(req);
        if (caller instanceof Response) return caller;

        const t = now();
        let upstream: Response;
        try {
            upstream = await fetchImpl(`${GEMINI_REST}/auth_tokens`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.apiKey },
                body: JSON.stringify({
                    uses: 1,
                    expireTime: new Date(t + LIVE_TOKEN_LIFETIME_MS).toISOString(),
                    newSessionExpireTime: new Date(t + LIVE_TOKEN_START_WINDOW_MS).toISOString(),
                }),
            });
        } catch (err) {
            log.error(`[api] Token request failed: ${(err as Error).message}`);
            return errorResponse(502, 'Gemini is unreachable right now');
        }
        if (!upstream.ok) return upstreamError(upstream);

        const data = (await upstream.json().catch(() => ({}))) as { name?: string };
        if (!data.name) return errorResponse(502, 'Gemini did not return a token');
        return jsonResponse(200, { token: data.name, expiresAt: t + LIVE_TOKEN_LIFETIME_MS });
    };
}
