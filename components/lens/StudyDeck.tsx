import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { SavedWord, SrsState } from '../../types/lens';
import { SpeakerButton } from './VocabCardView';
import { localeFor } from '../../services/languages';
import { Dictation, isDictationSupported } from '../../services/speech';
import { matchesSpokenWord } from '../../services/speechMatch';
import { describeNextReview, Grade, isDue, review } from '../../services/srs';

const MONO = { fontFamily: "'IBM Plex Mono', monospace" };
const COUNTS = [5, 10, 20, 0]; // 0 = all

interface StudyDeckProps {
    words: SavedWord[];
    defaultLanguage: string;
    onReviewed: (word: SavedWord, srs: SrsState) => void;
}

function shuffle<T>(items: T[]): T[] {
    const a = [...items];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

const GRADES: { grade: Grade; label: string; className: string }[] = [
    { grade: 'again', label: 'Again', className: 'border-rose-500/40 text-rose-300 hover:bg-rose-500/10' },
    { grade: 'hard', label: 'Hard', className: 'border-amber-500/40 text-amber-300 hover:bg-amber-500/10' },
    { grade: 'good', label: 'Good', className: 'border-[#00FF41]/40 text-[#00FF41] hover:bg-[#00FF41]/10' },
    { grade: 'easy', label: 'Easy', className: 'border-sky-400/40 text-sky-300 hover:bg-sky-400/10' },
];

/**
 * Flash-card study. Gallery's version flips cards only; Glossos adds spaced-repetition grading and a
 * "say it" check that listens with speech recognition (matcher ported from Gallery's vocab games).
 */
export const StudyDeck: React.FC<StudyDeckProps> = ({ words, defaultLanguage, onReviewed }) => {
    const languages = useMemo(() => [...new Set(words.map(w => w.learnLanguage))].sort(), [words]);
    const [language, setLanguage] = useState(languages.includes(defaultLanguage) ? defaultLanguage : languages[0] ?? defaultLanguage);
    const pool = useMemo(() => words.filter(w => w.learnLanguage === language), [words, language]);
    const due = useMemo(() => pool.filter(w => isDue(w.srs)), [pool]);
    const [onlyDue, setOnlyDue] = useState(true);
    const [count, setCount] = useState(10);

    const [queue, setQueue] = useState<SavedWord[] | null>(null);
    const [position, setPosition] = useState(0);
    const [flipped, setFlipped] = useState(false);
    const [listening, setListening] = useState(false);
    const [heard, setHeard] = useState<{ text: string; ok: boolean } | null>(null);
    const [stats, setStats] = useState({ reviewed: 0, spokenOk: 0 });
    const dictation = useRef<Dictation | null>(null);

    useEffect(() => () => dictation.current?.cancel(), []);

    const learnLocale = localeFor(language);
    const card = queue?.[position];

    const start = () => {
        const source = onlyDue && due.length ? due : pool;
        const picked = shuffle(source);
        setQueue(count ? picked.slice(0, count) : picked);
        setPosition(0);
        setFlipped(false);
        setHeard(null);
        setStats({ reviewed: 0, spokenOk: 0 });
    };

    const listen = () => {
        if (!card) return;
        setHeard(null);
        const d = new Dictation(learnLocale, () => undefined, () => setListening(false));
        dictation.current = d;
        d.start();
        setListening(true);
    };

    const stopListening = async () => {
        const d = dictation.current;
        dictation.current = null;
        setListening(false);
        if (!d || !card) return;
        const text = await d.finish(1500);
        const ok = matchesSpokenWord(text, card.word);
        setHeard({ text: text || '(nothing heard)', ok });
        if (ok) setStats(s => ({ ...s, spokenOk: s.spokenOk + 1 }));
        setFlipped(true);
    };

    const grade = (g: Grade) => {
        if (!card || !queue) return;
        const srs = review(card.srs, g);
        onReviewed(card, srs);
        setStats(s => ({ ...s, reviewed: s.reviewed + 1 }));
        // "Again" brings the card back at the end of this session.
        const nextQueue = g === 'again' ? [...queue, { ...card, srs }] : queue;
        setQueue(nextQueue);
        setPosition(p => p + 1);
        setFlipped(false);
        setHeard(null);
    };

    if (words.length === 0) {
        return (
            <div className="h-full flex flex-col items-center justify-center text-center p-8">
                <h3 className="text-white text-lg font-bold mb-2">Nothing to study yet</h3>
                <p className="text-slate-500 text-sm max-w-xs">Save words from Lens lessons and they will show up here.</p>
            </div>
        );
    }

    // ─── Setup ───
    if (!queue) {
        return (
            <div className="p-6 max-w-md mx-auto space-y-5">
                <h3 className="text-white text-lg font-bold">Study session</h3>
                <label className="block">
                    <span className="text-[10px] uppercase tracking-[0.2em] text-slate-500 font-bold" style={MONO}>Language</span>
                    <select value={language} onChange={e => setLanguage(e.target.value)} className="mt-1 w-full bg-black/30 border border-white/[0.08] text-slate-200 text-sm rounded-xl px-3 py-2">
                        {languages.map(l => <option key={l} value={l}>{l} ({words.filter(w => w.learnLanguage === l).length})</option>)}
                    </select>
                </label>
                <div>
                    <span className="text-[10px] uppercase tracking-[0.2em] text-slate-500 font-bold" style={MONO}>Cards</span>
                    <div className="mt-1 flex gap-2">
                        <button onClick={() => setOnlyDue(true)} className={`flex-1 px-3 py-2 rounded-xl border text-sm ${onlyDue ? 'border-[#00FF41]/40 text-[#00FF41] bg-[#00FF41]/10' : 'border-white/[0.08] text-slate-400'}`}>Due ({due.length})</button>
                        <button onClick={() => setOnlyDue(false)} className={`flex-1 px-3 py-2 rounded-xl border text-sm ${!onlyDue ? 'border-[#00FF41]/40 text-[#00FF41] bg-[#00FF41]/10' : 'border-white/[0.08] text-slate-400'}`}>All ({pool.length})</button>
                    </div>
                </div>
                <div>
                    <span className="text-[10px] uppercase tracking-[0.2em] text-slate-500 font-bold" style={MONO}>How many</span>
                    <div className="mt-1 flex gap-2">
                        {COUNTS.map(n => (
                            <button key={n} onClick={() => setCount(n)} className={`flex-1 px-3 py-2 rounded-xl border text-sm ${count === n ? 'border-[#FFBF00]/40 text-[#FFBF00] bg-[#FFBF00]/10' : 'border-white/[0.08] text-slate-400'}`}>
                                {n || 'All'}
                            </button>
                        ))}
                    </div>
                </div>
                {onlyDue && due.length === 0 && (
                    <p className="text-xs text-slate-500" style={MONO}>Nothing is due right now, so this session uses all your {language} words.</p>
                )}
                <button onClick={start} disabled={pool.length === 0} className="w-full py-3 rounded-xl bg-[#00FF41]/15 border border-[#00FF41]/40 text-[#00FF41] font-bold disabled:opacity-40" style={MONO}>
                    Start
                </button>
            </div>
        );
    }

    // ─── Finished ───
    if (!card) {
        return (
            <div className="h-full flex flex-col items-center justify-center text-center p-8 gap-3">
                <h3 className="text-white text-xl font-bold">Session complete</h3>
                <p className="text-slate-400 text-sm" style={MONO}>
                    {stats.reviewed} reviews{isDictationSupported() ? ` · ${stats.spokenOk} said correctly` : ''}
                </p>
                <div className="flex gap-3 mt-2">
                    <button onClick={start} className="px-5 py-2.5 rounded-full bg-[#00FF41]/15 border border-[#00FF41]/40 text-[#00FF41] text-sm font-bold" style={MONO}>Again</button>
                    <button onClick={() => setQueue(null)} className="px-5 py-2.5 rounded-full bg-white/[0.04] border border-white/[0.08] text-slate-300 text-sm" style={MONO}>Change deck</button>
                </div>
            </div>
        );
    }

    // ─── Card ───
    return (
        <div className="p-4 sm:p-6 max-w-md mx-auto flex flex-col gap-4">
            <div className="flex items-center justify-between text-[11px] text-slate-500" style={MONO}>
                <button onClick={() => setQueue(null)} className="hover:text-slate-300">← Deck</button>
                <span>{position + 1} / {queue.length}</span>
            </div>

            <div
                onClick={() => setFlipped(f => !f)}
                className="cursor-pointer rounded-3xl border border-white/[0.08] bg-[#0d0d0e]/95 p-6 min-h-[300px] flex flex-col items-center justify-center text-center gap-4 shadow-2xl"
            >
                {card.imageDataUrl && <img src={card.imageDataUrl} alt="" className="w-32 h-32 rounded-2xl object-cover border border-white/[0.06]" />}
                {!flipped ? (
                    <>
                        <p className="text-white text-2xl font-bold">{card.meaning}</p>
                        <p className="text-[11px] text-slate-600" style={MONO}>Say it in {language}, or tap to flip</p>
                    </>
                ) : (
                    <>
                        <div className="flex items-center gap-2">
                            <p className="text-[#00FF41] text-3xl font-bold">{card.word}</p>
                            <SpeakerButton text={card.word} locale={learnLocale} label={`Pronounce ${card.word}`} />
                        </div>
                        {card.example && (
                            <div className="flex items-start gap-2 text-left">
                                <div>
                                    <p className="text-[#F5F5F7] text-sm">{card.example}</p>
                                    <p className="text-slate-500 text-xs mt-1">{card.exampleTranslation}</p>
                                </div>
                                <SpeakerButton text={card.example} locale={learnLocale} label="Play example sentence" small />
                            </div>
                        )}
                    </>
                )}
            </div>

            {heard && (
                <p className={`text-center text-sm ${heard.ok ? 'text-[#00FF41]' : 'text-rose-300'}`} style={MONO}>
                    {heard.ok ? '✓ ' : '✗ '}“{heard.text}”
                </p>
            )}

            {!flipped && isDictationSupported() && (
                <button
                    onClick={listening ? stopListening : listen}
                    className={`mx-auto flex items-center gap-2 px-5 py-2.5 rounded-full border text-sm font-semibold ${listening ? 'border-rose-500/40 text-rose-300 bg-rose-500/10 animate-pulse' : 'border-[#FFBF00]/40 text-[#FFBF00] bg-[#FFBF00]/10'}`}
                    style={MONO}
                >
                    {listening ? 'Done' : 'Say it'}
                </button>
            )}

            {flipped && (
                <div className="grid grid-cols-4 gap-2">
                    {GRADES.map(({ grade: g, label, className }) => (
                        <button key={g} onClick={() => grade(g)} className={`py-2 rounded-xl border bg-black/20 text-xs font-bold flex flex-col items-center ${className}`} style={MONO}>
                            {label}
                            <span className="text-[10px] font-normal opacity-60">{describeNextReview(card.srs, g)}</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};
