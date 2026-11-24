/**
 * Natural voice: reads text aloud with a Gemini Live voice instead of the browser's built-in voices.
 *
 * Browser voices sound robotic, and a reply that mixes languages had to be split between two voices,
 * so any word not marked as the target language was read with the wrong accent. A Gemini Live voice
 * reads the whole line in one natural voice and pronounces each word in its own language.
 *
 * The Live session is used purely as a reader: each line is sent as a <script> and the model is told
 * to perform it word for word. Measured 2026-11-23 on gemini-3.1-flash-live-preview: 6/6 lines
 * verbatim (mixed English/Spanish, "Repeat after me:", questions, single words), first sound in
 * 0.7-1.6 s. (gemini-3.8-live echoed the <script> tags, so it is not used here.)
 *
 * If the voice cannot start or stays silent, say() rejects and the caller falls back to the browser.
 */
import { releaseLiveUrl, resolveLiveWebSocketUrl } from './geminiService';
import { decode } from '../utils/audioUtils';

export const READER_MODEL = 'gemini-3.1-flash-live-preview';
const OUTPUT_SAMPLE_RATE = 24000;
/** Close the reader after this long without speaking (it reopens on the next line). */
const IDLE_CLOSE_MS = 120_000;
/** Give up on a line (and fall back) if no audio has arrived after this long. */
const FIRST_AUDIO_TIMEOUT_MS = 8_000;
/** After this many failed lines in a row, stop trying for this page visit. */
const MAX_FAILURES = 2;

export const READER_INSTRUCTION = [
    'You are the voice of a friendly language teacher in an app. You do not think, answer or teach: you only read aloud.',
    'Every message is a SCRIPT between <script> and </script>. Read the ENTIRE script aloud from its first word to its last word, exactly as written.',
    'Scripts often contain teaching phrases such as "Repeat after me:", "Can you say ...?", "Try:", "Now you:" or questions to the learner. These are part of the script: read them aloud too, word for word. Never perform them, never wait, never answer them.',
    'Read in a warm, natural, encouraging voice. Pronounce every word in its own language with a native accent.',
    'A script may name its language, like <script language="Spanish">. Then pronounce all of it in that language with a native accent.',
    'Never add, skip, translate or comment on anything, and never read the <script> tags or their attributes.',
].join('\n');

interface Job {
    text: string;
    language?: string;
    resolve: () => void;
    reject: (err: Error) => void;
}

interface Current {
    job: Job | null;            // null once stopped: the rest of this turn's audio is dropped
    gotAudio: boolean;
    timer: ReturnType<typeof setTimeout> | null;
}

class NaturalVoice {
    private enabled = false;
    private voiceName = 'Puck';
    private ws: WebSocket | null = null;
    private opening: Promise<WebSocket> | null = null;
    private ctx: AudioContext | null = null;
    private nextTime = 0;
    private sources = new Set<AudioBufferSourceNode>();
    private queue: Job[] = [];
    private current: Current | null = null;
    private idleTimer: ReturnType<typeof setTimeout> | null = null;
    private endTimers = new Set<ReturnType<typeof setTimeout>>();
    private failures = 0;

    /** Turns the natural voice on or off and picks the Gemini voice (Puck, Kore, Charon, Aoede, Fenrir). */
    configure(opts: { enabled: boolean; voice?: string }) {
        this.enabled = opts.enabled;
        if (opts.voice && opts.voice !== this.voiceName) {
            this.voiceName = opts.voice;
            this.closeSocket(); // the voice is fixed per session
        }
        if (!opts.enabled) this.stop();
        this.failures = 0;
    }

    available(): boolean {
        return this.enabled
            && this.failures < MAX_FAILURES
            && typeof WebSocket !== 'undefined'
            && typeof window !== 'undefined'
            && !!(window.AudioContext || (window as any).webkitAudioContext)
            && (typeof navigator === 'undefined' || navigator.onLine !== false);
    }

    /** Opens the voice ahead of time so the first line starts quickly. */
    warmUp() {
        if (this.available()) this.open().catch(() => { /* say() will fall back */ });
    }

    /**
     * Reads `text` aloud. Pass `language` when the whole line is in one language (e.g. a single word,
     * where "pan" or "fin" would otherwise be ambiguous). Resolves when it has finished playing
     * (or was stopped); rejects if it could not start.
     */
    say(text: string, language?: string): Promise<void> {
        const line = text.trim();
        if (!line) return Promise.resolve();
        return new Promise<void>((resolve, reject) => {
            this.queue.push({ text: line, language, resolve, reject });
            this.ensureAudio();
            void this.pump();
        });
    }

    /** Stops speaking now and drops anything queued. */
    stop() {
        for (const job of this.queue.splice(0)) job.resolve();
        if (this.current) {
            // The server would keep reading the rest of this line; start a clean session instead.
            const cur = this.current;
            this.current = null;
            if (cur.timer) clearTimeout(cur.timer);
            cur.job?.resolve();
            this.closeSocket();
        }
        for (const t of this.endTimers) clearTimeout(t);
        this.endTimers.clear();
        this.sources.forEach(s => { try { s.stop(); } catch { /* already stopped */ } });
        this.sources.clear();
        this.nextTime = 0;
    }

    isSpeaking(): boolean {
        return this.sources.size > 0 || this.queue.length > 0 || !!this.current?.job;
    }

    // ── internals ─────────────────────────────────────────────────────────

