import React, { useEffect, useState } from 'react';
import { useAuth } from './AuthModal';
import { getUserStats } from '../services/sessionManager';
import { Icon, type IconName } from './ui/Icon';
import { Button, Eyebrow, Sheet } from './ui/primitives';

interface UserStats {
    totalSessions: number;
    totalMinutes: number;
    averagePronunciationScore: number;
    unresolvedMistakes: number;
}

export const userInitial = (user: { isAnonymous?: boolean; displayName?: string | null; email?: string | null } | null) =>
    !user || user.isAnonymous ? 'G' : (user.displayName?.[0] || user.email?.[0] || 'U').toUpperCase();

export const userFirstName = (user: { isAnonymous?: boolean; displayName?: string | null; email?: string | null } | null) =>
    !user || user.isAnonymous ? 'Guest' : (user.displayName?.split(' ')[0] || user.email?.split('@')[0] || 'You');

export const Avatar: React.FC<{ size?: number }> = ({ size = 36 }) => {
    const { user } = useAuth();
    return (
        <span
            className="relative inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-gold-300 via-gold-500 to-gold-700 font-display font-bold text-ink-950 shadow-[0_6px_20px_-8px_rgba(255,191,0,0.7)] ring-1 ring-white/20"
            style={{ width: size, height: size, fontSize: size * 0.4 }}
            aria-hidden="true"
        >
            {userInitial(user)}
        </span>
    );
};

/** Your account and progress. */
export const ProfileSheet: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
    const { user, logout } = useAuth();
    const [stats, setStats] = useState<UserStats | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!open || !user) return;
        let cancelled = false;
        setLoading(true);
        getUserStats(user.uid)
            .then(s => { if (!cancelled) setStats(s); })
            .catch(err => console.error('Error loading stats:', err))
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [open, user]);

    const handleLogout = async () => {
        try {
            await logout();
        } catch (error) {
            console.error('[GLOSSOS] Logout error:', error);
        } finally {
            onClose();
        }
    };

    const cards: { icon: IconName; label: string; value: string | number; tone?: 'gold' }[] = stats ? [
        { icon: 'chat', label: 'Conversations', value: stats.totalSessions },
        { icon: 'mic', label: 'Minutes speaking', value: stats.totalMinutes },
        { icon: 'speaker', label: 'Pronunciation', value: stats.averagePronunciationScore ? `${stats.averagePronunciationScore}/5` : '—' },
        { icon: 'flame', label: 'Mistakes to review', value: stats.unresolvedMistakes, tone: stats.unresolvedMistakes > 0 ? 'gold' : undefined },
    ] : [];

    return (
        <Sheet
            open={open}
            onClose={onClose}
            title="Your progress"
            footer={<Button variant="ghost" icon="logout" className="w-full text-rose-300 hover:text-rose-200 hover:bg-rose-500/10" onClick={handleLogout}>Sign out</Button>}
        >
            <div className="mb-7 flex items-center gap-4 rounded-2xl border border-white/[0.07] bg-gradient-to-br from-white/[0.05] to-transparent p-4">
                <Avatar size={52} />
                <div className="min-w-0">
                    <p className="truncate font-display text-lg font-bold text-white">{user?.isAnonymous ? 'Guest' : (user?.displayName || user?.email || 'You')}</p>
                    <p className="truncate text-sm text-slate-400">{user?.isAnonymous ? 'Guest account on this device' : user?.email}</p>
                </div>
            </div>

            <Eyebrow>All time</Eyebrow>
            {loading ? (
                <div className="mt-3 grid grid-cols-2 gap-3">
                    {[0, 1, 2, 3].map(i => <div key={i} className="h-[104px] animate-pulse rounded-2xl bg-white/[0.03]" />)}
                </div>
            ) : stats ? (
                <div className="mt-3 grid grid-cols-2 gap-3">
                    {cards.map(c => (
                        <div
                            key={c.label}
                            className={`rounded-2xl border p-4 ${c.tone === 'gold' ? 'border-gold-500/25 bg-gold-500/[0.06]' : 'border-white/[0.07] bg-white/[0.025]'}`}
                        >
                            <Icon name={c.icon} size={18} className={c.tone === 'gold' ? 'text-gold-400' : 'text-mint-300'} />
                            <p className="mt-3 font-display text-[28px] font-bold leading-none tracking-tight text-white">{c.value}</p>
                            <p className="mt-1.5 text-xs font-medium text-slate-400">{c.label}</p>
                        </div>
                    ))}
                </div>
            ) : (
                <p className="mt-3 text-sm text-slate-400">Your stats will appear after your first conversation.</p>
            )}

            {user?.isAnonymous && (
                <p className="mt-6 rounded-2xl border border-white/[0.07] bg-white/[0.02] px-4 py-3 text-xs leading-relaxed text-slate-400">
                    Guest progress is tied to this browser and is lost when you sign out. Create an account to keep it.
                </p>
            )}
        </Sheet>
    );
};
