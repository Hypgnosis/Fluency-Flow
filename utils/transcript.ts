import type { TranscriptionEntry } from '../types';

/**
 * Adds a transcript entry or updates its text. A new entry goes just before `beforeId`
 * when that entry exists (your words arriving after the tutor's reply has started).
 */
export function upsertEntry(
    log: TranscriptionEntry[],
    update: Pick<TranscriptionEntry, 'id' | 'speaker' | 'text' | 'isFinal'>,
    beforeId: number,
): TranscriptionEntry[] {
    const i = log.findIndex(e => e.id === update.id);
    if (i !== -1) {
        const next = log.slice();
        next[i] = { ...next[i], text: update.text };
        return next;
    }
    const at = beforeId === -1 ? -1 : log.findIndex(e => e.id === beforeId);
    if (at === -1) return [...log, update];
    return [...log.slice(0, at), update, ...log.slice(at)];
}
