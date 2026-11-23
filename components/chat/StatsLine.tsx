import React from 'react';
import type { ReplyStats } from '../../services/textEngine';

const MONO = { fontFamily: "'IBM Plex Mono', monospace" };

function formatLatency(ms: number): string {
    if (ms < 1000) return `${ms} ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
    return `${(ms / 60_000).toFixed(1)} min`;
}

/** Per-reply stats like Gallery's chat: where it ran, first-token latency, speed. */
export const StatsLine: React.FC<{ stats: ReplyStats | null }> = ({ stats }) => {
    if (!stats) return <span />;
    const parts = [
        stats.engine === 'device' ? 'on device' : 'cloud',
        `first token ${formatLatency(stats.ttftMs)}`,
        stats.decodeTokensPerSec ? `${stats.decodeTokensPerSec.toFixed(1)} tok/s` : null,
        `total ${formatLatency(stats.totalMs)}`,
    ].filter(Boolean);
    return <span className="text-[10px] text-slate-600" style={MONO}>{parts.join(' · ')}</span>;
};
