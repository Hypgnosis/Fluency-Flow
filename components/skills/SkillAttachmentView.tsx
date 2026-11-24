import React from 'react';
import type { SkillAttachment } from '../../services/tutorSkills/types';
import { VocabCardView, SpeakerButton } from '../lens/VocabCardView';
import { localeFor } from '../../services/languages';

const Chip: React.FC<{ tone: 'amber' | 'green' | 'slate'; label: string; children: React.ReactNode }> = ({ tone, label, children }) => {
    const tones = {
        amber: 'border-gold-500/25 bg-gold-500/[0.06] text-gold-300',
        green: 'border-[#3DF5A0]/25 bg-[#3DF5A0]/[0.06] text-[#3DF5A0]',
        slate: 'border-white/[0.08] bg-white/[0.03] text-slate-300',
    };
    return (
        <div className={`inline-flex flex-col gap-1 max-w-[88%] sm:max-w-[75%] px-4 py-2.5 rounded-2xl border ${tones[tone]}`}>
            <span className="text-[11px] font-semibold opacity-80">{label}</span>
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
                <Chip tone="amber" label={`Correction · ${attachment.category.charAt(0).toUpperCase()}${attachment.category.slice(1)}`}>
                    <span className="line-through text-slate-500">{attachment.incorrect}</span>
                    <span className="mx-2 text-slate-500">→</span>
                    <span className="font-semibold text-[#3DF5A0]">{attachment.correct}</span>
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
                            <p className="mt-2.5 flex items-center gap-1.5 text-xs font-medium text-slate-400">
                                {attachment.saved ? <><span className="text-mint-400">✓</span> Saved to your study deck</> : 'Could not save to your deck'}
                            </p>
                        }
                    />
                </div>
            );
        case 'card':
            return (
                <div className="max-w-[88%] sm:max-w-[75%] w-full rounded-2xl border border-white/[0.08] bg-ink-850/95 p-4 shadow-[var(--shadow-card)]">
                    <h4 className="text-white font-bold mb-3">{attachment.title}</h4>
                    <ul className="space-y-2">
                        {attachment.rows.map((row, i) => (
                            <li key={i} className="flex items-center gap-2">
                                <SpeakerButton text={row.target} locale={learnLocale} label={`Play ${row.target}`} small />
                                <span className="text-[#3DF5A0] font-semibold">{row.target}</span>
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
