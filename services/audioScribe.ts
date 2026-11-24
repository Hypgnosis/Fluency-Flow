/**
 * Audio Scribe: transcribe and translate a short audio clip, and pull out words worth learning.
 * Glossos version of Google AI Edge Gallery's Audio Scribe (llm_ask_audio). Gallery sends a
 * ≤30 s 16 kHz mono WAV clip to Gemma; here the clip goes to Gemini in two steps: a verbatim
 * transcript first, then translation, words and corrections from that text.
 */

import { FALLBACK_MODEL, FAST_MODELS, generateWithFallback, lowLatencyThinking } from './genaiClient';
import { encode, encodeWAV, pcmTo16kInt16 } from '../utils/audioUtils';
import type { VocabCard } from '../types/lens';

/** Longest clip we send (Gallery allows 30 s; 60 s keeps the request well under the 6 MB limit). */
export const MAX_CLIP_SECONDS = 60;
const TARGET_RATE = 16_000;

export interface ScribeCorrection {
    incorrect: string;
    correct: string;
    explanation: string;
}

export interface ScribeResult {
    detectedLanguage: string;
    transcript: string;
    translation: string;
    words: VocabCard[];
    /** Mistakes in what was said (useful when learners record themselves). */
    corrections: ScribeCorrection[];
}

/** Downmixes to mono, resamples to 16 kHz and trims to the clip limit. */
export function toMono16k(channels: Float32Array[], sampleRate: number, maxSeconds = MAX_CLIP_SECONDS): Float32Array {
    const length = channels[0]?.length ?? 0;
    const mono = new Float32Array(length);
    for (const ch of channels) for (let i = 0; i < length; i++) mono[i] += ch[i] / channels.length;
    const int16 = pcmTo16kInt16(mono, sampleRate);
    const limit = Math.min(int16.length, maxSeconds * TARGET_RATE);
    const out = new Float32Array(limit);
    for (let i = 0; i < limit; i++) out[i] = int16[i] / 0x8000;
    return out;
}

/** Decodes any browser-supported audio file into a 16 kHz mono WAV blob. */
export async function fileToWav(file: Blob): Promise<{ wav: Blob; seconds: number; trimmed: boolean }> {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    const ctx: AudioContext = new Ctx();
    try {
        const buffer = await ctx.decodeAudioData(await file.arrayBuffer());
        const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
        const samples = toMono16k(channels, buffer.sampleRate);
        return { wav: encodeWAV(samples, TARGET_RATE, 1), seconds: samples.length / TARGET_RATE, trimmed: buffer.duration > MAX_CLIP_SECONDS };
    } finally {
        ctx.close().catch(() => undefined);
    }
}

/**
 * Step 1 models: a dedicated transcription model first (verbatim, fast), then a general model with a
 * strict verbatim prompt. In testing, asking for transcript + translation in one request made models
 * silently "fix" the speaker's grammar ("yo va" became "yo iba"); transcription alone stays faithful.
 */
export const TRANSCRIBE_MODELS = ['gemini-3.5-transcribe', FALLBACK_MODEL];

export const VERBATIM_PROMPT = 'Transcribe this audio verbatim, word for word, in the original language, with punctuation. '
    + 'Do not correct grammar or word choice, even if the speaker makes mistakes. Mark unclear words as [inaudible]. '
    + 'If there is no speech, reply with nothing.';

