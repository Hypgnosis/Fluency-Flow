import React, { useMemo, useState } from 'react';
import type { SavedWord } from '../../types/lens';
import { VocabCardView } from './VocabCardView';
import { localeFor } from '../../services/languages';
import { isDue } from '../../services/srs';

const MONO = { fontFamily: "'IBM Plex Mono', monospace" };

interface SavedWordsProps {
    words: SavedWord[];
    loading: boolean;
    onDelete: (word: SavedWord) => void;
    onStudy: () => void;
}

export const SavedWords: React.FC<SavedWordsProps> = ({ words, loading, onDelete, onStudy }) => {
    const [filter, setFilter] = useState('All');
    const [confirming, setConfirming] = useState<string | null>(null);

    const languages = useMemo(() => [...new Set(words.map(w => w.learnLanguage))].sort(), [words]);
    const shown = filter === 'All' ? words : words.filter(w => w.learnLanguage === filter);
    const dueCount = shown.filter(w => isDue(w.srs)).length;

    if (loading) {
        return <div className="p-8 text-center text-slate-500 text-sm" style={MONO}>Loading your words…</div>;
    }

    if (words.length === 0) {
        return (
            <div className="h-full flex flex-col items-center justify-center text-center p-8">
                <h3 className="text-white text-lg font-bold mb-2">No saved words yet</h3>
                <p className="text-slate-500 text-sm max-w-xs">Ask the Lens teacher about something around you, then tap Save on the card.</p>
            </div>
        );
    }

    return (
        <div className="p-4 sm:p-6 space-y-4 max-w-2xl mx-auto">
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                    <span className="text-white font-bold">{shown.length} words</span>
                    {languages.length > 1 && (
                        <select
                            value={filter}
                            onChange={e => setFilter(e.target.value)}
                            className="bg-black/30 border border-white/[0.08] text-slate-300 text-xs rounded-full px-3 py-1.5"
                            style={MONO}
                        >
                            <option value="All">All languages</option>
                            {languages.map(l => <option key={l} value={l}>{l}</option>)}
                        </select>
                    )}
                </div>
                <button
                    onClick={onStudy}
                    className="px-4 py-2 rounded-full bg-[#00FF41]/10 border border-[#00FF41]/30 text-[#00FF41] text-xs font-bold hover:bg-[#00FF41]/20"
                    style={MONO}
                >
                    Study{dueCount ? ` · ${dueCount} due` : ''}
                </button>
            </div>

            {shown.map(word => (
                <VocabCardView
                    key={word.id}
                    card={word}
                    learnLocale={localeFor(word.learnLanguage)}
                    imageDataUrl={word.imageDataUrl}
                    footer={
                        <div className="flex items-center justify-between mt-3 text-[11px] text-slate-600" style={MONO}>
                            <span>{word.learnLanguage} · {word.srs.reps ? `reviewed ${word.srs.reps}×` : 'new'}</span>
                            {confirming === word.id ? (
                                <span className="flex items-center gap-2">
                                    <span className="text-rose-300">Delete?</span>
                                    <button onClick={() => { onDelete(word); setConfirming(null); }} className="text-rose-300 hover:text-rose-200 font-bold">Yes</button>
                                    <button onClick={() => setConfirming(null)} className="hover:text-slate-300">No</button>
                                </span>
                            ) : (
                                <button onClick={() => setConfirming(word.id)} className="hover:text-rose-300">Delete</button>
                            )}
                        </div>
                    }
                />
            ))}
        </div>
    );
};
