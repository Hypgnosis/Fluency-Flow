import React from 'react';
import { motion } from 'motion/react';
import { AuthModal } from '../AuthModal';
import { Icon, type IconName } from '../ui/Icon';
import { Wordmark } from '../ui/Logo';

const FEATURES: { icon: IconName; title: string; body: string }[] = [
    { icon: 'mic', title: 'Talk out loud', body: 'Real-time voice conversations at your level.' },
    { icon: 'camera', title: 'Learn what you see', body: 'Point your camera, get the word and a mini lesson.' },
    { icon: 'pen', title: 'Write with feedback', body: 'Corrections that explain the why.' },
    { icon: 'chip', title: 'Practice offline', body: 'A private model that runs on your device.' },
];

const rise = (delay: number) => ({
    initial: { opacity: 0, y: 18 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.7, delay, ease: [0.22, 1, 0.36, 1] as const },
});

/** Signed-out home: what Glossos is, plus the sign-in card. */
export const Landing: React.FC = () => (
    <div className="relative min-h-[100dvh] w-full overflow-hidden bg-ink-950 text-slate-100">
        {/* Hero visual: Blender-rendered glass orb loop (poster shows first, video fades in when ready) */}
        <div className="pointer-events-none absolute inset-0" aria-hidden="true">
            <motion.div
                className="absolute left-1/2 top-[-6%] aspect-square w-[118vw] -translate-x-1/2 opacity-45 lg:left-auto lg:right-[-8%] lg:top-1/2 lg:w-[min(112vh,64vw)] lg:-translate-y-1/2 lg:translate-x-0 lg:opacity-100"
                initial={{ scale: 0.92 }}
                animate={{ scale: 1 }}
                transition={{ duration: 1.6, ease: [0.22, 1, 0.36, 1] }}
                style={{ WebkitMaskImage: 'radial-gradient(circle at center, black 42%, transparent 68%)', maskImage: 'radial-gradient(circle at center, black 42%, transparent 68%)' }}
            >
                <video className="h-full w-full object-cover" poster="/brand/hero-poster.webp" autoPlay muted loop playsInline preload="auto">
                    <source src="/brand/hero-loop.webm" type="video/webm" />
                    <source src="/brand/hero-loop.mp4" type="video/mp4" />
                </video>
            </motion.div>
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_20%_40%,rgba(255,191,0,0.08),transparent_55%)]" />
            <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-ink-950 to-transparent" />
        </div>

        <div className="relative z-10 mx-auto flex min-h-[100dvh] w-full max-w-7xl flex-col px-5 py-6 sm:px-10 lg:py-10">
            <motion.header {...rise(0)}><Wordmark /></motion.header>

            <div className="grid flex-1 items-center gap-12 py-10 lg:grid-cols-[1.15fr_1fr] lg:gap-16">
                <div className="max-w-xl">
                    <motion.p {...rise(0.08)} className="inline-flex items-center gap-2 rounded-full border border-gold-500/25 bg-gold-500/[0.08] px-3 py-1 text-xs font-semibold text-gold-300">
                        <Icon name="sparkles" size={13} /> Your personal language tutor
                    </motion.p>
                    <motion.h1 {...rise(0.16)} className="mt-5 font-display text-[40px] font-bold leading-[1.04] tracking-[-0.03em] text-white sm:text-6xl">
                        Speak a new language.{' '}
                        <span className="bg-gradient-to-r from-gold-200 via-gold-400 to-gold-600 bg-clip-text text-transparent">Out loud, from day one.</span>
                    </motion.h1>
                    <motion.p {...rise(0.24)} className="mt-5 max-w-lg text-[17px] leading-relaxed text-slate-300">
                        Have real conversations with a tutor that listens, answers and gently corrects you. Learn the words for everything around you, polish your writing, and keep practicing offline.
                    </motion.p>
                    <motion.ul {...rise(0.32)} className="mt-9 grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {FEATURES.map(f => (
                            <li key={f.title} className="flex gap-3 rounded-2xl border border-white/[0.06] bg-ink-900/40 p-3.5 backdrop-blur-md">
                                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gold-500/10 text-gold-400"><Icon name={f.icon} size={18} /></span>
                                <span>
                                    <span className="block text-sm font-semibold text-white">{f.title}</span>
                                    <span className="mt-0.5 block text-[13px] leading-snug text-slate-400">{f.body}</span>
                                </span>
                            </li>
                        ))}
                    </motion.ul>
                </div>

                <motion.div {...rise(0.2)} className="flex justify-center lg:justify-end">
                    <AuthModal />
                </motion.div>
            </div>

            <motion.footer {...rise(0.4)} className="text-xs text-slate-600">
                © {new Date().getFullYear()} Glossos
            </motion.footer>
        </div>
    </div>
);