export function buildAnalysisPrompt(transcript: string, nativeLanguage: string, learnLanguage: string, level: string): string {
    return [
        `This is a verbatim transcript of an audio clip, for a ${level.toLowerCase()} learner of ${learnLanguage} whose native language is ${nativeLanguage}.`,
        `Transcript: """${transcript}"""`,
        'Return JSON with:',
        '- "detected_language": the main language of the transcript (English name).',
        `- "translation": a natural translation into ${nativeLanguage} (if the transcript is already in ${nativeLanguage}, translate it into ${learnLanguage}).`,
        `- "words": up to 5 useful ${learnLanguage} words or short phrases from the transcript for this learner, each with "word" (dictionary form, nouns with their article), "meaning" (in ${nativeLanguage}), "example" (the sentence from the transcript that uses it, corrected if it had a mistake) and "example_translation" (in ${nativeLanguage}). Empty if the transcript has no ${learnLanguage}.`,
        `- "corrections": clear grammar or word-choice mistakes in the ${learnLanguage} that was spoken, each with "incorrect" (as said), "correct" and "explanation" (at most 12 words, in ${nativeLanguage}). Empty if there are none.`,
    ].join('\n');
}

const S = { type: 'STRING' } as const;
export const ANALYSIS_SCHEMA = {
    type: 'OBJECT',
    properties: {
        detected_language: S,
        translation: S,
        words: {
            type: 'ARRAY',
            items: { type: 'OBJECT', properties: { word: S, meaning: S, example: S, example_translation: S }, required: ['word', 'meaning'] },
        },
        corrections: {
            type: 'ARRAY',
            items: { type: 'OBJECT', properties: { incorrect: S, correct: S, explanation: S }, required: ['incorrect', 'correct'] },
        },
    },
    required: ['detected_language', 'translation', 'words', 'corrections'],
} as const;

export function parseAnalysis(raw: string, transcript: string): ScribeResult {
    let obj: any = {};
    try {
        obj = JSON.parse(raw.replace(/^\s*```(?:json)?\s*/i, '').replace(/```\s*$/, ''));
    } catch {
        throw new Error('The transcription came back in an unexpected format. Please try again.');
    }
    const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
    return {
        detectedLanguage: s(obj.detected_language),
        transcript,
        translation: s(obj.translation),
        words: (Array.isArray(obj.words) ? obj.words : [])
            .map((w: any) => ({ word: s(w?.word), meaning: s(w?.meaning), example: s(w?.example), exampleTranslation: s(w?.example_translation) }))
            .filter((w: VocabCard) => w.word && w.meaning)
            .slice(0, 5),
        corrections: (Array.isArray(obj.corrections) ? obj.corrections : [])
            .map((c: any) => ({ incorrect: s(c?.incorrect), correct: s(c?.correct), explanation: s(c?.explanation) }))
            .filter((c: ScribeCorrection) => c.incorrect && c.correct && c.incorrect.toLowerCase() !== c.correct.toLowerCase())
            .slice(0, 5),
    };
}

export async function transcribeClip(opts: {
    wav: Blob;
    nativeLanguage: string;
    learnLanguage: string;
    level: string;
    signal?: AbortSignal;
}): Promise<ScribeResult> {
    const data = encode(new Uint8Array(await opts.wav.arrayBuffer()));

    // Step 1: verbatim transcript.
    const transcript = (await generateWithFallback(TRANSCRIBE_MODELS, model => ({
        model,
        contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'audio/wav', data } }, { text: VERBATIM_PROMPT }] }],
        generationConfig: {
            temperature: 0,
            maxOutputTokens: 2048,
            ...(/^gemini-2\.5/.test(model) ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
        },
        signal: opts.signal,
        timeoutMs: 30_000,
    }))).trim();
    if (!transcript) return { detectedLanguage: '', transcript: '', translation: '', words: [], corrections: [] };

    // Step 2: translation, words and corrections from the transcript text.
    const raw = await generateWithFallback(FAST_MODELS, model => ({
        model,
        contents: [{ role: 'user', parts: [{ text: buildAnalysisPrompt(transcript, opts.nativeLanguage, opts.learnLanguage, opts.level) }] }],
        generationConfig: {
            temperature: 0,
            maxOutputTokens: 2048,
            responseMimeType: 'application/json',
            responseSchema: ANALYSIS_SCHEMA,
            thinkingConfig: lowLatencyThinking(model),
        },
        signal: opts.signal,
        timeoutMs: 20_000,
    }));
    return parseAnalysis(raw, transcript);
}
