import React, { useState, useRef, useCallback, useEffect, Suspense, lazy } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { startLiveSession, createBlob, prefetchLiveConnection, kickoffPrompt } from '../services/geminiService';
import { decode, decodeAudioData, encodeWAV } from '../utils/audioUtils';
import { TranscriptionEntry } from '../types';
import { upsertEntry } from '../utils/transcript';
import PronunciationScoreCircle from './PronunciationScoreCircle';
import { useAuth } from './AuthModal';
import { saveSession, loadUserContext, parseProfileMistakes } from '../services/sessionManager';
import { PronunciationAnalysisCard } from './PhoneticFeedback';
import { AudioComparisonPlayer } from './AudioComparisonPlayer';
import { createMockPhoneticAnalysis } from '../services/phoneticAnalysis';
import { shouldGenerateImage, generateSceneImage } from '../services/imageGenerationService';
import { SceneImage, SceneImageSkeleton } from './SceneImage';
import { useMobileResilience, resumeAudioContextsIfSuspended } from '../hooks/useMobileResilience';
import { useWebSocketSession, MAX_RECONNECT_ATTEMPTS } from '../hooks/useWebSocketSession';
import { glossosLog, glossosWarn, glossosError, mobileLog } from '../utils/debugLog';
import { SkillAttachmentView } from './skills/SkillAttachmentView';
import {
    buildFunctionDeclarations, buildSkillsInstruction, enabledSkills, executeToolCalls, newReviewMemory, runTurnReview,
} from '../services/tutorSkills/registry';
import { defaultSkillServices, describeAttachment } from '../services/tutorSkills/services';
import type { LiveFunctionCall, SkillAttachment, SkillContext, TutorSkill } from '../services/tutorSkills/types';
import { LEVELS, languageMeta, voiceLabel, useLearningSettings } from './shell/LearningSettings';
import { useShell } from './shell/shellContext';
import { Icon } from './ui/Icon';
import { Badge, Button, cx } from './ui/primitives';
import { LogoMark } from './ui/Logo';

const GlossosOrb = lazy(() => import('./GlossosOrb'));

type ConnectionState = 'IDLE' | 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED' | 'ERROR';

/** Audio buffer size for ScriptProcessor/WorkletNode (lower = less latency) */
const AUDIO_BUFFER_SIZE = 2048;
/** Output AudioContext sample rate — matches Gemini's 24kHz output */
const OUTPUT_SAMPLE_RATE = 24000;
/** How long to wait for first AI response before showing a hint (ms) */
const CONNECTION_TIMEOUT_MS = 15000;

