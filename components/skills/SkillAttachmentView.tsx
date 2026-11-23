import React from 'react';
import type { SkillAttachment } from '../../services/tutorSkills/types';
import { VocabCardView, SpeakerButton } from '../lens/VocabCardView';
import { localeFor } from '../../services/languages';

const MONO = { fontFamily: "'IBM Plex Mono', monospace" };

const Chip: React.FC<{ tone: 'amber' | 'green' | 'slate'; label: string; children: React.ReactNode }> = ({ tone, label, children }) => {
    const tones = {
        amber: 'border-[#FFBF00]/25 bg-[#FFBF00]/[0.06] text-[#FFBF00]',
        green: 'border-[#00FF41]/25 bg-[#00FF41]/[0.06] text-[#00FF41]',
        slate: 'border-white/[0.08] bg-white/[0.03] text-slate-300',
    };
    return (
        <div className={`inline-flex flex-col gap-1 max-w-[88%] sm:max-w-[75%] px-4 py-2.5 rounded-2xl border ${tones[tone]}`}>
            <span className="text-[9px] uppercase tracking-[0.2em] font-bold opacity-70" style={MONO}>{label}</span>
            <div className="text-sm text-[#F5F5F7]">{children}</div>
        </div>
    );
};

/** Renders something a Tutor Skill showed during the voice conversation. */
export const SkillAttachmentView: React.FC<{ attachment: SkillAttachment; learnLanguage: string }> = ({ attachment, learnLanguage }) => {
    const learnLocale = localeFor(learnLanguage);
    switch (attachment.kind) {
        case 'mistake':
            return (
                <Chip tone="amber" label={`Noted · ${attachment.category}`}>
                    <span className="line-through text-slate-500">{attachment.incorrect}</span>
                    <span className="mx-2 text-slate-500">→</span>
                    <span className="font-semibold text-[#00FF41]">{attachment.correct}</span>
                    {attachment.explanation && <p className="text-xs text-slate-400 mt-1">{attachment.explanation}</p>}
                </Chip>
            );
        case 'fixed':
            return (
                <Chip tone="green" label="Mistake fixed">
                    ✓ You got <span className="font-semibold">{attachment.incorrect}</span> right on your own.
                </Chip>
            );
        case 'vocab':
            return (
                <div className="max-w-[88%] sm:max-w-[75%] w-full">
                    <VocabCardView
                        card={attachment.card}
                        learnLocale={localeFor(attachment.learnLanguage)}
                        footer={
                            <p className="mt-2 text-[10px] uppercase tracking-[0.2em] text-slate-500" style={MONO}>
                                {attachment.saved ? 'Saved to your study deck' : 'Could not save to your deck'}
                            </p>
                        }
                    />
                </div>
            );
        case 'card':
            return (
                <div className="max-w-[88%] sm:max-w-[75%] w-full rounded-2xl border border-white/[0.08] bg-[#0d0d0e]/95 p-4 shadow-xl">
                    <h4 className="text-white font-bold mb-3">{attachment.title}</h4>
                    <ul className="space-y-2">
                        {attachment.rows.map((row, i) => (
                            <li key={i} className="flex items-center gap-2">
                                <SpeakerButton text={row.target} locale={learnLocale} label={`Play ${row.target}`} small />
                                <span className="text-[#00FF41] font-semibold">{row.target}</span>
                                <span className="text-slate-500 text-sm">— {row.native}</span>
                            </li>
                        ))}
                    </ul>
                    {attachment.tip && <p className="text-xs text-slate-400 mt-3 border-t border-white/[0.05] pt-2">💡 {attachment.tip}</p>}
                </div>
            );
        case 'wiki':
            return (
                <Chip tone="slate" label="Wikipedia">
                    <a href={attachment.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-sky-300 hover:underline">
                        {attachment.title}
                    </a>
                    {attachment.summary && <p className="text-xs text-slate-400 mt-1 line-clamp-2">{attachment.summary}</p>}
                </Chip>
            );
        default:
            return null;
    }
};
