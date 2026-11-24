/**
 * Conversation Assist: listens to a real, face-to-face conversation and helps the learner reply.
 *
 * Listening uses a Gemini Live session as a live transcriber: the microphone streams in, the
 * session's input transcription gives the words as they are spoken, and the model is told to stay
 * silent. Measured 2026-11-23: gemini-3.1-flash-live-preview stays silent (no audio out) and
 * transcribes accurately; gemini-3.8-live still produced audio, and neither Live model accepts a
 * TEXT response, so the help itself comes from a fast text model, once per finished sentence.
 */
import { createBlob, releaseLiveUrl, resolveLiveWebSocketUrl } from './geminiService';
import { FAST_MODELS, generateWithFallback, lowLatencyThinking } from './genaiClient';

/**
 * Models for the reply help, best first. Suggestions are phrases the learner will say out loud,
 * so they must be correct: Flash-Lite alone suggested "una agua" (should be "un agua").
 */
export const HELP_MODELS = [...new Set(['gemini-3.5-flash', ...FAST_MODELS])];

export const LISTENER_MODEL = 'gemini-3.1-flash-live-preview';
export const LISTENER_INSTRUCTION = 'You are a silent transcription device placed in a room. You never speak and never reply to anything you hear: every response you give is empty silence. Do not greet, do not answer questions, do not comment.';

/** A sentence is finished when the transcriber goes quiet for this long (or ends its turn). */
const SENTENCE_GAP_MS = 1200;
const MAX_RECONNECTS = 3;

// ─── Listening ────────────────────────────────────────────────────────────

export interface ListenerCallbacks {
    /** Words of the sentence being spoken right now (grows as people talk). */
    onPartial: (text: string) => void;
    /** A finished sentence. */
    onSentence: (text: string) => void;
    /** Microphone level, 0..1, for the meter. */
    onLevel?: (level: number) => void;
    onError: (message: string) => void;
}

/** Microphone → Live transcription. One instance per listening session. */
export class ConversationListener {
    private ws: WebSocket | null = null;
    private ctx: AudioContext | null = null;
    private stream: MediaStream | null = null;
    private node: AudioWorkletNode | ScriptProcessorNode | null = null;
    private source: MediaStreamAudioSourceNode | null = null;
    private sentence = '';
    private gapTimer: ReturnType<typeof setTimeout> | null = null;
    private stopped = false;
    private paused = false;
    private reconnects = 0;

    constructor(private cb: ListenerCallbacks) { }

    /** Must be called from a tap (audio needs a user gesture). */
    async start(): Promise<void> {
        const Ctor = window.AudioContext || (window as any).webkitAudioContext;
        this.ctx = new Ctor();
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('Listening needs a secure (https) connection.');
        const [stream] = await Promise.all([
            navigator.mediaDevices.getUserMedia({
                audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
            }).catch(() => { throw new Error('Microphone access was blocked. Allow the microphone for this site, then try again.'); }),
            this.connect(),
        ]);
        if (this.stopped) { stream.getTracks().forEach(t => t.stop()); return; }
        this.stream = stream;
        await this.ctx.resume();
        this.source = this.ctx.createMediaStreamSource(stream);
        const onAudio = (data: Float32Array) => this.onAudio(data);
        try {
            await this.ctx.audioWorklet.addModule('/audio-processor-worklet.js');
            const node = new AudioWorkletNode(this.ctx, 'audio-capture-processor');
            node.port.onmessage = ev => { if (ev.data?.type === 'audio') onAudio(ev.data.buffer); };
            this.node = node;
        } catch {
            const node = this.ctx.createScriptProcessor(2048, 1, 1);
            node.onaudioprocess = ev => onAudio(ev.inputBuffer.getChannelData(0));
            this.node = node;
        }
        const silent = this.ctx.createGain();
        silent.gain.value = 0;
        this.source.connect(this.node);
        this.node.connect(silent);
        silent.connect(this.ctx.destination);
    }

    /** Stop sending audio for a moment (e.g. while the app itself is speaking a reply). */
    setPaused(paused: boolean) { this.paused = paused; }

    stop() {
        this.stopped = true;
        this.flush();
        if (this.gapTimer) clearTimeout(this.gapTimer);
        const ws = this.ws;
        this.ws = null;
        if (ws) { ws.onclose = null; try { ws.close(); } catch { /* closed */ } }
        this.stream?.getTracks().forEach(t => t.stop());
        try { this.node?.disconnect(); this.source?.disconnect(); } catch { /* already disconnected */ }
        this.ctx?.close().catch(() => { /* closed */ });
    }

