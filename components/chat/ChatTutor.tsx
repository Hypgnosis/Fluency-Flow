import React, { useEffect, useMemo, useRef, useState } from 'react';
import { chatTutorSystemPrompt } from '../../services/tutorPrompts';
import { engineReady, streamReply, type ReplyStats } from '../../services/textEngine';
import type { ChatTurn } from '../../services/onDevice/runtime';
import { renderMarkdown } from '../../utils/miniMarkdown';
import { Dictation, isDictationSupported, isTtsSupported, speakSegments, stopSpeaking } from '../../services/speech';
import { replySegments } from '../../services/readAloud';
import { localeFor } from '../../services/languages';
import { EngineSwitch } from '../offline/EngineSwitch';
import { useEnginePreference } from '../offline/useOnDevice';
import { StatsLine } from './StatsLine';

const MONO = { fontFamily: "'IBM Plex Mono', monospace" };
/** Older turns are dropped from the prompt so small on-device context windows never overflow. */
const MAX_HISTORY_TURNS = 16;

interface ChatMessage extends ChatTurn {
    id: string;
    stats?: ReplyStats;
}

interface ChatTutorProps {
    nativeLanguage: string;
    learnLanguage: string;
    level: string;
    onManageModels: () => void;
}

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const AUTO_READ_KEY = 'glossos_chat_autoread';

const Bubble: React.FC<{ message: ChatMessage; streaming?: boolean; speaking?: boolean; onSpeak?: () => void }> = ({ message, streaming, speaking, onSpeak }) => {
    const html = useMemo(() => (message.role === 'model' ? renderMarkdown(message.text) : ''), [message.role, message.text]);
    return (
        <div className={message.role === 'user' ? 'text-right' : 'text-left'}>
            <div className={`inline-block max-w-[88%] px-4 py-3 rounded-2xl text-sm leading-relaxed border text-left ${message.role === 'user'
                ? 'rounded-br-md bg-[#161616]/90 border-white/[0.08] text-[#F5F5F7]'
                : 'rounded-bl-md bg-[#0d0d0e]/90 border-[#00FF41]/[0.08] text-[#F5F5F7]'}`}>
                {message.role === 'user'
                    ? message.text
                    : <div className="glossos-md" dangerouslySetInnerHTML={{ __html: html || (streaming ? '<p>…</p>' : '') }} />}
            </div>
            {message.role === 'model' && !streaming && message.text && (
                <div className="mt-1 flex items-center gap-2">
                    {onSpeak && (
                        <button onClick={onSpeak} className={`text-[11px] ${speaking ? 'text-[#00FF41]' : 'text-slate-500 hover:text-slate-300'}`} style={MONO}
                            aria-label={speaking ? 'Stop reading' : 'Read aloud'}>
                            {speaking ? '■ Stop' : '🔊 Read aloud'}
                        </button>
                    )}
                    {message.stats && <StatsLine stats={message.stats} />}
                </div>
            )}
        </div>
    );
};

/**
 * Text chat with the tutor (Gallery's AI Chat). Runs on Gemini or fully on-device, so it keeps
 * working without an internet connection.
 */
