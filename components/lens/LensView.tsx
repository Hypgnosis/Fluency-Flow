import React, { useEffect, useRef, useState } from 'react';
import type { SavedWord } from '../../types/lens';
import { LensViewfinder, LensViewfinderHandle } from './LensViewfinder';
import { VocabCardView } from './VocabCardView';
import { useLensLesson, LensLessonOptions } from './useLensLesson';
import { Dictation, isDictationSupported, speak, stopSpeaking } from '../../services/speech';
import { balanceTargets } from '../../services/lensTeacher/dialogue';
import { localeFor } from '../../services/languages';
import { fileToSquareDataUrl } from '../../utils/imageUtils';
import { findSaved } from '../../services/vocabStore';

const MONO = { fontVariantNumeric: 'tabular-nums' } as const;

interface LensViewProps extends LensLessonOptions {
    savedWords: SavedWord[];
    onToggleSave: (card: import('../../types/lens').VocabCard, imageDataUrl?: string) => void;
}

/** Renders a tagged teacher reply; <target> spans are highlighted and tap-to-pronounce. */
const TeacherText: React.FC<{ text: string; learnLocale: string }> = ({ text, learnLocale }) => {
    const parts = balanceTargets(text).split(/(<target>[\s\S]*?<\/target>)/gi);
    return (
        <>
            {parts.map((part, i) => {
                const m = /^<target>([\s\S]*?)<\/target>$/i.exec(part);
                if (!m) return <React.Fragment key={i}>{part}</React.Fragment>;
                return (
                    <button
                        key={i}
                        onClick={() => speak(m[1], learnLocale)}
                        className="inline font-semibold text-[#3DF5A0] underline decoration-[#3DF5A0]/30 decoration-dotted underline-offset-4 hover:decoration-[#3DF5A0]"
                        title="Tap to hear it"
                    >
                        {m[1]}
                    </button>
                );
            })}
        </>
    );
};

