/**
 * Read-aloud for text-chat replies (Gallery's chat TTS). Tutor replies are written in the target
 * language with native-language explanations in [square brackets]; each part is spoken with a
 * matching voice. Markdown, emoji and code are not read out.
 */

import type { SpeechSegment } from './speech';

export function cleanForReading(text: string): string {
    return text
        .replace(/```[\s\S]*?```/g, ' ')              // code blocks
        .replace(/^\s*\|.*\|\s*$/gm, ' ')             // table rows
        .replace(/^\s*[-*•]\s+|^\s*\d+[.)]\s+/gm, '')  // list markers
        .replace(/^#{1,6}\s+/gm, '')                   // headings
        .replace(/[*_`~]+/g, '')                       // emphasis
        .replace(/\p{Extended_Pictographic}️?/gu, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/** Splits a reply into target-language parts and [native-language] parts. */
export function replySegments(text: string, learnLocale: string, nativeLocale: string): SpeechSegment[] {
    const clean = cleanForReading(text);
    const segments: SpeechSegment[] = [];
    let last = 0;
    for (const m of clean.matchAll(/\[([^\]]+)\]/g)) {
        const before = clean.slice(last, m.index).trim();
        if (before) segments.push({ text: before, locale: learnLocale });
        const inner = m[1].replace(/^(in [a-z]+|en [a-záéíóú]+)\s*:\s*/i, '').trim();
        if (inner) segments.push({ text: inner, locale: nativeLocale });
        last = (m.index ?? 0) + m[0].length;
    }
    const rest = clean.slice(last).trim();
    if (rest) segments.push({ text: rest, locale: learnLocale });
    return segments.filter(s => /[\p{L}\p{N}]/u.test(s.text));
}
