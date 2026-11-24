import { encode, pcmTo16kInt16 } from '../utils/audioUtils';
import { authHeaders } from './genaiClient';
import { endLease, handlePaymentRequired, isBillingRefusal } from './billing';
import type { LivePurpose } from './billing/plans';
import type { LiveFunctionResponse } from './tutorSkills/types';

/**
 * Live (voice) models, best first. In November 2026 tests with real spoken audio, gemini-3.8-live
 * corrected learners accurately with ~1.2 s latency; the 2.5 native-audio model interrupted itself.
 * If a model is unavailable when a session starts, the next one is tried.
 * Override the first choice with GEMINI_LIVE_MODEL.
 */
export const DEFAULT_LIVE_MODEL = 'gemini-3.8-live';
const FALLBACK_LIVE_MODELS = ['gemini-3.1-flash-live-preview', 'gemini-2.5-flash-native-audio-latest'];
const API_VERSION = 'v1beta';

// Optional self-hosted WebSocket proxy (server/). Not needed on Netlify, where the browser gets a
// short-lived ephemeral token from /api/live-token instead.
const liveConfig = {
  model: process.env.GEMINI_LIVE_MODEL || DEFAULT_LIVE_MODEL,
  proxyUrl: process.env.VITE_WS_PROXY_URL || '',
  /** Dev-only key; always empty in production builds (see vite.config.ts). */
  devApiKey: process.env.API_KEY || process.env.GEMINI_API_KEY || '',
};

/** Test hook: overrides the build-time proxy URL / dev key / model. */
export function _setLiveConfig(overrides: Partial<typeof liveConfig>) {
  Object.assign(liveConfig, overrides);
}

/** The order in which Live models are tried when a session starts. */
export function liveModelOrder(): string[] {
  return [...new Set([liveConfig.model, DEFAULT_LIVE_MODEL, ...FALLBACK_LIVE_MODELS].filter(Boolean))];
}
const LIVE_WS_BASE = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage';
/** Compresses the Talk context after ~4 minutes of conversation, keeping the latest ~2. */
export const LIVE_CONTEXT_WINDOW = { triggerTokens: 6400, slidingWindow: { targetTokens: 3200 } };

export interface GeminiCallbacks {
  onOpen: () => void;
  onMessage: (message: any) => void;
  onError: (error: ErrorEvent) => void;
  onClose: (event: CloseEvent) => void;
}

export interface LiveSession {
  sendRealtimeInput: (params: { media: { data: string; mimeType: string } }) => void;
  sendText: (text: string) => void;
  /** Answers a `toolCall` message (Tutor Skills). */
  sendToolResponse: (functionResponses: LiveFunctionResponse[]) => void;
  close: () => void;
}

/** Tools for the session (Tutor Skills): Live API function declarations plus prompt guidance. */
export interface LiveTools {
  functionDeclarations: Record<string, unknown>[];
  instructions: string;
}

/**
 * Creates a Blob-compatible object for sending audio data.
 */
export function createBlob(data: Float32Array, inputSampleRate: number): { data: string; mimeType: string } {
  const int16 = pcmTo16kInt16(data, inputSampleRate);
  return {
    data: encode(new Uint8Array(int16.buffer)),
    mimeType: 'audio/pcm;rate=16000',
  };
}

/**
 * Resolves the Live WebSocket URL.
 * - Self-hosted proxy, if VITE_WS_PROXY_URL is set.
 * - Local `npm run dev`: direct connection with the dev key from .env.local.
 * - Production (Netlify): asks /api/live-token for a one-use ephemeral token and connects to the
 *   constrained endpoint with it, so the real API key never reaches the browser.
 */
export async function resolveLiveWebSocketUrl(fetchImpl: typeof fetch = fetch, purpose: LivePurpose = 'talk'): Promise<string> {
  if (liveConfig.proxyUrl) {
    return `${liveConfig.proxyUrl.replace(/\/$/, '')}/ws`;
  }
  if (liveConfig.devApiKey) {
    console.warn('[GLOSSOS] [DEV] Using direct Gemini connection with the local dev key');
    return `${LIVE_WS_BASE}.${API_VERSION}.GenerativeService.BidiGenerateContent?key=${liveConfig.devApiKey}`;
  }
  const res = await fetchImpl('/api/live-token', { method: 'POST', headers: await authHeaders(), body: JSON.stringify({ purpose }) });
  const body = await res.json().catch(() => ({}));
  if (isBillingRefusal(res.status, body)) throw new Error(handlePaymentRequired(body));
  if (!res.ok || !body.token) {
    throw new Error(body?.error?.message || `Could not start a voice session (${res.status})`);
  }
  const url = `${LIVE_WS_BASE}.${API_VERSION}.GenerativeService.BidiGenerateContentConstrained?access_token=${encodeURIComponent(body.token)}`;
  if (typeof body.leaseId === 'string') leaseByUrl.set(url, body.leaseId);
  return url;
}

/** Voice time the server reserved for each token URL, handed back when the session ends. */
const leaseByUrl = new Map<string, string>();

/**
 * Tells the server a Live connection is over, so unused reserved time is returned.
 * Pass used=false for a token that never opened a session.
 */
