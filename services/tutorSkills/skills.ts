/** Built-in tutor skills. */

import type { MistakeCategory, TutorSkill } from './types';
import { normalizeWikiLang, queryWikipedia } from './wikipedia';
import { languageCode } from '../languages';

const str = (v: unknown, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const CATEGORIES: MistakeCategory[] = ['grammar', 'vocabulary', 'pronunciation'];

export const logMistakeSkill: TutorSkill = {
    name: 'log_mistake',
    title: 'Mistake memory',
    summary: 'Remembers your recurring mistakes so future lessons target them.',
    description: 'Record a clear mistake the learner made so later lessons can practice it.',
    parameters: {
        type: 'OBJECT',
        properties: {
            incorrect: { type: 'STRING', description: 'What the learner said, as said (short phrase).' },
            correct: { type: 'STRING', description: 'The corrected phrase in the target language.' },
            category: { type: 'STRING', enum: CATEGORIES, description: 'Type of mistake.' },
            explanation: { type: 'STRING', description: "Very short reason, in the learner's native language." },
        },
        required: ['incorrect', 'correct', 'category'],
    },
    mode: 'review',
    defaultEnabled: true,
    async run(args, ctx) {
        const incorrect = str(args.incorrect, 200);
        const correct = str(args.correct, 200);
        const category = (CATEGORIES.includes(args.category as MistakeCategory) ? args.category : 'grammar') as MistakeCategory;
        if (!incorrect || !correct) return { response: { error: 'incorrect and correct are required' } };
        const saved = await ctx.services.logMistake(correct, incorrect, correct, category, ctx.learnLanguage);
        return {
            response: { status: saved ? 'logged' : 'not_saved' },
            attachment: { kind: 'mistake', incorrect, correct, category, explanation: str(args.explanation, 200) || undefined },
        };
    },
};

export const markMistakeFixedSkill: TutorSkill = {
    name: 'mark_mistake_fixed',
    title: 'Progress tracking',
    summary: 'Clears a remembered mistake once you get it right on your own.',
    description: 'Mark a remembered mistake as fixed once the learner uses it correctly on their own.',
    parameters: {
        type: 'OBJECT',
        properties: {
            incorrect: { type: 'STRING', description: 'The incorrect form as listed in the learner profile.' },
        },
        required: ['incorrect'],
    },
    mode: 'review',
    defaultEnabled: true,
    async run(args, ctx) {
        const incorrect = str(args.incorrect, 200);
        if (!incorrect) return { response: { error: 'incorrect is required' } };
        const resolved = await ctx.services.resolveMistakeByForm(incorrect, ctx.learnLanguage);
        return {
            response: { status: resolved ? 'resolved' : 'not_found' },
            attachment: resolved ? { kind: 'fixed', incorrect } : undefined,
        };
    },
};

export const saveVocabularySkill: TutorSkill = {
    name: 'save_vocabulary',
    title: 'Save words',
    summary: 'Adds useful new words to your study deck (the same deck Lens uses).',
    description: "Save a useful new word the tutor taught to the learner's study deck.",
    parameters: {
        type: 'OBJECT',
        properties: {
            word: { type: 'STRING', description: 'The word or short phrase in the target language.' },
            meaning: { type: 'STRING', description: "Meaning in the learner's native language." },
            example: { type: 'STRING', description: 'A short natural example sentence in the target language.' },
            example_translation: { type: 'STRING', description: "The example translated into the learner's native language." },
        },
        required: ['word', 'meaning'],
    },
    mode: 'review',
    defaultEnabled: true,
    async run(args, ctx) {
        const card = {
            word: str(args.word, 80),
            meaning: str(args.meaning, 200),
            example: str(args.example, 300),
            exampleTranslation: str(args.example_translation, 300),
        };
        if (!card.word || !card.meaning) return { response: { error: 'word and meaning are required' } };
        let saved = true;
        try {
            await ctx.services.saveVocab(card, ctx.learnLanguage, ctx.nativeLanguage);
        } catch (err) {
            console.warn('[GLOSSOS-SKILLS] save_vocabulary failed:', err);
            saved = false;
        }
        return {
            response: { status: saved ? 'saved' : 'not_saved' },
            attachment: { kind: 'vocab', card, learnLanguage: ctx.learnLanguage, saved },
        };
    },
};

export const showCardSkill: TutorSkill = {
    name: 'show_card',
    title: 'Visual cards',
    summary: 'Shows on-screen cards: key phrases, conjugations, word lists.',
    description: 'Show the key phrases for a new role-play scenario as an on-screen card.',
    parameters: {
        type: 'OBJECT',
        properties: {
            title: { type: 'STRING', description: 'Short card title.' },
            rows: {
                type: 'ARRAY',
                description: 'Up to 8 rows.',
                items: {
                    type: 'OBJECT',
                    properties: {
                        target: { type: 'STRING', description: 'Target-language text.' },
                        native: { type: 'STRING', description: "Translation in the learner's native language." },
                    },
                    required: ['target', 'native'],
                },
            },
            tip: { type: 'STRING', description: "Optional one-line tip in the learner's native language." },
        },
        required: ['title', 'rows'],
    },
    mode: 'review',
    defaultEnabled: true,
    async run(args) {
        const rows = (Array.isArray(args.rows) ? args.rows : [])
            .map(r => ({ target: str((r as any)?.target, 120), native: str((r as any)?.native, 160) }))
            .filter(r => r.target)
            .slice(0, 8);
        const title = str(args.title, 80);
        if (!title || rows.length === 0) return { response: { error: 'title and at least one row are required' } };
        return {
            response: { status: 'shown' },
            attachment: { kind: 'card', title, rows, tip: str(args.tip, 200) || undefined },
        };
    },
};

export const lookupWikipediaSkill: TutorSkill = {
    name: 'lookup_wikipedia',
    title: 'Wikipedia',
    summary: 'Looks up real facts (people, places, culture, events) to talk about.',
    description:
        'Look up a factual topic on Wikipedia before talking about it, so you do not guess facts. '
        + 'topic: ONLY the primary entity, person, place or event (e.g. "Frida Kahlo", "Día de Muertos"); remove question '
        + 'words and details. lang: the 2-letter code of the language your topic is written in, preferably the target '
        + 'language. Then summarize the result in 1-3 short sentences at the learner\'s level. If the answer is not in the '
        + 'result, say so briefly and share a related fact that is.',
    parameters: {
        type: 'OBJECT',
        properties: {
            topic: { type: 'STRING', description: 'The main entity only.' },
            lang: { type: 'STRING', description: 'Two-letter Wikipedia language code, e.g. "es", "fr", "en".' },
        },
        required: ['topic'],
    },
    mode: 'live',
    defaultEnabled: true,
    async run(args, ctx) {
        const topic = str(args.topic, 120);
        if (!topic) return { response: { error: 'topic is required' } };
        const lang = normalizeWikiLang(args.lang || languageCode(ctx.learnLanguage));
        try {
            const result = await queryWikipedia(topic, lang, ctx.services.fetchImpl ?? fetch);
            if (!result) return { response: { result: `No Wikipedia article found for "${topic}".` } };
            return {
                response: { title: result.title, result: result.text },
                attachment: { kind: 'wiki', title: result.title, url: result.url, summary: result.extract.slice(0, 280), lang },
            };
        } catch (err) {
            return { response: { error: `Wikipedia is unavailable right now (${(err as Error).message}).` } };
        }
    },
};

export const BUILT_IN_SKILLS: TutorSkill[] = [
    logMistakeSkill,
    markMistakeFixedSkill,
    saveVocabularySkill,
    showCardSkill,
    lookupWikipediaSkill,
];