/** Talk: real-time voice conversation with the tutor (Gemini Live). */
const Conversation: React.FC = () => {
    const { user } = useAuth();
    const shell = useShell();
    const {
        learnLanguage: selectedLanguage, nativeLanguage, level: proficiencyLevel, voice: selectedVoice,
        sceneImages: sceneImagesEnabled, skillPrefs,
    } = useLearningSettings();
    const [connectionState, setConnectionState] = useState<ConnectionState>('IDLE');
    const [transcriptionLog, setTranscriptionLog] = useState<TranscriptionEntry[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [volume, setVolume] = useState<number>(0);
    const [sessionStartTime, setSessionStartTime] = useState<number>(0);

    // Tutor Skills (port of Google AI Edge Gallery's Agent Skills onto Live API function calling)
    const activeSkillsRef = useRef<{ skills: TutorSkill[]; ctx: SkillContext } | null>(null);
    const reviewMemoryRef = useRef(newReviewMemory());
    const profileMistakesRef = useRef<{ incorrect: string; correct: string }[]>([]);
    // Timestamped trace of the session start-up and turns (dev builds only; stripped in production).
    const addDebugLog = useCallback((msg: string) => { glossosLog(`+${Math.round(performance.now())}ms ${msg}`); }, []);

    // ─── WebSocket session hook (keepalive, reconnect, session params) ───
    const {
        sessionPromiseRef,
        isIntentionalStopRef,
        reconnectAttemptsRef,
        lastStartParamsRef,
        startKeepalive,
        stopKeepalive,
        storeSessionParams,
        markIntentionalStop,
        createOnCloseHandler,
    } = useWebSocketSession();

    const inputAudioContextRef = useRef<AudioContext | null>(null);
    const outputAudioContextRef = useRef<AudioContext | null>(null);
    const scriptProcessorRef = useRef<ScriptProcessorNode | AudioWorkletNode | null>(null);
    const mediaStreamSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const userMediaStreamRef = useRef<MediaStream | null>(null);
    const nextStartTimeRef = useRef<number>(0);
    const outputSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
    const outputAnalyserRef = useRef<AnalyserNode | null>(null);
    const connectionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const recognitionRef = useRef<any>(null);

    // Transcript entry ids come from a counter: Date.now() ids collided when your words and the
    // tutor's reply arrived in the same millisecond, which merged the reply into your bubble.
    const entryIdRef = useRef(0);
    const turnAudioLoggedRef = useRef(false);
    const micChunksRef = useRef(0);
    const micPeakRef = useRef(0);
    const nextEntryId = () => ++entryIdRef.current;
    const currentInputTranscriptionRef = useRef({ id: -1, text: '' });
    const currentOutputTranscriptionRef = useRef({ id: -1, text: '' });
    const currentAudioChunksRef = useRef<Float32Array[]>([]);
    const logContainerRef = useRef<HTMLDivElement>(null);
    const latestTranscriptionLogRef = useRef<TranscriptionEntry[]>([]);
    const sessionStartTimeRef = useRef<number>(0);
    const isSavingRef = useRef<boolean>(false);
    const playbackAudioRef = useRef<HTMLAudioElement | null>(null);

    // Auto-scroll to bottom
    useEffect(() => {
        latestTranscriptionLogRef.current = transcriptionLog;
        if (logContainerRef.current) {
            const scrollOptions: ScrollToOptions = {
                top: logContainerRef.current.scrollHeight,
                behavior: 'smooth'
            };
            logContainerRef.current.scrollTo(scrollOptions);
        }
    }, [transcriptionLog]);

    // Warm up the slow parts of starting a conversation as soon as the Talk page opens.
    const userContextCacheRef = useRef<{ uid: string; value: Promise<string> } | null>(null);
    const loadUserContextQuickly = useCallback((uid: string): Promise<string> => {
        if (userContextCacheRef.current?.uid !== uid) {
            const value = loadUserContext(uid).catch(() => '');
            userContextCacheRef.current = { uid, value };
        }
        // Never hold up the conversation for the profile: give it 1.5 s, then start without it.
        return Promise.race([
            userContextCacheRef.current.value,
            new Promise<string>(resolve => setTimeout(() => resolve(''), 1500)),
        ]);
    }, []);
    useEffect(() => {
        if (!user) return;
        prefetchLiveConnection();
        void loadUserContextQuickly(user.uid);
    }, [user, loadUserContextQuickly]);

    // ─── MOBILE RESILIENCE: Visibility resume + Wake Lock (extracted to hook) ───
    useMobileResilience({
        connectionState,
        inputAudioContextRef,
        outputAudioContextRef,
        nextStartTimeRef,
        addDebugLog,
    });

    const cleanupResources = useCallback(() => {
        // Use ref instead of state to avoid stale closure — state captured
        // by useCallback would be outdated if transcriptionLog changed
        latestTranscriptionLogRef.current.forEach(entry => {
            if (entry.audioUrl) {
                URL.revokeObjectURL(entry.audioUrl);
            }
        });

        // Stop any playback audio
        if (playbackAudioRef.current) {
            playbackAudioRef.current.pause();
            playbackAudioRef.current = null;
        }

        if (recognitionRef.current) {
            recognitionRef.current.onend = null;
            try { recognitionRef.current.stop(); } catch(e) { glossosError('Recognition stop failed:', e); }
            recognitionRef.current = null;
        }

        // ─── MOBILE RESILIENCE: Clear keepalive interval ───
        stopKeepalive();

        if (userMediaStreamRef.current) {
            userMediaStreamRef.current.getTracks().forEach(track => track.stop());
            userMediaStreamRef.current = null;
        }

        if (scriptProcessorRef.current) {
            scriptProcessorRef.current.disconnect();
            scriptProcessorRef.current = null;
        }
        if (mediaStreamSourceRef.current) {
            mediaStreamSourceRef.current.disconnect();
            mediaStreamSourceRef.current = null;
        }

        if (inputAudioContextRef.current && inputAudioContextRef.current.state !== 'closed') {
            inputAudioContextRef.current.close().catch(e => glossosError('Failed to close input AudioContext:', e));
            inputAudioContextRef.current = null;
        }
        if (outputAnalyserRef.current) {
            outputAnalyserRef.current.disconnect();
            outputAnalyserRef.current = null;
        }
        if (outputAudioContextRef.current && outputAudioContextRef.current.state !== 'closed') {
            outputAudioContextRef.current.close().catch(e => glossosError('Failed to close output AudioContext:', e));
            outputAudioContextRef.current = null;
        }

        outputSourcesRef.current.forEach(source => source.stop());
        outputSourcesRef.current.clear();
        nextStartTimeRef.current = 0;
        setVolume(0);

    }, []); // No state dependencies — uses refs only

    const stopConversation = useCallback(async () => {
        // Mark as intentional stop so onClose doesn't also try to save
        markIntentionalStop();

        if (sessionPromiseRef.current) {
            sessionPromiseRef.current.then((session) => {
                session.close();
            }).catch(console.error);
            sessionPromiseRef.current = null;
        }

        // Save session if user is authenticated and there are transcriptions
        // Use refs to avoid stale closure — state values captured by useCallback may be outdated
        const currentTranscriptions = latestTranscriptionLogRef.current;
        const currentStartTime = sessionStartTimeRef.current;
        if (user && currentTranscriptions.length > 0 && currentStartTime > 0 && !isSavingRef.current) {
            isSavingRef.current = true;
            const duration = Math.floor((Date.now() - currentStartTime) / 1000); // seconds
            glossosLog(`Saving session: ${currentTranscriptions.length} entries, ${duration}s`);
            try {
                const docId = await saveSession(currentTranscriptions, selectedLanguage, duration);
                if (docId) {
                    glossosLog(`Session saved: ${docId}`);
                } else {
                    glossosWarn('Session save returned null (Firebase not configured or user not authenticated)');
                }
            } catch (saveError) {
                glossosError('Session save failed:', saveError);
                setError('Failed to save session progress. Your conversation was not saved.');
            } finally {
                isSavingRef.current = false;
            }
        } else {
            glossosLog(`Session not saved — user: ${!!user}, entries: ${currentTranscriptions.length}, startTime: ${currentStartTime}, alreadySaving: ${isSavingRef.current}`);
        }

        cleanupResources();
        setConnectionState('IDLE');
        // Refresh your profile (new mistakes from this session) and the next connection token in the background.
        if (user) {
            userContextCacheRef.current = null;
            void loadUserContextQuickly(user.uid);
            prefetchLiveConnection();
        }
        setSessionStartTime(0);
        sessionStartTimeRef.current = 0;
        isIntentionalStopRef.current = false;
    }, [cleanupResources, user, selectedLanguage, markIntentionalStop, loadUserContextQuickly]);

    // Help Me functionality
    const handleHelpMe = useCallback(() => {
        if (sessionPromiseRef.current) {
            addDebugLog('Help requested');

            // Show immediate feedback in the UI
            const newId = nextEntryId();
            setTranscriptionLog(prev => [
                ...prev,
                {
                    id: newId,
                    speaker: 'You',
                    text: 'Asked for help',
                    isFinal: true,
                    timestamp: Date.now()
                }
            ]);

            const helpPrompt = `(I'm stuck. In ${nativeLanguage}, briefly explain what you just said. Then give me one simple reply I can say in ${selectedLanguage}, and wait for me to try it.)`;
            sessionPromiseRef.current.then(session => {
                session.sendText(helpPrompt);
            });
        }
    }, [addDebugLog, proficiencyLevel, selectedLanguage, nativeLanguage]);

    // Nano Banana Pro Scene Image Generation
    const handleGenerateSceneImage = useCallback(async (entryId: number, tutorText: string) => {
        if (!sceneImagesEnabled) return;
        if (!shouldGenerateImage(tutorText)) return;

        // Mark entry as generating
        setTranscriptionLog(prev =>
            prev.map(entry =>
                entry.id === entryId
                    ? { ...entry, isGeneratingImage: true }
                    : entry
            )
        );

        try {
            const result = await generateSceneImage(tutorText, selectedLanguage);
            setTranscriptionLog(prev =>
                prev.map(entry =>
                    entry.id === entryId
                        ? {
                            ...entry,
                            sceneImageUrl: result.imageDataUrl,
                            isGeneratingImage: false,
                        }
                        : entry
                )
            );
        } catch (err) {
            console.error('Scene image generation failed:', err);
            setTranscriptionLog(prev =>
                prev.map(entry =>
                    entry.id === entryId
                        ? { ...entry, isGeneratingImage: false }
                        : entry
                )
            );
        }
    }, [sceneImagesEnabled, selectedLanguage]);

    /** Adds what a skill showed (mistake noted, word saved, card...) to the conversation. */
    const appendAttachments = useCallback((attachments: SkillAttachment[]) => {
        if (attachments.length === 0) return;
        const now = Date.now();
        setTranscriptionLog(prev => [
            ...prev,
            ...attachments.map(attachment => ({
                id: nextEntryId(),
                speaker: 'Tutor' as const,
                text: describeAttachment(attachment),
                isFinal: true,
                timestamp: now,
                attachment,
            })),
        ]);
    }, []);

    /** Runs the tutor's live tool calls (e.g. Wikipedia), answers them, and shows their results. */
    const handleToolCall = useCallback(async (calls: LiveFunctionCall[]) => {
        const active = activeSkillsRef.current;
        if (!active || calls.length === 0) return;
        addDebugLog(`Tool call: ${calls.map(c => c.name).join(', ')}`);
        const liveSkills = active.skills.filter(s => s.mode === 'live');
        const { responses, attachments } = await executeToolCalls(calls, liveSkills, active.ctx);
        sessionPromiseRef.current?.then(session => session.sendToolResponse(responses)).catch(glossosError);
        appendAttachments(attachments);
    }, [addDebugLog, appendAttachments]);

    const handleMessage = useCallback(async (message: any) => {
        try {
            // Log all messages for debugging
            const msgKeys = Object.keys(message);
            // Don't flood the UI log with every message, just non-content ones or errors
            if (!message.serverContent) {
                addDebugLog(`Msg: ${msgKeys.join(', ')}`);
            } else if (message.serverContent?.modelTurn && !turnAudioLoggedRef.current) {
                turnAudioLoggedRef.current = true;
                addDebugLog('First tutor audio of the turn');
            }
            if (message.serverContent?.turnComplete) turnAudioLoggedRef.current = false;

            // Handle setup complete
            if ((message as any).setupComplete) {
                addDebugLog('Setup Complete! Session Ready');
                glossosLog('Setup complete — session is ready');
                return;
            }

            if (message.toolCall) {
                handleToolCall(message.toolCall.functionCalls ?? []);
                return;
            }
            if (message.toolCallCancellation) {
                glossosLog('Tool calls cancelled:', message.toolCallCancellation.ids);
                return;
            }

            if (message.serverContent) {
                // Clear connection timeout on first message — we're getting responses
                if (connectionTimeoutRef.current) {
                    clearTimeout(connectionTimeoutRef.current);
                    connectionTimeoutRef.current = null;
                }

                const inChunk: string | undefined = message.serverContent.inputTranscription?.text;
                if (inChunk) {
                    if (currentInputTranscriptionRef.current.id === -1) {
                        addDebugLog(`Learner words: ${inChunk}`);
                        currentInputTranscriptionRef.current = { id: nextEntryId(), text: '' };
                    }
                    const entry = currentInputTranscriptionRef.current;
                    entry.text += inChunk;
                    // Newer Live models send your words late, after the reply has started:
                    // keep your bubble above the reply it belongs to.
                    const replyId = currentOutputTranscriptionRef.current.id;
                    const update = { id: entry.id, speaker: 'You' as const, text: entry.text, isFinal: false };
                    setTranscriptionLog(prev => upsertEntry(prev, update, replyId));
                }

                const outChunk: string | undefined = message.serverContent.outputTranscription?.text;
                if (outChunk) {
                    if (currentOutputTranscriptionRef.current.id === -1) {
                        addDebugLog(`Tutor words: ${outChunk}`);
                        currentOutputTranscriptionRef.current = { id: nextEntryId(), text: '' };
                    }
                    const entry = currentOutputTranscriptionRef.current;
                    entry.text += outChunk;
                    const update = { id: entry.id, speaker: 'Tutor' as const, text: entry.text, isFinal: false };
                    setTranscriptionLog(prev => upsertEntry(prev, update, -1));
                }

                if (message.serverContent.turnComplete) {
                    glossosLog('Turn complete');
                    const inputId = currentInputTranscriptionRef.current.id;
                    const outputId = currentOutputTranscriptionRef.current.id;
                    // Cast turnComplete to any to access runtime properties
                    const score = (message.serverContent?.turnComplete as any)?.inputTranscription?.pronunciationFeedback?.qualityScore;

                    let audioUrl: string | undefined = undefined;
                    if (inputId !== -1 && currentAudioChunksRef.current.length > 0 && inputAudioContextRef.current) {
                        const sampleRate = inputAudioContextRef.current.sampleRate;
                        const totalLength = currentAudioChunksRef.current.reduce((sum, chunk) => sum + chunk.length, 0);
                        const combined = new Float32Array(totalLength);
                        let offset = 0;
                        for (const chunk of currentAudioChunksRef.current) {
                            combined.set(chunk, offset);
                            offset += chunk.length;
                        }
                        const wavBlob = encodeWAV(combined, sampleRate, 1);
                        audioUrl = URL.createObjectURL(wavBlob);
                    }
                    currentAudioChunksRef.current = [];

                    // Generate mock phonetic analysis (Phase 4)
                    // In production, this would be parsed from AI response
                    const phoneticAnalysis = score && score < 4 ? createMockPhoneticAnalysis() : undefined;

                    setTranscriptionLog(prev =>
                        prev.map(entry => {
                            if (entry.id === inputId) {
                                return {
                                    ...entry,
                                    isFinal: true,
                                    pronunciationScore: score,
                                    audioUrl,
                                    phoneticAnalysis,
                                    timestamp: Date.now()
                                };
                            }
                            if (entry.id === outputId) {
                                return { ...entry, isFinal: true };
                            }
                            return entry;
                        })
                    );

                    // Trigger Nano Banana Pro scene image generation for tutor messages
                    const outputText = currentOutputTranscriptionRef.current.text;
                    const outputEntryId = currentOutputTranscriptionRef.current.id;
                    if (outputText && outputEntryId !== -1) {
                        handleGenerateSceneImage(outputEntryId, outputText);
                    }

                    // Tutor Skills: review the finished exchange in the background
                    // (mistake memory, saved words, phrase cards, progress tracking).
                    const active = activeSkillsRef.current;
                    if (active && outputText) {
                        runTurnReview({
                            learnerText: currentInputTranscriptionRef.current.text,
                            tutorText: outputText,
                            skills: active.skills,
                            ctx: active.ctx,
                            profileMistakes: profileMistakesRef.current,
                            memory: reviewMemoryRef.current,
                        }).then(appendAttachments);
                    }

                    currentInputTranscriptionRef.current = { id: -1, text: '' };
                    currentOutputTranscriptionRef.current = { id: -1, text: '' };
                }

                if (message.serverContent?.modelTurn) {
                    const modelTurn = message.serverContent.modelTurn;
                    if (modelTurn.parts && modelTurn.parts.length > 0) {
                        for (const part of modelTurn.parts) {
                            // NOTE: We intentionally do NOT render part.text here.
                            // modelTurn text contains the AI's raw thinking/processing/instructions
                            // which should not appear in the chat. The actual spoken words are
                            // captured via outputTranscription above — that's what the user sees.

                            // Extract and play audio part only
                            const audioData = part?.inlineData?.data;
                            if (audioData && outputAudioContextRef.current) {
                                try {
                                    // ─── MOBILE RESILIENCE: Resume both AudioContexts ───
                                    await resumeAudioContextsIfSuspended(inputAudioContextRef, outputAudioContextRef, nextStartTimeRef);

                                    const audioBytes = decode(audioData);
                                    const audioBuffer = await decodeAudioData(audioBytes, outputAudioContextRef.current, 24000, 1);

                                    const now = outputAudioContextRef.current.currentTime;
                                    nextStartTimeRef.current = Math.max(nextStartTimeRef.current, now);

                                    const source = outputAudioContextRef.current.createBufferSource();
                                    source.buffer = audioBuffer;
                                    if (outputAnalyserRef.current) {
                                        source.connect(outputAnalyserRef.current);
                                    } else {
                                        source.connect(outputAudioContextRef.current.destination);
                                    }

                                    source.onended = () => {
                                        outputSourcesRef.current.delete(source);
                                    };

                                    source.start(nextStartTimeRef.current);
                                    nextStartTimeRef.current += audioBuffer.duration;
                                    outputSourcesRef.current.add(source);
                                } catch (audioErr) {
                                    glossosError('Audio playback error:', audioErr);
                                }
                            }
                        }
                    }
                }

                if (message.serverContent?.interrupted) {
                    glossosLog('Interrupted');
                    outputSourcesRef.current.forEach(source => source.stop());
                    outputSourcesRef.current.clear();
                    nextStartTimeRef.current = 0;
                    // You talked over the tutor: close its bubble so your words appear after it.
                    const cutId = currentOutputTranscriptionRef.current.id;
                    if (cutId !== -1) {
                        setTranscriptionLog(prev => prev.map(e => e.id === cutId ? { ...e, isFinal: true } : e));
                        currentOutputTranscriptionRef.current = { id: -1, text: '' };
                    }
                }
            }
        } catch (msgErr) {
            glossosError('Error handling server message:', msgErr);
        }
    }, [addDebugLog, handleGenerateSceneImage, handleToolCall, appendAttachments]);

    const startConversation = async () => {
        addDebugLog('Start clicked');
        // Check authentication
        if (!user) {
            setError('Please sign in to start a conversation.');
            return;
        }

        setConnectionState('CONNECTING');
        setError(null);
        addDebugLog('Resources cleanup...');

        // IMPORTANT: Clean up old resources FIRST (this closes old AudioContexts)
        cleanupResources();

        setTranscriptionLog([]);
        currentInputTranscriptionRef.current = { id: -1, text: '' };
        currentOutputTranscriptionRef.current = { id: -1, text: '' };
        const now = Date.now();
        setSessionStartTime(now);
        sessionStartTimeRef.current = now;

        // NOW create fresh AudioContexts synchronously — still within the user gesture
        // This MUST happen after cleanup (which nulls the refs) and before any await
        try {
            const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
            inputAudioContextRef.current = new AudioContextClass();
            outputAudioContextRef.current = new AudioContextClass({ sampleRate: OUTPUT_SAMPLE_RATE });

            // ─── AI OUTPUT ANALYSER: for real-time orb frequency visualization ───
            outputAnalyserRef.current = outputAudioContextRef.current.createAnalyser();
            outputAnalyserRef.current.fftSize = 256;
            outputAnalyserRef.current.smoothingTimeConstant = 0.7;
            outputAnalyserRef.current.connect(outputAudioContextRef.current.destination);

            addDebugLog(`AudioContexts created (In: ${inputAudioContextRef.current.state}, Out: ${outputAudioContextRef.current.state})`);
        } catch (e) {
            glossosError('Failed to create AudioContext:', e);
            setError('Failed to initialize audio. Please try again.');
            setConnectionState('ERROR');
            return;
        }

        // Clear any existing timeout
        if (connectionTimeoutRef.current) {
            clearTimeout(connectionTimeoutRef.current);
            connectionTimeoutRef.current = null;
        }

        try {
            // Check for secure context (getUserMedia requires HTTPS or localhost)
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                throw new Error('Microphone access needs a secure (https) connection.');
            }

            // Everything the session needs, fetched at the same time instead of one after another:
            // the connection token, the microphone, the audio worklet and your learning profile.
            prefetchLiveConnection();
            const workletReady = inputAudioContextRef.current!.audioWorklet
                ? inputAudioContextRef.current!.audioWorklet.addModule('/audio-processor-worklet.js').then(() => true, () => false)
                : Promise.resolve(false);
            const [userContext, stream] = await Promise.all([
                loadUserContextQuickly(user.uid).then(v => { addDebugLog(`Profile ready (${v.length} chars)`); return v; }),
                navigator.mediaDevices.getUserMedia({
                    audio: {
                        channelCount: 1,
                        sampleRate: 16000,
                        // Without echo cancellation the tutor hears itself through the speakers and keeps interrupting itself.
                        echoCancellation: true,
                        noiseSuppression: true,
                        autoGainControl: true,
                    },
                }).then(s => { addDebugLog('getUserMedia resolved'); return s; }).catch(() => {
                    throw new Error('Microphone access was blocked. Allow the microphone for this site in your browser settings, then try again.');
                }),
            ]);
            addDebugLog('Microphone acquired');
            userMediaStreamRef.current = stream;

            // Resume contexts (they were created synchronously above, they should still be valid)
            await inputAudioContextRef.current!.resume();
            await outputAudioContextRef.current!.resume();
            addDebugLog(`AudioContexts resumed (In: ${inputAudioContextRef.current!.state}, Out: ${outputAudioContextRef.current!.state})`);

            mediaStreamSourceRef.current = inputAudioContextRef.current.createMediaStreamSource(stream);

            // ─── Shared audio processing callback ───
            const processAudioChunk = (inputData: Float32Array) => {
                // Calculate volume for visualizer
                let sum = 0;
                for (let i = 0; i < inputData.length; i++) {
                    sum += inputData[i] * inputData[i];
                }
                const rms = Math.sqrt(sum / inputData.length);
                setVolume(prev => prev * 0.8 + Math.min(rms * 15, 1.5) * 0.2);

                micChunksRef.current += 1;
                micPeakRef.current = Math.max(micPeakRef.current, rms);
                if (micChunksRef.current % 50 === 0) {
                    addDebugLog(`Mic chunks ${micChunksRef.current}, peak level ${micPeakRef.current.toFixed(3)}`);
                    micPeakRef.current = 0;
                }

                // Keep raw float data for local playback recording
                currentAudioChunksRef.current.push(new Float32Array(inputData));

                if (inputAudioContextRef.current) {
                    const currentSampleRate = inputAudioContextRef.current.sampleRate;
                    const pcmBlob = createBlob(inputData, currentSampleRate);
                    sessionPromiseRef.current?.then((session) => {
                        try {
                            session.sendRealtimeInput({ media: pcmBlob });
                        } catch (sendErr) {
                            glossosError('Error sending audio:', sendErr);
                        }
                    }).catch((sessionErr) => {
                        glossosError('Session promise rejected:', sessionErr);
                    });
                }
            };

            // ─── AudioWorklet (preferred) — processes audio off the main thread ───
            // Falls back to ScriptProcessorNode for browsers without AudioWorklet support
            let audioNodeConnected = false;
            if (await workletReady) {
                try {
                    const workletNode = new AudioWorkletNode(inputAudioContextRef.current, 'audio-capture-processor');
                    workletNode.port.onmessage = (event) => {
                        if (event.data.type === 'audio') {
                            processAudioChunk(event.data.buffer);
                        }
                    };
                    mediaStreamSourceRef.current.connect(workletNode);
                    // AudioWorkletNode doesn't need a destination connection to stay alive
                    workletNode.connect(inputAudioContextRef.current.destination);
                    scriptProcessorRef.current = workletNode;
                    audioNodeConnected = true;
                    mobileLog('Using AudioWorkletNode (off main thread)');
                    addDebugLog('Audio: WorkletNode (off-thread)');
                } catch (workletErr) {
                    mobileLog('AudioWorklet failed, falling back to ScriptProcessor:', workletErr);
                }
            }

            // ─── Fallback: ScriptProcessorNode (deprecated but universally supported) ───
            if (!audioNodeConnected) {
                const scriptNode = inputAudioContextRef.current.createScriptProcessor(AUDIO_BUFFER_SIZE, 1, 1);
                scriptNode.onaudioprocess = (audioProcessingEvent) => {
                    processAudioChunk(audioProcessingEvent.inputBuffer.getChannelData(0));
                };
                mediaStreamSourceRef.current.connect(scriptNode);
                const silentGain = inputAudioContextRef.current.createGain();
                silentGain.gain.value = 0;
                scriptNode.connect(silentGain);
                silentGain.connect(inputAudioContextRef.current.destination);
                scriptProcessorRef.current = scriptNode;
                mobileLog('Using ScriptProcessorNode (fallback)');
                addDebugLog('Audio: ScriptProcessor (fallback)');
            }

            addDebugLog('Connecting to Gemini...');
            // ─── MOBILE RESILIENCE: Store params for auto-reconnect ───
            // ─── Tutor Skills: declare the enabled tools for this session ───
            const skills = enabledSkills(skillPrefs);
            reviewMemoryRef.current = newReviewMemory();
            profileMistakesRef.current = parseProfileMistakes(userContext || '');
            activeSkillsRef.current = {
                skills,
                ctx: { nativeLanguage, learnLanguage: selectedLanguage, level: proficiencyLevel, services: defaultSkillServices },
            };
            const tools = skills.length
                ? { functionDeclarations: buildFunctionDeclarations(skills), instructions: buildSkillsInstruction(skills) }
                : undefined;
            storeSessionParams({ language: selectedLanguage, userContext: userContext || '', proficiencyLevel, nativeLanguage, voiceName: selectedVoice, tools });

            // ─── Create onClose handler with reconnection logic (from hook) ───
            const handleWsClose = createOnCloseHandler({
                addDebugLog,
                setConnectionState,
                setError,
                handleMessage,
                cleanupResources,
                inputAudioContextRef,
                outputAudioContextRef,
                outputSourcesRef,
                nextStartTimeRef,
                onFinalDisconnect: (eventCode: number) => {
                    if (eventCode !== 1000 && reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
                        setError('Connection lost. Please restart the session.');
                    }

                    // Save on abnormal disconnects (stopConversation handles intentional saves)
                    if (!isIntentionalStopRef.current && !isSavingRef.current && user && latestTranscriptionLogRef.current.length > 0 && sessionStartTimeRef.current > 0) {
                        glossosLog('Abnormal disconnect — saving session from onClose');
                        isSavingRef.current = true;
                        const duration = Math.floor((Date.now() - sessionStartTimeRef.current) / 1000);
                        saveSession(latestTranscriptionLogRef.current, selectedLanguage, duration)
                            .catch(glossosError)
                            .finally(() => { isSavingRef.current = false; });
                    } else {
                        glossosLog(`onClose: skipping save (intentional=${isIntentionalStopRef.current}, saving=${isSavingRef.current})`);
                    }

                    setConnectionState('DISCONNECTED');
                    cleanupResources();
                    setSessionStartTime(0);
                    sessionStartTimeRef.current = 0;
                    reconnectAttemptsRef.current = 0;
                },
            });

            sessionPromiseRef.current = startLiveSession({
                onOpen: () => {
                    addDebugLog('WebSocket OPEN');
                    glossosLog('WebSocket onOpen fired');
                    glossosLog('Input AudioContext state:', inputAudioContextRef.current?.state);
                    glossosLog('Output AudioContext state:', outputAudioContextRef.current?.state);
                    setConnectionState('CONNECTED');
                    reconnectAttemptsRef.current = 0;

                    // The tutor speaks first, so the session never sits in silence waiting for you.
                    const kickoff = kickoffPrompt(selectedLanguage, nativeLanguage, proficiencyLevel);
                    sessionPromiseRef.current?.then(session => session.sendText(kickoff)).catch(glossosError);

                    // ─── MOBILE RESILIENCE: Start keepalive (deduplicated via hook) ───
                    startKeepalive();

                    // Set a timeout — if no AI response within 15s of CONNECTED, show a hint
                    connectionTimeoutRef.current = setTimeout(() => {
                        if (latestTranscriptionLogRef.current.length === 0) {
                            setError('No response from the AI tutor yet. Try speaking louder or check your microphone. The AI should respond within a few seconds.');
                        }
                        connectionTimeoutRef.current = null;
                    }, CONNECTION_TIMEOUT_MS);
                },
                onMessage: handleMessage,
                onError: (e: ErrorEvent) => {
                    addDebugLog(`Socket Error: ${e.message}`);
                    glossosError('Session error:', e);
                    const errorMsg = e.message || 'Unknown connection error';
                    if (errorMsg.includes('API key') || errorMsg.includes('401') || errorMsg.includes('403')) {
                        setError('Invalid API Key or authorization error. Please check your credentials.');
                    } else if (errorMsg.includes('model') || errorMsg.includes('404')) {
                        setError('The selected AI model is currently unavailable. Please try again later.');
                    } else {
                        setError(`Connection error: ${errorMsg}`);
                    }
                    setConnectionState('ERROR');
                    cleanupResources();
                },
                onClose: handleWsClose,
            }, selectedLanguage, userContext, proficiencyLevel, nativeLanguage, selectedVoice, tools);

            // Handle session promise for audio sending
            sessionPromiseRef.current.then(() => {
                addDebugLog('Session Promise Resolved');
            }).catch((err) => {
                addDebugLog(`Session Promise Rejected: ${err.message}`);
            });

        } catch (err) {
            glossosError('Failed to start session:', err);
            addDebugLog(`Start Error: ${(err as Error).message}`);
            const message = err instanceof Error ? err.message : 'An unknown error occurred.';
            setError(`Failed to start conversation. ${message}`);
            setConnectionState('ERROR');
            cleanupResources();
        }
    };

    // Cleanup on unmount ONLY
    useEffect(() => {
        return () => {
            // Directly clean up resources using refs to avoid dependency on closures/state
            if (sessionPromiseRef.current) {
                sessionPromiseRef.current.then(session => session.close()).catch(console.error);
                sessionPromiseRef.current = null;
            }
            if (inputAudioContextRef.current) {
                inputAudioContextRef.current.close().catch(console.error);
            }
            if (outputAudioContextRef.current) {
                outputAudioContextRef.current.close().catch(console.error);
            }
            if (scriptProcessorRef.current) {
                scriptProcessorRef.current.disconnect();
            }
            if (mediaStreamSourceRef.current) {
                mediaStreamSourceRef.current.disconnect();
            }
            if (userMediaStreamRef.current) {
                userMediaStreamRef.current.getTracks().forEach(track => track.stop());
            }
            if (connectionTimeoutRef.current) {
                clearTimeout(connectionTimeoutRef.current);
            }
        };
    }, []); // Empty dependency array ensures this ONLY runs on unmount

    const isConversationActive = connectionState === 'CONNECTED' || connectionState === 'CONNECTING';

    // Let the shell lock navigation and language settings while a conversation runs.
    const { setVoiceActive } = shell;
    useEffect(() => { setVoiceActive(isConversationActive); }, [isConversationActive, setVoiceActive]);
    useEffect(() => () => setVoiceActive(false), [setVoiceActive]);

    const replay = useCallback((url: string) => {
        if (playbackAudioRef.current) {
            playbackAudioRef.current.pause();
            playbackAudioRef.current.currentTime = 0;
        }
        const audio = new Audio(url);
        playbackAudioRef.current = audio;
        audio.onended = () => { playbackAudioRef.current = null; };
        audio.play().catch(console.error);
    }, []);

    const empty = transcriptionLog.length === 0;
    const learn = languageMeta(selectedLanguage);
    const levelLabel = LEVELS.find(l => l.id === proficiencyLevel)?.label ?? proficiencyLevel;
    const skillNames = new Set(enabledSkills(skillPrefs).map(s => s.name));
    const perks = [
        skillNames.has('log_mistake') && 'Remembers your mistakes',
        skillNames.has('save_vocabulary') && 'Saves new words',
        skillNames.has('show_card') && 'Phrase cards',
        skillNames.has('lookup_wikipedia') && 'Looks things up',
        sceneImagesEnabled && 'Paints the scene',
    ].filter(Boolean) as string[];
    const canAskHelp = connectionState === 'CONNECTED' && proficiencyLevel !== 'Advanced';
    const statusLabel =
        connectionState === 'CONNECTING' ? 'Connecting…'
            : connectionState === 'CONNECTED' ? 'Listening. Tap the red button to end.'
                : connectionState === 'ERROR' ? 'Tap the microphone to try again'
                    : connectionState === 'DISCONNECTED' ? 'Conversation ended. Tap to start a new one.'
                        : 'Tap the microphone to start talking';

    return (
        <div className="relative flex h-full flex-col">
            <div ref={logContainerRef} className="relative min-h-0 flex-1 overflow-y-auto">
                {empty ? (
                    <div className="flex h-full min-h-[430px] flex-col">
                        <div className="relative min-h-[200px] flex-1">
                            <div className="absolute inset-0">
                                <Suspense fallback={
                                    <div className="flex h-full items-center justify-center">
                                        <div className="h-40 w-40 animate-breathe rounded-full bg-[radial-gradient(circle_at_35%_30%,rgba(255,224,138,0.35),rgba(255,191,0,0.08)_55%,transparent_70%)]" />
                                    </div>
                                }>
                                    <GlossosOrb connectionState={connectionState} volume={volume} aiAnalyser={outputAnalyserRef.current} />
                                </Suspense>
                            </div>
                        </div>
                        <AnimatePresence mode="wait" initial={false}>
                            <motion.div
                                key={connectionState === 'DISCONNECTED' ? 'IDLE' : connectionState}
                                className="relative z-10 mx-auto w-full max-w-lg px-6 pb-4 text-center"
                                initial={{ opacity: 0, y: 12 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -8 }}
                                transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                            >
                                {connectionState === 'CONNECTING' ? (
                                    <>
                                        <h2 className="font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">Connecting to your tutor…</h2>
                                        <p className="mt-2.5 text-[15px] leading-relaxed text-slate-400">Allow microphone access if your browser asks.</p>
                                    </>
                                ) : connectionState === 'CONNECTED' ? (
                                    <>
                                        <Badge tone="mint"><span className="h-1.5 w-1.5 rounded-full bg-mint-400" /> Live</Badge>
                                        <h2 className="mt-3 font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">Your tutor is listening</h2>
                                        <p className="mt-2.5 text-[15px] leading-relaxed text-slate-400">Say hello. Even one word is a great start. Try:</p>
                                        {learn.hello && (
                                            <p className="mx-auto mt-3 inline-block rounded-2xl border border-gold-500/25 bg-gold-500/[0.08] px-4 py-2 font-display text-lg font-semibold text-gold-200">
                                                “{learn.hello}”
                                            </p>
                                        )}
                                    </>
                                ) : connectionState === 'ERROR' ? (
                                    <>
                                        <h2 className="font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">We couldn’t connect</h2>
                                        <p className="mt-2.5 text-[15px] leading-relaxed text-slate-400">Check your internet connection and microphone, then try again.</p>
                                    </>
                                ) : (
                                    <>
                                        <Badge tone="gold">{learn.native} · {levelLabel}</Badge>
                                        <h2 className="mt-3 font-display text-[28px] font-bold leading-tight tracking-tight text-white sm:text-4xl">
                                            Let’s talk in {selectedLanguage}
                                        </h2>
                                        <p className="mt-3 text-[15px] leading-relaxed text-slate-400">
                                            Tap the microphone and just start speaking. Your tutor answers out loud, keeps it at your level and gently fixes mistakes.
                                        </p>
                                        {perks.length > 0 && (
                                            <div className="mt-5 flex flex-wrap justify-center gap-2">
                                                {perks.map((perk, i) => (
                                                    <motion.span
                                                        key={perk}
                                                        initial={{ opacity: 0, y: 6 }}
                                                        animate={{ opacity: 1, y: 0 }}
                                                        transition={{ delay: 0.15 + i * 0.06 }}
                                                        className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.07] bg-white/[0.03] px-3 py-1 text-xs font-medium text-slate-300"
                                                    >
                                                        <Icon name="check" size={12} strokeWidth={2.5} className="text-mint-400" />
                                                        {perk}
                                                    </motion.span>
                                                ))}
                                            </div>
                                        )}
                                    </>
                                )}
                            </motion.div>
                        </AnimatePresence>
                    </div>
                ) : (
                    <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6 sm:px-6">
                        <MessageList log={transcriptionLog} learnLanguage={selectedLanguage} onReplay={replay} />
                    </div>
                )}
            </div>

            <AnimatePresence>
                {error && (
                    <motion.div
                        role="alert"
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 8 }}
                        className="mx-auto mb-2 flex w-[calc(100%-2rem)] max-w-xl items-start gap-3 rounded-2xl border border-rose-400/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-100 backdrop-blur-xl"
                    >
                        <Icon name="help" size={18} className="mt-0.5 shrink-0 text-rose-300" />
                        <span className="flex-1 leading-snug">{error}</span>
                        <button type="button" onClick={() => setError(null)} aria-label="Dismiss" className="text-rose-300 hover:text-white">
                            <Icon name="x" size={16} />
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Control dock */}
            <div className="relative shrink-0 px-4 pb-4 pt-1 sm:pb-6">
                <div className="mx-auto flex max-w-xl items-center justify-between gap-2 rounded-[28px] border border-white/[0.07] bg-ink-900/75 p-2.5 shadow-[0_24px_60px_-24px_rgba(0,0,0,0.95)] backdrop-blur-2xl">
                    <div className="flex w-[124px] justify-start">
                        {canAskHelp ? (
                            <Button variant="secondary" size="md" icon="help" onClick={handleHelpMe} className="rounded-full">Help me</Button>
                        ) : (
                            <button
                                type="button"
                                onClick={shell.openSettings}
                                disabled={isConversationActive}
                                className="flex items-center gap-2 rounded-full px-3 py-2 text-left transition-colors hover:bg-white/[0.06] disabled:opacity-40"
                                aria-label={`Tutor voice: ${voiceLabel(selectedVoice)}. Change`}
                            >
                                <Icon name="speaker" size={18} className="text-slate-400" />
                                <span className="leading-tight">
                                    <span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Voice</span>
                                    <span className="block text-sm font-semibold text-white">{voiceLabel(selectedVoice)}</span>
                                </span>
                            </button>
                        )}
                    </div>

                    <motion.button
                        type="button"
                        onClick={isConversationActive ? stopConversation : startConversation}
                        disabled={connectionState === 'CONNECTING'}
                        aria-label={isConversationActive ? 'End conversation' : 'Start talking'}
                        whileHover={{ scale: 1.04 }}
                        whileTap={{ scale: 0.94 }}
                        className="relative flex h-[68px] w-[68px] shrink-0 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/70 focus-visible:ring-offset-4 focus-visible:ring-offset-ink-900"
                    >
                        {!isConversationActive && (
                            <motion.span
                                className="absolute inset-0 rounded-full bg-gold-500/35"
                                animate={{ scale: [1, 1.45], opacity: [0.55, 0] }}
                                transition={{ duration: 2.4, repeat: Infinity, ease: 'easeOut' }}
                            />
                        )}
                        {connectionState === 'CONNECTING' && (
                            <span className="absolute -inset-1.5 animate-spin rounded-full border-2 border-gold-400/15 border-t-gold-400" />
                        )}
                        {connectionState === 'CONNECTED' && (
                            <span
                                className="absolute inset-0 rounded-full border-2 border-rose-300/50"
                                style={{ transform: `scale(${1 + Math.min(volume, 1.2) * 0.4})`, transition: 'transform 90ms linear' }}
                            />
                        )}
                        <span className={cx(
                            'relative flex h-full w-full items-center justify-center rounded-full transition-colors duration-300',
                            isConversationActive
                                ? 'bg-gradient-to-b from-rose-400 to-rose-600 text-white shadow-[0_12px_36px_-10px_rgba(244,63,94,0.8)]'
                                : 'bg-gradient-to-b from-gold-300 to-gold-500 text-ink-950 shadow-[0_12px_40px_-10px_rgba(255,191,0,0.85)]',
                        )}>
                            {isConversationActive
                                ? <Icon name="stop" size={22} strokeWidth={2} fill="currentColor" />
                                : <Icon name="mic" size={28} strokeWidth={2} />}
                        </span>
                    </motion.button>

                    <div className="flex w-[124px] justify-end">
                        {connectionState === 'CONNECTED' ? (
                            <div className="flex items-center gap-2.5 pr-3" aria-label="Microphone level">
                                <div className="flex h-6 items-center gap-[3px]">
                                    {[0.45, 0.75, 1, 0.75, 0.45].map((k, i) => (
                                        <span
                                            key={i}
                                            className="w-[3px] rounded-full bg-mint-400"
                                            style={{ height: `${4 + Math.min(volume, 1) * 20 * k}px`, transition: 'height 90ms linear' }}
                                        />
                                    ))}
                                </div>
                                <ElapsedTime start={sessionStartTime} />
                            </div>
                        ) : connectionState === 'CONNECTING' ? (
                            <span className="pr-3 text-sm font-medium text-gold-300">Connecting</span>
                        ) : (
                            <button
                                type="button"
                                onClick={shell.openSettings}
                                className="flex items-center gap-2 rounded-full px-3 py-2 text-right transition-colors hover:bg-white/[0.06]"
                                aria-label="Tutor skills and settings"
                            >
                                <span className="leading-tight">
                                    <span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Skills</span>
                                    <span className="block text-sm font-semibold text-white">{skillNames.size} on</span>
                                </span>
                                <Icon name="tools" size={18} className="text-slate-400" />
                            </button>
                        )}
                    </div>
                </div>
                <p className="mt-2.5 text-center text-xs font-medium text-slate-500" aria-live="polite">{statusLabel}</p>
            </div>
        </div>
    );
};

