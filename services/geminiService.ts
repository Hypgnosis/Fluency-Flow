import { encode, pcmTo16kInt16 } from '../utils/audioUtils';
import { authHeaders } from './genaiClient';
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
export async function resolveLiveWebSocketUrl(fetchImpl: typeof fetch = fetch): Promise<string> {
  if (liveConfig.proxyUrl) {
    return `${liveConfig.proxyUrl.replace(/\/$/, '')}/ws`;
  }
  if (liveConfig.devApiKey) {
    console.warn('[GLOSSOS] [DEV] Using direct Gemini connection with the local dev key');
    return `${LIVE_WS_BASE}.${API_VERSION}.GenerativeService.BidiGenerateContent?key=${liveConfig.devApiKey}`;
  }
  const res = await fetchImpl('/api/live-token', { method: 'POST', headers: await authHeaders() });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.token) {
    throw new Error(body?.error?.message || `Could not start a voice session (${res.status})`);
  }
  return `${LIVE_WS_BASE}.${API_VERSION}.GenerativeService.BidiGenerateContentConstrained?access_token=${encodeURIComponent(body.token)}`;
}

/**
 * Starts a live session using raw WebSocket (bypasses SDK issues).
 * In production, connects through the WS proxy (API key stays server-side).
 * In development, falls back to a direct Gemini connection.
 * Returns a promise that resolves to a session-like object.
 */
