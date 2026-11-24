import React from 'react';
import type { VocabCard } from '../../types/lens';
import { speak } from '../../services/speech';

const MONO = { fontVariantNumeric: 'tabular-nums' } as const;

export const SpeakerButton: React.FC<{ text: string; locale: string; label: string; small?: boolean }> = ({ text, locale, label, small }) => (
    <button
        onClick={e => { e.stopPropagation(); speak(text, locale); }}
        className={`flex-shrink-0 rounded-full bg-white/[0.06] hover:bg-[#3DF5A0]/15 border border-white/[0.08] hover:border-[#3DF5A0]/30 text-slate-300 hover:text-[#3DF5A0] transition-colors ${small ? 'p-1.5' : 'p-2'}`}
        aria-label={label}
        title={label}
    >
        <svg className={small ? 'w-3.5 h-3.5' : 'w-4 h-4'} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072M18.364 5.636a9 9 0 010 12.728M11 5L6 9H2v6h4l5 4V5z" />
        </svg>
    </button>
);

/** Highlights occurrences of `word` (or its noun without the article) inside `sentence`. */
function highlight(sentence: string, word: string): React.ReactNode {
    const candidates = [word, word.replace(/^\S+\s+/, '')].filter(w => w.length > 1);
    for (const w of candidates) {
        const idx = sentence.toLocaleLowerCase().indexOf(w.toLocaleLowerCase());
        if (idx >= 0) {
            return (
                <>
                    {sentence.slice(0, idx)}
                    <span className="text-[#3DF5A0] font-semibold">{sentence.slice(idx, idx + w.length)}</span>
                    {sentence.slice(idx + w.length)}
                </>
            );
        }
    }
    return sentence;
}

interface VocabCardViewProps {
    card: VocabCard;
    learnLocale: string;
    imageDataUrl?: string | null;
    saved?: boolean;
    onToggleSave?: () => void;
    footer?: React.ReactNode;
}

export const VocabCardView: React.FC<VocabCardViewProps> = ({ card, learnLocale, imageDataUrl, saved, onToggleSave, footer }) => (
    <div className="rounded-2xl border border-white/[0.08] bg-[#0d0d0e]/95 p-4 shadow-xl animate-fade-in">
        <div className="flex gap-4">
            {imageDataUrl && (
                <img src={imageDataUrl} alt="" className="w-20 h-20 sm:w-24 sm:h-24 rounded-xl object-cover flex-shrink-0 border border-white/[0.06]" />
            )}
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                    <h3 className="text-xl sm:text-2xl font-bold text-white tracking-tight break-words">{card.word}</h3>
                    <SpeakerButton text={card.word} locale={learnLocale} label={`Pronounce ${card.word}`} />
                </div>
                <p className="text-slate-400 text-sm mt-1">{card.meaning}</p>
            </div>
            {onToggleSave && (
                <button
                    onClick={onToggleSave}
                    className={`self-start flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${saved
                        ? 'bg-[#FFBF00]/15 text-[#FFBF00] border-[#FFBF00]/30'
                        : 'bg-white/[0.04] text-slate-300 border-white/[0.08] hover:border-[#FFBF00]/30 hover:text-[#FFBF00]'}`}
                    style={MONO}
                >
                    <svg className="w-3.5 h-3.5" fill={saved ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                    </svg>
                    {saved ? 'Saved' : 'Save'}
                </button>
            )}
        </div>

        {card.example && (
            <div className="mt-3 rounded-xl bg-black/30 border border-white/[0.05] p-3">
                <div className="flex items-start gap-2">
                    <p className="text-[#F5F5F7] text-sm leading-relaxed flex-1">{highlight(card.example, card.word)}</p>
                    <SpeakerButton text={card.example} locale={learnLocale} label="Play example sentence" small />
                </div>
                {card.exampleTranslation && <p className="text-slate-500 text-xs mt-1.5">{card.exampleTranslation}</p>}
            </div>
        )}
        {footer}
    </div>
);
