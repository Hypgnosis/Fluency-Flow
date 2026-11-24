/** Lens Teacher types (port of Google AI Edge Gallery's XR Language Teacher data model). */

export type PersonaId = 'buddy' | 'nerdy' | 'secret_agent' | 'wizard';

/** A vocabulary card produced by the Pass 2 extraction call. */
export interface VocabCard {
    word: string;
    meaning: string;
    example: string;
    exampleTranslation: string;
}

/** One text segment of a teacher reply, tagged with the language it should be spoken in. */
export interface DialogueSegment {
    text: string;
    isTargetLanguage: boolean;
}

export interface LensTurn {
    id: string;
    role: 'student' | 'teacher';
    /** Teacher turns keep their <target> tags; student turns are plain text. */
    text: string;
    /** Index into the lesson's card deck, when this teacher turn taught a card. */
    cardIndex?: number;
}

/** Spaced-repetition state (SM-2 style). */
export interface SrsState {
    reps: number;
    lapses: number;
    ease: number;
    intervalDays: number;
    due: number;
    lastReviewed?: number;
}

export interface SavedWord extends VocabCard {
    id: string;
    learnLanguage: string;
    nativeLanguage: string;
    imageDataUrl?: string;
    createdAt: number;
    srs: SrsState;
}

export type Pass2Decision =
    | { kind: 'skip' }
    | { kind: 'reuse'; cardIndex: number }
    | { kind: 'extract' };
