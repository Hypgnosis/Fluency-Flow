import React from 'react';
import { BUILT_IN_SKILLS } from '../../services/tutorSkills/skills';
import { isSkillEnabled, SkillPrefs } from '../../services/tutorSkills/registry';

const MONO = { fontFamily: "'IBM Plex Mono', monospace" };

interface SkillsPanelProps {
    prefs: SkillPrefs;
    onChange: (prefs: SkillPrefs) => void;
    onClose: () => void;
    locked: boolean;
}

/** Lets the learner turn Tutor Skills on or off (applies from the next voice session). */
export const SkillsPanel: React.FC<SkillsPanelProps> = ({ prefs, onChange, onClose, locked }) => (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
        <div
            role="dialog"
            aria-label="Tutor skills"
            className="w-full max-w-md rounded-3xl border border-white/[0.08] bg-[#0d0d0e] p-5 shadow-2xl animate-slide-up"
            onClick={e => e.stopPropagation()}
        >
            <div className="flex items-center justify-between mb-1">
                <h3 className="text-white font-bold text-lg">Tutor skills</h3>
                <button onClick={onClose} className="text-slate-500 hover:text-white" aria-label="Close">✕</button>
            </div>
            <p className="text-slate-500 text-xs mb-4" style={MONO}>
                {locked ? 'Changes apply to your next voice session.' : 'Tools your voice tutor can use while you talk.'}
            </p>
            <ul className="space-y-2">
                {BUILT_IN_SKILLS.map(skill => {
                    const on = isSkillEnabled(skill, prefs);
                    return (
                        <li key={skill.name}>
                            <label className="flex items-start gap-3 p-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] cursor-pointer">
                                <input
                                    type="checkbox"
                                    className="mt-1 accent-[#00FF41] w-4 h-4"
                                    checked={on}
                                    onChange={() => onChange({ ...prefs, [skill.name]: !on })}
                                />
                                <span>
                                    <span className="block text-sm font-semibold text-[#F5F5F7]">{skill.title}</span>
                                    <span className="block text-xs text-slate-500 mt-0.5">{skill.summary}</span>
                                </span>
                            </label>
                        </li>
                    );
                })}
            </ul>
        </div>
    </div>
);