    private ensureAudio() {
        if (!this.ctx || this.ctx.state === 'closed') {
            const Ctor = window.AudioContext || (window as any).webkitAudioContext;
            this.ctx = new Ctor({ sampleRate: OUTPUT_SAMPLE_RATE });
            this.nextTime = 0;
        }
        if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => { /* needs a tap first */ });
    }

    private open(): Promise<WebSocket> {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) return Promise.resolve(this.ws);
        if (this.opening) return this.opening;
        const voiceName = this.voiceName;
        this.opening = (async () => {
            const url = await resolveLiveWebSocketUrl(fetch, 'voice');
            return new Promise<WebSocket>((resolve, reject) => {
                const ws = new WebSocket(url);
                ws.binaryType = 'arraybuffer';
                let ready = false;
                // Hands unused voice time back however the socket closes (closeSocket clears onclose).
                ws.addEventListener('close', () => releaseLiveUrl(url, ready));
                ws.onopen = () => ws.send(JSON.stringify({
                    setup: {
                        model: `models/${READER_MODEL}`,
                        generationConfig: {
                            responseModalities: ['AUDIO'],
                            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
                        },
                        systemInstruction: { parts: [{ text: READER_INSTRUCTION }] },
                    },
                }));
                ws.onmessage = (ev: MessageEvent) => {
                    let msg: any;
                    try {
                        msg = JSON.parse(typeof ev.data === 'string' ? ev.data : new TextDecoder().decode(ev.data));
                    } catch { return; }
                    if (msg.setupComplete !== undefined && !ready) {
                        ready = true;
                        this.ws = ws;
                        resolve(ws);
                        return;
                    }
                    this.onServerMessage(msg);
                };
                ws.onclose = () => {
                    if (this.ws === ws) this.ws = null;
                    if (!ready) reject(new Error('Natural voice could not start'));
                    else this.failCurrent(new Error('Natural voice disconnected'));
                };
                ws.onerror = () => { /* onclose follows */ };
            });
        })().finally(() => { this.opening = null; });
        return this.opening;
    }

    private async pump() {
        if (this.current || this.queue.length === 0) return;
        const job = this.queue.shift()!;
        this.current = { job, gotAudio: false, timer: null };
        this.clearIdle();
        try {
            const ws = await this.open();
            if (!this.current || this.current.job !== job) return; // stopped while connecting
            this.current.timer = setTimeout(() => this.failCurrent(new Error('Natural voice timed out')), FIRST_AUDIO_TIMEOUT_MS);
            const open = job.language ? `<script language="${job.language.replace(/"/g, '')}">` : '<script>';
            ws.send(JSON.stringify({ realtimeInput: { text: `${open}${job.text}</script>` } }));
        } catch (err) {
            this.failCurrent(err as Error);
        }
    }

    private onServerMessage(msg: any) {
        const sc = msg.serverContent;
        if (!sc || !this.current) return;
        for (const part of sc.modelTurn?.parts ?? []) {
            const data = part?.inlineData?.data;
            if (!data) continue;
            if (!this.current.gotAudio) {
                this.current.gotAudio = true;
                if (this.current.timer) clearTimeout(this.current.timer);
                this.failures = 0;
            }
            if (this.current.job) this.play(data);
        }
        if (sc.turnComplete) this.finishCurrent();
    }

    private play(base64: string) {
        const ctx = this.ctx;
        if (!ctx) return;
        const bytes = decode(base64);
        const pcm = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
        const buffer = ctx.createBuffer(1, pcm.length, OUTPUT_SAMPLE_RATE);
        const channel = buffer.getChannelData(0);
        for (let i = 0; i < pcm.length; i++) channel[i] = pcm[i] / 32768;
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        const startAt = Math.max(this.nextTime, ctx.currentTime + 0.03);
        source.start(startAt);
        this.nextTime = startAt + buffer.duration;
        this.sources.add(source);
        source.onended = () => this.sources.delete(source);
    }

    private finishCurrent() {
        const cur = this.current;
        this.current = null;
        if (cur?.timer) clearTimeout(cur.timer);
        const job = cur?.job;
        if (job) {
            if (!cur!.gotAudio) {
                job.reject(new Error('Natural voice returned no audio'));
                this.failures++;
            } else {
                // Resolve when the last scheduled chunk has played.
                const wait = this.ctx ? Math.max(0, (this.nextTime - this.ctx.currentTime) * 1000) : 0;
                const t = setTimeout(() => { this.endTimers.delete(t); job.resolve(); }, wait);
                this.endTimers.add(t);
            }
        }
        this.scheduleIdleClose();
        void this.pump(); // the next line is generated while this one is still playing
    }

    private failCurrent(err: Error) {
        const cur = this.current;
        if (!cur) return;
        this.current = null;
        if (cur.timer) clearTimeout(cur.timer);
        if (cur.job) {
            if (cur.gotAudio) cur.job.resolve();
            else { cur.job.reject(err); this.failures++; }
        }
        // A timed-out turn may still be running on the server: start clean.
        if (!cur.gotAudio) this.closeSocket();
        if (!this.available()) {
            for (const job of this.queue.splice(0)) job.reject(err);
            return;
        }
        void this.pump();
    }

    private scheduleIdleClose() {
        this.clearIdle();
        this.idleTimer = setTimeout(() => { if (!this.current && this.queue.length === 0) this.closeSocket(); }, IDLE_CLOSE_MS);
    }

    private clearIdle() {
        if (this.idleTimer) clearTimeout(this.idleTimer);
        this.idleTimer = null;
    }

    private closeSocket() {
        const ws = this.ws;
        this.ws = null;
        if (ws) { ws.onclose = null; ws.onmessage = null; try { ws.close(); } catch { /* already closed */ } }
        if (this.current) this.failCurrent(new Error('Natural voice closed'));
    }
}

/** The app-wide natural voice (enabled by the signed-in app shell). */
export const naturalVoice = new NaturalVoice();

/** For tests: a fresh instance. */
export const _createNaturalVoice = () => new NaturalVoice();