export const ChatTutor: React.FC<ChatTutorProps> = ({ nativeLanguage, learnLanguage, level, onManageModels }) => {
    const [engine, setEngine] = useEnginePreference();
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [draft, setDraft] = useState('');
    const [running, setRunning] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const abort = useRef<AbortController | null>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const dictation = useRef<Dictation | null>(null);
    const [listening, setListening] = useState(false);
    const [speakingId, setSpeakingId] = useState<string | null>(null);
    const [autoRead, setAutoRead] = useState(() => {
        try { return localStorage.getItem(AUTO_READ_KEY) === 'true'; } catch { return false; }
    });

    const system = chatTutorSystemPrompt({ nativeLanguage, learnLanguage, level });
    const learnLocale = localeFor(learnLanguage);
    const nativeLocale = localeFor(nativeLanguage);

    /** Reads a reply aloud: target-language text and [native explanations] get matching voices. */
    const readAloud = (message: ChatMessage) => {
        if (speakingId === message.id) {
            stopSpeaking();
            setSpeakingId(null);
            return;
        }
        stopSpeaking();
        setSpeakingId(message.id);
        speakSegments(replySegments(message.text, learnLocale, nativeLocale))
            .finally(() => setSpeakingId(id => (id === message.id ? null : id)));
    };

    const toggleAutoRead = () => {
        const next = !autoRead;
        setAutoRead(next);
        try { localStorage.setItem(AUTO_READ_KEY, String(next)); } catch { /* storage unavailable */ }
        if (!next) stopSpeaking();
    };

    /** Tap-to-talk dictation in the language being learned (text goes into the box). */
    const toggleDictation = async () => {
        if (listening) {
            const d = dictation.current;
            dictation.current = null;
            setListening(false);
            const text = d ? await d.finish() : '';
            if (text) setDraft(text);
            return;
        }
        stopSpeaking();
        setSpeakingId(null);
        const d = new Dictation(learnLocale, text => setDraft(text), message => {
            setListening(false);
            setError(message);
        });
        dictation.current = d;
        d.start();
        setListening(true);
    };

    // A new language pair or level starts a new conversation.
    useEffect(() => {
        abort.current?.abort();
        setMessages([]);
        setError(null);
    }, [nativeLanguage, learnLanguage, level]);
    useEffect(() => () => {
        abort.current?.abort();
        dictation.current?.cancel();
        stopSpeaking();
    }, []);
    useEffect(() => {
        scrollRef.current?.scrollTo?.({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }, [messages]);

    const send = async (text = draft) => {
        const message = text.trim();
        if (!message || running) return;
        if (listening) {
            dictation.current?.cancel();
            dictation.current = null;
            setListening(false);
        }
        stopSpeaking();
        setSpeakingId(null);
        if (!engineReady(engine)) {
            setError('Load an on-device model first, or switch to Cloud.');
            return;
        }
        setError(null);
        setDraft('');
        const history: ChatTurn[] = messages.slice(-MAX_HISTORY_TURNS).map(({ role, text: t }) => ({ role, text: t }));
        const userMsg: ChatMessage = { id: newId(), role: 'user', text: message };
        const reply: ChatMessage = { id: newId(), role: 'model', text: '' };
        setMessages(prev => [...prev, userMsg, reply]);
        setRunning(true);
        const controller = new AbortController();
        abort.current = controller;
        try {
            let out = '';
            for await (const chunk of streamReply(engine, {
                system,
                history,
                message,
                signal: controller.signal,
                params: { maxOutputTokens: 512 },
                onStats: stats => setMessages(prev => prev.map(m => (m.id === reply.id ? { ...m, stats } : m))),
            })) {
                out += chunk;
                setMessages(prev => prev.map(m => (m.id === reply.id ? { ...m, text: out } : m)));
            }
            if (autoRead && out.trim() && !controller.signal.aborted) {
                setSpeakingId(reply.id);
                speakSegments(replySegments(out, learnLocale, nativeLocale))
                    .finally(() => setSpeakingId(id => (id === reply.id ? null : id)));
            }
        } catch (err) {
            if ((err as Error).name !== 'AbortError') {
                setError((err as Error).message || 'Something went wrong.');
                setMessages(prev => prev.filter(m => m.id !== reply.id || m.text));
            }
        } finally {
            setRunning(false);
            abort.current = null;
        }
    };

    const starters = [
        `¡Hola! Quiero practicar ${learnLanguage}.`,
        'Help me prepare for a job interview.',
        'Let\'s role-play ordering food at a restaurant.',
    ];

    return (
        <div className="flex flex-col h-full min-h-0">
            <div className="px-4 sm:px-6 py-2 border-b border-white/[0.04] flex items-center justify-between gap-2 flex-wrap">
                <span className="text-[10px] uppercase tracking-[0.2em] text-slate-500 font-bold" style={MONO}>Chat tutor</span>
                <div className="flex items-center gap-3">
                    {isTtsSupported() && (
                        <button onClick={toggleAutoRead} className={`text-[11px] ${autoRead ? 'text-[#00FF41]' : 'text-slate-500 hover:text-slate-300'}`} style={MONO}
                            title="Read every reply aloud" aria-pressed={autoRead}>
                            {autoRead ? '🔊 Auto-read on' : '🔈 Auto-read off'}
                        </button>
                    )}
                    <EngineSwitch value={engine} onChange={setEngine} onManageModels={onManageModels} />
                </div>
            </div>

            <div ref={scrollRef} className="flex-grow min-h-0 overflow-y-auto px-4 sm:px-6 py-4 space-y-3 max-w-2xl w-full mx-auto">
                {messages.length === 0 && (
                    <div className="text-center py-10">
                        <h3 className="text-white font-bold mb-2">Practice by text</h3>
                        <p className="text-slate-500 text-sm mb-4">
                            Write in {learnLanguage}. Your tutor corrects mistakes and keeps the conversation going.
                            {engine === 'device' && ' Running on this device: works offline.'}
                        </p>
                        <div className="flex flex-col items-center gap-2">
                            {starters.map(s => (
                                <button key={s} onClick={() => send(s)} className="text-xs text-slate-400 hover:text-white border border-white/[0.08] rounded-full px-3 py-1.5">{s}</button>
                            ))}
                        </div>
                    </div>
                )}
                {messages.map((m, i) => (
                    <Bubble key={m.id} message={m} streaming={running && i === messages.length - 1}
                        speaking={speakingId === m.id} onSpeak={isTtsSupported() ? () => readAloud(m) : undefined} />
                ))}
            </div>

            {error && (
                <div className="mx-4 sm:mx-6 mb-2 bg-rose-500/10 border border-rose-500/20 p-2.5 rounded-xl text-rose-300 text-xs flex justify-between gap-2">
                    <span>{error}</span>
                    {engine === 'device' && <button onClick={onManageModels} className="underline">Models</button>}
                </div>
            )}

            <form className="px-4 sm:px-6 py-3 border-t border-white/[0.04] flex items-center gap-2 max-w-2xl w-full mx-auto"
                onSubmit={e => { e.preventDefault(); send(); }}>
                {isDictationSupported() && (
                    <button type="button" onClick={toggleDictation} disabled={running}
                        className={`p-2.5 rounded-full border transition-colors disabled:opacity-40 ${listening
                            ? 'bg-rose-500/15 border-rose-500/40 text-rose-300 animate-pulse'
                            : 'bg-white/[0.04] border-white/[0.08] text-slate-400 hover:text-white'}`}
                        aria-label={listening ? 'Stop dictation' : `Speak in ${learnLanguage}`} title={listening ? 'Stop dictation' : `Speak in ${learnLanguage}`}>
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 016 0v8.25a3 3 0 01-3 3z" /></svg>
                    </button>
                )}
                <input value={draft} onChange={e => setDraft(e.target.value)} placeholder={listening ? 'Listening…' : `Write in ${learnLanguage}…`}
                    className="flex-1 min-w-0 bg-black/30 border border-white/[0.08] rounded-full px-4 py-2.5 text-sm text-[#F5F5F7] placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-[#00FF41]/40" />
                {running ? (
                    <button type="button" onClick={() => abort.current?.abort()} className="px-4 py-2.5 rounded-full bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm font-semibold" style={MONO}>Stop</button>
                ) : (
                    <button type="submit" disabled={!draft.trim()} className="px-4 py-2.5 rounded-full bg-[#00FF41]/15 border border-[#00FF41]/40 text-[#00FF41] text-sm font-bold disabled:opacity-40" style={MONO}>Send</button>
                )}
                {messages.length > 0 && !running && (
                    <button type="button" onClick={() => setMessages([])} className="text-[11px] text-slate-500 hover:text-slate-300" style={MONO}>New</button>
                )}
            </form>
        </div>
    );
};
