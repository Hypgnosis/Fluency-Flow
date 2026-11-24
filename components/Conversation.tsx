import React, { useState, useRef, useCallback, useEffect, Suspense, lazy } from 'react';
import { startLiveSession, createBlob } from '../services/geminiService';
import { decode, decodeAudioData, encodeWAV } from '../utils/audioUtils';
import { TranscriptionEntry } from '../types';
import { MicrophoneIcon, StopIcon, PlayIcon, ChevronDownIcon } from './icons/Icons';
import PronunciationScoreCircle from './PronunciationScoreCircle';
import { useAuth, AuthModal } from './AuthModal';
import { saveSession, loadUserContext, parseProfileMistakes } from '../services/sessionManager';
import { PronunciationAnalysisCard } from './PhoneticFeedback';
import { AudioComparisonPlayer } from './AudioComparisonPlayer';
import { createMockPhoneticAnalysis } from '../services/phoneticAnalysis';
import { shouldGenerateImage, generateSceneImage } from '../services/imageGenerationService';
import { SceneImage, SceneImageSkeleton } from './SceneImage';
import { useMobileResilience, resumeAudioContextsIfSuspended } from '../hooks/useMobileResilience';
import { useWebSocketSession, MAX_RECONNECT_ATTEMPTS } from '../hooks/useWebSocketSession';
import { glossosLog, glossosWarn, glossosError, mobileLog } from '../utils/debugLog';
import { SkillsPanel } from './skills/SkillsPanel';
import { SkillAttachmentView } from './skills/SkillAttachmentView';
import {
    buildFunctionDeclarations, buildSkillsInstruction, enabledSkills, executeToolCalls, loadSkillPrefs, newReviewMemory,
    runTurnReview, saveSkillPrefs, SkillPrefs,
} from '../services/tutorSkills/registry';
import { defaultSkillServices, describeAttachment } from '../services/tutorSkills/services';
import type { LiveFunctionCall, SkillAttachment, SkillContext, TutorSkill } from '../services/tutorSkills/types';

const GlossosOrb = lazy(() => import('./GlossosOrb'));
const LensTeacher = lazy(() => import('./lens/LensTeacher'));
const ChatTutor = lazy(() => import('./chat/ChatTutor').then(m => ({ default: m.ChatTutor })));
const WritingLab = lazy(() => import('./lab/WritingLab').then(m => ({ default: m.WritingLab })));
const OfflinePanel = lazy(() => import('./offline/OfflinePanel'));
const AudioScribe = lazy(() => import('./scribe/AudioScribe'));

/** Top-level modes (Gallery-style task tiles, shown as a mode bar). */
type AppMode = 'voice' | 'lens' | 'chat' | 'lab' | 'scribe' | 'offline';

const MODE_ICONS: Record<AppMode, string> = {
    voice: 'M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z',
    lens: 'M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z M15 13a3 3 0 11-6 0 3 3 0 016 0z',
    chat: 'M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z',
    lab: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z',
    scribe: 'M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3',
    offline: 'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4',
};

const MODES: { id: AppMode; label: string; title: string }[] = [
    { id: 'voice', label: 'Voice', title: 'Talk with your tutor in real time' },
    { id: 'lens', label: 'Lens', title: 'Point your camera and learn words' },
    { id: 'chat', label: 'Chat', title: 'Practice by text (works offline with an on-device model)' },
    { id: 'lab', label: 'Writing', title: 'Writing Lab: correct, rewrite, translate, explain, conjugate' },
    { id: 'scribe', label: 'Scribe', title: 'Audio Scribe: transcribe and translate a song, voice note or podcast clip' },
    { id: 'offline', label: 'Offline', title: 'Download a model to use Glossos without internet' },
];


type ConnectionState = 'IDLE' | 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED' | 'ERROR';

const LANGUAGES = ['English', 'Spanish', 'French', 'German', 'Italian', 'Japanese', 'Portuguese', 'Korean', 'Chinese', 'Russian', 'Slovak', 'Yucatec Mayan'];
const PROFICIENCY_LEVELS = [
    { value: 'Beginner', label: 'The Foundation' },
    { value: 'Intermediate', label: 'The Bridge' },
    { value: 'Advanced', label: 'The Pantheon' },
];
const VOICES = ['Puck', 'Charon', 'Kore', 'Fenrir', 'Aoede'];

// Level theme mapping
const LEVEL_THEMES: Record<string, string> = {
    'Beginner': 'theme-foundation',
    'Intermediate': 'theme-bridge',
    'Advanced': 'theme-pantheon',
};

const LEVEL_COLORS: Record<string, { accent: string; glow: string; text: string }> = {
    'Beginner': { accent: '#F5F5F7', glow: 'from-[#F5F5F7]/10 via-transparent to-transparent', text: 'text-[#F5F5F7]' },
    'Intermediate': { accent: '#00FF41', glow: 'from-[#00FF41]/10 via-transparent to-transparent', text: 'text-[#00FF41]' },
    'Advanced': { accent: '#FFBF00', glow: 'from-[#FFBF00]/15 via-transparent to-transparent', text: 'text-[#FFBF00]' },
};

