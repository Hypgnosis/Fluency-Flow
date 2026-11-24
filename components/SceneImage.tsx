import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Icon } from './ui/Icon';

interface SceneImageProps {
    imageDataUrl: string;
    description: string;
    isLoading?: boolean;
}

/** A picture of the scene the tutor is describing, shown under its message. Tap to see it whole. */
export const SceneImage: React.FC<SceneImageProps> = ({ imageDataUrl, description, isLoading = false }) => {
    const [expanded, setExpanded] = useState(false);
    const [loaded, setLoaded] = useState(false);

    if (isLoading) return <SceneImageSkeleton />;

    return (
        <motion.figure
            className="mt-3 w-full max-w-md overflow-hidden rounded-2xl border border-white/[0.08] bg-ink-850 shadow-[var(--shadow-card)]"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        >
            <button
                type="button"
                onClick={() => setExpanded(!expanded)}
                aria-label={expanded ? 'Show less of the picture' : 'Show the whole picture'}
                className={`group relative block w-full overflow-hidden transition-[max-height] duration-500 ${expanded ? 'max-h-[640px]' : 'max-h-[260px]'}`}
            >
                {!loaded && <div className="absolute inset-0 animate-pulse bg-white/[0.04]" />}
                <img
                    src={imageDataUrl}
                    alt={description}
                    onLoad={() => setLoaded(true)}
                    className={`h-auto w-full object-cover transition-all duration-700 ${loaded ? 'scale-100 opacity-100' : 'scale-105 opacity-0'} ${expanded ? '' : 'object-top'}`}
                />
                {!expanded && <div className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-ink-850 to-transparent" />}
                <span className="absolute bottom-2.5 right-2.5 flex items-center gap-1 rounded-full border border-white/10 bg-black/55 px-2.5 py-1 text-[11px] font-medium text-white/80 opacity-0 backdrop-blur-md transition-opacity group-hover:opacity-100">
                    <Icon name="chevronDown" size={12} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
                    {expanded ? 'Less' : 'See all'}
                </span>
            </button>
            <figcaption className="flex items-center gap-2 border-t border-white/[0.05] px-3.5 py-2.5 text-xs text-slate-400">
                <Icon name="image" size={14} className="text-gold-400" />
                The scene you are talking about
            </figcaption>
        </motion.figure>
    );
};

/** Placeholder while the scene picture is being painted. */
export const SceneImageSkeleton: React.FC = () => (
    <div className="mt-3 w-full max-w-md overflow-hidden rounded-2xl border border-white/[0.08] bg-ink-850">
        <div className="relative h-[180px] overflow-hidden">
            <div className="absolute inset-0 animate-shimmer bg-gradient-to-r from-ink-850 via-ink-700 to-ink-850 bg-[length:200%_100%]" />
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 text-slate-400">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-gold-500/25 bg-gold-500/10 text-gold-400">
                    <Icon name="sparkles" size={20} className="animate-pulse" />
                </span>
                <span className="text-xs font-medium">Painting the scene…</span>
            </div>
        </div>
    </div>
);
