/**
 * Tutor Skills: Glossos version of Google AI Edge Gallery's Agent Skills.
 *
 * - "live" skills are Gemini Live function declarations the voice tutor calls mid-conversation
 *   (they must return information the tutor needs before it answers, e.g. Wikipedia).
 * - "review" skills act on a structured review of each finished exchange (turnReview.ts), so the
 *   voice model never has to juggle bookkeeping tools.
 */

import type { VocabCard } from '../../types/lens';

/** Something a skill shows in the conversation. */
export type SkillAttachment =
    | { kind: 'mistake'; incorrect: string; correct: string; category: string; explanation?: string }
    | { kind: 'fixed'; incorrect: string }
    | { kind: 'vocab'; card: VocabCard; learnLanguage: string; saved: boolean }
    | { kind: 'card'; title: string; rows: { target: string; native: string }[]; tip?: string }
    | { kind: 'wiki'; title: string; url: string; summary: string; lang: string };

/** Persistence used by skills (injected so skills are easy to test). */
export interface SkillServices {
    logMistake: (word: string, incorrect: string, correct: string, category: MistakeCategory, language: string) => Promise<boolean>;
    resolveMistakeByForm: (incorrect: string, language: string) => Promise<boolean>;
    saveVocab: (card: VocabCard, learnLanguage: string, nativeLanguage: string) => Promise<void>;
    fetchImpl?: typeof fetch;
}

export type MistakeCategory = 'grammar' | 'vocabulary' | 'pronunciation';

export interface SkillContext {
    nativeLanguage: string;
    learnLanguage: string;
    level: string;
    services: SkillServices;
}

export interface SkillResult {
    /** Sent back to the model as the function response. */
    response: Record<string, unknown>;
    attachment?: SkillAttachment;
}

export interface TutorSkill {
    /** Function name the model calls (snake_case). */
    name: string;
    /** Short label for the Skills panel. */
    title: string;
    /** One line for the Skills panel. */
    summary: string;
    /** Description for the model: what the tool does and exactly when to call it. */
    description: string;
    /** OpenAPI-subset JSON schema for the arguments. */
    parameters: Record<string, unknown>;
    /** "live": declared to the voice model as a function. "review": run from the turn review. */
    mode: 'live' | 'review';
    defaultEnabled: boolean;
    run: (args: Record<string, unknown>, ctx: SkillContext) => Promise<SkillResult>;
}

/** A function call from the Live API (`toolCall.functionCalls[]`). */
export interface LiveFunctionCall {
    id: string;
    name: string;
    args?: Record<string, unknown>;
}

/** A function response for the Live API (`toolResponse.functionResponses[]`). */
export interface LiveFunctionResponse {
    id: string;
    name: string;
    response: Record<string, unknown>;
}
