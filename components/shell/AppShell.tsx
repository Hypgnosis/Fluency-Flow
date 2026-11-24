import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Icon } from '../ui/Icon';
import { Wordmark, LogoMark } from '../ui/Logo';
import { IconButton, LangBadge, Spinner, cx } from '../ui/primitives';
import { Avatar, ProfileSheet, userFirstName } from '../UserProfile';
import { useAuth } from '../AuthModal';
import { LEVELS, languageMeta, useLearningSettings } from './LearningSettings';
import { SettingsSheet } from './SettingsSheet';
import { NAV, PRIMARY_NAV, isAppMode, navItem, type AppMode } from './nav';
import Conversation from '../Conversation';
import { ShellCtx, type ShellApi } from './shellContext';
import { naturalVoice } from '../../services/naturalVoice';

export { useShell } from './shellContext';

const LensTeacher = lazy(() => import('../lens/LensTeacher'));
const ChatTutor = lazy(() => import('../chat/ChatTutor').then(m => ({ default: m.ChatTutor })));
const WritingLab = lazy(() => import('../lab/WritingLab').then(m => ({ default: m.WritingLab })));
const OfflinePanel = lazy(() => import('../offline/OfflinePanel'));
const AudioScribe = lazy(() => import('../scribe/AudioScribe'));
const ConversationAssist = lazy(() => import('../assist/ConversationAssist'));

const initialMode = (): AppMode => {
    // Dev-only: ?ui-preview&mode=lens opens a page directly for screen reviews.
    const requested = process.env.GLOSSOS_DEV_PREVIEW ? new URLSearchParams(window.location.search).get('mode') : null;
    return isAppMode(requested) ? requested : 'voice';
};

/** Language pair + level, the one control every page shares. Opens the settings sheet. */
const LanguageChip: React.FC<{ onClick: () => void; compact?: boolean }> = ({ onClick, compact }) => {
    const { learnLanguage, nativeLanguage, level } = useLearningSettings();
    const learn = languageMeta(learnLanguage);
    const native = languageMeta(nativeLanguage);
    const levelLabel = LEVELS.find(l => l.id === level)?.label ?? level;
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label={`Learning ${learn.name} from ${native.name}, ${levelLabel}. Change settings`}
            className="group flex h-10 items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.04] pl-1.5 pr-3 text-sm transition-colors hover:border-white/[0.16] hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/70"
        >
            <LangBadge code={learn.code} tone="gold" />
            {!compact && (
                <span className="flex items-center gap-1.5 whitespace-nowrap">
                    <span className="font-semibold text-white">{learn.native}</span>
                    <span className="text-slate-500">·</span>
                    <span className="text-slate-400">{levelLabel}</span>
                </span>
            )}
            <Icon name="chevronDown" size={14} className="text-slate-500 transition-colors group-hover:text-slate-300" />
        </button>
    );
};

/** Soft animated aurora behind every page. */
const Backdrop: React.FC = () => (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden="true">
        <motion.div
            className="absolute -left-[20%] -top-[30%] h-[80vh] w-[80vh] rounded-full bg-[radial-gradient(circle,rgba(255,191,0,0.16),transparent_62%)] blur-3xl"
            animate={{ x: [0, 60, 0], y: [0, 40, 0] }}
            transition={{ duration: 26, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
            className="absolute -bottom-[35%] -right-[15%] h-[90vh] w-[90vh] rounded-full bg-[radial-gradient(circle,rgba(61,245,160,0.09),transparent_60%)] blur-3xl"
            animate={{ x: [0, -50, 0], y: [0, -30, 0] }}
            transition={{ duration: 32, repeat: Infinity, ease: 'easeInOut' }}
        />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.035),transparent_55%)]" />
        <div className="absolute inset-0 opacity-[0.035] mix-blend-overlay [background-image:url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22160%22 height=%22160%22><filter id=%22n%22><feTurbulence type=%22fractalNoise%22 baseFrequency=%220.8%22 numOctaves=%223%22 stitchTiles=%22stitch%22/></filter><rect width=%22100%25%22 height=%22100%25%22 filter=%22url(%23n)%22/></svg>')]" />
    </div>
);