/** Audio buffer size for ScriptProcessor/WorkletNode (lower = less latency) */
const AUDIO_BUFFER_SIZE = 2048;
/** Output AudioContext sample rate — matches Gemini's 24kHz output */
const OUTPUT_SAMPLE_RATE = 24000;
/** How long to wait for first AI response before showing a hint (ms) */
const CONNECTION_TIMEOUT_MS = 15000;

const getDefaultLanguage = () => {
    if (typeof navigator === 'undefined') return 'English';
    const navLanguage = navigator.language || (navigator as any).userLanguage || "en";
    if (navLanguage.startsWith("es")) return "Spanish";
    if (navLanguage.startsWith("fr")) return "French";
    if (navLanguage.startsWith("de")) return "German";
    if (navLanguage.startsWith("it")) return "Italian";
    if (navLanguage.startsWith("ja")) return "Japanese";
    if (navLanguage.startsWith("pt")) return "Portuguese";
    if (navLanguage.startsWith("ko")) return "Korean";
    if (navLanguage.startsWith("zh")) return "Chinese";
    if (navLanguage.startsWith("ru")) return "Russian";
    if (navLanguage.startsWith("sk")) return "Slovak";
    return "English";
};

interface ConversationProps {
    defaultNativeLanguage?: string;
    defaultLearningLanguage?: string;
}