    private async connect(): Promise<void> {
        const url = await resolveLiveWebSocketUrl(fetch, 'assist');
        await new Promise<void>((resolve, reject) => {
            const ws = new WebSocket(url);
            ws.binaryType = 'arraybuffer';
            let ready = false;
            // Hands unused listening time back however the socket closes (stop() clears onclose).
            ws.addEventListener('close', () => releaseLiveUrl(url, ready));
            ws.onopen = () => ws.send(JSON.stringify({
                setup: {
                    model: `models/${LISTENER_MODEL}`,
                    generationConfig: { responseModalities: ['AUDIO'] },
                    systemInstruction: { parts: [{ text: LISTENER_INSTRUCTION }] },
                    inputAudioTranscription: {},
                },
            }));
            ws.onmessage = ev => {
                let msg: any;
                try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : new TextDecoder().decode(ev.data)); } catch { return; }
                if (msg.setupComplete !== undefined && !ready) {
                    ready = true;
                    this.ws = ws;
                    this.reconnects = 0;
                    resolve();
                    return;
                }
                const sc = msg.serverContent;
                if (sc?.inputTranscription?.text) this.onWords(sc.inputTranscription.text);
                if (sc?.turnComplete) this.flush();
            };
            ws.onclose = () => {
                if (this.ws === ws) this.ws = null;
                if (!ready) { reject(new Error('Could not start listening. Check your connection and try again.')); return; }
                if (this.stopped) return;
                // Live sessions have a time limit: reconnect quietly and keep listening.
                this.flush();
                if (this.reconnects++ < MAX_RECONNECTS) this.connect().catch(err => this.cb.onError((err as Error).message));
                else this.cb.onError('Listening stopped because the connection dropped. Tap Start to listen again.');
            };
            ws.onerror = () => { /* onclose follows */ };
        });
    }

    private onAudio(data: Float32Array) {
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
        this.cb.onLevel?.(Math.min(1, Math.sqrt(sum / data.length) * 8));
        const ws = this.ws;
        if (!ws || ws.readyState !== WebSocket.OPEN || this.paused || !this.ctx) return;
        const blob = createBlob(data, this.ctx.sampleRate);
        ws.send(JSON.stringify({ realtimeInput: { audio: { data: blob.data, mimeType: blob.mimeType } } }));
    }

    private onWords(chunk: string) {
        this.sentence += chunk;
        this.cb.onPartial(this.sentence.trim());
        if (this.gapTimer) clearTimeout(this.gapTimer);
        this.gapTimer = setTimeout(() => this.flush(), SENTENCE_GAP_MS);
    }

    private flush() {
        if (this.gapTimer) { clearTimeout(this.gapTimer); this.gapTimer = null; }
        const text = this.sentence.trim();
        this.sentence = '';
        if (text && /[\p{L}\p{N}]/u.test(text)) this.cb.onSentence(text);
        else this.cb.onPartial('');
    }
}

// ─── Help ─────────────────────────────────────────────────────────────────

export type Speaker = 'them' | 'me';

export interface ReplyIdea {
    /** What to say, in the language being learned. */
    text: string;
    /** What it means, in the learner's language. */
    meaning: string;
    /** How it sounds, spelled for the learner (beginners only). */
    sounds?: string;
}

export interface AssistHelp {
    speaker: Speaker;
    /** What was most likely said, with obvious speech-recognition slips fixed (same as heard if fine). */
    meant?: string;
    translation: string;
    replies: ReplyIdea[];
    tip?: string;
}

export interface AssistContext {
    nativeLanguage: string;
    learnLanguage: string;
    level: string;
    /** Earlier sentences, oldest first. */
    history: { speaker: Speaker; text: string }[];
    /** Replies suggested for the previous sentence (the learner often says one of them). */
    lastReplies: string[];
}

const normalize = (s: string) => s.toLocaleLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();

/** True when what was heard is (close to) one of the replies we suggested: the learner said it. */
export function matchesSuggestion(heard: string, replies: string[]): boolean {
    const h = normalize(heard);
    if (!h) return false;
    return replies.some(r => {
        const n = normalize(r);
        if (!n) return false;
        if (h === n || h.includes(n) || n.includes(h)) return true;
        const a = new Set(h.split(' ')), b = n.split(' ');
        const shared = b.filter(w => a.has(w)).length;
        return shared / Math.max(b.length, a.size) >= 0.7;
    });
}

const HELP_SCHEMA = {
    type: 'OBJECT',
    properties: {
        meant: { type: 'STRING' },
        speaker: { type: 'STRING', enum: ['them', 'me'] },
        translation: { type: 'STRING' },
        replies: {
            type: 'ARRAY',
            items: {
                type: 'OBJECT',
                properties: { text: { type: 'STRING' }, meaning: { type: 'STRING' }, sounds: { type: 'STRING' } },
                required: ['text', 'meaning'],
            },
        },
        tip: { type: 'STRING' },
    },
    required: ['meant', 'speaker', 'translation', 'replies'],
};

