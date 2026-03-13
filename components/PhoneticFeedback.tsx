import React, { useState } from 'react';
import { PhoneticFeedback as PhoneticFeedbackType } from '../types';

interface PhoneticFeedbackCardProps {
    feedback: PhoneticFeedbackType;
    onPractice?: () => void;
}

export const PhoneticFeedbackCard: React.FC<PhoneticFeedbackCardProps> = ({ feedback, onPractice }) => {
    const [isExpanded, setIsExpanded] = useState(false);

    const difficultyColors = {
        easy: 'from-emerald-500/20 to-green-500/20 border-emerald-500/30',
        medium: 'from-amber-500/20 to-yellow-500/20 border-amber-500/30',
        hard: 'from-rose-500/20 to-red-500/20 border-rose-500/30',
    };

    const difficultyBadge = {
        easy: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
        medium: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
        hard: 'bg-rose-500/20 text-rose-300 border-rose-500/30',
    };

    return (
        <div className={`relative p-5 rounded-2xl border bg-gradient-to-br ${difficultyColors[feedback.difficulty]} backdrop-blur-md transition-all duration-300 ${isExpanded ? 'shadow-2xl' : 'shadow-lg'}`}>
            {/* Header */}
            <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                    {/* Phoneme Badge */}
                    <div className="w-14 h-14 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center">
                        <span className="text-2xl font-bold text-white">{feedback.phoneme}</span>
                    </div>

                    <div>
                        <h4 className="text-white font-semibold text-lg">Sound Issue Detected</h4>
                        <p className="text-slate-400 text-sm">{feedback.issue}</p>
                    </div>
                </div>

                {/* Difficulty Badge */}
                <span className={`px-3 py-1 rounded-full text-xs font-medium border ${difficultyBadge[feedback.difficulty]} uppercase tracking-wider`}>
                    {feedback.difficulty}
                </span>
            </div>

            {/* Guidance Section */}
            <div className="mb-4 p-4 bg-black/20 rounded-xl border border-white/10">
                <h5 className="text-cyan-400 font-semibold text-sm uppercase tracking-wider mb-2 flex items-center gap-2">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                    </svg>
                    How to Fix It
                </h5>
                <p className="text-slate-200 text-sm leading-relaxed">{feedback.guidance}</p>
            </div>

            {/* Mouth Position */}
            <div className="mb-4">
                <button
                    onClick={() => setIsExpanded(!isExpanded)}
                    className="w-full flex items-center justify-between p-3 bg-white/5 hover:bg-white/10 rounded-lg transition-colors border border-white/10"
                >
                    <span className="text-white font-medium text-sm flex items-center gap-2">
                        <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        Mouth & Tongue Position
                    </span>
                    <svg className={`w-5 h-5 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                </button>

                {isExpanded && (
                    <div className="mt-3 p-4 bg-black/30 rounded-lg border border-white/10 animate-slide-down">
                        <p className="text-slate-300 text-sm leading-relaxed">{feedback.mouthPosition}</p>

                        {feedback.nativeComparison && (
                            <div className="mt-3 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                                <p className="text-blue-300 text-xs font-medium mb-1 uppercase tracking-wider">Native Language Comparison</p>
                                <p className="text-slate-200 text-sm">{feedback.nativeComparison}</p>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Practice Words */}
            <div className="mb-4">
                <h5 className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-2">Practice These Words</h5>
                <div className="flex flex-wrap gap-2">
                    {feedback.practiceWords.map((word, idx) => (
                        <span
                            key={idx}
                            className="px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-full text-white text-sm font-medium transition-colors cursor-pointer"
                        >
                            {word}
                        </span>
                    ))}
                </div>
            </div>

            {/* Practice Button */}
            {onPractice && (
                <button
                    onClick={onPractice}
                    className="w-full py-3 bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 text-white font-semibold rounded-xl transition-all shadow-lg hover:shadow-xl flex items-center justify-center gap-2"
                >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Start Practice Drill
                </button>
            )}
        </div>
    );
};

interface PronunciationAnalysisCardProps {
    analysis: {
        overallScore: number;
        accuracyPercentage: number;
        feedback: PhoneticFeedbackType[];
        strengths: string[];
        improvements: string[];
    };
}

export const PronunciationAnalysisCard: React.FC<PronunciationAnalysisCardProps> = ({ analysis }) => {
    return (
        <div className="space-y-4 animate-fade-in">
            {/* Overall Score Header */}
            <div className="p-6 bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-500/30 rounded-2xl">
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <h3 className="text-white font-bold text-xl mb-1">Pronunciation Analysis</h3>
                        <p className="text-slate-400 text-sm">Detailed feedback on your speech</p>
                    </div>
                    <div className="text-center">
                        <div className="text-4xl font-bold text-white mb-1">{analysis.accuracyPercentage}%</div>
                        <div className="text-xs text-slate-400 uppercase tracking-wider">Accuracy</div>
                    </div>
                </div>

                {/* Score Bar */}
                <div className="w-full h-2 bg-black/30 rounded-full overflow-hidden">
                    <div
                        className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all duration-1000"
                        style={{ width: `${analysis.accuracyPercentage}%` }}
                    />
                </div>
            </div>

            {/* Strengths */}
            {analysis.strengths.length > 0 && (
                <div className="p-5 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl">
                    <h4 className="text-emerald-400 font-semibold mb-3 flex items-center gap-2">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        What You Did Well
                    </h4>
                    <ul className="space-y-2">
                        {analysis.strengths.map((strength, idx) => (
                            <li key={idx} className="text-slate-200 text-sm flex items-start gap-2">
                                <span className="text-emerald-400 mt-1">✓</span>
                                {strength}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* Areas for Improvement */}
            {analysis.improvements.length > 0 && (
                <div className="p-5 bg-amber-500/10 border border-amber-500/20 rounded-2xl">
                    <h4 className="text-amber-400 font-semibold mb-3 flex items-center gap-2">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                        </svg>
                        Quick Improvement Tips
                    </h4>
                    <ul className="space-y-2">
                        {analysis.improvements.map((tip, idx) => (
                            <li key={idx} className="text-slate-200 text-sm flex items-start gap-2">
                                <span className="text-amber-400 mt-1">→</span>
                                {tip}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* Detailed Phonetic Feedback */}
            {analysis.feedback.length > 0 && (
                <div className="space-y-3">
                    <h4 className="text-white font-semibold flex items-center gap-2">
                        <svg className="w-5 h-5 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                        </svg>
                        Specific Sound Issues ({analysis.feedback.length})
                    </h4>

                    {analysis.feedback.map((fb, idx) => (
                        <PhoneticFeedbackCard key={idx} feedback={fb} />
                    ))}
                </div>
            )}
        </div>
    );
};