export async function startLiveSession(
  callbacks: GeminiCallbacks,
  language: string,
  userContext?: string,
  proficiencyLevel: string = 'Beginner',
  nativeLanguage: string = 'English',
  voiceName: string = 'Puck',
  tools?: LiveTools
): Promise<LiveSession> {

  const levelInstructions = {
    'Beginner': `The user is a COMPLETE BEGINNER. Follow these rules strictly:

SENTENCE LENGTH: Keep EVERY sentence to 3-7 words maximum. Never say long sentences. Break complex ideas into multiple tiny sentences.

SPEED: Speak at a natural, native pace (do NOT slow down artificially or over-enunciate). Use connected speech like a native speaker (e.g., say 'Hayadooin' not 'How are you doing').

VOCABULARY: Use only the 300 most common words. If you MUST use a word outside this range, IMMEDIATELY say it again in ${nativeLanguage} right after.

MANDATORY NATIVE LANGUAGE SCAFFOLDING: After every 2-3 exchanges, you MUST pause and give a brief explanation or summary in ${nativeLanguage}. Say something like: "[In ${nativeLanguage}: What I just said means... / Great job! You said... / Let me explain...]" Then continue in ${language}. Do NOT wait for the user to ask for help — proactively explain.

WHEN THE USER IS SILENT OR CONFUSED: If the user pauses for more than a moment, seems hesitant, or gives an incorrect response, IMMEDIATELY switch to ${nativeLanguage} to explain what you said, what it means, and suggest what they should say. Then repeat the ${language} phrase slowly.

CORRECTIONS: Correct EVERY mistake gently. First say the correct form in ${language}, then briefly explain why in ${nativeLanguage}.

FORMAT: Alternate frequently between ${language} and ${nativeLanguage}. A beginner needs constant reassurance and translation support. Never leave them confused.

EXAMPLE EXCHANGE:
Tutor: "Bonjour! Ca va?" [In English: That means 'Hello! How are you?'. You can answer 'Ca va bien' which means 'I'm fine'.]
User: "Sa va bee-en"
Tutor: "Tres bien! 'Ca va bien' — perfect!" [In English: Great job! You said 'I'm fine' correctly.]`,
    'Intermediate': `The user is at an intermediate level. Speak at a completely natural, native speed using everyday conversational flow and connected speech. You can use more varied vocabulary but avoid very obscure idioms. Correct major grammatical errors but let minor ones slide to maintain flow. If the user seems stuck on a concept, briefly explain in ${nativeLanguage} before continuing in ${language}. Aim for sentences of 5-12 words.`,
    'Advanced': 'The user is an advanced learner. Speak at a completely natural, native speed. Use sophisticated vocabulary, idioms, slang, and fully connected native speech patterns. Only correct subtle mistakes or unnatural phrasing.',
  };

  const selectedLevelInstruction = levelInstructions[proficiencyLevel as keyof typeof levelInstructions] || levelInstructions['Beginner'];

  const phoneticInstructions = `

PRONUNCIATION FEEDBACK REQUIREMENTS:
When you detect pronunciation issues, provide detailed phonetic analysis:
1. Identify the specific phoneme(s) that need improvement
2. Explain what went wrong
3. Describe the correct tongue and mouth positioning in simple terms
4. Compare to a similar sound in ${nativeLanguage} if helpful
5. Suggest 2-3 practice words that emphasize this sound
6. Rate the difficulty: easy, medium, or hard

Example format:
"I noticed your Spanish 'rr' sounded like an English 'r'. For the trilled 'rr', place your tongue against your upper teeth and let it vibrate. It's similar to the 'tt' sound in 'butter'. Try practicing: 'perro', 'carro', 'ferrocarril'. This is a medium difficulty sound."

Also provide:
- What they did well (strengths)
- Quick improvement tips (2-3 actionable points)
- Overall accuracy percentage if possible
`;

  const situationalSceneInstructions = `

SITUATIONAL TEACHING (AUDIO-VISUAL):
To make learning more immersive, regularly create vivid situational scenarios that help the learner practice real-world conversations. Describe scenes in detail so they can visualize the context:

Examples of great situational prompts:
- "Imagine you're at a cozy cafe in the morning, ordering your favorite breakfast..."
- "You're at a busy market, looking at fresh fruits and vegetables..."
- "Picture yourself checking in at a hotel reception desk..."
- "You're at the train station, trying to buy a ticket to the next city..."
- "Imagine you're at a restaurant with friends, ready to order dinner..."

When introducing new vocabulary or practice scenarios:
1. Set the scene with vivid, descriptive language about the location and atmosphere
2. Describe what you can see, hear, and smell in the environment
3. Present 2-3 useful phrases the learner would need in that situation
4. Ask them to practice responding as if they were there
5. Use scenario-based follow-up questions to deepen engagement

This creates an immersive experience where the learner can connect words to real situations.
`;

  const immersionRule = proficiencyLevel === 'Beginner'
    ? `You will FREQUENTLY alternate between ${language} and ${nativeLanguage}. Teach in both languages. Every few sentences in ${language}, pause and explain or summarize in ${nativeLanguage}. The user is a beginner and NEEDS constant ${nativeLanguage} support — do not wait for them to ask.`
    : proficiencyLevel === 'Intermediate'
      ? `Speak primarily in ${language}. If the user seems confused or stuck, briefly switch to ${nativeLanguage} to explain, then continue in ${language}.`
      : `Speak ONLY in ${language}. Full immersion. Only use ${nativeLanguage} if the user explicitly asks for clarification.`;

  const openingLine = proficiencyLevel === 'Advanced'
    ? `Begin with: "Inmersion Total. Motor dialectico activado." for Spanish or the equivalent in the target language. Do not offer help or simplification.`
    : proficiencyLevel === 'Intermediate'
      ? `Begin with: "Engaging fluidity protocols. Focus on conversational cadence."`
      : `Begin with a very short, simple greeting in ${language}, then IMMEDIATELY explain in ${nativeLanguage} what you just said and how the user should respond. Keep it warm and encouraging.`;

  const baseInstruction = language === nativeLanguage
    ? `You are GLOSSOS, an elite linguistic mastery system. The user wants to practice ${language} (their native language). Focus on advanced vocabulary, public speaking skills, and dialectical mastery. Level: ${proficiencyLevel}. ${selectedLevelInstruction} Keep your responses concise and clinical.${phoneticInstructions}${situationalSceneInstructions}`
    : `You are GLOSSOS, an elite linguistic mastery system. The user is a ${nativeLanguage} speaker acquiring ${language}. Level: ${proficiencyLevel}. ${selectedLevelInstruction} ${immersionRule} Keep your responses concise and precise, and ask questions to maintain conversational cadence. ${openingLine} ${phoneticInstructions}${situationalSceneInstructions}`;

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
      ...(tools?.functionDeclarations.length
        ? { tools: [{ functionDeclarations: tools.functionDeclarations }] }
        : {}),
    }
  });

  type Attempt = { session: LiveSession } | { failure: string };

  /** Opens one WebSocket for `model`. Resolves with the session, or with why it failed before setup. */
  const attempt = async (model: string): Promise<Attempt> => {
    // Throws (no retry) if we cannot get a URL/token, e.g. signed out or server not configured.
    const wsUrl = await resolveLiveWebSocketUrl();

    return new Promise<Attempt>(resolve => {
      let ready = false;
      console.log(`[GLOSSOS] Opening WebSocket connection (${model})...`);
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log('[GLOSSOS] [OK] WebSocket OPEN — sending setup...');
        ws.send(JSON.stringify(setupFor(model)));
      };

      ws.onmessage = async (event: MessageEvent) => {
        let data: any;
        try {
          if (typeof event.data === 'string') {
            data = JSON.parse(event.data);
          } else if (event.data instanceof Blob) {
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
              const msg = {
                clientContent: {
                  turns: [{
                    role: 'user',
                    parts: [{ text: text }]
                  }],
                  turnComplete: true
                }
              };
              console.log('[GLOSSOS] Sending text to Gemini:', JSON.stringify(msg));
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