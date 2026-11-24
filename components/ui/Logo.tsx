import React from 'react';

/** The Glossos mark (split ring with a vertical stroke), drawn as SVG so it stays crisp at any size. */
export const LogoMark: React.FC<{ size?: number; className?: string }> = ({ size = 28, className }) => {
    // Unique gradient id per instance: a duplicate id inside a hidden element (e.g. the desktop
    // sidebar on phones) would make every other copy of the mark render invisible.
    const gid = `glossos-mark-${React.useId().replace(/:/g, '')}`;
    return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true" className={className}>
        <defs>
            <linearGradient id={gid} x1="6" y1="4" x2="26" y2="28" gradientUnits="userSpaceOnUse">
                <stop offset="0" stopColor="#FFE08A" />
                <stop offset="0.45" stopColor="#FFBF00" />
                <stop offset="1" stopColor="#E0A800" />
            </linearGradient>
        </defs>
        <path d="M14.2 6.9A9.3 9.3 0 0 0 14.2 25.1" stroke={`url(#${gid})`} strokeWidth="2.6" strokeLinecap="butt" />
        <path d="M17.8 6.9A9.3 9.3 0 0 1 17.8 25.1" stroke={`url(#${gid})`} strokeWidth="2.6" strokeLinecap="butt" />
        <path d="M16 2.6 17.35 4.4V27.6L16 29.4 14.65 27.6V4.4Z" fill={`url(#${gid})`} />
    </svg>
    );
};

export const Wordmark: React.FC<{ className?: string; compact?: boolean }> = ({ className, compact }) => (
    <span className={`inline-flex items-center gap-2.5 ${className ?? ''}`}>
        <span className="relative flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.08] bg-gradient-to-b from-white/[0.07] to-white/[0.01] shadow-[0_8px_24px_-12px_rgba(255,191,0,0.5)]">
            <LogoMark size={22} />
        </span>
        {!compact && (
            <span className="font-display text-[19px] font-bold tracking-[-0.02em] text-white">
                Glossos
            </span>
        )}
    </span>
);