const PageFallback = () => (
    <div className="flex h-full items-center justify-center text-gold-400"><Spinner size={28} /></div>
);

/** The signed-in app: sidebar on desktop, tab bar on phones, one page at a time. */
export const AppShell: React.FC = () => {
    const { user } = useAuth();
    const settings = useLearningSettings();
    const [mode, setMode] = useState<AppMode>(initialMode);
    const [voiceActive, setVoiceActive] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [profileOpen, setProfileOpen] = useState(false);
    const [notice, setNotice] = useState<string | null>(null);
    const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const flash = useCallback((text: string) => {
        setNotice(text);
        if (noticeTimer.current) clearTimeout(noticeTimer.current);
        noticeTimer.current = setTimeout(() => setNotice(null), 2800);
    }, []);
    useEffect(() => () => { if (noticeTimer.current) clearTimeout(noticeTimer.current); }, []);

    const navigate = useCallback((next: AppMode) => {
        if (voiceActive && next !== 'voice') {
            flash('End your conversation first, then switch.');
            return;
        }
        setMode(next);
    }, [voiceActive, flash]);

    const api = useMemo<ShellApi>(() => ({ navigate, openSettings: () => setSettingsOpen(true), setVoiceActive }), [navigate]);

    // Lens, Chat read-aloud and word buttons speak with the tutor's natural Gemini voice.
    useEffect(() => { naturalVoice.configure({ enabled: true, voice: settings.voice }); }, [settings.voice]);
    useEffect(() => () => naturalVoice.configure({ enabled: false }), []);
    useEffect(() => { if (mode === 'lens') naturalVoice.warmUp(); }, [mode]);
    const page = navItem(mode);
    const { nativeLanguage, learnLanguage, level } = settings;

    return (
        <ShellCtx.Provider value={api}>
            <div className="relative flex h-[100dvh] w-full overflow-hidden bg-ink-950 text-slate-100 selection:bg-gold-500/25">
                <Backdrop />

                {/* ── Sidebar (desktop) ── */}
                <aside className="relative z-10 hidden w-[256px] shrink-0 flex-col border-r border-white/[0.06] bg-ink-950/40 px-4 pb-4 pt-6 backdrop-blur-2xl lg:flex">
                    <div className="px-2"><Wordmark /></div>

                    <nav aria-label="Main" className="mt-9 flex flex-col gap-1">
                        {NAV.map(item => {
                            const active = item.id === mode;
                            const locked = voiceActive && item.id !== 'voice';
                            return (
                                <React.Fragment key={item.id}>
                                    {item.id === 'offline' && <div className="mx-3 my-3 h-px bg-white/[0.06]" />}
                                    <button
                                        type="button"
                                        onClick={() => navigate(item.id)}
                                        aria-current={active ? 'page' : undefined}
                                        aria-disabled={locked || undefined}
                                        className={cx(
                                            'group relative flex h-11 items-center gap-3 rounded-xl px-3 text-[14px] font-medium transition-colors',
                                            active ? 'text-white' : 'text-slate-400 hover:text-slate-100',
                                            locked && 'opacity-40',
                                        )}
                                    >
                                        {active && (
                                            <motion.span
                                                layoutId="nav-active"
                                                className="absolute inset-0 rounded-xl border border-white/[0.08] bg-gradient-to-r from-white/[0.08] to-white/[0.02]"
                                                transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                                            >
                                                <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-gold-400 shadow-[0_0_12px_rgba(255,191,0,0.8)]" />
                                            </motion.span>
                                        )}
                                        <Icon name={item.icon} size={19} className={cx('relative transition-colors', active ? 'text-gold-400' : 'text-slate-500 group-hover:text-slate-300')} />
                                        <span className="relative">{item.id === 'lab' ? 'Write' : item.id === 'assist' ? 'Assist' : item.title}</span>
                                        {item.id === 'voice' && voiceActive && (
                                            <span className="relative ml-auto flex h-2 w-2">
                                                <span className="absolute inset-0 animate-ping rounded-full bg-mint-400/70" />
                                                <span className="relative h-2 w-2 rounded-full bg-mint-400" />
                                            </span>
                                        )}
                                    </button>
                                </React.Fragment>
                            );
                        })}
                    </nav>

                    <div className="mt-auto space-y-2">
                        <button
                            type="button"
                            onClick={() => setSettingsOpen(true)}
                            className="w-full rounded-2xl border border-white/[0.07] bg-white/[0.025] p-3.5 text-left transition-colors hover:bg-white/[0.05]"
                        >
                            <span className="flex items-center justify-between">
                                <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Learning</span>
                                <Icon name="settings" size={15} className="text-slate-500" />
                            </span>
                            <span className="mt-2.5 flex items-center gap-2">
                                <LangBadge code={languageMeta(learnLanguage).code} tone="gold" />
                                <span className="font-display text-[15px] font-semibold text-white">{languageMeta(learnLanguage).native}</span>
                            </span>
                            <span className="mt-1.5 block text-xs text-slate-400">
                                {LEVELS.find(l => l.id === level)?.label} · from {languageMeta(nativeLanguage).native}
                            </span>
                        </button>
                        <button
                            type="button"
                            onClick={() => setProfileOpen(true)}
                            className="flex w-full items-center gap-3 rounded-2xl px-2.5 py-2 text-left transition-colors hover:bg-white/[0.05]"
                        >
                            <Avatar size={34} />
                            <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-semibold text-white">{userFirstName(user)}</span>
                                <span className="block text-xs text-slate-500">Your progress</span>
                            </span>
                            <Icon name="chevronRight" size={15} className="text-slate-600" />
                        </button>
                    </div>
                </aside>

                {/* ── Main column ── */}
                <div className="relative z-10 flex min-w-0 flex-1 flex-col">
                    <header className="flex h-16 shrink-0 items-center justify-between gap-3 px-4 sm:px-6 lg:h-20 lg:px-10">
                        <div className="flex min-w-0 items-center gap-3">
                            <span className="lg:hidden"><LogoMark size={26} /></span>
                            <div className="min-w-0">
                                <AnimatePresence mode="wait" initial={false}>
                                    <motion.div
                                        key={mode}
                                        initial={{ opacity: 0, y: 6 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, y: -6 }}
                                        transition={{ duration: 0.2 }}
                                    >
                                        <h1 className="truncate font-display text-lg font-bold tracking-tight text-white lg:text-2xl">
                                            <span className="lg:hidden">{page.label}</span>
                                            <span className="hidden lg:inline">{page.title}</span>
                                        </h1>
                                        <p className="hidden truncate text-sm text-slate-400 lg:block">{page.subtitle}</p>
                                    </motion.div>
                                </AnimatePresence>
                            </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
                            <span className="hidden sm:block"><LanguageChip onClick={() => setSettingsOpen(true)} /></span>
                            <span className="sm:hidden"><LanguageChip compact onClick={() => setSettingsOpen(true)} /></span>
                            <IconButton
                                icon="chip"
                                label="Offline mode"
                                active={mode === 'offline'}
                                className="lg:hidden"
                                onClick={() => navigate('offline')}
                            />
                            <button
                                type="button"
                                onClick={() => setProfileOpen(true)}
                                aria-label="Your progress and account"
                                className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/70 lg:hidden"
                            >
                                <Avatar size={34} />
                            </button>
                        </div>
                    </header>

                    <main className="relative min-h-0 flex-1">
                        <AnimatePresence mode="wait" initial={false}>
                            <motion.div
                                key={mode}
                                className="absolute inset-0 flex flex-col"
                                initial={{ opacity: 0, y: 14 }}
                                animate={{ opacity: 1, y: 0, transitionEnd: { transform: 'none' } }}
                                exit={{ opacity: 0, y: -10 }}
                                transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
                            >
                                <Suspense fallback={<PageFallback />}>
                                    {mode === 'voice' && <Conversation />}
                                    {mode === 'lens' && <LensTeacher nativeLanguage={nativeLanguage} learnLanguage={learnLanguage} level={level} />}
                                    {mode === 'assist' && <ConversationAssist nativeLanguage={nativeLanguage} learnLanguage={learnLanguage} level={level} />}
                                    {mode === 'chat' && <ChatTutor nativeLanguage={nativeLanguage} learnLanguage={learnLanguage} level={level} onManageModels={() => navigate('offline')} />}
                                    {mode === 'lab' && (
                                        <div className="min-h-0 flex-1 overflow-y-auto">
                                            <WritingLab nativeLanguage={nativeLanguage} learnLanguage={learnLanguage} level={level} onManageModels={() => navigate('offline')} />
                                        </div>
                                    )}
                                    {mode === 'scribe' && (
                                        <div className="min-h-0 flex-1 overflow-y-auto">
                                            <AudioScribe nativeLanguage={nativeLanguage} learnLanguage={learnLanguage} level={level} />
                                        </div>
                                    )}
                                    {mode === 'offline' && (
                                        <div className="min-h-0 flex-1 overflow-y-auto">
                                            <OfflinePanel />
                                        </div>
                                    )}
                                </Suspense>
                            </motion.div>
                        </AnimatePresence>

                        <AnimatePresence>
                            {notice && (
                                <motion.div
                                    role="status"
                                    className="pointer-events-none absolute inset-x-0 top-2 z-30 flex justify-center px-4"
                                    initial={{ opacity: 0, y: -8 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -8 }}
                                >
                                    <span className="rounded-full border border-white/[0.1] bg-ink-800/95 px-4 py-2 text-sm font-medium text-slate-100 shadow-xl backdrop-blur-xl">
                                        {notice}
                                    </span>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </main>

                    {/* ── Tab bar (phones and tablets) ── */}
                    <nav
                        aria-label="Main"
                        className="relative z-20 shrink-0 border-t border-white/[0.06] bg-ink-950/80 backdrop-blur-2xl lg:hidden"
                        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
                    >
                        <div className="mx-auto flex max-w-lg items-stretch justify-around px-2">
                            {PRIMARY_NAV.map(item => {
                                const active = item.id === mode;
                                const locked = voiceActive && item.id !== 'voice';
                                return (
                                    <button
                                        key={item.id}
                                        type="button"
                                        onClick={() => navigate(item.id)}
                                        aria-current={active ? 'page' : undefined}
                                        aria-disabled={locked || undefined}
                                        className={cx('relative flex h-[62px] flex-1 flex-col items-center justify-center gap-1 text-[11px] font-semibold transition-colors', active ? 'text-white' : 'text-slate-500', locked && 'opacity-40')}
                                    >
                                        {active && (
                                            <motion.span
                                                layoutId="tab-active"
                                                className="absolute top-0 h-[3px] w-8 rounded-b-full bg-gold-400 shadow-[0_0_14px_rgba(255,191,0,0.9)]"
                                                transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                                            />
                                        )}
                                        <Icon name={item.icon} size={21} className={active ? 'text-gold-400' : undefined} />
                                        {item.label}
                                    </button>
                                );
                            })}
                        </div>
                    </nav>
                </div>
            </div>

            <SettingsSheet open={settingsOpen} onClose={() => setSettingsOpen(false)} locked={voiceActive} onOpenOffline={() => navigate('offline')} />
            <ProfileSheet open={profileOpen} onClose={() => setProfileOpen(false)} />
        </ShellCtx.Provider>
    );
};

export default AppShell;