export function buildHelpPrompt(sentence: string, c: AssistContext): string {
    const recent = c.history.slice(-8).map(h => `[${h.speaker === 'me' ? 'learner' : 'other person'}] ${h.text}`).join('\n') || '(nothing yet)';
    const beginner = c.level === 'Beginner';
    return `A ${nativeOr(c)} speaker who is a ${c.level.toLowerCase()} learner of ${c.learnLanguage} is in a real, face-to-face conversation right now. Their phone hears everyone and you help them keep up.

Conversation so far (oldest first):
${recent}

Just heard (from speech recognition, which can mishear words): "${sentence}"
${c.lastReplies.length ? `Replies we suggested last time: ${c.lastReplies.map(r => `"${r}"`).join(', ')}` : ''}

Return JSON:
- meant: what was most likely really said. Fix obvious speech-recognition slips using the situation (for example, a waiter asking "¿Quiere algo de oler?" almost certainly said "¿Quiere algo de beber?"). Keep the speaker's own grammar mistakes; only fix mishearings. If nothing needs fixing, repeat it exactly.
- speaker: "me" or "them". It was the learner ("me") if it has learner mistakes (wrong verb forms or agreement, like "yo va"), mixes in ${c.nativeLanguage}, is very simple, or matches a suggested reply. It was the other person ("them") if it is fluent, natural ${c.learnLanguage}. Also use the flow: a line that answers the other person's last question is usually the learner's.
- translation: "meant" in natural ${c.nativeLanguage}. If it is already in ${c.nativeLanguage}, give it in ${c.learnLanguage} instead.
- replies: if speaker is "them", 3 short, natural, grammatically perfect things the learner could say next in ${c.learnLanguage}, fitting the conversation and their level${beginner ? ' (very simple: 2 to 6 words)' : ''}. Make them different (for example agree, decline or ask back). Each has "meaning" in ${c.nativeLanguage}${beginner ? ` and "sounds": how it is pronounced, spelled simply for a ${c.nativeLanguage} speaker` : ''}. If speaker is "me", return an empty list.
- tip: optional, at most 14 words in ${c.nativeLanguage}. If speaker is "me" and they made a mistake, the correct way to say it. If speaker is "them", a useful hint only when it really helps (politeness, a number, a cultural point). Otherwise leave it out.`;
}

function nativeOr(c: AssistContext) { return c.nativeLanguage; }

export function parseHelp(raw: string): AssistHelp {
    const json = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ''));
    const replies: ReplyIdea[] = Array.isArray(json.replies)
        ? json.replies
            .filter((r: any) => r && typeof r.text === 'string' && r.text.trim())
            .slice(0, 3)
            .map((r: any) => ({ text: r.text.trim(), meaning: String(r.meaning ?? '').trim(), ...(r.sounds ? { sounds: String(r.sounds).trim() } : {}) }))
        : [];
    const meant = String(json.meant ?? '').trim();
    return {
        speaker: json.speaker === 'me' ? 'me' : 'them',
        ...(meant ? { meant } : {}),
        translation: String(json.translation ?? '').trim(),
        replies,
        ...(json.tip && String(json.tip).trim() ? { tip: String(json.tip).trim() } : {}),
    };
}

/** Translation, who said it, and what to answer, for one finished sentence. */
/** How long to wait for the better model before using the fast model's answer. */
export const STRONG_WAIT_MS = 2500;

export async function getAssistHelp(
    sentence: string,
    context: AssistContext,
    generate: typeof generateWithFallback = generateWithFallback,
    strongWaitMs: number = STRONG_WAIT_MS,
): Promise<AssistHelp> {
    const prompt = buildHelpPrompt(sentence, context);
    const ask = (models: string[], timeoutMs: number) => generate(models, model => ({
        model,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 700,
            responseMimeType: 'application/json',
            responseSchema: HELP_SCHEMA,
            thinkingConfig: lowLatencyThinking(model),
        },
        timeoutMs,
    })).then(parseHelp);

    // Ask both at once: the better model's replies are more reliable, but in a live conversation
    // help must not wait on an overloaded model. Use the fast answer if the better one is late.
    const strong = ask([HELP_MODELS[0]], 6_000);
    const fast = ask(FAST_MODELS, 8_000);
    const help = await new Promise<AssistHelp>((resolve, reject) => {
        let settled = false, waited = false, strongFailed = false;
        let fastResult: AssistHelp | null = null;
        let fastError: unknown = null;
        const finish = (h: AssistHelp) => { if (!settled) { settled = true; clearTimeout(timer); resolve(h); } };
        const timer = setTimeout(() => { waited = true; if (fastResult) finish(fastResult); }, strongWaitMs);
        strong.then(finish, () => {
            strongFailed = true;
            if (fastResult) finish(fastResult);
            else if (fastError && !settled) { settled = true; clearTimeout(timer); reject(fastError); }
        });
        fast.then(h => { fastResult = h; if (waited || strongFailed) finish(h); }, err => {
            fastError = err;
            if (strongFailed && !settled) { settled = true; clearTimeout(timer); reject(err); }
        });
    });
    // The learner reading out one of our suggestions is the clearest signal of who spoke.
    if (matchesSuggestion(sentence, context.lastReplies)) return { ...help, speaker: 'me', replies: [] };
    return help;
}
