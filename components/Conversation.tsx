import React, { useState, useRef, useCallback, useEffect, Suspense, lazy } from 'react';
import { startLiveSession, createBlob } from '../services/geminiService';
import { decode, decodeAudioData, encodeWAV } from '../utils/audioUtils';
import { TranscriptionEntry, VocabularyCard } from '../types';
import { MicrophoneIcon, StopIcon, PlayIcon, ChevronDownIcon } from './icons/Icons';
import PronunciationScoreCircle from './PronunciationScoreCircle';
import { useAuth, AuthModal } from './AuthModal';
import { saveSession, loadUserContext } from '../services/sessionManager';
import { PronunciationAnalysisCard } from './PhoneticFeedback';
import { AudioComparisonPlayer } from './AudioComparisonPlayer';
import { createMockPhoneticAnalysis } from '../services/phoneticAnalysis';
import { CameraCapture } from './CameraCapture';
import { VocabularyCardDisplay, VocabularyCollection } from './VocabularyCard';
import { analyzeImageForVocabulary } from '../services/visionService';
import { shouldGenerateImage, generateSceneImage } from '../services/imageGenerationService';
import { SceneImage, SceneImageSkeleton } from './SceneImage';

const GlossosOrb = lazy(() => import('./GlossosOrb'));


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

    // Vision Mode (Phase 5)
    const [isVisionMode, setIsVisionMode] = useState(false);
    const [showCamera, setShowCamera] = useState(false);
    const [vocabularyCards, setVocabularyCards] = useState<VocabularyCard[]>([]);
    const [isAnalyzingImage, setIsAnalyzingImage] = useState(false);
    const [sceneImagesEnabled, setSceneImagesEnabled] = useState(true);
    const [messageCount, setMessageCount] = useState(0);
    const [audioChunkCount, setAudioChunkCount] = useState(0);
    const [debugLog, setDebugLog] = useState<string[]>([]);

    const addDebugLog = useCallback((msg: string) => {
        setDebugLog(prev => [...prev.slice(-19), `[${new Date().toLocaleTimeString()}] ${msg}`]);
    }, []);

    const sessionPromiseRef = useRef<ReturnType<typeof startLiveSession> | null>(null);
    const inputAudioContextRef = useRef<AudioContext | null>(null);
    const outputAudioContextRef = useRef<AudioContext | null>(null);
    const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
    const mediaStreamSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const userMediaStreamRef = useRef<MediaStream | null>(null);
    const nextStartTimeRef = useRef<number>(0);
    const outputSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
    const connectionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const currentInputTranscriptionRef = useRef({ id: -1, text: '' });
    const currentOutputTranscriptionRef = useRef({ id: -1, text: '' });
    const currentAudioChunksRef = useRef<Float32Array[]>([]);
    const logContainerRef = useRef<HTMLDivElement>(null);

    // Auto-scroll to bottom
    useEffect(() => {
        if (logContainerRef.current) {
            const scrollOptions: ScrollToOptions = {
                top: logContainerRef.current.scrollHeight,
                behavior: 'smooth'
            };
            logContainerRef.current.scrollTo(scrollOptions);
        }
    }, [transcriptionLog]);

    const cleanupResources = useCallback(() => {
        transcriptionLog.forEach(entry => {
            if (entry.audioUrl) {
                URL.revokeObjectURL(entry.audioUrl);
            }
        });

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
            inputAudioContextRef.current.close().catch(console.error);
            inputAudioContextRef.current = null;
        }
        if (outputAudioContextRef.current && outputAudioContextRef.current.state !== 'closed') {
            outputAudioContextRef.current.close().catch(console.error);
            outputAudioContextRef.current = null;
        }

        outputSourcesRef.current.forEach(source => source.stop());
        outputSourcesRef.current.clear();
        nextStartTimeRef.current = 0;
        setVolume(0);

    }, [transcriptionLog]);

    const stopConversation = useCallback(async () => {
        if (sessionPromiseRef.current) {
            sessionPromiseRef.current.then((session) => {
                session.close();
            }).catch(console.error);
            sessionPromiseRef.current = null;
        }

        // Save session if user is authenticated and there are transcriptions
        if (user && transcriptionLog.length > 0 && sessionStartTime > 0) {
            const duration = Math.floor((Date.now() - sessionStartTime) / 1000); // seconds
            await saveSession(transcriptionLog, selectedLanguage, duration);
        }

        cleanupResources();
        setConnectionState('IDLE');
        setSessionStartTime(0);
    }, [cleanupResources, user, transcriptionLog, selectedLanguage, sessionStartTime]);

    // Vision Mode Handlers (Phase 5)
    const handleCameraCapture = useCallback(async (imageDataUrl: string) => {
        setShowCamera(false);
        setIsAnalyzingImage(true);
        setError(null);

        try {
            const result = await analyzeImageForVocabulary(imageDataUrl, selectedLanguage);
            setVocabularyCards(prev => [result.vocabularyCard, ...prev]);
        } catch (err) {
            console.error('Vision analysis error:', err);
            setError('Failed to analyze image. Please try again.');
        } finally {
            setIsAnalyzingImage(false);
        }
    }, [selectedLanguage]);

    const handlePracticeCard = useCallback((cardId: string) => {
        const card = vocabularyCards.find(c => c.id === cardId);
        if (!card) return;

        // TODO: Launch conversation mode with focus on this word
        console.log('Practice card:', card.word);
        setIsVisionMode(false);
    }, [vocabularyCards]);

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

    const handleDeleteCard = useCallback((cardId: string) => {
        setVocabularyCards(prev => prev.filter(c => c.id !== cardId));
    }, []);


    const handleMessage = useCallback(async (message: any) => {
        try {
            // Log all messages for debugging
            const msgKeys = Object.keys(message);
            console.log('[GLOSSOS] Message received:', msgKeys.join(', '), message);
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
                console.log('[GLOSSOS] ✅ Setup complete — session is ready');
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
                    console.log('[GLOSSOS] 🎤 Input transcription:', text);
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
                    console.log('[GLOSSOS] 🤖 Output transcription:', text);
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
                    console.log('[GLOSSOS] ✅ Turn complete');
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

                    currentInputTranscriptionRef.current = { id: -1, text: '' };
                    currentOutputTranscriptionRef.current = { id: -1, text: '' };
                }

                // Handle audio output from model
                const modelTurn = message.serverContent?.modelTurn;
                if (modelTurn?.parts && modelTurn.parts.length > 0) {
                    for (const part of modelTurn.parts) {
                        const audioData = part?.inlineData?.data;
                        if (audioData && outputAudioContextRef.current) {
                            try {
                                // Ensure AudioContext is in 'running' state (browsers can auto-suspend)
                                if (outputAudioContextRef.current.state === 'suspended') {
                                    console.log('[GLOSSOS] ⚠️ AudioContext suspended, resuming...');
                                    await outputAudioContextRef.current.resume();
                                }

                                const audioBytes = decode(audioData);
                                const audioBuffer = await decodeAudioData(audioBytes, outputAudioContextRef.current, 24000, 1);

                                const now = outputAudioContextRef.current.currentTime;
                                nextStartTimeRef.current = Math.max(nextStartTimeRef.current, now);

                                const source = outputAudioContextRef.current.createBufferSource();
                                source.buffer = audioBuffer;
                                source.connect(outputAudioContextRef.current.destination);

                                source.onended = () => {
                                    outputSourcesRef.current.delete(source);
                                };

                                source.start(nextStartTimeRef.current);
                                nextStartTimeRef.current += audioBuffer.duration;
                                setAudioChunkCount(prev => prev + 1);
                                outputSourcesRef.current.add(source);
                            } catch (audioErr) {
                                console.error('[GLOSSOS] Audio playback error:', audioErr);
                            }
                        }
                    }
                }

                if (message.serverContent?.interrupted) {
                    console.log('[GLOSSOS] ⚠️ Interrupted');
                    outputSourcesRef.current.forEach(source => source.stop());
                    outputSourcesRef.current.clear();
                    nextStartTimeRef.current = 0;
                }
            }
        } catch (msgErr) {
            console.error('[GLOSSOS] Error handling server message:', msgErr);
        }
    }, [addDebugLog, handleGenerateSceneImage]);

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
        setSessionStartTime(Date.now());

        // NOW create fresh AudioContexts synchronously — still within the user gesture
        // This MUST happen after cleanup (which nulls the refs) and before any await
        try {
            const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
            inputAudioContextRef.current = new AudioContextClass();
            outputAudioContextRef.current = new AudioContextClass({ sampleRate: 24000 });
            addDebugLog(`AudioContexts created (In: ${inputAudioContextRef.current.state}, Out: ${outputAudioContextRef.current.state})`);
        } catch (e) {
            console.error('[GLOSSOS] Failed to create AudioContext:', e);
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
            // Reduced buffer size to 2048 for lower latency (approx 40-50ms at 48k)
            scriptProcessorRef.current = inputAudioContextRef.current.createScriptProcessor(2048, 1, 1);

            scriptProcessorRef.current.onaudioprocess = (audioProcessingEvent) => {
                const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);

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
                    // Pass actual sample rate so createBlob can downsample to 16k if needed
                    const currentSampleRate = inputAudioContextRef.current.sampleRate;
                    const pcmBlob = createBlob(inputData, currentSampleRate);
                    sessionPromiseRef.current?.then((session) => {
                        try {
                            session.sendRealtimeInput({ media: pcmBlob });
                        } catch (sendErr) {
                            console.error('[GLOSSOS] Error sending audio:', sendErr);
                        }
                    }).catch((sessionErr) => {
                        console.error('[GLOSSOS] Session promise rejected:', sessionErr);
                    });
                }
            };

            mediaStreamSourceRef.current.connect(scriptProcessorRef.current);

            const silentGain = inputAudioContextRef.current.createGain();
            silentGain.gain.value = 0;
            scriptProcessorRef.current.connect(silentGain);
            silentGain.connect(inputAudioContextRef.current.destination);

            addDebugLog('Connecting to Gemini...');
            sessionPromiseRef.current = startLiveSession({
                onOpen: () => {
                    addDebugLog('WebSocket OPEN');
                    console.log('[GLOSSOS] ✅ WebSocket onOpen fired');
                    console.log('[GLOSSOS] Input AudioContext state:', inputAudioContextRef.current?.state);
                    console.log('[GLOSSOS] Output AudioContext state:', outputAudioContextRef.current?.state);
                    setConnectionState('CONNECTED');
                    // Set a timeout — if no AI response within 15s of CONNECTED, show a hint
                    connectionTimeoutRef.current = setTimeout(() => {
                        if (transcriptionLog.length === 0) {
                            setError('No response from the AI tutor yet. Try speaking louder or check your microphone. The AI should respond within a few seconds.');
                        }
                        connectionTimeoutRef.current = null;
                    }, 15000);
                },
                onMessage: handleMessage,
                onError: (e: ErrorEvent) => {
                    addDebugLog(`Socket Error: ${e.message}`);
                    console.error('Session error:', e);
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
                onClose: (event: CloseEvent) => {
                    addDebugLog(`Socket Closed: ${event.code}`);
                    console.log('Session closed:', event);
                    if (event.code !== 1000) {
                        // Only show error for abnormal closures
                        // setError(`Connection closed unexpectedly (code: ${event.code})`); 
                    }
                    setConnectionState('DISCONNECTED');
                    cleanupResources();
                },
            }, selectedLanguage, userContext, proficiencyLevel, nativeLanguage, selectedVoice);

            // Handle session promise for audio sending
            sessionPromiseRef.current.then(() => {
                addDebugLog('Session Promise Resolved');
            }).catch((err) => {
                addDebugLog(`Session Promise Rejected: ${err.message}`);
            });

        } catch (err) {
            console.error('Failed to start session:', err);
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

    // Toggle vision mode (must be after isConversationActive)
    const toggleVisionMode = useCallback(() => {
        if (isConversationActive) {
            setError('Stop the conversation before switching modes');
            return;
        }
        setIsVisionMode(!isVisionMode);
        setError(null);
    }, [isConversationActive, isVisionMode]);

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
                            {/* Vision Mode Toggle */}
                            <button
                                onClick={toggleVisionMode}
                                disabled={isConversationActive}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full transition-all text-xs font-semibold disabled:opacity-30 disabled:cursor-not-allowed ${isVisionMode
                                    ? 'bg-[#FFBF00]/15 text-[#FFBF00] border border-[#FFBF00]/30 shadow-lg shadow-[#FFBF00]/10'
                                    : 'bg-white/[0.04] text-slate-500 border border-white/[0.06] hover:bg-white/[0.08] hover:text-slate-300'
                                    }`}
                                title={isVisionMode ? 'Switch to Voice Mode' : 'Switch to Vision Mode'}
                                style={{ fontFamily: "'IBM Plex Mono', monospace" }}
                            >
                                {isVisionMode ? (
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                                    </svg>
                                ) : (
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                                    </svg>
                                )}
                                <span className="hidden sm:inline">{isVisionMode ? 'Vision' : 'Voice'}</span>
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
                {!isVisionMode ? (
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
                                        <GlossosOrb connectionState={connectionState} volume={volume} />
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
                        {transcriptionLog.map(entry => (
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
                                                                onClick={() => new Audio(entry.audioUrl).play()}
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
                    /* Vision Mode - Vocabulary Collection */
                    <div className="flex-grow overflow-y-auto p-6 md:p-8">
                        {isAnalyzingImage && (
                            <div className="flex items-center justify-center py-12">
                                <div className="text-center">
                                    <div className="w-16 h-16 mx-auto mb-4 border-4 border-purple-500/30 border-t-purple-500 rounded-full animate-spin"></div>
                                    <p className="text-white font-semibold">Analyzing image...</p>
                                    <p className="text-slate-400 text-sm mt-1">Creating vocabulary card</p>
                                </div>
                            </div>
                        )}

                        {!isAnalyzingImage && vocabularyCards.length === 0 && (
                            <div className="h-full flex flex-col items-center justify-center text-center px-4">
                                <div className="relative animate-float mb-8">
                                    <div className="absolute -inset-6 bg-purple-500/10 rounded-full blur-2xl"></div>
                                    <div className="w-28 h-28 rounded-full bg-gradient-to-br from-purple-500/15 to-blue-500/15 border border-purple-500/20 flex items-center justify-center overflow-hidden">
                                        <svg className="w-14 h-14 text-purple-400/60 relative z-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                                        </svg>
                                    </div>
                                </div>
                                <h2 className="text-white text-xl font-bold mb-2">No Vocabulary Cards Yet</h2>
                                <p className="text-slate-500 text-sm mb-6 max-w-sm">Point your camera at objects to learn new words in your target language</p>
                                <button
                                    onClick={() => setShowCamera(true)}
                                    className="px-6 py-3 bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-600 hover:to-blue-600 text-white font-semibold rounded-xl transition-all shadow-lg shadow-purple-500/20 hover:shadow-purple-500/30 flex items-center gap-2"
                                >
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                                    </svg>
                                    Capture Object
                                </button>
                            </div>
                        )}

                        {vocabularyCards.length > 0 && (
                            <div>
                                <div className="flex items-center justify-between mb-6">
                                    <h3 className="text-white font-bold text-lg">
                                        Vocabulary Collection ({vocabularyCards.length})
                                    </h3>
                                    <button
                                        onClick={() => setShowCamera(true)}
                                        className="px-4 py-2 bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 border border-purple-500/30 rounded-lg transition-colors flex items-center gap-2 text-sm font-semibold"
                                    >
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                        </svg>
                                        Add Card
                                    </button>
                                </div>
                                <VocabularyCollection
                                    cards={vocabularyCards}
                                    onPracticeCard={handlePracticeCard}
                                    onDeleteCard={handleDeleteCard}
                                />
                            </div>
                        )}
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
            </div>

            {/* Auth Modal */}
            {showAuthModal && <AuthModal onClose={() => setShowAuthModal(false)} />}

            {/* Camera Capture Modal (Phase 5) */}
            {showCamera && (
                <CameraCapture
                    isActive={showCamera}
                    onCapture={handleCameraCapture}
                    onClose={() => setShowCamera(false)}
                />
            )}
        </div>
    );
};

export default Conversation;