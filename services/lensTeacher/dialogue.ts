/**
 * Parsing for Lens Teacher replies and vocabulary cards.
 *
 * Ported from Google AI Edge Gallery (Apache License 2.0):
 * models/XrLanguageTeacherDialogueFormatter.kt, XrLanguageTeacherVocabCardSanitizer.kt and
 * XrLanguageTeacherCardDecision.kt in customtasks/xrlanguageteacher.
 *
 * Teacher replies use a small tag protocol: the whole answer sits in <reply>...</reply>, and every
 * word or sentence in the language being learned is wrapped in <target>...</target>.
 */

import type { DialogueSegment, Pass2Decision, VocabCard } from '../../types/lens';

const TARGET_TAG = /<(\/?)target>/gi;

/** Splits unclosed <target>…<target> pairs, drops stray closing tags and closes a trailing open tag. */
export function balanceTargets(text: string): string {
    let out = '';
    let open = false;
    let last = 0;
    for (const m of text.matchAll(TARGET_TAG)) {
        out += text.slice(last, m.index);
        last = (m.index ?? 0) + m[0].length;
        if (m[1] === '/') {
            if (open) {
                out += '</target>';
                open = false;
            }
        } else {
            if (open) out += '</target>';
            out += '<target>';
            open = true;
        }
    }
    out += text.slice(last);
    if (open) out += '</target>';
    return out;
}

/**
 * Turns the raw (possibly partial) model stream into the reply text shown and spoken so far,
 * keeping only <target> tags.
 */
export function extractStreamingReply(raw: string): string {
    const text = raw.replace(/^\s*```[a-z]*\s*/i, '').replace(/```\s*$/, '');

    // Nothing to show while the stream is still only a prefix of "<reply>".
    const lead = text.trimStart().toLowerCase();
    if (lead.length > 0 && lead.length < 7 && '<reply>'.startsWith(lead)) return '';

    const openMatch = /<reply>/i.exec(text);
    let body = openMatch ? text.slice(openMatch.index + openMatch[0].length) : text;

    const end = body.search(/<\/reply>|<card/i);
    if (end >= 0) body = body.slice(0, end);

    // Drop a partial trailing tag such as "<tar" or "</re".
    const lt = body.lastIndexOf('<');
    if (lt >= 0 && body.indexOf('>', lt) === -1) body = body.slice(0, lt);

    body = body.replace(/<(\/?)say>/gi, '<$1target>');
    body = body.replace(/<(?!\/?target>)[^>]*>/gi, '');
    return balanceTargets(body).trimStart();
}

export function isReplyComplete(raw: string): boolean {
    return /<\/reply>/i.test(raw);
}

function targetDepth(text: string): number {
    let depth = 0;
    for (const m of text.matchAll(TARGET_TAG)) depth = m[1] === '/' ? Math.max(0, depth - 1) : depth + 1;
    return depth;
}

