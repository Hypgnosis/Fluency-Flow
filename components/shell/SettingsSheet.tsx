import React, { useState } from 'react';
import { BUILT_IN_SKILLS } from '../../services/tutorSkills/skills';
import { isSkillEnabled } from '../../services/tutorSkills/registry';
import { Icon } from '../ui/Icon';
import { Eyebrow, LangBadge, OptionTile, Segmented, Sheet, Switch } from '../ui/primitives';
import { LANGUAGES, LEVELS, VOICES, languageMeta, useLearningSettings } from './LearningSettings';

interface SettingsSheetProps {
    open: boolean;
    onClose: () => void;
    /** A voice conversation is running: language, level and voice are locked until it ends. */
    locked: boolean;
    onOpenOffline: () => void;
}

const Section: React.FC<{ title: string; hint?: string; children: React.ReactNode }> = ({ title, hint, children }) => (
    <section className="mb-8 last:mb-2">
        <div className="mb-3 flex items-baseline justify-between gap-3">
            <Eyebrow>{title}</Eyebrow>
            {hint && <span className="text-[11px] text-slate-500">{hint}</span>}
        </div>
        {children}
    </section>
);

/** Everything about how the tutor teaches you, in one place. */
export const SettingsSheet: React.FC<SettingsSheetProps> = ({ open, onClose, locked, onOpenOffline }) => {
    const s = useLearningSettings();
    const [langTab, setLangTab] = useState<'learn' | 'native'>('learn');
    const current = langTab === 'learn' ? s.learnLanguage : s.nativeLanguage;
    const choose = langTab === 'learn' ? s.setLearnLanguage : s.setNativeLanguage;
    const learn = languageMeta(s.learnLanguage);
    const native = languageMeta(s.nativeLanguage);

    return (
        <Sheet open={open} onClose={onClose} title="Learning settings" subtitle="Applies to Talk, Lens, Chat, Write and Scribe.">
            {locked && (
                <div className="mb-6 flex items-start gap-3 rounded-2xl border border-gold-500/25 bg-gold-500/[0.07] px-4 py-3 text-sm text-gold-200">
                    <Icon name="lock" size={18} className="mt-0.5 shrink-0" />
                    <span>You're in a conversation. End it to change your languages, level or voice.</span>
                </div>
            )}

            <Section title="Languages">
                <Segmented<'learn' | 'native'>
                    id="lang-tab"
                    value={langTab}
                    onChange={setLangTab}
                    options={[
                        { value: 'learn', label: <>Learning · <span className="text-gold-300">{learn.native}</span></> },
                        { value: 'native', label: <>I speak · <span className="text-slate-200">{native.native}</span></> },
                    ]}
                />
                <div role="radiogroup" aria-label={langTab === 'learn' ? 'Language to learn' : 'Your language'} className="mt-3 grid grid-cols-2 gap-2">
                    {LANGUAGES.map(l => (
                        <OptionTile
                            key={l.name}
                            selected={current === l.name}
                            disabled={locked || (langTab === 'learn' ? l.name === s.nativeLanguage : l.name === s.learnLanguage)}
                            onSelect={() => choose(l.name)}
                            leading={<LangBadge code={l.code} tone={current === l.name ? 'gold' : 'slate'} />}
                            title={l.native}
                            description={l.native !== l.name ? l.name : undefined}
                            className="py-2.5"
                        />
                    ))}
                </div>
            </Section>

            <Section title="Level">
                <div role="radiogroup" aria-label="Level" className="space-y-2">
                    {LEVELS.map(l => (
                        <OptionTile
                            key={l.id}
                            selected={s.level === l.id}
                            disabled={locked}
                            onSelect={() => s.setLevel(l.id)}
                            title={l.label}
                            description={l.description}
                        />
                    ))}
                </div>
            </Section>

            <Section title="Tutor voice" hint="Used in Talk">
                <div role="radiogroup" aria-label="Tutor voice" className="grid grid-cols-2 gap-2">
                    {VOICES.map(v => (
                        <OptionTile
                            key={v.id}
                            selected={s.voice === v.id}
                            disabled={locked}
                            onSelect={() => s.setVoice(v.id)}
                            title={v.label}
                            description={v.description}
                        />
                    ))}
                </div>
            </Section>

            <Section title="During conversations" hint={locked ? 'Applies next time' : undefined}>
                <ul className="divide-y divide-white/[0.05] overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.02]">
                    <ToggleRow
                        title="Scene illustrations"
                        description="Now and then your tutor paints the scene you are talking about."
                        checked={s.sceneImages}
                        onChange={s.setSceneImages}
                    />
                    {BUILT_IN_SKILLS.map(skill => {
                        const on = isSkillEnabled(skill, s.skillPrefs);
                        return (
                            <ToggleRow
                                key={skill.name}
                                title={skill.title}
                                description={skill.summary}
                                checked={on}
                                onChange={v => s.setSkillPrefs({ ...s.skillPrefs, [skill.name]: v })}
                            />
                        );
                    })}
                </ul>
            </Section>

            <Section title="Offline">
                <button
                    type="button"
                    onClick={() => { onClose(); onOpenOffline(); }}
                    className="flex w-full items-center gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.02] px-4 py-3.5 text-left transition-colors hover:bg-white/[0.05]"
                >
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-mint-400/10 text-mint-300"><Icon name="chip" size={18} /></span>
                    <span className="flex-1">
                        <span className="block text-sm font-semibold text-white">Offline mode</span>
                        <span className="block text-xs text-slate-400">Download a private on-device model for Chat and Write.</span>
                    </span>
                    <Icon name="chevronRight" size={16} className="text-slate-500" />
                </button>
            </Section>
        </Sheet>
    );
};

const ToggleRow: React.FC<{ title: string; description: string; checked: boolean; onChange: (v: boolean) => void }> = ({ title, description, checked, onChange }) => (
    <li className="flex items-center gap-4 px-4 py-3.5">
        <span className="flex-1">
            <span className="block text-sm font-semibold text-white">{title}</span>
            <span className="mt-0.5 block text-xs leading-snug text-slate-400">{description}</span>
        </span>
        <Switch checked={checked} onChange={onChange} label={title} />
    </li>
);
