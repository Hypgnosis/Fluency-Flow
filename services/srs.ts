/**
 * Spaced repetition for saved vocabulary (SM-2 style).
 * Gallery's study mode only flips cards; grading and scheduling are a Glossos addition.
 */

import type { SrsState } from '../types/lens';

export type Grade = 'again' | 'hard' | 'good' | 'easy';

export const DAY_MS = 24 * 60 * 60 * 1000;
const AGAIN_DELAY_MS = 60 * 1000;
const MIN_EASE = 1.3;

export function newSrsState(now = Date.now()): SrsState {
    return { reps: 0, lapses: 0, ease: 2.5, intervalDays: 0, due: now };
}

export function review(state: SrsState, grade: Grade, now = Date.now()): SrsState {
    let { reps, lapses, ease, intervalDays } = state;

    if (grade === 'again') {
        return {
            reps: 0,
            lapses: lapses + 1,
            ease: Math.max(MIN_EASE, ease - 0.2),
            intervalDays: 0,
            due: now + AGAIN_DELAY_MS,
            lastReviewed: now,
        };
    }

    if (grade === 'hard') {
        ease = Math.max(MIN_EASE, ease - 0.15);
        intervalDays = reps === 0 ? 0.5 : Math.max(1, intervalDays * 1.2);
    } else if (grade === 'good') {
        intervalDays = reps === 0 ? 1 : reps === 1 ? 3 : intervalDays * ease;
    } else {
        ease += 0.15;
        intervalDays = reps === 0 ? 3 : reps === 1 ? 6 : intervalDays * ease * 1.3;
    }

    intervalDays = Math.round(intervalDays * 100) / 100;
    return { reps: reps + 1, lapses, ease, intervalDays, due: now + intervalDays * DAY_MS, lastReviewed: now };
}

export function isDue(state: SrsState, now = Date.now()): boolean {
    return state.due <= now;
}

/** Short label for when a grade would bring the card back, e.g. "1 min", "12 h", "3 d". */
export function describeNextReview(state: SrsState, grade: Grade, now = Date.now()): string {
    const ms = review(state, grade, now).due - now;
    if (ms < 60 * 60 * 1000) return `${Math.max(1, Math.round(ms / 60000))} min`;
    if (ms < DAY_MS) return `${Math.round(ms / 3600000)} h`;
    const days = ms / DAY_MS;
    if (days < 30) return `${Math.round(days)} d`;
    return `${Math.round(days / 30)} mo`;
}
