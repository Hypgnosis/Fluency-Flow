/**
 * Turn review: after each spoken exchange, a fast text model reviews it and returns structured JSON
 * (mistakes, mistakes now fixed, new words, a phrase card). The review skills then act on it.
 *
 * Why not Live tools: in testing, gemini-2.5-flash-native-audio became unreliable when several tools
 * were declared (it spoke control tokens instead of audio, or looped on calls). A separate structured
 * pass is reliable and never disturbs the voice. It mirrors Gallery's language teacher, where one
 * pass speaks and a second pass extracts the vocabulary card.
 */

import { FAST_MODELS, generateWithFallback, lowLatencyThinking } from '../genaiClient';
import { normalizeForMatch } from '../speechMatch';

export interface ReviewWants {
    mistakes: boolean;
    fixed: boolean;
    words: boolean;
    card: boolean;
}

export interface TurnReview {
    mistakes: { incorrect: string; correct: string; category: string; explanation: string }[];
    fixed: string[];
    new_words: { word: string; meaning: string; example: string; example_translation: string }[];
    phrase_card: { title: string; rows: { target: string; native: string }[]; tip?: string } | null;
}

export interface ReviewInput {
    learnerText: string;
    tutorText: string;
    nativeLanguage: string;
    learnLanguage: string;
    level: string;
    /** Unresolved mistakes from the learner profile. */
    profileMistakes: { incorrect: string; correct: string }[];
    /** Words already saved or taught this session. */
    knownWords: string[];
    /** Titles of phrase cards already shown this session. */
    shownCards: string[];
    wants: ReviewWants;
}

export const EMPTY_REVIEW: TurnReview = { mistakes: [], fixed: [], new_words: [], phrase_card: null };

const quoteList = (items: string[]) => (items.length ? items.map(i => `"${i}"`).join(', ') : '(none)');

export function buildReviewPrompt(input: ReviewInput): string {
    const { learnerText, tutorText, nativeLanguage: native, learnLanguage: learn, level, wants } = input;
    const parts = [
        `You are reviewing one exchange from a spoken ${learn} lesson for a ${level} learner whose native language is ${native}.`,
        "The learner's words are a speech-recognition transcript: ignore punctuation, capitalization, missing accent marks and obvious recognition errors.",
        '',
        `LEARNER said: "${learnerText}"`,
        `TUTOR replied: "${tutorText}"`,
        '',
        'Return JSON with these keys:',
    ];
    if (wants.mistakes) {
        parts.push(`- "mistakes": clear grammar or word-choice mistakes in the LEARNER's ${learn} (never the tutor's). For each: "incorrect" (the learner's phrase), "correct" (the corrected ${learn} phrase), "category" ("grammar" or "vocabulary"), "explanation" (at most 12 words, in ${native}). Empty if there are none or the learner spoke ${native}.`);
    }
    if (wants.fixed) {
        const past = input.profileMistakes.length
            ? input.profileMistakes.map((m, i) => `${i + 1}. wrong: "${m.incorrect}" | right: "${m.correct}"`).join('\n')
            : '(none)';
        parts.push(`- "fixed": the numbers of the learner's past mistakes (below) whose RIGHT version the LEARNER just used correctly in what they said. Empty if none.\n  Past mistakes:\n${past}`);
    }
    if (wants.words) {
        parts.push(`- "new_words": at most 1 ${learn} word or short phrase that the TUTOR explicitly taught in this reply (asked the learner to say it, or explained its meaning) and that is new for this learner (skip these: ${quoteList(input.knownWords)}). Do not include words merely used in passing. Use dictionary form: infinitive for verbs, masculine singular for adjectives, and the article for nouns where ${learn} has one. Each: "word", "meaning" (in ${native}), "example" (a short ${learn} sentence), "example_translation" (in ${native}). Empty if nothing was explicitly taught.`);
    }
    if (wants.card) {
        parts.push(`- "phrase_card": only if the TUTOR just set up a NEW role-play or real-world scenario (ordering food, asking directions, at the doctor...): an object with "title" (in ${native}), "rows" (3-6 key ${learn} phrases, each with "target" and "native"), and "tip" (one short line in ${native}, optional). Otherwise null. Already shown: ${quoteList(input.shownCards)}.`);
    }
    return parts.join('\n');
}

