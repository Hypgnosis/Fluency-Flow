import React, { useState, useEffect } from 'react';
import { useAuth } from './AuthModal';
import { getUserStats } from '../services/sessionManager';

interface UserStats {
    totalSessions: number;
    totalMinutes: number;
    averagePronunciationScore: number;
    unresolvedMistakes: number;
}

export const UserProfile: React.FC<{ onClose: () => void }> = ({ onClose }) => {
    const { user, logout } = useAuth();
    const [stats, setStats] = useState<UserStats | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (user) {
            loadStats();
        }
    }, [user]);

    const loadStats = async () => {
        if (!user) return;
        setLoading(true);
        try {
            const userStats = await getUserStats(user.uid);
            setStats(userStats);
        } catch (error) {
            console.error('Error loading stats:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleLogout = async () => {
        await logout();
        onClose();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
            <div className="relative w-full max-w-md mx-4 p-8 bg-[#0A0A0B] border border-white/[0.06] rounded-3xl shadow-2xl">
                {/* Ambient glow */}
                <div className="absolute -inset-1 bg-gradient-to-r from-[#FFBF00]/15 to-[#00FF41]/15 rounded-3xl blur-xl" />

                <div className="relative">
                    {/* Header */}
                    <div className="flex items-center justify-between mb-6">
                        <h2 className="text-xl font-bold text-white tracking-tighter" style={{ fontFamily: "'Inter Tight', sans-serif" }}>Neural Retention Index</h2>
                        <button
                            onClick={onClose}
                            className="p-2 hover:bg-white/5 rounded-full transition-colors"
                        >
                            <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>

                    {/* User Info */}
                    <div className="mb-6 flex items-center gap-4 p-4 bg-white/[0.02] rounded-2xl border border-white/[0.06]">
                        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#FFBF00] to-[#00FF41] flex items-center justify-center text-black font-bold text-lg">
                            {user?.isAnonymous ? 'G' : (user?.displayName?.[0] || user?.email?.[0] || 'U')}
                        </div>
                        <div className="flex-1">
                            <p className="text-white font-medium" style={{ fontFamily: "'Inter Tight', sans-serif" }}>
                                {user?.isAnonymous ? 'Guest' : (user?.displayName || user?.email || 'User')}
                            </p>
                            <p className="text-xs text-slate-600" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                                {user?.isAnonymous ? 'Anonymous neural session' : user?.email}
                            </p>
                        </div>
                    </div>

                    {/* NRI Stats */}
                    {loading ? (
                        <div className="space-y-3 mb-6">
                            {[...Array(4)].map((_, i) => (
                                <div key={i} className="h-20 bg-white/[0.02] rounded-2xl animate-pulse" />
                            ))}
                        </div>
                    ) : stats ? (
                        <div className="grid grid-cols-2 gap-3 mb-6">
                            <StatCard
                                icon={
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                                    </svg>
                                }
                                label="Linguistic Syncs"
                                value={stats.totalSessions}
                                accentColor="#00FF41"
                            />
                            <StatCard
                                icon={
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                }
                                label="Immersion Minutes"
                                value={stats.totalMinutes}
                                accentColor="#00FF41"
                            />
                            <StatCard
                                icon={
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                                    </svg>
                                }
                                label="Avg. Neural Integrity"
                                value={`${stats.averagePronunciationScore}/5`}
                                accentColor="#FFBF00"
                            />
                            <StatCard
                                icon={
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                    </svg>
                                }
                                label="Resolved Deviations"
                                value={stats.unresolvedMistakes}
                                highlight={stats.unresolvedMistakes > 0}
                                accentColor="#00FF41"
                            />
                        </div>
                    ) : null}

                    {/* Actions */}
                    <div className="space-y-2">
                        <button
                            onClick={handleLogout}
                            className="w-full px-6 py-3 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 text-rose-300 font-medium rounded-full transition-all"
                            style={{ fontFamily: "'IBM Plex Mono', monospace" }}
                        >
                            Terminate Session
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

const StatCard: React.FC<{
    icon: React.ReactNode;
    label: string;
    value: string | number;
    highlight?: boolean;
    accentColor?: string;
}> = ({ icon, label, value, highlight, accentColor = '#00FF41' }) => (
    <div className={`p-4 rounded-2xl border transition-colors ${highlight
            ? 'bg-[#FFBF00]/[0.06] border-[#FFBF00]/15'
            : 'bg-white/[0.02] border-white/[0.06] hover:bg-white/[0.04]'
        }`}>
        <div className="mb-2" style={{ color: highlight ? '#FFBF00' : accentColor }}>
            {icon}
        </div>
        <p className="text-2xl font-bold text-white mb-1" style={{ fontFamily: "'Inter Tight', sans-serif", letterSpacing: '-0.025em' }}>{value}</p>
        <p className="text-[9px] text-slate-600 uppercase tracking-[0.15em]" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{label}</p>
    </div>
);
