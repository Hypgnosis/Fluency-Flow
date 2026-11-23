/**
 * Model calls for Lens Teacher.
 *
 * Same two-pass design as Google AI Edge Gallery's XR Language Teacher:
 * - Pass 1 streams the spoken reply (<reply> with <target> spans) for the photo and question.
 * - Pass 2 is a separate text-only call that turns that reply into one JSON vocabulary card.
 *
 * Gemini is stateless, so the caller keeps the lesson's `history` (the photo stays in the first
 * user turn) and sends it with every request.
 */

import type { PersonaId, VocabCard } from '../../types/lens';
import {
    Content, FAST_MODELS, TEXT_MODELS, generateWithFallback, inlineImage, lowLatencyThinking, streamWithFallback,
} from '../genaiClient';
import { buildPass1Prompt, buildPass2Prompt, buildSystemPrompt, PASS2_RESPONSE_SCHEMA } from './prompts';
import { extractStreamingReply, parsePass2Output, sanitizeVocabCard } from './dialogue';

export interface TeacherSettings {
    persona: PersonaId;
    nativeLanguage: string;
    learnLanguage: string;
    level?: string;
}

export interface TeacherTurnRequest extends TeacherSettings {
    /** Lesson history so far (empty on the first turn). */
    history: Content[];
    /** JPEG data URL of the frozen camera frame. Required on the first turn. */
    imageDataUrl?: string;
    question?: string;
    /** The lesson's current card word, used to keep follow-ups on topic. */
    focalWord?: string;
    signal?: AbortSignal;
    /** Called with the reply-so-far (with <target> tags) as it streams. */
    onReply?: (replyWithTags: string) => void;
}

export interface TeacherTurnResult {
    replyWithTags: string;
    /** The user and model turns to append to the lesson history. */
    newHistory: Content[];
}

export async function runTeacherTurn(req: TeacherTurnRequest): Promise<TeacherTurnResult> {
    const isFollowUp = req.history.length > 0;
    const prompt = buildPass1Prompt({
        main: req.nativeLanguage,
        learn: req.learnLanguage,
        question: req.question,
        isFollowUp,
        focalWord: req.focalWord,
    });

    const userTurn: Content = {
        role: 'user',
        parts: !isFollowUp && req.imageDataUrl ? [inlineImage(req.imageDataUrl), { text: prompt }] : [{ text: prompt }],
    };

    let raw = '';
    let lastReply = '';
    // Falls back to the next model when one is overloaded before it starts streaming.
    for await (const chunk of streamWithFallback(TEXT_MODELS, model => ({
        model,
        systemInstruction: buildSystemPrompt(req.persona, req.nativeLanguage, req.learnLanguage, req.level),
        contents: [...req.history, userTurn],
        generationConfig: {
            temperature: 0.3,
            // Generous cap: on Gemini 3 models thinking tokens can count against it.
            maxOutputTokens: 1024,
            thinkingConfig: lowLatencyThinking(model),
        },
        signal: req.signal,
        timeoutMs: 25_000,
    }))) {
        raw += chunk;
        const reply = extractStreamingReply(raw);
        if (reply !== lastReply) {
            lastReply = reply;
            req.onReply?.(reply);
        }
    }

    const replyWithTags = extractStreamingReply(raw).trim();
    if (!replyWithTags) throw new Error('The teacher returned an empty reply.');
    return {
        replyWithTags,
        newHistory: [userTurn, { role: 'model', parts: [{ text: `<reply>${replyWithTags}</reply>` }] }],
    };
}

export async function extractVocabCard(opts: {
    nativeLanguage: string;
    learnLanguage: string;
    replyWithTags: string;
    question?: string;
    existingWords: string[];
    signal?: AbortSignal;
}): Promise<VocabCard | null> {
    const prompt = buildPass2Prompt({
        main: opts.nativeLanguage,
        learn: opts.learnLanguage,
        replyWithTags: opts.replyWithTags,
        question: opts.question,
        existingWords: opts.existingWords,
    });

    const attempt = async (withSchema: boolean) => {
        const raw = await generateWithFallback(FAST_MODELS, model => ({
            model,
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
                temperature: 0,
                maxOutputTokens: 512,
                responseMimeType: 'application/json',
                ...(withSchema ? { responseSchema: PASS2_RESPONSE_SCHEMA } : {}),
                thinkingConfig: lowLatencyThinking(model),
            },
            signal: opts.signal,
            timeoutMs: 20_000,
        }));
        const card = parsePass2Output(raw);
        return card ? sanitizeVocabCard(card, opts.replyWithTags) : null;
    };

    // Like Gallery: one constrained attempt, then one retry without the schema.
    try {
        const card = await attempt(true);
        if (card) return card;
    } catch (err) {
        if ((err as Error).name === 'AbortError') throw err;
    }
    return attempt(false);
}
