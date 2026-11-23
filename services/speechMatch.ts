/**
 * Lenient matching of a speech-recognition transcript against a vocabulary word.
 * Simplified port of Google AI Edge Gallery's XrLanguageTeacherSpeechMatcher.kt (Apache License 2.0).
 */

/** NFKC, accent folding, katakana→hiragana, lowercase, punctuation→space. */
export function normalizeForMatch(text: string): string {
    return text
        .normalize('NFKC')
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .normalize('NFC')
        .replace(/[ァ-ヶ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60))
        .toLocaleLowerCase()
        .replace(/[\p{P}\p{S}]+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

const SPACELESS_SCRIPT = /[぀-ヿ㐀-鿿฀-๿]/;
const JAPANESE_PARTICLES = /(は|が|を|に|へ|で|と|も|の|です|だ)/g;
const LEADING_ARTICLE = /^(el|la|los|las|un|una|le|les|une|der|die|das|ein|eine|il|lo|gli|o|a|os|as|the|an)\s+/;

function levenshtein(a: string[], b: string[]): number {
    const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        let diag = prev[0];
        prev[0] = i;
        for (let j = 1; j <= b.length; j++) {
            const tmp = prev[j];
            prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
            diag = tmp;
        }
    }
    return prev[b.length];
}

const chars = (s: string) => Array.from(s);

function targetForms(target: string): string[] {
    const forms = target
        .replace(/\([^)]*\)/g, ' ')
        .split(/[/•·,;—–]/)
        .map(normalizeForMatch)
        .filter(Boolean);
    const withoutArticles = forms.map(f => f.replace(LEADING_ARTICLE, '')).filter(f => f && !forms.includes(f));
    return [...forms, ...withoutArticles];
}

function matchesSpaceless(transcript: string, form: string): boolean {
    const t = transcript.replace(/\s/g, '');
    const f = form.replace(/\s/g, '');
    if (t.includes(f) || t.replace(JAPANESE_PARTICLES, '').includes(f.replace(JAPANESE_PARTICLES, ''))) return true;
    const threshold = f.length >= 6 ? 2 : f.length >= 3 ? 1 : 0;
    if (threshold === 0) return false;
    const tc = chars(t);
    const fc = chars(f);
    for (let len = fc.length - threshold; len <= fc.length + threshold; len++) {
        for (let i = 0; len > 0 && i + len <= tc.length; i++) {
            if (levenshtein(tc.slice(i, i + len), fc) <= threshold) return true;
        }
    }
    return false;
}

function tokenThreshold(length: number): number {
    return length >= 7 ? 2 : length >= 4 ? 1 : 0;
}

function matchesSpaced(transcript: string, form: string): boolean {
    const tokens = transcript.split(' ').filter(Boolean);
    const formTokens = form.split(' ').filter(Boolean);
    const n = formTokens.length;
    const formChars = chars(formTokens.join(' '));
    const threshold = tokenThreshold(formChars.length);
    for (let i = 0; i + n <= tokens.length; i++) {
        if (levenshtein(chars(tokens.slice(i, i + n).join(' ')), formChars) <= threshold) return true;
    }
    return false;
}

/** Whether the spoken `transcript` contains `target` (a word or short phrase). */
export function matchesSpokenWord(transcript: string, target: string): boolean {
    const t = normalizeForMatch(transcript);
    if (!t) return false;
    return targetForms(target).some(form =>
        SPACELESS_SCRIPT.test(form) ? matchesSpaceless(t, form) : matchesSpaced(t, form));
}