const Conversation: React.FC<ConversationProps> = ({ defaultNativeLanguage, defaultLearningLanguage }) => {
    const { user } = useAuth();
    const [connectionState, setConnectionState] = useState<ConnectionState>('IDLE');
    const [selectedLanguage, setSelectedLanguage] = useState<string>(defaultLearningLanguage || 'Spanish');
    const [nativeLanguage, setNativeLanguage] = useState<string>(defaultNativeLanguage || getDefaultLanguage());
    const [proficiencyLevel, setProficiencyLevel] = useState<string>('Beginner');
    const [selectedVoice, setSelectedVoice] = useState<string>('Puck');
    const [transcriptionLog, setTranscriptionLog] = useState<TranscriptionEntry[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [volume, setVolume] = useState<number>(0);
    const [showAuthModal, setShowAuthModal] = useState(false);
    const [sessionStartTime, setSessionStartTime] = useState<number>(0);

    // Lens mode (port of Google AI Edge Gallery's XR Language Teacher)
    const [mode, setMode] = useState<AppMode>('voice');
    const isVoiceMode = mode === 'voice';
    const [sceneImagesEnabled, setSceneImagesEnabled] = useState(true);
    // Tutor Skills (port of Google AI Edge Gallery's Agent Skills onto Live API function calling)
    const [skillPrefs, setSkillPrefs] = useState<SkillPrefs>(() => loadSkillPrefs());
    const [showSkills, setShowSkills] = useState(false);
    const activeSkillsRef = useRef<{ skills: TutorSkill[]; ctx: SkillContext } | null>(null);
    const reviewMemoryRef = useRef(newReviewMemory());
    const profileMistakesRef = useRef<{ incorrect: string; correct: string }[]>([]);
    const [messageCount, setMessageCount] = useState(0);
    const [audioChunkCount, setAudioChunkCount] = useState(0);
    const [debugLog, setDebugLog] = useState<string[]>([]);

    const addDebugLog = useCallback((msg: string) => {
        setDebugLog(prev => [...prev.slice(-19), `[${new Date().toLocaleTimeString()}] ${msg}`]);
    }, []);

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
        setSessionStartTime(0);
        sessionStartTimeRef.current = 0;
        isIntentionalStopRef.current = false;
    }, [cleanupResources, user, selectedLanguage, markIntentionalStop]);

    // Help Me functionality
    const handleHelpMe = useCallback(() => {
        if (sessionPromiseRef.current) {
            addDebugLog('Help requested');

            // Show immediate feedback in the UI
            const newId = Date.now();
            setTranscriptionLog(prev => [
                ...prev,
                {
                    id: newId,
                    speaker: 'You',
                    text: '🙏 Requested help with the conversation...',
                    isFinal: true,
                    timestamp: newId
                }
            ]);

            const helpPrompt = `I am a ${proficiencyLevel} level learner and I am stuck. Please provide a TEXT-ONLY explanation in ${nativeLanguage} of what you just said (do NOT speak the ${nativeLanguage} part out loud). Then, SPEAK a suggested simple response in ${selectedLanguage} suitable for my level.`;
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
            ...attachments.map((attachment, i) => ({
                id: now + (i + 1) / 1000 + Math.random() / 1e6,
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
            glossosLog('Message received:', msgKeys.join(', '), message);
            // Don't flood the UI log with every message, just non-content ones or errors
            if (!message.serverContent) {
                addDebugLog(`Msg: ${msgKeys.join(', ')}`);
            } else if (message.serverContent?.modelTurn) {
                addDebugLog('Audio received');
            }

            // Count messages
            setMessageCount(prev => prev + 1);

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

                if (message.serverContent.inputTranscription) {
                    const { text } = message.serverContent.inputTranscription;
                    glossosLog('Input transcription:', text);
                    setTranscriptionLog(prev => {
                        const existingEntryIndex = prev.findIndex(e => e.id === currentInputTranscriptionRef.current.id);
                        if (existingEntryIndex === -1 && text) {
                            const newId = Date.now();
                            currentInputTranscriptionRef.current = { id: newId, text };
                            return [...prev, { id: newId, speaker: 'You', text, isFinal: false }];
                        } else if (existingEntryIndex !== -1) {
                            const newLog = [...prev];
                            newLog[existingEntryIndex] = { ...newLog[existingEntryIndex], text: text };
                            currentInputTranscriptionRef.current.text = text;
                            return newLog;
                        }
                        return prev;
                    });
                }

                if (message.serverContent.outputTranscription) {
                    const { text } = message.serverContent.outputTranscription;
                    glossosLog('Output transcription:', text);
                    setTranscriptionLog(prev => {
                        const existingEntryIndex = prev.findIndex(e => e.id === currentOutputTranscriptionRef.current.id);
                        if (existingEntryIndex === -1 && text) {
                            const newId = Date.now();
                            currentOutputTranscriptionRef.current = { id: newId, text };
                            return [...prev, { id: newId, speaker: 'Tutor', text, isFinal: false }];
                        } else if (existingEntryIndex !== -1) {
                            const newLog = [...prev];
                            const newText = newLog[existingEntryIndex].text + text;
                            newLog[existingEntryIndex] = { ...newLog[existingEntryIndex], text: newText };
                            currentOutputTranscriptionRef.current.text = newText;
                            return newLog;
                        }
                        return prev;
                    });
                }

                if (message.serverContent.turnComplete) {
                    glossosLog('Turn complete');
                    const inputId = currentInputTranscriptionRef.current.id;
                    const outputId = currentOutputTranscriptionRef.current.id;
                    // Cast turnComplete to any to access runtime properties
                    const score = (message.serverContent?.turnComplete as any)?.inputTranscription?.pronunciationFeedback?.qualityScore;

                    let audioUrl: string | undefined = undefined;
                    if (currentAudioChunksRef.current.length > 0 && inputAudioContextRef.current) {
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
                                    setAudioChunkCount(prev => prev + 1);
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
            addDebugLog('User not logged in');
            setShowAuthModal(true);
            return;
        }

        setConnectionState('CONNECTING');
        setError(null);
        setMessageCount(0);
        setAudioChunkCount(0);
        setDebugLog([]); // Clear log on new start
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
            // Load user context for personalization
            const userContext = await loadUserContext(user.uid);

            // Check for secure context (getUserMedia requires HTTPS or localhost)
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                throw new Error('Microphone access requires a secure connection. Please use localhost:3001 instead of the network IP address.');
            }

            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: 1,
                    sampleRate: 16000,
                },
            }).catch((micErr) => {
                throw new Error('Microphone access denied. Please allow microphone access in your browser settings and try again.');
            });
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
            if (inputAudioContextRef.current.audioWorklet) {
                try {
                    await inputAudioContextRef.current.audioWorklet.addModule('/audio-processor-worklet.js');
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

    // Switch modes (must be after isConversationActive)
    const switchMode = useCallback((next: AppMode) => {
        if (isConversationActive && next !== 'voice') {
            setError('Stop the conversation before switching modes');
            return;
        }
        setMode(next);
        setError(null);
    }, [isConversationActive]);

    return (
        <div className={`relative flex flex-col h-full w-full mx-auto animate-fade-in ${LEVEL_THEMES[proficiencyLevel] || ''}`}>

            {/* Glass Container */}
            <div className="flex flex-col flex-grow glass-card shadow-2xl shadow-black/40 overflow-hidden ring-1 ring-white/[0.06]">

                {/* Control Header */}
                <div className="px-4 sm:px-6 py-4 sm:py-5 border-b border-white/[0.06] flex justify-between items-center glass-header">
                    <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
                        {/* Dynamic Status Indicator */}
                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/20 border border-white/[0.06]">
                            <div className={`w-2 h-2 rounded-full transition-all duration-500 ${connectionState === 'CONNECTED' ? 'bg-[#00FF41] shadow-[0_0_12px_rgba(0,255,65,0.7)]' :
                                connectionState === 'CONNECTING' ? 'bg-[#FFBF00] animate-pulse shadow-[0_0_8px_rgba(255,191,0,0.4)]' :
                                    connectionState === 'ERROR' ? 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.4)]' :
                                        'bg-slate-600'
                                }`}></div>
                            <span className={`text-[10px] font-bold tracking-[0.15em] uppercase transition-colors`} style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                                {connectionState === 'IDLE' ? 'Standby' : connectionState === 'CONNECTING' ? 'Initializing' : connectionState === 'CONNECTED' ? 'Synced' : connectionState}
                            </span>
                        </div>

                        {/* Mode Toggles */}
                        <div className="flex items-center gap-1.5">
                            {/* Mode bar */}
                            <div className="flex items-center gap-0.5 rounded-full bg-black/20 border border-white/[0.06] p-0.5" role="tablist" aria-label="Mode">
                                {MODES.map(m => (
                                    <button
                                        key={m.id}
                                        role="tab"
                                        aria-selected={mode === m.id}
                                        onClick={() => switchMode(m.id)}
                                        disabled={isConversationActive && m.id !== 'voice'}
                                        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full transition-all text-xs font-semibold disabled:opacity-30 disabled:cursor-not-allowed ${mode === m.id
                                            ? 'bg-[#FFBF00]/15 text-[#FFBF00] border border-[#FFBF00]/30'
                                            : 'text-slate-500 border border-transparent hover:text-slate-300'
                                            }`}
                                        title={m.title}
                                        style={{ fontFamily: "'IBM Plex Mono', monospace" }}
                                    >
                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={MODE_ICONS[m.id]} />
                                        </svg>
                                        <span className={mode === m.id ? 'inline' : 'hidden lg:inline'}>{m.label}</span>
                                    </button>
                                ))}
                            </div>

                            {/* Tutor Skills */}
                            <button
                                onClick={() => setShowSkills(true)}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full transition-all text-xs font-semibold bg-white/[0.04] text-slate-400 border border-white/[0.06] hover:bg-white/[0.08] hover:text-slate-200"
                                title="Tutor skills: what your voice tutor can do while you talk"
                                style={{ fontFamily: "'IBM Plex Mono', monospace" }}
                            >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437l1.745-1.437" />
                                </svg>
                                <span className="hidden sm:inline">Skills</span>
                                <span className="text-[10px] text-[#00FF41]">{enabledSkills(skillPrefs).length}</span>
                            </button>

                            {/* Scene Images Toggle */}
                            <button
                                onClick={() => setSceneImagesEnabled(!sceneImagesEnabled)}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full transition-all text-xs font-semibold ${sceneImagesEnabled
                                    ? 'bg-gradient-to-r from-[#FFBF00]/12 to-[#00FF41]/12 text-[#FFBF00] border border-[#FFBF00]/20'
                                    : 'bg-white/[0.04] text-slate-500 border border-white/[0.06] hover:bg-white/[0.08] hover:text-slate-300'
                                    }`}
                                title={sceneImagesEnabled ? 'Disable scene images' : 'Enable scene images'}
                            >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                </svg>
                                {sceneImagesEnabled && <div className="w-1.5 h-1.5 rounded-full bg-[#FFBF00] animate-pulse" />}
                            </button>
                        </div>
                    </div>

                    {/* Native Language Selector */}
                    <div className="relative group flex items-center gap-2 mr-2">
                        <span className="text-[10px] uppercase font-bold text-slate-500 hidden sm:inline-block tracking-wider">I speak:</span>
                        <div className="relative">
                            <div className="absolute inset-y-0 right-3 flex items-center pointer-events-none">
                                <ChevronDownIcon className="w-3 h-3 text-slate-500 group-hover:text-slate-300 transition-colors" />
                            </div>
                            <select
                                value={nativeLanguage}
                                onChange={(e) => setNativeLanguage(e.target.value)}
                                disabled={isConversationActive}
                                className="appearance-none bg-black/20 hover:bg-white/[0.06] border border-white/[0.08] text-slate-300 text-xs sm:text-sm font-semibold rounded-full pl-3 pr-8 py-1.5 transition-all focus:outline-none focus:ring-1 focus:ring-purple-500/40 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                            >
                                {LANGUAGES.map(lang => <option key={lang} value={lang} className="bg-slate-900 text-slate-200">{lang}</option>)}
                            </select>
                        </div>
                    </div>

                    {/* Target Language Selector */}
                    <div className="relative group flex items-center gap-2">
                        <span className="text-[10px] uppercase font-bold text-slate-500 hidden sm:inline-block tracking-wider">Learning:</span>
                        <div className="relative">
                            <div className="absolute inset-y-0 right-3 flex items-center pointer-events-none">
                                <ChevronDownIcon className="w-3.5 h-3.5 text-slate-500 group-hover:text-slate-300 transition-colors" />
                            </div>
                            <select
                                value={selectedLanguage}
                                onChange={(e) => setSelectedLanguage(e.target.value)}
                                disabled={isConversationActive}
                                className="appearance-none bg-black/20 hover:bg-white/[0.06] border border-white/[0.08] text-[#00FF41] text-xs sm:text-sm font-semibold rounded-full pl-4 pr-10 py-2 transition-all focus:outline-none focus:ring-1 focus:ring-[#00FF41]/40 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                            >
                                {LANGUAGES.map(lang => <option key={lang} value={lang} className="bg-slate-900 text-slate-200">{lang}</option>)}
                            </select>
                        </div>
                    </div>

                    {/* Proficiency Selector */}
                    <div className="relative group ml-2">
                        <div className="absolute inset-y-0 right-3 flex items-center pointer-events-none">
                            <ChevronDownIcon className="w-3.5 h-3.5 text-slate-500 group-hover:text-slate-300 transition-colors" />
                        </div>
                        <select
                            value={proficiencyLevel}
                            onChange={(e) => setProficiencyLevel(e.target.value)}
                            disabled={isConversationActive}
                            title="Select your cognitive tier"
                            className="appearance-none bg-black/20 hover:bg-white/[0.06] border border-white/[0.08] text-[#FFBF00] text-xs sm:text-sm font-semibold rounded-full pl-4 pr-10 py-2 transition-all focus:outline-none focus:ring-1 focus:ring-[#FFBF00]/40 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                            style={{ fontFamily: "'IBM Plex Mono', monospace" }}
                        >
                            {PROFICIENCY_LEVELS.map(level => <option key={level.value} value={level.value} className="bg-[#0A0A0B] text-[#FFBF00]">{level.label}</option>)}
                        </select>
                    </div>

                    {/* Voice Selector */}
                    <div className="relative group ml-2">
                        <div className="absolute inset-y-0 right-3 flex items-center pointer-events-none">
                            <ChevronDownIcon className="w-3.5 h-3.5 text-slate-500 group-hover:text-slate-300 transition-colors" />
                        </div>
                        <select
                            value={selectedVoice}
                            onChange={(e) => setSelectedVoice(e.target.value)}
                            disabled={isConversationActive}
                            title="Select AI Voice"
                            className="appearance-none bg-black/20 hover:bg-white/[0.06] border border-white/[0.08] text-slate-400 text-xs sm:text-sm font-semibold rounded-full pl-4 pr-10 py-2 transition-all focus:outline-none focus:ring-1 focus:ring-white/20 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                            style={{ fontFamily: "'IBM Plex Mono', monospace" }}
                        >
                            {VOICES.map(voice => <option key={voice} value={voice} className="bg-[#0A0A0B] text-slate-300">{voice}</option>)}
                        </select>
                    </div>
                </div>

                {/* Live Status Bar — shows when connected */}
                {isConversationActive && (
                    <div className="px-4 py-1.5 bg-slate-900/80 border-b border-white/[0.04] flex items-center justify-between text-[10px] font-mono text-slate-500">
                        <div className="flex items-center gap-3">
                            <span>📡 msgs: <span className="text-[#00FF41]">{messageCount}</span></span>
                            <span>🔊 audio: <span className="text-[#00FF41]">{audioChunkCount}</span></span>
                            <span>📝 log: <span className="text-[#FFBF00]">{transcriptionLog.length}</span></span>
                        </div>
                        <div className="flex items-center gap-2">
                            <span>vol: {(volume * 100).toFixed(0)}%</span>
                            <div className="w-16 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                                <div className="h-full bg-gradient-to-r from-[#00FF41] to-[#FFBF00] rounded-full transition-all duration-100" style={{ width: `${Math.min(volume * 100, 100)}%` }} />
                            </div>
                        </div>
                    </div>
                )}

                {/* Main Content Area */}
                {isVoiceMode ? (
                    /* Voice Mode - Chat Log Area */
                    <div
                        ref={logContainerRef}
                        className="flex-grow overflow-y-auto p-4 sm:p-6 md:p-8 space-y-6 sm:space-y-8"
                    >
                        {/* Context-Aware Empty State with 3D Orb */}
                        {transcriptionLog.length === 0 && (
                            <div className="h-full flex flex-col items-center justify-center text-center select-none px-4 relative">
                                {/* 3D Orb Background */}
                                <div className="absolute inset-0 z-0">
                                    <Suspense fallback={
                                        <div className="w-full h-full flex items-center justify-center">
                                            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-[#FFBF00]/10 to-[#00FF41]/10 animate-breathe" />
                                        </div>
                                    }>
                                        <GlossosOrb connectionState={connectionState} volume={volume} aiAnalyser={outputAnalyserRef.current} />
                                    </Suspense>
                                </div>

                                {/* Text Overlay */}
                                <div className="relative z-10 mt-auto mb-8 sm:mb-12 pointer-events-none">
                                    {connectionState === 'CONNECTING' ? (
                                        <div className="animate-fade-in">
                                            <h2 className="text-[#FFBF00] text-xl sm:text-2xl font-bold tracking-tighter mb-2" style={{ fontFamily: "'Inter Tight', sans-serif" }}>
                                                Initializing Neural Link...
                                            </h2>
                                            <p className="text-slate-500 text-sm font-medium max-w-xs mx-auto leading-relaxed" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                                                Setting up your real-time audio session
                                            </p>
                                        </div>
                                    ) : connectionState === 'CONNECTED' ? (
                                        <div className="animate-fade-in">
                                            <h2 className="text-[#00FF41] text-xl sm:text-2xl font-bold tracking-tighter mb-2" style={{ fontFamily: "'Inter Tight', sans-serif" }}>
                                                Neural Sync Active
                                            </h2>
                                            <p className="text-slate-400 text-sm font-medium max-w-sm mx-auto leading-relaxed mb-3" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                                                {proficiencyLevel === 'Advanced'
                                                    ? 'Full Immersion Engaged. Entering dialectical mastery.'
                                                    : proficiencyLevel === 'Intermediate'
                                                        ? 'Engaging fluidity protocols. Focus on conversational cadence.'
                                                        : 'Initialize structural acquisition. GLOSSOS is monitoring syntax.'
                                                }
                                            </p>
                                            <div className="flex items-center gap-2 justify-center text-xs text-slate-500">
                                                <span className="text-[#00FF41]">◉</span>
                                                <span style={{ fontFamily: "'IBM Plex Mono', monospace" }}>Speak in <em className="text-[#FFBF00]">{selectedLanguage}</em> to begin</span>
                                            </div>
                                        </div>
                                    ) : connectionState === 'ERROR' ? (
                                        <div className="animate-fade-in">
                                            <h2 className="text-rose-400 text-xl font-bold tracking-tight mb-2">
                                                Connection Issue
                                            </h2>
                                            <p className="text-slate-500 text-sm font-medium max-w-sm mx-auto leading-relaxed">
                                                Tap the microphone to try again
                                            </p>
                                        </div>
                                    ) : (
                                        <div className="animate-fade-in">
                                            <h2 className="text-white text-xl sm:text-2xl font-bold tracking-tighter mb-2" style={{ fontFamily: "'Inter Tight', sans-serif" }}>
                                                Awaiting Neural Sync
                                            </h2>
                                            <p className="text-slate-500 text-sm sm:text-base font-medium max-w-sm mx-auto leading-relaxed mb-5" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                                                Initialize a linguistic sync to begin cognitive acquisition
                                            </p>
                                            <div className="flex flex-col sm:flex-row items-center gap-3 sm:gap-6 text-xs text-slate-600 pointer-events-auto">
                                                <div className="flex items-center gap-2">
                                                    <div className="w-6 h-6 rounded-full bg-[#00FF41]/10 border border-[#00FF41]/20 flex items-center justify-center text-[#00FF41] font-bold text-[10px]">1</div>
                                                    <span className="font-medium">Initialize</span>
                                                </div>
                                                <svg className="w-3 h-3 text-slate-700 hidden sm:block" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                                </svg>
                                                <div className="flex items-center gap-2">
                                                    <div className="w-6 h-6 rounded-full bg-[#00FF41]/10 border border-[#00FF41]/20 flex items-center justify-center text-[#00FF41] font-bold text-[10px]">2</div>
                                                    <span className="font-medium">Transmit</span>
                                                </div>
                                                <svg className="w-3 h-3 text-slate-700 hidden sm:block" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                                </svg>
                                                <div className="flex items-center gap-2">
                                                    <div className="w-6 h-6 rounded-full bg-[#00FF41]/10 border border-[#00FF41]/20 flex items-center justify-center text-[#00FF41] font-bold text-[10px]">3</div>
                                                    <span className="font-medium">Neural analysis</span>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Chat Messages */}
                        {transcriptionLog.map(entry => entry.attachment ? (
                            <div key={entry.id} className="w-full flex justify-start animate-slide-up">
                                <SkillAttachmentView attachment={entry.attachment} learnLanguage={selectedLanguage} />
                            </div>
                        ) : (
                            <div key={entry.id} className="w-full space-y-3 animate-slide-up">
                                <div className={`flex flex-col ${entry.speaker === 'You' ? 'items-end' : 'items-start'}`}>
                                    <div className={`max-w-[88%] sm:max-w-[80%] md:max-w-[75%] relative`}>
                                        {/* Speaker Label */}
                                        <div className={`flex items-center gap-2 mb-1.5 ${entry.speaker === 'You' ? 'justify-end' : 'justify-start'}`}>
                                            {entry.speaker === 'Tutor' && (
                                                <div className="w-5 h-5 rounded-full bg-gradient-to-br from-[#FFBF00] to-[#00FF41] flex items-center justify-center">
                                                    <svg className="w-3 h-3 text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                                    </svg>
                                                </div>
                                            )}
                                            <span className={`text-[10px] font-bold uppercase tracking-[0.15em]`} style={{ fontFamily: "'IBM Plex Mono', monospace", color: entry.speaker === 'You' ? '#F5F5F7' : '#00FF41', opacity: 0.6 }}>
                                                {entry.speaker === 'You' ? 'You' : 'GLOSSOS'}
                                            </span>
                                        </div>

                                        {/* Message Bubble */}
                                        <div className={`px-5 py-3.5 sm:px-6 sm:py-4 rounded-2xl text-[14px] sm:text-[15px] leading-relaxed shadow-lg border
                                            ${entry.speaker === 'You'
                                                ? 'bg-gradient-to-br from-[#1a1a1a]/90 to-[#111]/90 text-[#F5F5F7] border-white/[0.08] rounded-br-md'
                                                : 'bg-[#0d0d0e]/90 text-[#F5F5F7] border-[#00FF41]/[0.08] rounded-bl-md'
                                            } ${!entry.isFinal ? 'opacity-90' : ''}`}>
                                            {entry.text}
                                            {!entry.isFinal && <span className="inline-block w-0.5 h-4 ml-1 align-middle bg-current animate-blink opacity-60" />}
                                        </div>

                                        {/* Nano Banana Pro Scene Image */}
                                        {entry.speaker === 'Tutor' && entry.isGeneratingImage && (
                                            <SceneImageSkeleton />
                                        )}
                                        {entry.speaker === 'Tutor' && entry.sceneImageUrl && !entry.isGeneratingImage && (
                                            <SceneImage
                                                imageDataUrl={entry.sceneImageUrl}
                                                description={entry.text}
                                            />
                                        )}

                                        {/* Score & Actions */}
                                        {/* Neural Integrity Rate & Actions */}
                                        {entry.speaker === 'You' && entry.isFinal && (entry.pronunciationScore !== undefined || entry.audioUrl) && (
                                            <div className="flex items-center gap-2.5 mt-2 justify-end">
                                                <div className="flex items-center gap-2.5 bg-black/30 rounded-full px-3 py-1.5 border border-white/[0.08] backdrop-blur-sm">
                                                    {typeof entry.pronunciationScore === 'number' && (
                                                        <div title="Pronunciation Score">
                                                            <PronunciationScoreCircle score={entry.pronunciationScore} />
                                                        </div>
                                                    )}
                                                    {entry.audioUrl && (
                                                        <>
                                                            <div className="w-px h-3 bg-white/10"></div>
                                                            <button
                                                                onClick={() => {
                                                                    // Stop any currently playing audio before starting new one
                                                                    if (playbackAudioRef.current) {
                                                                        playbackAudioRef.current.pause();
                                                                        playbackAudioRef.current.currentTime = 0;
                                                                    }
                                                                    const audio = new Audio(entry.audioUrl);
                                                                    playbackAudioRef.current = audio;
                                                                    audio.onended = () => { playbackAudioRef.current = null; };
                                                                    audio.play().catch(console.error);
                                                                }}
                                                                className="p-1 hover:bg-white/10 rounded-full transition-colors group/btn"
                                                                aria-label="Replay your audio"
                                                            >
                                                                <PlayIcon className="w-3 h-3 text-slate-400 group-hover/btn:text-cyan-400 transition-colors" />
                                                            </button>
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Phonetic Analysis (Phase 4) */}
                                {entry.speaker === 'You' && entry.phoneticAnalysis && entry.isFinal && (
                                    <div className="w-full px-4">
                                        <PronunciationAnalysisCard analysis={entry.phoneticAnalysis} />
                                        {entry.audioUrl && (
                                            <div className="mt-4">
                                                <AudioComparisonPlayer
                                                    userAudioUrl={entry.audioUrl}
                                                    word={entry.text.split(' ')[0]}
                                                />
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                ) : (
                    /* Other modes: Lens, Chat, Writing Lab, Offline models */
                    <div className="flex-grow min-h-0 flex flex-col">
                        <Suspense fallback={
                            <div className="flex-grow flex items-center justify-center">
                                <div className="w-12 h-12 rounded-full border-2 border-[#FFBF00]/20 border-t-[#FFBF00] animate-spin" />
                            </div>
                        }>
                            {mode === 'lens' && <LensTeacher nativeLanguage={nativeLanguage} learnLanguage={selectedLanguage} level={proficiencyLevel} />}
                            {mode === 'chat' && <ChatTutor nativeLanguage={nativeLanguage} learnLanguage={selectedLanguage} level={proficiencyLevel} onManageModels={() => switchMode('offline')} />}
                            {mode === 'lab' && (
                                <div className="flex-grow min-h-0 overflow-y-auto">
                                    <WritingLab nativeLanguage={nativeLanguage} learnLanguage={selectedLanguage} level={proficiencyLevel} onManageModels={() => switchMode('offline')} />
                                </div>
                            )}
                            {mode === 'scribe' && (
                                <div className="flex-grow min-h-0 overflow-y-auto">
                                    <AudioScribe nativeLanguage={nativeLanguage} learnLanguage={selectedLanguage} level={proficiencyLevel} />
                                </div>
                            )}
                            {mode === 'offline' && <OfflinePanel />}
                        </Suspense>
                    </div>
                )}

                {/* Error Banner */}
                {error && (
                    <div className="mx-4 sm:mx-6 mb-3 bg-rose-500/10 border border-rose-500/20 p-3 rounded-xl flex items-center justify-center gap-2 backdrop-blur-sm">
                        <span className="w-2 h-2 bg-rose-500 rounded-full animate-pulse"></span>
                        <p className="text-rose-300 text-xs font-semibold tracking-wide">{error}</p>
                    </div>
                )}

                {/* ============================================
                    BOTTOM CONTROL CENTER — Premium Mic Button & Help
                    ============================================ */}
                {isVoiceMode && (
                <div className="px-6 py-4 border-t border-white/[0.04] flex flex-col items-center justify-center relative overflow-hidden">



                    {/* Background glow */}
                    <div className={`absolute inset-0 transition-all duration-1000 pointer-events-none bg-gradient-to-t ${isConversationActive
                        ? (LEVEL_COLORS[proficiencyLevel]?.glow || 'from-[#00FF41]/10 via-transparent to-transparent')
                        : 'from-slate-900/30 to-transparent'
                        }`} />

                    {/* Sound wave visualizer — only when active */}
                    {isConversationActive && (
                        <div className="flex items-center gap-1 mb-3 h-6">
                            {[...Array(5)].map((_, i) => (
                                <div
                                    key={i}
                                    className="sound-wave-bar"
                                    style={{
                                        height: `${8 + volume * 20 + Math.random() * 6}px`,
                                        opacity: 0.6 + volume * 0.4,
                                        transition: 'height 80ms ease-out',
                                    }}
                                />
                            ))}
                        </div>
                    )}

                    {/* Main Actions Row */}
                    <div className="flex items-center justify-center gap-4 sm:gap-8 w-full z-20">
                        {/* Invisible spacer to center the mic button when help is shown */}
                        {isConversationActive && <div className="w-[72px] sm:w-[80px] hidden sm:block opacity-0 select-none pointer-events-none" />}

                        {/* Main Microphone Button */}
                        <button
                            onClick={isConversationActive ? stopConversation : startConversation}
                            disabled={connectionState === 'CONNECTING'}
                            className="relative flex items-center justify-center transition-all duration-500 group focus:outline-none focus:ring-0"
                            style={{ width: '64px', height: '64px' }}
                        >
                            {/* Outer animated ring — conic gradient */}
                            <div
                                className={`absolute rounded-full transition-all duration-700 ${isConversationActive
                                    ? 'opacity-100'
                                    : 'opacity-0 group-hover:opacity-60'
                                    }`}
                                style={{ inset: '-4px' }}
                            >
                                <div className="w-full h-full rounded-full mic-outer-ring p-[2px]">
                                    <div className="w-full h-full rounded-full bg-[#080810]" />
                                </div>
                            </div>

                            {/* Ping ring when active */}
                            {isConversationActive && (
                                <div className="absolute inset-0 rounded-full bg-gradient-to-r from-[#FFBF00]/30 to-[#00FF41]/20 animate-ping-slow" />
                            )}

                            {/* Dynamic Volume Ring 1 */}
                            {isConversationActive && (
                                <div
                                    className="absolute inset-0 rounded-full border-2 border-[#FFBF00]/20 transition-all duration-100 ease-out"
                                    style={{
                                        transform: `scale(${1 + volume * 0.4})`,
                                        opacity: 0.4 + volume * 0.6,
                                    }}
                                />
                            )}
                            {/* Dynamic Volume Ring 2 */}
                            {isConversationActive && (
                                <div
                                    className="absolute inset-0 rounded-full border border-[#00FF41]/10 transition-all duration-200 ease-out"
                                    style={{
                                        transform: `scale(${1 + volume * 0.7})`,
                                        opacity: 0.2,
                                    }}
                                />
                            )}

                            {/* Button Core */}
                            <div
                                className={`absolute rounded-full shadow-2xl transition-all duration-500 flex items-center justify-center border overflow-hidden
                                    ${isConversationActive
                                        ? 'bg-gradient-to-br from-rose-600 to-red-700 border-rose-500/30 shadow-rose-500/30'
                                        : 'bg-gradient-to-br from-[#0f0f0f] via-[#141410] to-[#0a0a08] border-white/[0.06] group-hover:border-[#FFBF00]/30 hover:scale-[1.03] animate-breathe shadow-[#FFBF00]/10'
                                    }
                                `}
                                style={{ inset: '8px' }}
                            >
                                {/* Inner glow on hover (idle) */}
                                {!isConversationActive && (
                                    <div className="absolute inset-0 bg-gradient-to-tr from-[#FFBF00]/10 via-transparent to-[#00FF41]/5 opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
                                )}

                                {/* Active inner shimmer */}
                                {isConversationActive && (
                                    <div className="absolute inset-0 bg-gradient-to-t from-transparent via-white/5 to-transparent opacity-40" />
                                )}

                                {/* Icon */}
                                {isConversationActive ? (
                                    <StopIcon className="w-8 h-8 sm:w-10 sm:h-10 text-white drop-shadow-lg relative z-10" />
                                ) : (
                                    <svg
                                        className="w-10 h-10 sm:w-12 sm:h-12 relative z-10 drop-shadow-lg transition-colors duration-300 text-[#FFBF00]/80 group-hover:text-[#FFBF00]"
                                        xmlns="http://www.w3.org/2000/svg"
                                        fill="none"
                                        viewBox="0 0 24 24"
                                        strokeWidth={1.5}
                                        stroke="currentColor"
                                    >
                                        <path
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 016 0v8.25a3 3 0 01-3 3z"
                                        />
                                    </svg>
                                )}
                            </div>
                        </button>

                        {/* Help Button (Only when active) */}
                        {isConversationActive && proficiencyLevel !== 'Advanced' && (
                            <button
                                onClick={handleHelpMe}
                                className="flex flex-col items-center justify-center w-[72px] sm:w-[80px] gap-1 px-2 py-2 sm:py-3 rounded-2xl bg-[#FFBF00]/10 hover:bg-[#FFBF00]/20 border border-[#FFBF00]/30 text-[#FFBF00] transition-all hover:scale-105 active:scale-95 shadow-lg shadow-black/20"
                                style={{ fontFamily: "'IBM Plex Mono', monospace" }}
                            >
                                <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                <span className="text-[10px] font-bold uppercase tracking-wider">Assist</span>
                            </button>
                        )}
                    </div>

                    {/* Status Label */}
                    <p className={`mt-5 sm:mt-6 text-[10px] sm:text-[11px] uppercase tracking-[0.3em] font-bold transition-colors duration-300`}
                        style={{
                            fontFamily: "'IBM Plex Mono', monospace",
                            color: connectionState === 'CONNECTED' ? '#00FF41' :
                                connectionState === 'CONNECTING' ? '#FFBF00' :
                                    connectionState === 'ERROR' ? '#f87171' : '#4b5563',
                            opacity: 0.7
                        }}>
                        {connectionState === 'CONNECTING' ? 'Establishing Neural Link...' :
                            connectionState === 'CONNECTED' ? '◉ Monitoring' :
                                connectionState === 'ERROR' ? 'Reinitialize' :
                                    'Initialize Sync'
                        }
                    </p>
                </div>
                )}
            </div>

            {/* Tutor Skills panel */}
            {showSkills && (
                <SkillsPanel
                    prefs={skillPrefs}
                    locked={isConversationActive}
                    onChange={prefs => { setSkillPrefs(prefs); saveSkillPrefs(prefs); }}
                    onClose={() => setShowSkills(false)}
                />
            )}

            {/* Auth Modal */}
            {showAuthModal && <AuthModal onClose={() => setShowAuthModal(false)} />}

        </div>
    );
};

export default Conversation;