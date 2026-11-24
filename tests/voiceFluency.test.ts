vi.mock('../services/firebase', () => ({ auth: null, db: null, isFirebaseConfigured: false }));

import { upsertEntry } from '../utils/transcript';
import { _setLiveConfig, buildTutorInstruction, kickoffPrompt, startLiveSession } from '../services/geminiService';
import { executeToolCalls } from '../services/tutorSkills/registry';
import type { TranscriptionEntry } from '../types';

describe('transcript entries', () => {
    it('keeps the tutor reply in its own bubble even when both start in the same millisecond', () => {
        let log: TranscriptionEntry[] = [];
        log = upsertEntry(log, { id: 1, speaker: 'You', text: 'Bonjour, comment allez-vous?', isFinal: false }, -1);
        log = upsertEntry(log, { id: 2, speaker: 'Tutor', text: 'Formidable! You', isFinal: false }, -1);
        log = upsertEntry(log, { id: 2, speaker: 'Tutor', text: 'Formidable! You combined "Hello" and "How are you?" perfectly.', isFinal: false }, -1);
        expect(log.map(e => [e.speaker, e.text])).toEqual([
            ['You', 'Bonjour, comment allez-vous?'],
            ['Tutor', 'Formidable! You combined "Hello" and "How are you?" perfectly.'],
        ]);
    });

    it('puts your words above the reply when they arrive after it started', () => {
        let log: TranscriptionEntry[] = [{ id: 1, speaker: 'Tutor', text: 'Hola', isFinal: true }];
        log = upsertEntry(log, { id: 2, speaker: 'Tutor', text: 'Muy bien', isFinal: false }, -1);
        log = upsertEntry(log, { id: 3, speaker: 'You', text: 'Hola, ¿qué tal?', isFinal: false }, 2);
        expect(log.map(e => e.id)).toEqual([1, 3, 2]);
    });

    it('updates text without dropping extras like the replay audio', () => {
        const log: TranscriptionEntry[] = [{ id: 7, speaker: 'You', text: 'Ho', isFinal: false, audioUrl: 'blob:x' }];
        const next = upsertEntry(log, { id: 7, speaker: 'You', text: 'Hola', isFinal: false }, -1);
        expect(next[0]).toMatchObject({ text: 'Hola', audioUrl: 'blob:x' });
    });
});

describe('tutor instructions', () => {
    it('are short, spoken-style, and free of jargon or bracket formatting', () => {
        for (const level of ['Beginner', 'Intermediate', 'Advanced']) {
            const text = buildTutorInstruction('French', 'English', level);
            expect(text.length).toBeLessThan(2200);
            expect(text).toMatch(/one to three sentences/);
            expect(text).not.toMatch(/\[In English|Neural|protocol|Inmersion|clinical/i);
        }
    });

    it('asks the tutor to greet first', () => {
        expect(kickoffPrompt('Spanish', 'English', 'Beginner')).toMatch(/Greet them in Spanish/);
    });
});

class FakeWebSocket {
    static OPEN = 1;
    static last: FakeWebSocket | null = null;
    readyState = 1;
    binaryType = 'blob';
    sent: any[] = [];
    onopen: (() => void) | null = null;
    onmessage: ((ev: { data: unknown }) => void) | null = null;
    onerror: ((ev: unknown) => void) | null = null;
    onclose: ((ev: unknown) => void) | null = null;
    constructor(public url: string) { FakeWebSocket.last = this; setTimeout(() => this.onopen?.(), 0); }
    send(data: string) { this.sent.push(JSON.parse(data)); }
    close() { /* noop */ }
}

describe('live session text and frames', () => {
    beforeEach(() => vi.stubGlobal('WebSocket', FakeWebSocket));
    afterEach(() => vi.unstubAllGlobals());
    const cb = () => ({ onOpen: vi.fn(), onMessage: vi.fn(), onError: vi.fn(), onClose: vi.fn() });

    const open = async (model: string) => {
        _setLiveConfig({ proxyUrl: '', devApiKey: 'dev-key', model });
        const callbacks = cb();
        const pending = startLiveSession(callbacks, 'Spanish', '', 'Beginner', 'English', 'Puck');
        await vi.waitFor(() => expect(FakeWebSocket.last?.sent.length).toBe(1));
        const ws = FakeWebSocket.last!;
        ws.onmessage!({ data: JSON.stringify({ setupComplete: {} }) });
        return { ws, session: await pending, callbacks };
    };

    it('sends text as realtimeInput.text to Gemini 3 Live models', async () => {
        const { ws, session } = await open('gemini-3.8-live');
        session.sendText('hola');
        expect(ws.sent[1]).toEqual({ realtimeInput: { text: 'hola' } });
    });

    it('sends text as a clientContent turn to 2.5 models', async () => {
        const { ws, session } = await open('gemini-2.5-flash-native-audio-latest');
        session.sendText('hola');
        expect(ws.sent[1]).toEqual({ clientContent: { turns: [{ role: 'user', parts: [{ text: 'hola' }] }], turnComplete: true } });
    });

    it('reads binary frames synchronously so messages stay in order', async () => {
        const { ws, callbacks } = await open('gemini-3.8-live');
        expect(ws.binaryType).toBe('arraybuffer');
        const frame = (n: number) => new TextEncoder().encode(JSON.stringify({ serverContent: { outputTranscription: { text: String(n) } } })).buffer;
        ws.onmessage!({ data: frame(1) });
        ws.onmessage!({ data: frame(2) });
        expect(callbacks.onMessage.mock.calls.map(c => c[0].serverContent.outputTranscription.text)).toEqual(['1', '2']);
    });
});

describe('live tool calls', () => {
    it('answer with an error instead of leaving the tutor waiting on a slow lookup', async () => {
        const slow = {
            name: 'lookup_wikipedia', title: 'Wikipedia', summary: '', mode: 'live' as const, declaration: { name: 'lookup_wikipedia', description: '' },
            run: () => new Promise(() => { /* never resolves */ }),
        };
        const started = Date.now();
        const { responses } = await executeToolCalls([{ id: 'c1', name: 'lookup_wikipedia', args: {} }], [slow as any], {} as any, 50);
        expect(Date.now() - started).toBeLessThan(1000);
        expect(responses[0]).toMatchObject({ id: 'c1', response: { error: expect.stringMatching(/too long/) } });
    });
});
