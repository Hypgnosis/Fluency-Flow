import React, { useState } from 'react';
import { VocabularyCard as VocabularyCardType } from '../types';

interface VocabularyCardDisplayProps {
    card: VocabularyCardType;
    onPractice?: () => void;
    onSave?: () => void;
    onDelete?: () => void;
}

export const VocabularyCardDisplay: React.FC<VocabularyCardDisplayProps> = ({
    card,
    onPractice,
    onSave,
    onDelete
}) => {
    const [isFlipped, setIsFlipped] = useState(false);

    const difficultyColors = {
        beginner: 'from-emerald-500/20 to-green-500/20 border-emerald-500/30',
        intermediate: 'from-amber-500/20 to-yellow-500/20 border-amber-500/30',
        advanced: 'from-rose-500/20 to-red-500/20 border-rose-500/30',
    };

    const difficultyBadge = {
        beginner: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
        intermediate: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
        advanced: 'bg-rose-500/20 text-rose-300 border-rose-500/30',
    };

    return (
        <div
            className={`relative p-6 rounded-3xl border bg-gradient-to-br ${card.difficulty ? difficultyColors[card.difficulty] : 'from-blue-500/20 to-cyan-500/20 border-blue-500/30'} backdrop-blur-md shadow-2xl transition-all duration-500 cursor-pointer perspective-1000`}
            onClick={() => setIsFlipped(!isFlipped)}
        >
            {/* Flip Indicator */}
            <div className="absolute top-4 right-4 text-slate-400 text-xs uppercase tracking-wider flex items-center gap-1">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Tap to flip
            </div>

            <div className={`transform transition-all duration-500 ${isFlipped ? 'rotate-y-180' : ''}`}>
                {!isFlipped ? (
                    /* Front Side - Target Language */
                    <div className="space-y-6">
                        {/* Image */}
                        {card.imageDataUrl && (
                            <div className="relative w-full h-48 rounded-2xl overflow-hidden bg-black/20">
                                <img
                                    src={card.imageDataUrl}
                                    alt={card.word}
                                    className="w-full h-full object-cover"
                                />
                                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                            </div>
                        )}

                        {/* Word */}
                        <div className="text-center">
                            <h2 className="text-5xl font-bold text-white mb-2">{card.word}</h2>
                            {card.pronunciation && (
                                <p className="text-slate-400 text-lg">/{card.pronunciation}/</p>
                            )}
                        </div>

                        {/* Part of Speech & Difficulty */}
                        <div className="flex items-center justify-center gap-3">
                            {card.partOfSpeech && (
                                <span className="px-3 py-1 rounded-full text-xs font-medium bg-white/10 text-slate-300 border border-white/20">
                                    {card.partOfSpeech}
                                </span>
                            )}
                            {card.difficulty && (
                                <span className={`px-3 py-1 rounded-full text-xs font-medium border ${difficultyBadge[card.difficulty]} uppercase`}>
                                    {card.difficulty}
                                </span>
                            )}
                        </div>

                        {/* Example Sentence (Target Language) */}
                        {card.exampleSentence && (
                            <div className="p-4 bg-black/20 rounded-xl border border-white/10">
                                <p className="text-white text-center italic">"{card.exampleSentence}"</p>
                            </div>
                        )}
                    </div>
                ) : (
                    /* Back Side - Translation & Details */
                    <div className="space-y-6 rotate-y-180">
                        {/* Translation */}
                        <div className="text-center">
                            <p className="text-slate-400 text-sm uppercase tracking-wider mb-2">Translation</p>
                            <h2 className="text-4xl font-bold text-white mb-3">{card.translation}</h2>
                            <p className="text-slate-300">→ {card.word}</p>
                        </div>

                        {/* Language Badge */}
                        <div className="flex justify-center">
                            <span className="px-4 py-2 rounded-full text-sm font-medium bg-blue-500/20 text-blue-300 border border-blue-500/30">
                                {card.language}
                            </span>
                        </div>

                        {/* Additional Info */}
                        <div className="grid grid-cols-2 gap-3">
                            <div className="p-3 bg-black/20 rounded-xl border border-white/10 text-center">
                                <p className="text-slate-500 text-xs uppercase">Part of Speech</p>
                                <p className="text-white text-sm font-medium mt-1">{card.partOfSpeech || 'N/A'}</p>
                            </div>
                            <div className="p-3 bg-black/20 rounded-xl border border-white/10 text-center">
                                <p className="text-slate-500 text-xs uppercase">Level</p>
                                <p className="text-white text-sm font-medium mt-1 capitalize">{card.difficulty || 'N/A'}</p>
                            </div>
                        </div>

                        {/* Saved Date */}
                        <p className="text-slate-500 text-xs text-center">
                            Learned: {new Date(card.timestamp).toLocaleDateString()}
                        </p>
                    </div>
                )}
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-2 mt-6 pt-6 border-t border-white/10" onClick={(e) => e.stopPropagation()}>
                {onPractice && (
                    <button
                        onClick={onPractice}
                        className="flex-1 py-3 bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 text-white font-semibold rounded-xl transition-all flex items-center justify-center gap-2"
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        Practice
                    </button>
                )}

                {onSave && (
                    <button
                        onClick={onSave}
                        className="p-3 bg-white/10 hover:bg-white/20 rounded-xl transition-colors"
                        aria-label="Save card"
                    >
                        <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                        </svg>
                    </button>
                )}

                {onDelete && (
                    <button
                        onClick={onDelete}
                        className="p-3 bg-white/10 hover:bg-rose-500/20 rounded-xl transition-colors"
                        aria-label="Delete card"
                    >
                        <svg className="w-5 h-5 text-slate-400 hover:text-rose-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                    </button>
                )}
            </div>
        </div>
    );
};

interface VocabularyCollectionProps {
    cards: VocabularyCardType[];
    onPracticeCard?: (cardId: string) => void;
    onDeleteCard?: (cardId: string) => void;
}

export const VocabularyCollection: React.FC<VocabularyCollectionProps> = ({
    cards,
    onPracticeCard,
    onDeleteCard
}) => {
    if (cards.length === 0) {
        return (
            <div className="text-center py-12">
                <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-slate-800/50 flex items-center justify-center">
                    <svg className="w-10 h-10 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
                    </svg>
                </div>
                <h3 className="text-white font-semibold text-lg mb-2">No Vocabulary Cards Yet</h3>
                <p className="text-slate-400 text-sm">Use Vision Mode to capture objects and build your collection</p>
            </div>
        );
    }

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {cards.map(card => (
                <VocabularyCardDisplay
                    key={card.id}
                    card={card}
                    onPractice={onPracticeCard ? () => onPracticeCard(card.id) : undefined}
                    onDelete={onDeleteCard ? () => onDeleteCard(card.id) : undefined}
                />
            ))}
        </div>
    );
};
