import React, { Suspense, lazy, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { LANGUAGES, LEVELS, languageMeta } from './shell/LearningSettings';
import { Button, LangBadge, OptionTile, cx } from './ui/primitives';
import { Icon, type IconName } from './ui/Icon';
import { Wordmark } from './ui/Logo';

const LanguageOrb = lazy(() => import('./LanguageOrb'));

interface OnboardingPageProps {
    onComplete: (nativeLanguage: string, learningLanguage: string) => void;
}

const guessNativeLanguage = () => {
    const code = (typeof navigator !== 'undefined' ? navigator.language : 'en').slice(0, 2).toLowerCase();
    return LANGUAGES.find(l => l.code.toLowerCase() === code)?.name ?? 'English';
};

const FEATURES: { icon: IconName; title: string; body: string }[] = [
    { icon: 'mic', title: 'Talk', body: 'Real conversations out loud. Your tutor answers, corrects gently and remembers.' },
    { icon: 'camera', title: 'Lens', body: 'Point your camera at anything and learn what it is called.' },
    { icon: 'pen', title: 'Write', body: 'Get your writing corrected, with the why explained in your language.' },
    { icon: 'chip', title: 'Offline', body: 'Download a private model and keep practicing with no internet.' },
];

const STEPS = 4;

/** First-run setup: what you learn, what you speak, your level, then a quick tour. */
export default function OnboardingPage({ onComplete }: OnboardingPageProps) {
    const [step, setStep] = useState(0);
    const [learningLanguage, setLearningLanguage] = useState('Spanish');
    const [nativeLanguage, setNativeLanguage] = useState(() => {
        const guess = guessNativeLanguage();
        return guess === 'Spanish' ? 'English' : guess;
    });
    const [level, setLevel] = useState('Beginner');

    const handleComplete = () => {
        try {
            localStorage.setItem('glossos_onboarded', 'true');
            localStorage.setItem('glossos_native_lang', nativeLanguage);
            localStorage.setItem('glossos_learning_lang', learningLanguage);
            localStorage.setItem('glossos_level', level);
        } catch { /* storage unavailable */ }
        onComplete(nativeLanguage, learningLanguage);
    };

    const learn = languageMeta(learningLanguage);
    const native = languageMeta(nativeLanguage);

    const pickLearn = (name: string) => {
        setLearningLanguage(name);
        if (name === nativeLanguage) setNativeLanguage(name === 'English' ? 'Spanish' : 'English');
    };

    return (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-ink-950 text-slate-100">
            <div className="pointer-events-none fixed inset-0" aria-hidden="true">
                <div className="absolute -left-1/4 -top-1/3 h-[80vh] w-[80vh] rounded-full bg-[radial-gradient(circle,rgba(255,191,0,0.14),transparent_62%)] blur-3xl" />
                <div className="absolute -bottom-1/3 -right-1/4 h-[80vh] w-[80vh] rounded-full bg-[radial-gradient(circle,rgba(61,245,160,0.08),transparent_60%)] blur-3xl" />
            </div>

            <div className="relative mx-auto flex min-h-full w-full max-w-2xl flex-col px-5 pb-8 pt-6 sm:px-8 sm:pt-10">
                <div className="flex items-center justify-between">
                    <Wordmark />
                    <div className="flex items-center gap-1.5" aria-label={`Step ${step + 1} of ${STEPS}`}>
                        {Array.from({ length: STEPS }, (_, i) => (
                            <motion.span
                                key={i}
                                className={cx('h-1.5 rounded-full', i <= step ? 'bg-gold-400' : 'bg-white/10')}
                                animate={{ width: i === step ? 22 : 6 }}
                                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                            />
                        ))}
                    </div>
                </div>

                <div className="flex flex-1 flex-col justify-center py-8">
                    <AnimatePresence mode="wait">
                        <motion.div
                            key={step}
                            initial={{ opacity: 0, x: 24 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -24 }}
                            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                        >
                            {step === 0 && (
                                <>
                                    <h1 className="font-display text-3xl font-bold tracking-tight text-white sm:text-4xl">Which language do you want to learn?</h1>
                                    <p className="mt-3 text-[15px] text-slate-400">You can change this any time.</p>
                                    <div role="radiogroup" aria-label="Language to learn" className="mt-8 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                                        {LANGUAGES.map(l => (
                                            <OptionTile
                                                key={l.name}
                                                selected={learningLanguage === l.name}
                                                onSelect={() => pickLearn(l.name)}
                                                leading={<LangBadge code={l.code} tone={learningLanguage === l.name ? 'gold' : 'slate'} />}
                                                title={l.native}
                                                description={l.native !== l.name ? l.name : undefined}
                                            />
                                        ))}
                                    </div>
                                </>
                            )}

                            {step === 1 && (
                                <>
                                    <h1 className="font-display text-3xl font-bold tracking-tight text-white sm:text-4xl">And which language do you speak?</h1>
                                    <p className="mt-3 text-[15px] text-slate-400">Your tutor explains things in this language when you get stuck.</p>
                                    <div role="radiogroup" aria-label="Your language" className="mt-8 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                                        {LANGUAGES.filter(l => l.name !== learningLanguage).map(l => (
                                            <OptionTile
                                                key={l.name}
                                                selected={nativeLanguage === l.name}
                                                onSelect={() => setNativeLanguage(l.name)}
                                                leading={<LangBadge code={l.code} tone={nativeLanguage === l.name ? 'gold' : 'slate'} />}
                                                title={l.native}
                                                description={l.native !== l.name ? l.name : undefined}
                                            />
                                        ))}
                                    </div>
                                </>
                            )}

                            {step === 2 && (
                                <>
                                    <h1 className="font-display text-3xl font-bold tracking-tight text-white sm:text-4xl">How much {learn.name} do you know?</h1>
                                    <p className="mt-3 text-[15px] text-slate-400">Your tutor adapts its pace and vocabulary to you.</p>
                                    <div role="radiogroup" aria-label="Level" className="mt-8 space-y-2.5">
                                        {LEVELS.map(l => (
                                            <OptionTile
                                                key={l.id}
                                                selected={level === l.id}
                                                onSelect={() => setLevel(l.id)}
                                                title={l.label}
                                                description={l.description}
                                                className="py-4"
                                            />
                                        ))}
                                    </div>
                                </>
                            )}

                            {step === 3 && (
                                <>
                                    <div className="h-[220px] sm:h-[260px]">
                                        <Suspense fallback={<div className="h-full" />}>
                                            <LanguageOrb nativeLanguage={nativeLanguage} learningLanguage={learningLanguage} />
                                        </Suspense>
                                    </div>
                                    <div className="text-center">
                                        <p className="inline-flex items-center gap-2 text-sm text-slate-400">
                                            <LangBadge code={native.code} size="sm" /> {native.native}
                                            <Icon name="arrowRight" size={14} className="text-gold-400" />
                                            <LangBadge code={learn.code} tone="gold" size="sm" /> <span className="text-white">{learn.native}</span>
                                        </p>
                                        <h1 className="mt-3 font-display text-3xl font-bold tracking-tight text-white sm:text-4xl">You’re all set</h1>
                                        <p className="mx-auto mt-3 max-w-md text-[15px] text-slate-400">Here is what you can do with Glossos.</p>
                                    </div>
                                    <div className="mt-7 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                                        {FEATURES.map((f, i) => (
                                            <motion.div
                                                key={f.title}
                                                initial={{ opacity: 0, y: 10 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                transition={{ delay: 0.1 + i * 0.07 }}
                                                className="flex gap-3.5 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4"
                                            >
                                                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gold-500/10 text-gold-400"><Icon name={f.icon} size={20} /></span>
                                                <span>
                                                    <span className="block font-display font-semibold text-white">{f.title}</span>
                                                    <span className="mt-0.5 block text-sm leading-snug text-slate-400">{f.body}</span>
                                                </span>
                                            </motion.div>
                                        ))}
                                    </div>
                                </>
                            )}
                        </motion.div>
                    </AnimatePresence>
                </div>

                <div className="flex items-center justify-between gap-3">
                    {step > 0 ? (
                        <Button variant="ghost" size="lg" onClick={() => setStep(step - 1)}>Back</Button>
                    ) : <span />}
                    {step < STEPS - 1 ? (
                        <Button variant="primary" size="lg" iconRight="arrowRight" onClick={() => setStep(step + 1)}>Continue</Button>
                    ) : (
                        <Button variant="primary" size="lg" iconRight="arrowRight" onClick={handleComplete}>Start learning</Button>
                    )}
                </div>
            </div>
        </div>
    );
}
