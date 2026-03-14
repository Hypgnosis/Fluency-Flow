import { encode, pcmTo16kInt16 } from '../utils/audioUtils';
import { Modality } from '@google/genai';

const MODEL_NAME = 'gemini-2.5-flash-native-audio-preview-12-2025';
const API_VERSION = 'v1beta';

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
 * Starts a live session using raw WebSocket (bypasses SDK issues).
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
  // Use environment variable, fallback to hardcoded key only if missing (for debugging/dev convenience)
  const apiKey = process.env.API_KEY || process.env.GEMINI_API_KEY;

  // Explicit log to console
  console.log('[GLOSSOS] Starting Live Session with key length:', apiKey?.length);

  if (!apiKey) {
    console.error('[GLOSSOS] API Key is missing!');
    throw new Error("API_KEY environment variable not set");
  }

  const levelInstructions = {
    'Beginner': `The user is a complete beginner. Speak SLOWLY and clearly. Use very simple vocabulary and short sentences. If you use a complex word, immediately translate it to ${nativeLanguage}. Correct every mistake gently.`,
    'Intermediate': 'The user is at an intermediate level. Speak at a natural but clear pace. You can use more varied vocabulary but avoid very obscure idioms. Correct major grammatical errors but let minor ones slide to maintain flow.',
    'Advanced': 'The user is an advanced learner. Speak at a completely natural, native speed. Use sophisticated vocabulary, idioms, and slang. Only correct subtle mistakes or unnatural phrasing.',
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
- "Imagine you're at a cozy café in the morning, ordering your favorite breakfast..."
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

  const baseInstruction = language === nativeLanguage
    ? `You are GLOSSOS, an elite linguistic mastery system. The user wants to practice ${language} (their native language). Focus on advanced vocabulary, public speaking skills, and dialectical mastery. Level: ${proficiencyLevel}. ${selectedLevelInstruction} Keep your responses concise and clinical.${phoneticInstructions}${situationalSceneInstructions}`
    : `You are GLOSSOS, an elite linguistic mastery system. The user is a ${nativeLanguage} speaker acquiring ${language}. Level: ${proficiencyLevel}. ${selectedLevelInstruction} You must speak ONLY in ${language}, even if the user speaks ${nativeLanguage} (unless explaining a complex concept or translating for a Beginner). If the user gets stuck, explain in ${nativeLanguage}. Keep your responses concise and precise, and ask questions to maintain conversational cadence. ${proficiencyLevel === 'Advanced' ? 'Begin with: "Inmersión Total. Motor dialéctico activado." for Spanish or the equivalent in the target language. Do not offer help or simplification.' : proficiencyLevel === 'Intermediate' ? 'Begin with: "Engaging fluidity protocols. Focus on conversational cadence."' : 'Begin with a simple greeting in ${language}. Say: "Inicializando adquisición estructural." for Spanish or the equivalent greeting.'} ${phoneticInstructions}${situationalSceneInstructions}`;

  const systemInstruction = userContext
    ? `${baseInstruction}\n\n${userContext}`
    : baseInstruction;

  return new Promise<LiveSession>((resolve, reject) => {
    try {
      const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.${API_VERSION}.GenerativeService.BidiGenerateContent?key=${apiKey}`;

      console.log('[GLOSSOS] Opening WebSocket connection...');
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log('[GLOSSOS] ✅ WebSocket OPEN — sending setup...');

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
          console.log('[GLOSSOS] ✅ Setup complete — session ready!');
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
        console.error('[GLOSSOS] ❌ WebSocket error:', e);
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