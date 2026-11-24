/**
 * Browser speech: text-to-speech (speechSynthesis) and dictation (SpeechRecognition).
 *
 * Mirrors how Gallery's language teacher speaks: each reply is split into segments, host text is
 * spoken with a native-language voice and <target> spans with a target-language voice.
 */

import { naturalVoice } from './naturalVoice';
import { languageNameForLocale } from './languages';

export interface SpeechSegment {
    text: string;
    locale: string;
}

// ─── Text-to-speech ────────────────────────────────────────────────────────

function synth(): SpeechSynthesis | null {
    return typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;
}

export function isTtsSupported(): boolean {
    return synth() !== null || naturalVoice.available();
}

let cachedVoices: SpeechSynthesisVoice[] = [];
function voices(): SpeechSynthesisVoice[] {
    const s = synth();
    if (!s) return [];
    const list = s.getVoices();
    if (list.length) cachedVoices = list;
    return cachedVoices;
}
if (typeof window !== 'undefined' && synth()) {
    synth()!.addEventListener?.('voiceschanged', () => { cachedVoices = synth()!.getVoices(); });
}

const QUALITY_HINT = /natural|neural|google|premium|enhanced|siri/i;

/** Best available voice for a locale: exact tag first, then same language, preferring higher quality. */
export function pickVoice(locale: string): SpeechSynthesisVoice | undefined {
    const tag = locale.toLowerCase().replace('_', '-');
    const lang = tag.split('-')[0];
    const all = voices();
    const rank = (v: SpeechSynthesisVoice) => (QUALITY_HINT.test(v.name) ? 0 : 1) + (v.localService ? 0 : 0.5);
    const exact = all.filter(v => v.lang.toLowerCase().replace('_', '-') === tag).sort((a, b) => rank(a) - rank(b));
    if (exact.length) return exact[0];
    return all.filter(v => v.lang.toLowerCase().split(/[-_]/)[0] === lang).sort((a, b) => rank(a) - rank(b))[0];
}

export function hasVoiceFor(locale: string): boolean {
    return pickVoice(locale) !== undefined;
}

let speechRate = 1;
export function setSpeechRate(rate: number) {
    speechRate = rate;
}

/**
 * Speaks segments in order. Resolves when the last one ends (or speech is cancelled).
 * Uses the natural Gemini voice when it is on (one voice, native pronunciation in every language)
 * and the browser's voices otherwise or if the natural voice cannot start.
 */
export function speakSegments(segments: SpeechSegment[]): Promise<void> {
    if (naturalVoice.available()) {
        const spoken = segments.filter(s => s.text.trim());
        const text = spoken.map(s => s.text.trim()).join(' ');
        const locales = new Set(spoken.map(s => s.locale.toLowerCase().split(/[-_]/)[0]));
        const language = locales.size === 1 ? languageNameForLocale(spoken[0].locale) : undefined;
        return naturalVoice.say(text, language).catch(() => browserSpeakSegments(segments));
    }
    return browserSpeakSegments(segments);
}

/** The browser's built-in voices: one voice per language, switching at each segment. */
function browserSpeakSegments(segments: SpeechSegment[]): Promise<void> {
    const s = synth();
    const items = segments.filter(seg => seg.text.trim());
    if (!s || items.length === 0) return Promise.resolve();
    // Chrome can get stuck in a paused state after tab switches.
    if (s.paused) s.resume();
    return new Promise(resolve => {
        items.forEach((seg, i) => {
            const u = new SpeechSynthesisUtterance(seg.text);
            u.lang = seg.locale;
            const voice = pickVoice(seg.locale);
            if (voice) u.voice = voice;
            u.rate = speechRate;
            if (i === items.length - 1) {
                u.onend = () => resolve();
                u.onerror = () => resolve();
            }
            s.speak(u);
        });
    });
}

export function speak(text: string, locale: string): Promise<void> {
    return speakSegments([{ text, locale }]);
}

export function stopSpeaking() {
    naturalVoice.stop();
    synth()?.cancel();
}

export function isSpeaking(): boolean {
    return naturalVoice.isSpeaking() || (synth()?.speaking ?? false);
}

// ─── Dictation ─────────────────────────────────────────────────────────────

type RecognitionCtor = new () => any;

function recognitionCtor(): RecognitionCtor | null {
    if (typeof window === 'undefined') return null;
    return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;
}

export function isDictationSupported(): boolean {
    return recognitionCtor() !== null;
}

/**
 * Tap-to-talk dictation. Like Gallery's teacher it never stops on silence: when the browser ends a
 * recognition segment, a new one starts and the text keeps accumulating until finish() or cancel().
 */
export class Dictation {
    private recognition: any = null;
    private committed = '';
    private sessionFinal = '';
    private interim = '';
    private active = false;
    private endWaiters: (() => void)[] = [];

    constructor(
        private readonly locale: string,
        private readonly onTranscript: (text: string) => void,
        private readonly onError?: (message: string) => void,
    ) {}

    get transcript(): string {
        return [this.committed, this.sessionFinal, this.interim].map(s => s.trim()).filter(Boolean).join(' ');
    }

    start() {
        const Ctor = recognitionCtor();
        if (!Ctor) {
            this.onError?.('Speech recognition is not supported in this browser. Try Chrome, Edge or Safari, or type your question.');
            return;
        }
        stopSpeaking();
        this.active = true;
        this.committed = '';
        this.begin(Ctor);
    }

    private begin(Ctor: RecognitionCtor) {
        const rec = new Ctor();
        rec.lang = this.locale;
        rec.continuous = true;
        rec.interimResults = true;
        rec.onresult = (event: any) => {
            let finals = '';
            let interim = '';
            for (let i = 0; i < event.results.length; i++) {
                const r = event.results[i];
                if (r.isFinal) finals += r[0].transcript;
                else interim += r[0].transcript;
            }
            this.sessionFinal = finals;
            this.interim = interim;
            this.onTranscript(this.transcript);
        };
        rec.onerror = (event: any) => {
            if (event.error === 'no-speech' || event.error === 'aborted') return;
            const message = event.error === 'not-allowed'
                ? 'Microphone access was blocked. Allow it in your browser settings.'
                : `Speech recognition error: ${event.error}`;
            this.active = false;
            this.onError?.(message);
        };
        rec.onend = () => {
            this.committed = [this.committed, this.sessionFinal, this.interim].map(s => s.trim()).filter(Boolean).join(' ');
            this.sessionFinal = '';
            this.interim = '';
            if (this.active) {
                try { this.begin(Ctor); return; } catch { this.active = false; }
            }
            this.endWaiters.splice(0).forEach(fn => fn());
        };
        this.recognition = rec;
        rec.start();
    }

    /** Stops listening and returns the final transcript (waits up to `timeoutMs` for the last result). */
    finish(timeoutMs = 2000): Promise<string> {
        if (!this.recognition) return Promise.resolve(this.transcript);
        this.active = false;
        return new Promise(resolve => {
            const done = () => resolve(this.transcript);
            const timer = setTimeout(done, timeoutMs);
            this.endWaiters.push(() => { clearTimeout(timer); done(); });
            try { this.recognition.stop(); } catch { clearTimeout(timer); done(); }
        });
    }

    cancel() {
        this.active = false;
        this.endWaiters = [];
        try { this.recognition?.abort(); } catch { /* already stopped */ }
        this.recognition = null;
    }
}