export function releaseLiveUrl(url: string | undefined, used = true): void {
  if (!url) return;
  const leaseId = leaseByUrl.get(url);
  if (!leaseId) return;
  leaseByUrl.delete(url);
  endLease(leaseId, used);
}

/**
 * Starts a live session using raw WebSocket (bypasses SDK issues).
 * In production, connects through the WS proxy (API key stays server-side).
 * In development, falls back to a direct Gemini connection.
 * Returns a promise that resolves to a session-like object.
 */
/**
 * How the voice tutor behaves. Written for speech: short turns, no formatting read aloud,
 * one correction at a time. (The previous 4k-character prompt made replies ~0.4 s slower and
 * long-winded, and the tutor read "[In English: ...]" brackets out loud.)
 */
export function buildTutorInstruction(language: string, nativeLanguage: string, level: string): string {
  if (language === nativeLanguage) {
    return `You are Glossos, a friendly ${language} conversation coach talking out loud with a native speaker who wants to express themselves better.
- This is a spoken conversation. Keep every turn short: one to three sentences, then hand the turn back, usually with a question.
- Never read out formatting, lists, brackets or labels.
- Help them find richer words and more natural phrasing. Offer at most one suggestion per turn.`;
  }
  const levelGuide = level === 'Advanced'
    ? `The learner is advanced.
- Speak only ${language}, at native speed, with idioms and natural expressions.
- Use ${nativeLanguage} only if they ask for it.`
    : level === 'Intermediate'
      ? `The learner is intermediate.
- Speak mostly ${language}, at a natural pace, with everyday vocabulary.
- Switch to ${nativeLanguage} only for a quick explanation when they are stuck, then go back to ${language}.`
      : `The learner is a beginner.
- Use very short, simple sentences and the most common words.
- Mix in ${nativeLanguage} naturally: say a ${language} phrase, then say what it means in ${nativeLanguage}. Just say it; never use brackets or labels.
- If they hesitate, seem lost, or answer in ${nativeLanguage}, explain briefly in ${nativeLanguage} and give them an easy phrase to say back.`;

  return `You are Glossos, a warm and patient ${language} tutor having a spoken conversation with a ${nativeLanguage} speaker.

HOW TO TALK
- This is a live voice conversation. Keep every turn short: one to three sentences, then hand the turn back, usually with one simple question.
- Never lecture or list. Never read out formatting, brackets, labels or stage directions.
- Sound like an encouraging friend, not a textbook.

${levelGuide}

CORRECTIONS
- When they make a mistake, say their sentence back the right way, then give the reason in a few words${level === 'Advanced' ? '' : ` of ${nativeLanguage}`}. Correct only the most important mistake in each turn.
- If a word was clearly mispronounced, say it slowly once and invite them to repeat it.

KEEP IT GOING
- Talk about their day, their interests, or a simple role-play (ordering at a café, asking for directions, checking into a hotel). Introduce one or two useful new words at a time.
- If they ask for help, explain in ${nativeLanguage}, then suggest a simple reply they can say in ${language}.`;
}

/** What the app says to the tutor when a session opens, so the tutor greets the learner first. */
export function kickoffPrompt(language: string, nativeLanguage: string, level: string): string {
  const help = level === 'Beginner' && language !== nativeLanguage ? ` Then say what it means in ${nativeLanguage}.` : '';
  return `(The learner just started a voice session. Greet them in ${language} with one short, friendly sentence and ask one easy question to get them talking.${help})`;
}

// ─── Connection prefetch ─────────────────────────────────────────────────
// Minting a Live token takes 0.4-1.3 s (plus a Netlify cold start), so the Talk page asks for one
// as soon as it opens. Tokens must be used within 60 s; prefetched ones are dropped after 45 s.
const PREFETCH_MAX_AGE_MS = 45_000;
let prefetched: { url: Promise<string>; at: number } | null = null;

/** Starts getting a Live connection URL (token) in the background. Safe to call repeatedly. */
export function prefetchLiveConnection(): void {
  if (prefetched && Date.now() - prefetched.at < PREFETCH_MAX_AGE_MS) return;
  if (prefetched) prefetched.url.then(url => releaseLiveUrl(url, false), () => undefined);
  const url = resolveLiveWebSocketUrl();
  const entry = { url, at: Date.now() };
  url.catch(() => { if (prefetched === entry) prefetched = null; });
  prefetched = entry;
}

/** A prefetched URL if it is still fresh (each token works once), otherwise a new one. */
function takeLiveWebSocketUrl(): Promise<string> {
  const entry = prefetched;
  prefetched = null;
  if (entry && Date.now() - entry.at < PREFETCH_MAX_AGE_MS) return entry.url.catch(() => resolveLiveWebSocketUrl());
  if (entry) entry.url.then(url => releaseLiveUrl(url, false), () => undefined);
  return resolveLiveWebSocketUrl();
}