export function buildReviewSchema(wants: ReviewWants): Record<string, unknown> {
    const S = { type: 'STRING' };
    const properties: Record<string, unknown> = {};
    if (wants.mistakes) {
        properties.mistakes = {
            type: 'ARRAY',
            items: {
                type: 'OBJECT',
                properties: { incorrect: S, correct: S, category: { type: 'STRING', enum: ['grammar', 'vocabulary'] }, explanation: S },
                required: ['incorrect', 'correct', 'category'],
            },
        };
    }
    if (wants.fixed) properties.fixed = { type: 'ARRAY', items: { type: 'INTEGER' } };
    if (wants.words) {
        properties.new_words = {
            type: 'ARRAY',
            items: {
                type: 'OBJECT',
                properties: { word: S, meaning: S, example: S, example_translation: S },
                required: ['word', 'meaning'],
            },
        };
    }
    if (wants.card) {
        properties.phrase_card = {
            type: 'OBJECT',
            nullable: true,
            properties: {
                title: S,
                rows: { type: 'ARRAY', items: { type: 'OBJECT', properties: { target: S, native: S }, required: ['target', 'native'] } },
                tip: S,
            },
            required: ['title', 'rows'],
        };
    }
    return { type: 'OBJECT', properties, required: Object.keys(properties) };
}

/**
 * Deterministic check: the learner said the corrected phrase and not the wrong one.
 * Catches exact-phrase fixes even when the model misses them.
 */
export function detectFixedLocally(learnerText: string, profile: ReviewInput['profileMistakes']): string[] {
    const said = ` ${normalizeForMatch(learnerText)} `;
    return profile
        .filter(m => {
            const right = normalizeForMatch(m.correct);
            const wrong = normalizeForMatch(m.incorrect);
            const specific = right.includes(' ') || right.length >= 6; // avoid matching tiny words by chance
            return specific && right !== wrong && said.includes(` ${right} `) && !said.includes(` ${wrong} `);
        })
        .map(m => m.incorrect);
}

/**
 * Parses the model output, dropping anything malformed. `profile` maps "fixed" numbers
 * (1-based) back to the incorrect forms.
 */
export function parseReview(raw: string, profile: ReviewInput['profileMistakes'] = []): TurnReview {
    let obj: any;
    try {
        obj = JSON.parse(raw.replace(/^\s*```(?:json)?\s*/i, '').replace(/```\s*$/, ''));
    } catch {
        return EMPTY_REVIEW;
    }
    if (!obj || typeof obj !== 'object') return EMPTY_REVIEW;
    const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
    const arr = (v: unknown) => (Array.isArray(v) ? v : []);
    const card = obj.phrase_card && typeof obj.phrase_card === 'object' ? obj.phrase_card : null;
    const rows = card ? arr(card.rows).map((r: any) => ({ target: s(r?.target), native: s(r?.native) })).filter(r => r.target) : [];
    return {
        mistakes: arr(obj.mistakes)
            .map((m: any) => ({ incorrect: s(m?.incorrect), correct: s(m?.correct), category: s(m?.category) || 'grammar', explanation: s(m?.explanation) }))
            .filter(m => m.incorrect && m.correct && m.incorrect.toLowerCase() !== m.correct.toLowerCase()),
        fixed: arr(obj.fixed)
            .map((f: unknown) => (typeof f === 'number' ? profile[f - 1]?.incorrect ?? '' : s(f)))
            .filter(Boolean),
        new_words: arr(obj.new_words)
            .map((w: any) => ({ word: s(w?.word), meaning: s(w?.meaning), example: s(w?.example), example_translation: s(w?.example_translation) }))
            .filter(w => w.word && w.meaning)
            .slice(0, 1),
        phrase_card: card && s(card.title) && rows.length ? { title: s(card.title), rows: rows.slice(0, 6), tip: s(card.tip) || undefined } : null,
    };
}

export async function reviewTurn(
    input: ReviewInput,
    generate: typeof generateWithFallback = generateWithFallback,
): Promise<TurnReview> {
    const { wants } = input;
    if (!wants.mistakes && !wants.fixed && !wants.words && !wants.card) return EMPTY_REVIEW;
    const raw = await generate(FAST_MODELS, model => ({
        model,
        contents: [{ role: 'user', parts: [{ text: buildReviewPrompt(input) }] }],
        generationConfig: {
            temperature: 0,
            maxOutputTokens: 1024,
            responseMimeType: 'application/json',
            responseSchema: buildReviewSchema(wants),
            thinkingConfig: lowLatencyThinking(model),
        },
        timeoutMs: 20_000,
    }));
    const review = parseReview(raw, input.profileMistakes);
    // Only accept "fixed" items that really are in the profile, plus exact-phrase fixes found locally.
    const profile = new Set(input.profileMistakes.map(m => m.incorrect.toLowerCase()));
    const fixed = [...review.fixed, ...(wants.fixed ? detectFixedLocally(input.learnerText, input.profileMistakes) : [])]
        .filter(f => profile.has(f.toLowerCase()));
    return { ...review, fixed: [...new Set(fixed)] };
}