/** Spoken transcripts sometimes carry markdown emphasis (*fui*); show plain text. */
const plainSpeech = (text: string) => text.replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1');

/** The conversation transcript. Memoized so the live mic level does not re-render every message. */
const MessageList = React.memo<{ log: TranscriptionEntry[]; learnLanguage: string; onReplay: (url: string) => void }>(({ log, learnLanguage, onReplay }) => (
    <>
            {log.map(entry => (
                <motion.div
                    key={entry.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                >
                    {entry.attachment ? (
                        <div className="flex gap-3">
                            <span className="w-8 shrink-0" />
                            <SkillAttachmentView attachment={entry.attachment} learnLanguage={learnLanguage} />
                        </div>
                    ) : entry.speaker === 'Tutor' ? (
                        <div className="flex items-start gap-3">
                            <span className="mt-6 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/[0.08] bg-ink-800 shadow-[0_6px_18px_-8px_rgba(255,191,0,0.6)]">
                                <LogoMark size={17} />
                            </span>
                            <div className="min-w-0 max-w-[85%] sm:max-w-[78%]">
                                <p className="mb-1.5 text-xs font-semibold text-slate-500">Tutor</p>
                                <div className="rounded-2xl rounded-tl-md border border-white/[0.07] bg-white/[0.045] px-4 py-3 text-[15px] leading-relaxed text-slate-100 shadow-[var(--shadow-card)] backdrop-blur-xl">
                                    {plainSpeech(entry.text)}
                                    {!entry.isFinal && <span className="ml-1 inline-block h-4 w-0.5 animate-blink bg-gold-400 align-middle" />}
                                </div>
                                {entry.isGeneratingImage && <SceneImageSkeleton />}
                                {entry.sceneImageUrl && !entry.isGeneratingImage && (
                                    <SceneImage imageDataUrl={entry.sceneImageUrl} description={entry.text} />
                                )}
                            </div>
                        </div>
                    ) : (
                        <div className="flex flex-col items-end">
                            <div className={cx(
                                'max-w-[85%] rounded-2xl rounded-tr-md border border-gold-500/20 bg-gradient-to-br from-gold-500/[0.17] to-gold-500/[0.06] px-4 py-3 text-[15px] leading-relaxed text-white sm:max-w-[78%]',
                                !entry.isFinal && 'opacity-80',
                            )}>
                                {entry.text}
                                {!entry.isFinal && <span className="ml-1 inline-block h-4 w-0.5 animate-blink bg-white/70 align-middle" />}
                            </div>
                            {entry.isFinal && (typeof entry.pronunciationScore === 'number' || entry.audioUrl) && (
                                <div className="mt-2 flex items-center gap-2 rounded-full border border-white/[0.07] bg-white/[0.03] py-1 pl-1.5 pr-1">
                                    {typeof entry.pronunciationScore === 'number' && (
                                        <span title="Pronunciation score"><PronunciationScoreCircle score={entry.pronunciationScore} /></span>
                                    )}
                                    {entry.audioUrl && (
                                        <button
                                            type="button"
                                            onClick={() => onReplay(entry.audioUrl!)}
                                            className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium text-slate-300 transition-colors hover:bg-white/[0.07] hover:text-white"
                                            aria-label="Replay your audio"
                                        >
                                            <Icon name="play" size={11} fill="currentColor" /> Replay
                                        </button>
                                    )}
                                </div>
                            )}
                            {entry.phoneticAnalysis && entry.isFinal && (
                                <div className="mt-3 w-full">
                                    <PronunciationAnalysisCard analysis={entry.phoneticAnalysis} />
                                    {entry.audioUrl && (
                                        <div className="mt-4">
                                            <AudioComparisonPlayer userAudioUrl={entry.audioUrl} word={entry.text.split(' ')[0]} />
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </motion.div>
            ))}
    </>
));
MessageList.displayName = 'MessageList';

/** Running time of the current conversation (re-renders only itself). */
const ElapsedTime: React.FC<{ start: number }> = ({ start }) => {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (!start) return;
        const t = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(t);
    }, [start]);
    const sec = start ? Math.max(0, Math.floor((now - start) / 1000)) : 0;
    return <span className="font-mono text-sm tabular-nums text-slate-300">{Math.floor(sec / 60)}:{String(sec % 60).padStart(2, '0')}</span>;
};

export default Conversation;