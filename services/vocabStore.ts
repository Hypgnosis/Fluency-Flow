/**
 * Saved vocabulary and Lens lesson history.
 *
 * Firestore when Firebase is configured and a user is signed in:
 *   users/{uid}/vocabulary/{learnLanguage}_{word}
 *   users/{uid}/lessons/{lessonId}
 * Otherwise vocabulary falls back to localStorage so the feature still works in local development.
 *
 * Writes go through one ordered queue (as in Gallery's XrLanguageTeacherOrderedWriter) so that
 * "save, then immediately un-save" lands in the right order.
 */

import { collection, deleteDoc, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';
import { auth, db } from './firebase';
import type { LensTurn, SavedWord, SrsState, VocabCard } from '../types/lens';
import { newSrsState } from './srs';
import { isSameVocabularyWord } from './lensTeacher/dialogue';

const LOCAL_KEY_PREFIX = 'glossos_vocab_';

function uid(): string | null {
    return auth?.currentUser?.uid ?? null;
}

function useFirestore(): boolean {
    return Boolean(db && uid());
}

function localKey(): string {
    return `${LOCAL_KEY_PREFIX}${uid() ?? 'guest'}`;
}

function readLocal(): SavedWord[] {
    try {
        return JSON.parse(localStorage.getItem(localKey()) || '[]');
    } catch {
        return [];
    }
}

function writeLocal(words: SavedWord[]) {
    try {
        localStorage.setItem(localKey(), JSON.stringify(words));
    } catch (err) {
        console.warn('[GLOSSOS-VOCAB] Could not write local vocabulary:', err);
    }
}

/** Stable document id: "{language}_{word}", lowercased, unsafe characters replaced, max 64 chars. */
export function wordId(learnLanguage: string, word: string): string {
    const safe = (s: string) => s.trim().toLocaleLowerCase().replace(/[\s/\\#?%.[\]*`$]+/g, '_');
    return `${safe(learnLanguage)}_${safe(word)}`.slice(0, 64);
}

let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
}

export async function listSavedWords(): Promise<SavedWord[]> {
    await queue;
    if (!useFirestore()) return readLocal().sort((a, b) => b.createdAt - a.createdAt);
    const snap = await getDocs(collection(db!, `users/${uid()}/vocabulary`));
    return snap.docs.map(d => d.data() as SavedWord).sort((a, b) => b.createdAt - a.createdAt);
}

export function findSaved(words: SavedWord[], learnLanguage: string, word: string): SavedWord | undefined {
    return words.find(w => w.learnLanguage === learnLanguage && isSameVocabularyWord(w.word, word));
}

async function readSaved(id: string): Promise<SavedWord | undefined> {
    if (!useFirestore()) return readLocal().find(w => w.id === id);
    const snap = await getDoc(doc(db!, `users/${uid()}/vocabulary/${id}`));
    return snap.exists() ? (snap.data() as SavedWord) : undefined;
}

/**
 * Saves a card. An existing entry keeps its text and study progress; only a missing image is filled in.
 */
export function saveWord(
    card: VocabCard,
    ctx: { learnLanguage: string; nativeLanguage: string; imageDataUrl?: string; existing?: SavedWord },
): Promise<SavedWord> {
    return enqueue(async () => {
        const existing = ctx.existing ?? await readSaved(wordId(ctx.learnLanguage, card.word));
        const base: SavedWord = existing ?? {
            ...card,
            id: wordId(ctx.learnLanguage, card.word),
            learnLanguage: ctx.learnLanguage,
            nativeLanguage: ctx.nativeLanguage,
            createdAt: Date.now(),
            srs: newSrsState(),
        };
        const entry: SavedWord = { ...base, imageDataUrl: base.imageDataUrl ?? ctx.imageDataUrl };
        // Firestore rejects undefined values.
        const clean = JSON.parse(JSON.stringify(entry)) as SavedWord;

        if (useFirestore()) {
            await setDoc(doc(db!, `users/${uid()}/vocabulary/${clean.id}`), clean);
        } else {
            writeLocal([clean, ...readLocal().filter(w => w.id !== clean.id)]);
        }
        return clean;
    });
}

export function deleteWord(id: string): Promise<void> {
    return enqueue(async () => {
        if (useFirestore()) await deleteDoc(doc(db!, `users/${uid()}/vocabulary/${id}`));
        else writeLocal(readLocal().filter(w => w.id !== id));
    });
}

export function updateSrs(id: string, srs: SrsState): Promise<void> {
    return enqueue(async () => {
        if (useFirestore()) {
            await setDoc(doc(db!, `users/${uid()}/vocabulary/${id}`), { srs }, { merge: true });
        } else {
            writeLocal(readLocal().map(w => (w.id === id ? { ...w, srs } : w)));
        }
    });
}

export interface LessonRecord {
    id: string;
    title: string;
    persona: string;
    nativeLanguage: string;
    learnLanguage: string;
    createdAt: number;
    updatedAt: number;
    thumbnailDataUrl?: string;
    turns: { role: LensTurn['role']; text: string; cardIndex?: number }[];
    cards: VocabCard[];
}

/** Best-effort save of a lesson transcript (Firestore only). */
export function saveLesson(lesson: LessonRecord): Promise<void> {
    if (!useFirestore()) return Promise.resolve();
    return enqueue(async () => {
        const clean = JSON.parse(JSON.stringify(lesson));
        await setDoc(doc(db!, `users/${uid()}/lessons/${lesson.id}`), clean);
    }).catch(err => console.warn('[GLOSSOS-VOCAB] Lesson not saved:', err));
}