const ABBREVIATION_END = /(?:^|[\s(>])(?:prof|mr|mrs|ms|dr|st|jr|sr|vs|etc)\.$/i;

/**
 * Finds sentences in `text` that are complete after offset `from`, so they can be spoken while the
 * rest of the reply is still streaming. Returns the sentences and the offset to resume from.
 */
export function extractCompleteSentences(text: string, from = 0): { sentences: string[]; next: number } {
    const boundary = /(?:[.!?](?:<\/(?:target|say)>)?\s+|[。！？](?:<\/(?:target|say)>)?\s*)/g;
    boundary.lastIndex = from;
    const sentences: string[] = [];
    let start = from;
    let m: RegExpExecArray | null;
    while ((m = boundary.exec(text))) {
        const end = m.index + m[0].length;
        if (targetDepth(text.slice(0, end)) > 0) continue;
        const candidate = text.slice(start, m.index + 1).replace(/<[^>]+>/g, '');
        if (ABBREVIATION_END.test(candidate.trim())) continue;
        const sentence = text.slice(start, end).trim();
        if (sentence) sentences.push(sentence);
        start = end;
    }
    return { sentences, next: start };
}

/** Removes emoji and markdown so text can be spoken or shown plainly. */
export function cleanForSpeech(text: string): string {
    return text
        .replace(/\p{Extended_Pictographic}️?/gu, '')
        .replace(/[*_`#~]+/g, '')
        .replace(/\s+/g, ' ');
}

/** Splits a tagged reply into segments spoken in the native language or the target language. */
export function parseDialogueSegments(text: string): DialogueSegment[] {
    const segments: DialogueSegment[] = [];
    const source = balanceTargets(text);
    let last = 0;
    for (const m of source.matchAll(/<target>([\s\S]*?)<\/target>/gi)) {
        segments.push({ text: source.slice(last, m.index), isTargetLanguage: false });
        segments.push({ text: m[1], isTargetLanguage: true });
        last = (m.index ?? 0) + m[0].length;
    }
    segments.push({ text: source.slice(last), isTargetLanguage: false });

    // "manzana! Say …": move punctuation that starts a segment back onto the previous one.
    for (let i = 1; i < segments.length; i++) {
        const lead = /^\s*([!?.,;:…。！？、，]+)/.exec(segments[i].text);
        if (lead) {
            segments[i - 1].text = segments[i - 1].text.trimEnd() + lead[1];
            segments[i].text = segments[i].text.slice(lead[0].length);
        }
    }

    return segments
        .map(s => ({ ...s, text: cleanForSpeech(s.text).trim() }))
        .filter(s => /[\p{L}\p{N}]/u.test(s.text));
}

export function stripTags(text: string): string {
    return text.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

export function targetSpans(text: string): string[] {
    return [...balanceTargets(text).matchAll(/<target>([\s\S]*?)<\/target>/gi)]
        .map(m => m[1].trim())
        .filter(Boolean);
}

/** Wraps untagged occurrences of `word` in <target> so they are spoken in the target language. */
export function tagCardWord(text: string, word: string): string {
    const w = word.trim();
    if (!w) return text;
    const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Split on existing target spans so we never nest tags.
    return balanceTargets(text)
        .split(/(<target>[\s\S]*?<\/target>)/gi)
        .map(part => (part.toLowerCase().startsWith('<target>')
            ? part
            : part.replace(new RegExp(`(^|[^\\p{L}])(${escaped})(?![\\p{L}])`, 'giu'), '$1<target>$2</target>')))
        .join('');
}

// ─── Vocabulary words ─────────────────────────────────────────────────────

const EDGE_LEAD = /^[\s¡¿"'“”‘’«»「」『』()[\].,;:!?…。！？、，-]+/;
const EDGE_TRAIL = /[\s"'“”‘’«»「」『』()[\].,;:!?…。！？、，-]+$/;
const LEADING_ARTICLE = /^(el|la|los|las|un|una|unos|unas|le|les|une|des|der|die|das|ein|eine|the|a|an)\s+/i;

function normalizeWord(word: string): string {
    return stripTags(word).replace(EDGE_LEAD, '').replace(EDGE_TRAIL, '').toLocaleLowerCase();
}

/** Whether two vocabulary words are the same, ignoring case, punctuation and a leading article. */
export function isSameVocabularyWord(a: string, b: string): boolean {
    const na = normalizeWord(a);
    const nb = normalizeWord(b);
    if (!na || !nb) return false;
    if (na === nb) return true;
    return na.replace(LEADING_ARTICLE, '') === nb.replace(LEADING_ARTICLE, '');
}

/** Decides whether a reply needs a new card, reuses a card from this lesson, or has none. */
export function decidePass2Card(replyWithTags: string, sessionCards: VocabCard[]): Pass2Decision {
    const spans = targetSpans(replyWithTags);
    if (spans.length === 0) return { kind: 'skip' };
    let firstMatch = -1;
    for (const span of spans) {
        const idx = sessionCards.findIndex(card => isSameVocabularyWord(span, card.word));
        if (idx === -1) return { kind: 'extract' };
        if (firstMatch === -1) firstMatch = idx;
    }
    return { kind: 'reuse', cardIndex: firstMatch };
}

function tryParseObject(text: string): Record<string, unknown> | null {
    try {
        const value = JSON.parse(text);
        return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
    } catch {
        return null;
    }
}

/** Parses the Pass 2 JSON output into a card, or null when it is unusable. */
export function parsePass2Output(raw: string): VocabCard | null {
    const text = raw
        .replace(/<0x[0-9a-f]{2}>/gi, '')
        .replace(/^\s*```(?:json)?\s*/i, '')
        .replace(/```\s*$/, '')
        .trim();
    const obj = tryParseObject(text)
        ?? (text.includes('{') ? tryParseObject(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) : null);
    if (!obj) return null;

    const str = (v: unknown) => (typeof v === 'string' ? v : '');
    const card: VocabCard = {
        word: str(obj.word),
        meaning: str(obj.meaning),
        example: str(obj.example),
        exampleTranslation: str(obj.example_translation ?? obj.exampleTranslation),
    };

    // The model sometimes echoes the field names or labels instead of values.
    const echo = /^(word|meaning|example|example_translation|translation)\s*(:|$)/i;
    if (Object.values(card).filter(v => echo.test(v.trim())).length >= 2) return null;
    if (!card.word.trim() || (!card.meaning.trim() && !card.exampleTranslation.trim())) return null;
    return card;
}

const WRAPPING_PAIRS: [string, string][] = [
    ['"', '"'], ['“', '”'], ['‘', '’'], ["'", "'"], ['«', '»'], ['「', '」'], ['『', '』'], ['(', ')'], ['[', ']'],
];

function unwrapPairs(text: string): string {
    let t = text.trim();
    let changed = true;
    while (changed && t.length >= 2) {
        changed = false;
        for (const [open, close] of WRAPPING_PAIRS) {
            if (t.startsWith(open) && t.endsWith(close) && !t.slice(1, -1).includes(close)) {
                t = t.slice(open.length, t.length - close.length).trim();
                changed = true;
            }
        }
    }
    return t;
}

function cleanWord(word: string): string {
    let t = unwrapPairs(stripTags(word));
    const spanishPair = (t.startsWith('¡') && t.endsWith('!')) || (t.startsWith('¿') && t.endsWith('?'));
    if (!spanishPair) t = t.replace(/^[\s.,;:…、，-]+/, '').replace(/[\s.,;:…、，。！？.!?-]+$/, '');
    return unwrapPairs(t);
}

/** Cleans a Pass 2 card (tags, stray punctuation, empty fields, sentence-as-word). */
export function sanitizeVocabCard(card: VocabCard, replyWithTags: string): VocabCard {
    let word = cleanWord(card.word);
    let example = unwrapPairs(stripTags(card.example));
    let meaning = unwrapPairs(stripTags(card.meaning)).replace(/[.!?。！？]+$/, '').trim();
    let exampleTranslation = unwrapPairs(stripTags(card.exampleTranslation));

    if (!meaning) meaning = exampleTranslation;
    if (!exampleTranslation) exampleTranslation = meaning;

    // If the model returned a whole phrase, prefer the longest shorter <target> span inside it.
    const nWord = normalizeWord(word);
    const inner = targetSpans(replyWithTags)
        .map(cleanWord)
        .filter(span => {
            const n = normalizeWord(span);
            return n && n.length < nWord.length && nWord.includes(n);
        })
        .sort((a, b) => b.length - a.length);
    if (inner.length) {
        if (!example) example = word;
        word = inner[0];
    }

    return { word, meaning, example, exampleTranslation };
}
