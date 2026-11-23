import { encode, pcmTo16kInt16 } from '../utils/audioUtils';
import { Modality } from '@google/genai';

const MODEL_NAME = 'gemini-2.5-flash-native-audio-latest';
const API_VERSION = 'v1beta';

// Proxy URL for production — keeps API key server-side
// Set VITE_WS_PROXY_URL in your .env.local or hosting env vars
const WS_PROXY_URL = process.env.VITE_WS_PROXY_URL || '';

export interface GeminiCallbacks {
  onOpen: () => void;
  onMessage: (message: any) => void;
  onError: (error: ErrorEvent) => void;
  onClose: (event: CloseEvent) => void;
}

export interface LiveSession {
  sendRealtimeInput: (params: { media: { data: string; mimeType: string } }) => void;
  sendText: (text: string) => void;
  close: () => void;
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
 * Resolves the WebSocket URL.
 * - Production: uses the WS proxy (API key stays server-side)
 * - Development: connects directly to Gemini (requires client-side API key)
 */
function getWebSocketUrl(): string {
  if (WS_PROXY_URL) {
    // Production: connect to proxy — no API key in the client bundle
    const proxyUrl = WS_PROXY_URL.replace(/\/$/, ''); // trim trailing slash
    console.log('[GLOSSOS] Using WebSocket proxy:', proxyUrl);
    return `${proxyUrl}/ws`;
  }

  // Development fallback: direct connection (API key exposed — dev only!)
  const apiKey = process.env.API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('[GLOSSOS] No WS_PROXY_URL and no API key configured!');
    throw new Error(
      'Set VITE_WS_PROXY_URL for production, or GEMINI_API_KEY for local development.'
    );
  }
  console.warn('[GLOSSOS] [WARN] Using direct Gemini connection (API key exposed — dev only)');
  return `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.${API_VERSION}.GenerativeService.BidiGenerateContent?key=${apiKey}`;
}

/**
 * Starts a live session using raw WebSocket (bypasses SDK issues).
 * In production, connects through the WS proxy (API key stays server-side).
 * In development, falls back to a direct Gemini connection.
 * Returns a promise that resolves to a session-like object.
 */
export function startLiveSession(
  callbacks: GeminiCallbacks,
  language: string,
  userContext?: string,
  proficiencyLevel: string = 'Beginner',
  nativeLanguage: string = 'English',
  voiceName: string = 'Puck'
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

  const systemInstruction = userContext
    ? `${baseInstruction}\n\n${userContext}`
    : baseInstruction;

  return new Promise<LiveSession>((resolve, reject) => {
    try {
      const wsUrl = getWebSocketUrl();

      console.log('[GLOSSOS] Opening WebSocket connection...');
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log('[GLOSSOS] [OK] WebSocket OPEN — sending setup...');

        // Send setup message
        const setupMsg = {
          setup: {
            model: `models/${MODEL_NAME}`,
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
          }
        };
        ws.send(JSON.stringify(setupMsg));
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
          console.log('[GLOSSOS] [OK] Setup complete — session ready!');
          callbacks.onOpen();

          const session: LiveSession = {
            sendRealtimeInput: (params: { media: { data: string; mimeType: string } }) => {
              if (ws.readyState !== WebSocket.OPEN) return;
              const msg = {
                realtimeInput: {
                  mediaChunks: [{
                    data: params.media.data,
                    mimeType: params.media.mimeType,
                  }]
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
            close: () => {
              ws.close();
            }
          };

          resolve(session);
          return;
        }

        // Forward all other messages to the callback
        callbacks.onMessage(data);
      };

      ws.onerror = (e: Event) => {
        console.error('[GLOSSOS] [ERROR] WebSocket error:', e);
        callbacks.onError(e as ErrorEvent);
        reject(new Error('WebSocket connection error'));
      };

      ws.onclose = (e: CloseEvent) => {
        console.log('[GLOSSOS] 🔌 WebSocket closed:', e.code, e.reason);
        callbacks.onClose(e);
      };

    } catch (err) {
      reject(err);
    }
  });
}