export async function startLiveSession(
  callbacks: GeminiCallbacks,
  language: string,
  userContext?: string,
  proficiencyLevel: string = 'Beginner',
  nativeLanguage: string = 'English',
  voiceName: string = 'Puck',
  tools?: LiveTools
): Promise<LiveSession> {

  const baseInstruction = buildTutorInstruction(language, nativeLanguage, proficiencyLevel);

  const systemInstruction = [baseInstruction, userContext, tools?.instructions]
    .filter(Boolean)
    .join('\n\n');

  const setupFor = (model: string) => ({
    setup: {
      model: `models/${model}`,
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: voiceName
            }
          }
        }
      },
      systemInstruction: {
        parts: [{ text: systemInstruction }]
      },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      // Live re-bills the whole conversation on every turn, so without this a session's cost per
      // minute keeps growing. Tested on 3.8-live; do not combine with sessionResumption (no replies).
      contextWindowCompression: LIVE_CONTEXT_WINDOW,
      ...(tools?.functionDeclarations.length
        ? { tools: [{ functionDeclarations: tools.functionDeclarations }] }
        : {}),
    }
  });

  type Attempt = { session: LiveSession } | { failure: string };

  /** Opens one WebSocket for `model`. Resolves with the session, or with why it failed before setup. */
  const attempt = async (model: string): Promise<Attempt> => {
    // Throws (no retry) if we cannot get a URL/token, e.g. signed out or server not configured.
    const wsUrl = await takeLiveWebSocketUrl();

    return new Promise<Attempt>(resolve => {
      let ready = false;
      console.log(`[GLOSSOS] Opening WebSocket connection (${model})...`);
      const ws = new WebSocket(wsUrl);
      // ArrayBuffer frames decode synchronously, so server messages (and audio chunks) are
      // handled strictly in arrival order. Blob frames needed an async read that could reorder them.
      ws.binaryType = 'arraybuffer';

      ws.onopen = () => {
        console.log('[GLOSSOS] [OK] WebSocket OPEN — sending setup...');
        ws.send(JSON.stringify(setupFor(model)));
      };

      ws.onmessage = async (event: MessageEvent) => {
        let data: any;
        try {
          if (typeof event.data === 'string') {
            data = JSON.parse(event.data);
          } else if (typeof Blob !== 'undefined' && event.data instanceof Blob) {
            const text = await event.data.text();
            data = JSON.parse(text);
          } else {
            data = JSON.parse(new TextDecoder().decode(event.data));
          }
        } catch (e) {
          console.error('[GLOSSOS] Failed to parse message:', e);
          return;
        }

        // If this is the setupComplete message, resolve the session
        if (data.setupComplete !== undefined) {
          console.log(`[GLOSSOS] [OK] Setup complete — session ready (${model})`);
          ready = true;
          callbacks.onOpen();

          const session: LiveSession = {
            sendRealtimeInput: (params: { media: { data: string; mimeType: string } }) => {
              if (ws.readyState !== WebSocket.OPEN) return;
              // `realtimeInput.audio` is the current format; the older `mediaChunks` field is rejected
              // ("deprecated") or ignored by newer Live models.
              const msg = {
                realtimeInput: {
                  audio: {
                    data: params.media.data,
                    mimeType: params.media.mimeType,
                  }
                }
              };
              ws.send(JSON.stringify(msg));
            },
            sendText: (text: string) => {
              if (ws.readyState !== WebSocket.OPEN) {
                console.log('[GLOSSOS] Cannot send text: WebSocket not open');
                return;
              }
              // Gemini 3 Live models take text mid-conversation as realtimeInput.text;
              // clientContent turns are only for seeding history there. 2.5 models use clientContent.
              const msg = model.startsWith('gemini-2.')
                ? { clientContent: { turns: [{ role: 'user', parts: [{ text }] }], turnComplete: true } }
                : { realtimeInput: { text } };
              ws.send(JSON.stringify(msg));
            },
            sendToolResponse: (functionResponses: LiveFunctionResponse[]) => {
              if (ws.readyState !== WebSocket.OPEN || functionResponses.length === 0) return;
              ws.send(JSON.stringify({ toolResponse: { functionResponses } }));
            },
            close: () => {
              ws.close();
            }
          };

          resolve({ session });
          return;
        }

        // Forward all other messages to the callback
        callbacks.onMessage(data);
      };

      ws.onerror = (e: Event) => {
        console.error('[GLOSSOS] [ERROR] WebSocket error:', e);
        if (ready) callbacks.onError(e as ErrorEvent);
      };

      ws.onclose = (e: CloseEvent) => {
        console.log('[GLOSSOS] 🔌 WebSocket closed:', e.code, e.reason);
        releaseLiveUrl(wsUrl, ready);
        if (ready) callbacks.onClose(e);
        else resolve({ failure: `${e.code}${e.reason ? ` ${e.reason}` : ''}` });
      };
    });
  };

  let lastFailure = '';
  for (const model of liveModelOrder()) {
    const result = await attempt(model);
    if ('session' in result) return result.session;
    lastFailure = result.failure;
    console.warn(`[GLOSSOS] Live model ${model} could not start (${lastFailure}); trying the next one`);
  }
  const message = `Could not start a voice session (${lastFailure || 'no model available'})`;
  callbacks.onError({ message } as ErrorEvent);
  throw new Error(message);
}