export const LensView: React.FC<LensViewProps> = ({ savedWords, onToggleSave, ...options }) => {
    const lesson = useLensLesson(options);
    const viewfinder = useRef<LensViewfinderHandle>(null);
    const fileInput = useRef<HTMLInputElement>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const dictation = useRef<Dictation | null>(null);

    const [pendingFrame, setPendingFrame] = useState<string | null>(null);
    const [listening, setListening] = useState(false);
    const [transcript, setTranscript] = useState('');
    const [textMode, setTextMode] = useState(!isDictationSupported());
    const [draft, setDraft] = useState('');
    const greeted = useRef(false);

    const learnLocale = localeFor(options.learnLanguage);
    const nativeLocale = lesson.nativeLocale;
    const frozen = lesson.image ?? pendingFrame;
    const isBusy = lesson.busy !== 'none';
    const inLesson = lesson.turns.some(t => t.role === 'teacher');

    // Greet once per lesson, like Gallery (fixed phrase, not generated).
    useEffect(() => {
        if (!inLesson && !greeted.current) {
            greeted.current = true;
            lesson.speakGreeting();
        }
    }, [inLesson, lesson]);

    useEffect(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }, [lesson.turns, lesson.streamingReply, lesson.cards.length]);

    useEffect(() => () => dictation.current?.cancel(), []);

    const captureOrPending = (): string | null => pendingFrame ?? lesson.image ?? viewfinder.current?.capture() ?? null;

    const startListening = () => {
        if (isBusy) return;
        if (!inLesson && !frozen) {
            const frame = viewfinder.current?.capture();
            if (!frame) {
                lesson.setError('The camera is not ready yet. You can also upload a photo.');
                return;
            }
            setPendingFrame(frame);
        }
        stopSpeaking();
        setTranscript('');
        const d = new Dictation(nativeLocale, setTranscript, message => {
            setListening(false);
            lesson.setError(message);
        });
        dictation.current = d;
        d.start();
        setListening(true);
    };

    const cancelListening = () => {
        dictation.current?.cancel();
        dictation.current = null;
        setListening(false);
        setTranscript('');
        if (!inLesson) setPendingFrame(null);
    };

    const sendSpeech = async () => {
        const d = dictation.current;
        dictation.current = null;
        setListening(false);
        const text = d ? await d.finish() : transcript;
        setTranscript('');
        const frame = captureOrPending();
        setPendingFrame(null);
        if (!inLesson && !text.trim()) {
            await lesson.ask(undefined, frame ?? undefined);
            return;
        }
        if (!text.trim()) return; // Blank follow-ups are ignored.
        await lesson.ask(text, frame ?? undefined);
    };

    const sendText = async () => {
        const text = draft.trim();
        if (inLesson && !text) return;
        const frame = captureOrPending();
        if (!inLesson && !frame) {
            lesson.setError('The camera is not ready yet. You can also upload a photo.');
            return;
        }
        setDraft('');
        setPendingFrame(null);
        await lesson.ask(text || undefined, frame ?? undefined);
    };

    const shutter = async () => {
        const frame = captureOrPending();
        if (!frame) {
            lesson.setError('The camera is not ready yet. You can also upload a photo.');
            return;
        }
        setPendingFrame(null);
        await lesson.ask(undefined, frame);
    };

    const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        try {
            const frame = await fileToSquareDataUrl(file);
            lesson.newLesson();
            setPendingFrame(frame);
        } catch {
            lesson.setError('Could not read that image.');
        }
    };

    const newLesson = () => {
        cancelListening();
        setPendingFrame(null);
        greeted.current = false;
        lesson.newLesson();
    };

    const overlayLabel = lesson.busy === 'thinking' ? 'Thinking…' : listening ? 'Listening…' : null;
    const currentCard = lesson.cards[lesson.selectedCard];

    return (
        <div className="flex flex-col h-full min-h-0">
            <div ref={scrollRef} className="flex-grow min-h-0 overflow-y-auto px-4 sm:px-6 pt-4 pb-2 space-y-4">
                <LensViewfinder
                    ref={viewfinder}
                    frozenImage={frozen}
                    overlay={overlayLabel && (
                        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 px-4 py-1.5 rounded-full bg-black/70 border border-[#FFBF00]/30 text-[#FFBF00] text-xs font-semibold animate-pulse" style={MONO}>
                            {overlayLabel}
                        </div>
                    )}
                />

                {/* Dialogue */}
                <div className="space-y-3 max-w-2xl mx-auto">
                    {!inLesson && lesson.turns.length === 0 && !lesson.streamingReply && (
                        <div className="text-left">
                            <div className="inline-block px-4 py-3 rounded-2xl rounded-bl-md bg-[#0d0d0e]/90 border border-[#3DF5A0]/[0.08] text-sm text-[#F5F5F7]">
                                {lesson.greeting}
                            </div>
                            <p className="text-[11px] text-slate-600 mt-2" style={MONO}>
                                Point at something, then tap the mic to ask, or tap the shutter for just the word.
                            </p>
                        </div>
                    )}
                    {lesson.turns.map(turn => (
                        <div key={turn.id} className={turn.role === 'student' ? 'text-right' : 'text-left'}>
                            <div className={`inline-block max-w-[90%] px-4 py-3 rounded-2xl text-sm leading-relaxed border text-left ${turn.role === 'student'
                                ? 'rounded-br-md bg-[#161616]/90 border-white/[0.08] text-[#F5F5F7]'
                                : 'rounded-bl-md bg-[#0d0d0e]/90 border-[#3DF5A0]/[0.08] text-[#F5F5F7]'}`}>
                                {turn.role === 'teacher'
                                    ? <TeacherText text={turn.text} learnLocale={learnLocale} />
                                    : turn.text}
                            </div>
                        </div>
                    ))}
                    {lesson.streamingReply && (
                        <div className="text-left">
                            <div className="inline-block max-w-[90%] px-4 py-3 rounded-2xl rounded-bl-md bg-[#0d0d0e]/90 border border-[#3DF5A0]/[0.08] text-sm leading-relaxed text-[#F5F5F7]">
                                <TeacherText text={lesson.streamingReply} learnLocale={learnLocale} />
                                <span className="inline-block w-0.5 h-4 ml-1 align-middle bg-current animate-blink opacity-60" />
                            </div>
                        </div>
                    )}
                    {listening && (
                        <div className="text-right">
                            <div className="inline-block max-w-[90%] px-4 py-3 rounded-2xl rounded-br-md bg-[#161616]/60 border border-dashed border-white/[0.12] text-sm text-slate-300 italic">
                                {transcript || 'Listening…'}
                            </div>
                        </div>
                    )}
                </div>

                {/* Vocabulary found */}
                {(currentCard || lesson.busy === 'extracting') && (
                    <div className="max-w-2xl mx-auto">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-[10px] uppercase tracking-[0.2em] text-slate-500 font-bold" style={MONO}>
                                {lesson.busy === 'extracting' && !currentCard ? 'Finding vocab…' : 'Vocab found'}
                            </span>
                            {lesson.cards.length > 1 && (
                                <div className="flex items-center gap-1">
                                    {lesson.cards.map((c, i) => (
                                        <button
                                            key={c.word + i}
                                            onClick={() => lesson.setSelectedCard(i)}
                                            className={`w-2 h-2 rounded-full ${i === lesson.selectedCard ? 'bg-[#3DF5A0]' : 'bg-white/20 hover:bg-white/40'}`}
                                            aria-label={`Show card ${i + 1}: ${c.word}`}
                                        />
                                    ))}
                                </div>
                            )}
                        </div>
                        {currentCard ? (
                            <VocabCardView
                                card={currentCard}
                                learnLocale={learnLocale}
                                imageDataUrl={lesson.image}
                                saved={Boolean(findSaved(savedWords, options.learnLanguage, currentCard.word))}
                                onToggleSave={() => onToggleSave(currentCard, lesson.thumbnail())}
                            />
                        ) : (
                            <div className="h-24 rounded-2xl border border-white/[0.06] bg-white/[0.02] animate-pulse" />
                        )}
                    </div>
                )}
            </div>

            {lesson.error && (
                <div className="mx-4 sm:mx-6 mb-2 bg-rose-500/10 border border-rose-500/20 p-3 rounded-xl flex items-center justify-between gap-3">
                    <p className="text-rose-300 text-xs font-semibold">{lesson.error}</p>
                    <button onClick={() => lesson.setError(null)} className="text-rose-300/70 hover:text-rose-200 text-xs" aria-label="Dismiss">✕</button>
                </div>
            )}

            {/* Controls */}
            <div className="px-4 sm:px-6 py-3 border-t border-white/[0.04]">
                {listening ? (
                    <div className="flex items-center justify-center gap-3">
                        <button onClick={cancelListening} className="px-4 py-2.5 rounded-full bg-white/[0.04] border border-white/[0.08] text-slate-300 text-sm font-semibold hover:bg-white/[0.08]" style={MONO}>
                            Cancel
                        </button>
                        <button onClick={sendSpeech} className="px-6 py-2.5 rounded-full bg-[#3DF5A0]/15 border border-[#3DF5A0]/40 text-[#3DF5A0] text-sm font-bold hover:bg-[#3DF5A0]/25" style={MONO}>
                            Send
                        </button>
                    </div>
                ) : isBusy ? (
                    <div className="flex items-center justify-center">
                        <button onClick={lesson.stop} className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm font-semibold hover:bg-rose-500/20" style={MONO}>
                            <span className="w-2.5 h-2.5 rounded-sm bg-current" /> Stop
                        </button>
                    </div>
                ) : (
                    <div className="flex items-center gap-2 sm:gap-3 max-w-2xl mx-auto">
                        {/* Upload photo */}
                        {!inLesson && (
                            <>
                                <input ref={fileInput} type="file" accept="image/*" className="hidden" onChange={onPickFile} />
                                <button onClick={() => fileInput.current?.click()} className="p-2.5 rounded-full bg-white/[0.04] border border-white/[0.08] text-slate-400 hover:text-white" title="Upload a photo" aria-label="Upload a photo">
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                    </svg>
                                </button>
                            </>
                        )}

                        {textMode ? (
                            <form className="flex-1 flex items-center gap-2" onSubmit={e => { e.preventDefault(); sendText(); }}>
                                <input
                                    value={draft}
                                    onChange={e => setDraft(e.target.value)}
                                    placeholder={inLesson ? 'Ask a follow-up…' : 'Ask about what you see (or leave empty)…'}
                                    className="flex-1 min-w-0 bg-black/30 border border-white/[0.08] rounded-full px-4 py-2.5 text-sm text-[#F5F5F7] placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-[#3DF5A0]/40"
                                />
                                <button type="submit" className="px-4 py-2.5 rounded-full bg-[#3DF5A0]/15 border border-[#3DF5A0]/40 text-[#3DF5A0] text-sm font-bold" style={MONO}>
                                    Ask
                                </button>
                            </form>
                        ) : (
                            <div className="flex-1 flex items-center justify-center gap-4">
                                {!inLesson && (
                                    <button onClick={shutter} className="w-12 h-12 rounded-full border-2 border-[#F5F5F7]/70 flex items-center justify-center hover:border-white" title="Just teach me the word" aria-label="Take photo and get the word">
                                        <span className="w-9 h-9 rounded-full bg-[#F5F5F7]/90" />
                                    </button>
                                )}
                                <button
                                    onClick={startListening}
                                    className="w-14 h-14 rounded-full bg-gradient-to-br from-[#FFBF00]/90 to-[#FFBF00]/60 text-black flex items-center justify-center shadow-lg shadow-[#FFBF00]/20 hover:scale-105 transition-transform"
                                    title={inLesson ? 'Ask a follow-up' : 'Ask about this'}
                                    aria-label={inLesson ? 'Ask a follow-up' : 'Ask about this'}
                                >
                                    <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 016 0v8.25a3 3 0 01-3 3z" />
                                    </svg>
                                </button>
                            </div>
                        )}

                        {isDictationSupported() && (
                            <button onClick={() => setTextMode(m => !m)} className="p-2.5 rounded-full bg-white/[0.04] border border-white/[0.08] text-slate-400 hover:text-white" title={textMode ? 'Use voice' : 'Type instead'} aria-label={textMode ? 'Use voice' : 'Type instead'}>
                                {textMode ? (
                                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 016 0v8.25a3 3 0 01-3 3z" /></svg>
                                ) : (
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h10" /></svg>
                                )}
                            </button>
                        )}

                        {(inLesson || frozen) && (
                            <button onClick={newLesson} className="px-3 py-2.5 rounded-full bg-white/[0.04] border border-white/[0.08] text-slate-300 text-xs font-semibold hover:text-white whitespace-nowrap" style={MONO} title="Ask about something else">
                                New
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};
