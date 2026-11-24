import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
    ConversationListener, getAssistHelp, type AssistHelp, type ReplyIdea, type Speaker,
} from '../../services/conversationAssist';
import { speak, stopSpeaking } from '../../services/speech';
import { localeFor } from '../../services/languages';
import { languageMeta } from '../shell/LearningSettings';
import { Icon } from '../ui/Icon';
import { Badge, Button, Card, Eyebrow, IconButton, Spinner, cx } from '../ui/primitives';

interface Props {
    nativeLanguage: string;
    learnLanguage: string;
    level: string;
}

interface Item {
    id: number;
    text: string;
    speaker?: Speaker;
    help?: AssistHelp;
    state: 'thinking' | 'done' | 'failed';
}

type Status = 'idle' | 'starting' | 'listening';

/**
 * Conversation Assist: the phone listens to a real conversation, shows what the other person said
 * in your language, and suggests what to answer (it can also say the answer for you).
 */
export default function ConversationAssist({ nativeLanguage, learnLanguage, level }: Props) {
    const [status, setStatus] = useState<Status>('idle');
    const [items, setItems] = useState<Item[]>([]);
    const [partial, setPartial] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [startedAt, setStartedAt] = useState(0);
    const [speakingKey, setSpeakingKey] = useState<string | null>(null);
    const [showBig, setShowBig] = useState<ReplyIdea | null>(null);
    const listenerRef = useRef<ConversationListener | null>(null);
    const itemsRef = useRef<Item[]>([]);
    const nextId = useRef(0);
    const levelRef = useRef(0);
    const feedRef = useRef<HTMLDivElement>(null);
    const learnLocale = localeFor(learnLanguage);
    const learn = languageMeta(learnLanguage);
    const native = languageMeta(nativeLanguage);

    useEffect(() => { itemsRef.current = items; }, [items]);
    useEffect(() => {
        if (items.length || partial) feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: 'smooth' });
    }, [items, partial]);

    const update = (id: number, patch: Partial<Item>) => setItems(prev => prev.map(it => it.id === id ? { ...it, ...patch } : it));

    const helpFor = useCallback(async (id: number, text: string, forceSpeaker?: Speaker) => {
        const done = itemsRef.current.filter(it => it.id !== id && it.state === 'done' && it.speaker);
        const lastThem = [...done].reverse().find(it => it.speaker === 'them');
        update(id, { state: 'thinking' });
        try {
            const help = await getAssistHelp(text, {
                nativeLanguage, learnLanguage, level,
                history: done.map(it => ({ speaker: it.speaker!, text: it.text })),
                lastReplies: forceSpeaker ? [] : (lastThem?.help?.replies.map(r => r.text) ?? []),
            });
            const speaker = forceSpeaker ?? help.speaker;
            update(id, { state: 'done', speaker, help: { ...help, speaker, replies: speaker === 'me' ? [] : help.replies } });
        } catch {
            update(id, { state: 'failed' });
        }
    }, [nativeLanguage, learnLanguage, level]);

    const onSentence = useCallback((text: string) => {
        setPartial('');
        const id = ++nextId.current;
        setItems(prev => [...prev, { id, text, state: 'thinking' }]);
        // Let the state settle so the history used for help includes the previous sentence.
        setTimeout(() => void helpFor(id, text), 0);
    }, [helpFor]);

    const stop = useCallback(() => {
        listenerRef.current?.stop();
        listenerRef.current = null;
        stopSpeaking();
        setStatus('idle');
        setPartial('');
    }, []);

    const start = async () => {
        setError(null);
        setStatus('starting');
        const listener = new ConversationListener({
            onPartial: setPartial,
            onSentence,
            onLevel: v => { levelRef.current = v; },
            onError: msg => { setError(msg); stop(); },
        });
        listenerRef.current = listener;
        try {
            await listener.start();
            if (listenerRef.current !== listener) return;
            setStartedAt(Date.now());
            setStatus('listening');
        } catch (err) {
            listener.stop();
            listenerRef.current = null;
            setStatus('idle');
            setError((err as Error).message || 'Could not start listening.');
        }
    };

    useEffect(() => () => { listenerRef.current?.stop(); stopSpeaking(); }, []);

    /** Speaks a reply for the learner. The microphone pauses so the app does not transcribe itself. */
    const sayForMe = async (reply: ReplyIdea, key: string) => {
        stopSpeaking();
        setSpeakingKey(key);
        listenerRef.current?.setPaused(true);
        const id = ++nextId.current;
        setItems(prev => [...prev, { id, text: reply.text, speaker: 'me', state: 'done', help: { speaker: 'me', translation: reply.meaning, replies: [] } }]);
        try {
            await speak(reply.text, learnLocale);
        } finally {
            setSpeakingKey(k => (k === key ? null : k));
            setTimeout(() => listenerRef.current?.setPaused(false), 350);
        }
    };

    const switchSpeaker = (item: Item) => {
        const next: Speaker = item.speaker === 'me' ? 'them' : 'me';
        if (next === 'me') update(item.id, { speaker: 'me', help: item.help ? { ...item.help, speaker: 'me', replies: [] } : undefined });
        else void helpFor(item.id, item.text, 'them');
    };

    const listening = status === 'listening';

    return (
        <div className="relative flex h-full flex-col">
            <div ref={feedRef} className="min-h-0 flex-1 overflow-y-auto">
                <div className="mx-auto w-full max-w-2xl px-4 pb-6 pt-2 sm:px-6">
                    {items.length === 0 && !partial ? (
                        <Intro listening={listening} learnName={learnLanguage} nativeName={nativeLanguage} />
                    ) : (
                        <div className="space-y-3 pt-2">
                            <AnimatePresence initial={false}>
                                {items.map(item => (
                                    <motion.div key={item.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}>
                                        {item.speaker === 'me'
                                            ? <MyLine item={item} onSwitch={() => switchSpeaker(item)} />
                                            : <TheirLine
                                                item={item}
                                                nativeCode={native.code}
                                                speakingKey={speakingKey}
                                                onRetry={() => void helpFor(item.id, item.text)}
                                                onSwitch={() => switchSpeaker(item)}
                                                onSay={(r, key) => void sayForMe(r, key)}
                                                onShow={setShowBig}
                                            />}
                                    </motion.div>
                                ))}
                            </AnimatePresence>
                            {partial && (
                                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-2xl border border-dashed border-white/[0.1] px-4 py-3 text-[17px] text-slate-300">
                                    {partial}<span className="ml-1 inline-block h-4 w-0.5 animate-blink bg-mint-400 align-middle" />
                                </motion.div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            <AnimatePresence>
                {error && (
                    <motion.div role="alert" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                        className="mx-auto mb-2 flex w-[calc(100%-2rem)] max-w-xl items-start gap-3 rounded-2xl border border-rose-400/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                        <Icon name="help" size={18} className="mt-0.5 shrink-0 text-rose-300" />
                        <span className="flex-1">{error}</span>
                        <button type="button" onClick={() => setError(null)} aria-label="Dismiss" className="text-rose-300 hover:text-white"><Icon name="x" size={16} /></button>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Control dock */}
            <div className="shrink-0 px-4 pb-4 pt-1 sm:pb-6">
                <div className="mx-auto flex max-w-xl items-center gap-3 rounded-[28px] border border-white/[0.07] bg-ink-900/75 p-2.5 shadow-[0_24px_60px_-24px_rgba(0,0,0,0.95)] backdrop-blur-2xl">
                    {listening ? (
                        <>
                            <div className="flex flex-1 items-center gap-3 pl-2">
                                <span className="relative flex h-2.5 w-2.5">
                                    <span className="absolute inset-0 animate-ping rounded-full bg-mint-400/70" />
                                    <span className="relative h-2.5 w-2.5 rounded-full bg-mint-400" />
                                </span>
                                <span className="text-sm font-semibold text-white">Listening</span>
                                <LevelMeter levelRef={levelRef} />
                                <Elapsed start={startedAt} />
                            </div>
                            <Button variant="danger" icon="stop" onClick={stop} className="rounded-full">Stop</Button>
                        </>
                    ) : (
                        <>
                            <div className="hidden flex-1 items-center gap-2 pl-2 text-sm text-slate-400 sm:flex">
                                <Badge tone="gold">{learn.native}</Badge>
                                <Icon name="arrowRight" size={14} className="text-slate-600" />
                                <Badge>{native.native}</Badge>
                            </div>
                            <Button variant="primary" size="lg" icon={status === 'starting' ? undefined : 'ear'} loading={status === 'starting'} onClick={start} className="w-full whitespace-nowrap rounded-full sm:w-auto">
                                {items.length ? 'Listen again' : 'Start listening'}
                            </Button>
                        </>
                    )}
                </div>
                <p className="mt-2.5 text-center text-xs text-slate-500">
                    {listening ? 'Put your phone between you and the person you are talking to.' : 'Audio is sent to Google Gemini to transcribe it. Glossos does not save it.'}
                </p>
            </div>

            {/* Show a reply in big letters to the other person */}
            <AnimatePresence>
                {showBig && (
                    <motion.button
                        type="button"
                        className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-ink-950/97 px-8 text-center backdrop-blur-xl"
                        onClick={() => setShowBig(null)}
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        aria-label="Close"
                    >
                        <motion.p initial={{ scale: 0.94 }} animate={{ scale: 1 }} className="font-display text-4xl font-bold leading-tight tracking-tight text-white sm:text-6xl">
                            {showBig.text}
                        </motion.p>
                        <p className="text-lg text-slate-400">{showBig.meaning}</p>
                        <span className="mt-6 text-sm text-slate-500">Tap anywhere to close</span>
                    </motion.button>
                )}
            </AnimatePresence>
        </div>
    );
}

// ─── Pieces ───────────────────────────────────────────────────────────────

/** The sentence as it was most likely said (speech recognition slips fixed). */
const shownText = (item: Item) => item.help?.meant || item.text;
const heardDifferently = (item: Item) => {
    const n = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    return !!item.help?.meant && n(item.help.meant) !== n(item.text);
};

const Intro: React.FC<{ listening: boolean; learnName: string; nativeName: string }> = ({ listening, learnName, nativeName }) => (
    <div className="flex min-h-[420px] flex-col items-center justify-center py-8 text-center">
        <div className="relative mb-8 flex h-36 w-36 items-center justify-center">
            {[0, 1, 2].map(i => (
                <motion.span
                    key={i}
                    className="absolute inset-0 rounded-full border border-gold-400/30"
                    animate={{ scale: [0.6, 1.25], opacity: [0.7, 0] }}
                    transition={{ duration: 3, repeat: Infinity, delay: i, ease: 'easeOut' }}
                />
            ))}
            <span className="relative flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-b from-gold-300 to-gold-500 text-ink-950 shadow-[0_16px_50px_-12px_rgba(255,191,0,0.8)]">
                <Icon name="ear" size={36} strokeWidth={1.9} />
            </span>
        </div>
        <h2 className="font-display text-[28px] font-bold leading-tight tracking-tight text-white sm:text-4xl">
            {listening ? 'Listening to the conversation' : 'Never get lost in a conversation'}
        </h2>
        <p className="mt-3 max-w-md text-[15px] leading-relaxed text-slate-400">
            {listening
                ? `When someone speaks, you will see what they said in ${nativeName} and what you could answer in ${learnName}.`
                : `Abroad and someone is talking to you? Glossos listens, shows you what they said in ${nativeName}, and suggests what to answer in ${learnName}. It can even say it for you.`}
        </p>
        {!listening && (
            <>
                <div className="mt-7 grid w-full max-w-lg grid-cols-1 gap-2 text-left sm:grid-cols-3">
                    {[
                        { icon: 'ear' as const, title: 'They speak', body: 'Glossos hears it' },
                        { icon: 'globe' as const, title: 'You understand', body: `In ${nativeName}, instantly` },
                        { icon: 'chat' as const, title: 'You answer', body: 'Pick a reply or let Glossos say it' },
                    ].map((s, i) => (
                        <motion.div key={s.title} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + i * 0.08 }}
                            className="flex items-center gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-3 sm:flex-col sm:items-start">
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gold-500/10 text-gold-400"><Icon name={s.icon} size={18} /></span>
                            <span>
                                <span className="block text-sm font-semibold text-white">{s.title}</span>
                                <span className="block text-xs text-slate-400">{s.body}</span>
                            </span>
                        </motion.div>
                    ))}
                </div>
                <p className="mt-5 flex max-w-md items-start gap-2 text-left text-xs leading-relaxed text-slate-500">
                    <Icon name="lock" size={14} className="mt-0.5 shrink-0" />
                    Be open about it: let the people you are talking to know you are using a translation app.
                </p>
            </>
        )}
    </div>
);

const TheirLine: React.FC<{
    item: Item;
    nativeCode: string;
    speakingKey: string | null;
    onRetry: () => void;
    onSwitch: () => void;
    onSay: (r: ReplyIdea, key: string) => void;
    onShow: (r: ReplyIdea) => void;
}> = ({ item, speakingKey, onRetry, onSwitch, onSay, onShow }) => (
    <Card className="p-4 sm:p-5">
        <div className="flex items-center justify-between gap-2">
            <Eyebrow>{item.speaker === 'them' ? 'They said' : 'Heard'}</Eyebrow>
            {item.state === 'done' && (
                <button type="button" onClick={onSwitch} className="flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium text-slate-500 transition-colors hover:bg-white/[0.05] hover:text-slate-300">
                    <Icon name="swap" size={12} /> It was me
                </button>
            )}
        </div>
        <p className="mt-2 font-display text-xl font-semibold leading-snug text-white">{shownText(item)}</p>
        {heardDifferently(item) && <p className="mt-0.5 text-xs text-slate-500">Heard as “{item.text}”</p>}
        {item.state === 'thinking' && (
            <p className="mt-2 flex items-center gap-2 text-sm text-slate-500"><Spinner size={12} /> Translating…</p>
        )}
        {item.state === 'failed' && (
            <p className="mt-2 flex items-center gap-2 text-sm text-rose-300">
                Could not translate this one.
                <button type="button" onClick={onRetry} className="font-semibold text-gold-300 hover:text-gold-200">Try again</button>
            </p>
        )}
        {item.help && (
            <>
                <p className="mt-1.5 text-[15px] leading-relaxed text-slate-300">{item.help.translation}</p>
                {item.help.tip && (
                    <p className="mt-3 flex items-start gap-2 rounded-xl bg-gold-500/[0.06] px-3 py-2 text-sm text-gold-200">
                        <Icon name="sparkles" size={14} className="mt-0.5 shrink-0" /> {item.help.tip}
                    </p>
                )}
                {item.help.replies.length > 0 && (
                    <div className="mt-4">
                        <Eyebrow className="text-gold-400/80">You could say</Eyebrow>
                        <div className="mt-2 space-y-2">
                            {item.help.replies.map((r, i) => {
                                const key = `${item.id}-${i}`;
                                const speaking = speakingKey === key;
                                return (
                                    <div key={key} className={cx('flex items-center gap-2 rounded-2xl border p-3 transition-colors', speaking ? 'border-gold-400/60 bg-gold-500/[0.12]' : 'border-gold-500/20 bg-gold-500/[0.05]')}>
                                        <div className="min-w-0 flex-1">
                                            <p className="text-[17px] font-semibold leading-snug text-gold-100">{r.text}</p>
                                            <p className="mt-0.5 text-xs leading-snug text-slate-400">
                                                {r.meaning}
                                                {r.sounds && <span className="text-slate-500"> · sounds like “{r.sounds}”</span>}
                                            </p>
                                        </div>
                                        <IconButton icon="expand" label="Show it big" size="sm" onClick={() => onShow(r)} />
                                        <IconButton icon="speaker" label="Say it for me" size="sm" active={speaking} onClick={() => onSay(r, key)} />
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </>
        )}
    </Card>
);

const MyLine: React.FC<{ item: Item; onSwitch: () => void }> = ({ item, onSwitch }) => (
    <div className="flex flex-col items-end">
        <div className="max-w-[88%] rounded-2xl rounded-tr-md border border-gold-500/20 bg-gradient-to-br from-gold-500/[0.15] to-gold-500/[0.05] px-4 py-3">
            <p className="text-[11px] font-semibold text-gold-300/80">You said</p>
            <p className="mt-0.5 text-[16px] font-medium text-white">{item.text}</p>
            {item.help?.translation && <p className="mt-0.5 text-sm text-slate-300">{item.help.translation}</p>}
            {item.help?.tip && <p className="mt-2 flex items-start gap-1.5 text-sm text-gold-200"><Icon name="pen" size={14} className="mt-0.5 shrink-0 text-gold-400" /> {item.help.tip}</p>}
        </div>
        <button type="button" onClick={onSwitch} className="mt-1 flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium text-slate-500 hover:text-slate-300">
            <Icon name="swap" size={12} /> It was them
        </button>
    </div>
);

const LevelMeter: React.FC<{ levelRef: React.MutableRefObject<number> }> = ({ levelRef }) => {
    const [level, setLevel] = useState(0);
    useEffect(() => {
        const t = setInterval(() => setLevel(l => l * 0.5 + levelRef.current * 0.5), 90);
        return () => clearInterval(t);
    }, [levelRef]);
    return (
        <span className="flex h-5 items-center gap-[3px]" aria-hidden="true">
            {[0.45, 0.75, 1, 0.75, 0.45].map((k, i) => (
                <span key={i} className="w-[3px] rounded-full bg-mint-400" style={{ height: `${4 + level * 16 * k}px`, transition: 'height 90ms linear' }} />
            ))}
        </span>
    );
};

const Elapsed: React.FC<{ start: number }> = ({ start }) => {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
    const sec = start ? Math.max(0, Math.floor((now - start) / 1000)) : 0;
    return <span className="font-mono text-sm tabular-nums text-slate-400">{Math.floor(sec / 60)}:{String(sec % 60).padStart(2, '0')}</span>;
};
