vi.mock('../services/firebase', () => ({ auth: null, db: null, isFirebaseConfigured: false }));

import { _setLiveConfig } from '../services/geminiService';
import { _createNaturalVoice, READER_MODEL } from '../services/naturalVoice';

class FakeWebSocket {
    static OPEN = 1;
    static all: FakeWebSocket[] = [];
    readyState = 1;
    binaryType = 'blob';
    sent: any[] = [];
    onopen: (() => void) | null = null;
    onmessage: ((ev: { data: unknown }) => void) | null = null;
    onerror: ((ev: unknown) => void) | null = null;
    onclose: ((ev: unknown) => void) | null = null;
    constructor(public url: string) { FakeWebSocket.all.push(this); setTimeout(() => this.onopen?.(), 0); }
    send(data: string) { this.sent.push(JSON.parse(data)); }
    close() { this.readyState = 3; }
    addEventListener() { /* lease bookkeeping; not needed here */ }
    server(msg: unknown) { this.onmessage?.({ data: JSON.stringify(msg) }); }
}

class FakeAudioContext {
    state = 'running';
    currentTime = 0;
    destination = {};
    started: number[] = [];
    resume() { return Promise.resolve(); }
    createBuffer(_c: number, length: number, rate: number) { return { duration: length / rate, getChannelData: () => new Float32Array(length) }; }
    createBufferSource() { const ctx = this; return { buffer: null, onended: null, connect() {}, stop() {}, start(at: number) { ctx.started.push(at); } }; }
}

const audioChunk = (samples = 240) => Buffer.from(new Int16Array(samples).buffer).toString('base64');

describe('natural voice reader', () => {
    beforeEach(() => {
        FakeWebSocket.all = [];
        vi.stubGlobal('WebSocket', FakeWebSocket);
        vi.stubGlobal('AudioContext', FakeAudioContext);
        _setLiveConfig({ proxyUrl: '', devApiKey: 'dev-key' });
    });
    afterEach(() => vi.unstubAllGlobals());

    const ready = async () => {
        await vi.waitFor(() => expect(FakeWebSocket.all[0]?.sent.length).toBe(1));
        const ws = FakeWebSocket.all[0];
        ws.server({ setupComplete: {} });
        return ws;
    };

    it('reads a line word for word with the chosen Gemini voice, then resolves', async () => {
        const voice = _createNaturalVoice();
        voice.configure({ enabled: true, voice: 'Kore' });
        expect(voice.available()).toBe(true);
        const done = voice.say('That is a mug. In Spanish we say "la taza".');
        const ws = await ready();
        const setup = ws.sent[0].setup;
        expect(setup.model).toBe(`models/${READER_MODEL}`);
        expect(setup.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe('Kore');
        expect(setup.systemInstruction.parts[0].text).toMatch(/word for word/);
        await vi.waitFor(() => expect(ws.sent[1]).toEqual({ realtimeInput: { text: '<script>That is a mug. In Spanish we say "la taza".</script>' } }));
        ws.server({ serverContent: { modelTurn: { parts: [{ inlineData: { data: audioChunk(), mimeType: 'audio/pcm;rate=24000' } }] } } });
        ws.server({ serverContent: { turnComplete: true } });
        await expect(done).resolves.toBeUndefined();
    });

    it('sends the next line only after the current one is complete', async () => {
        const voice = _createNaturalVoice();
        voice.configure({ enabled: true });
        const first = voice.say('Hola.');
        const second = voice.say('¿Qué es esto?');
        const ws = await ready();
        await vi.waitFor(() => expect(ws.sent).toHaveLength(2));
        ws.server({ serverContent: { modelTurn: { parts: [{ inlineData: { data: audioChunk() } }] } } });
        expect(ws.sent).toHaveLength(2);
        ws.server({ serverContent: { turnComplete: true } });
        await vi.waitFor(() => expect(ws.sent[2]).toEqual({ realtimeInput: { text: '<script>¿Qué es esto?</script>' } }));
        ws.server({ serverContent: { modelTurn: { parts: [{ inlineData: { data: audioChunk() } }] } } });
        ws.server({ serverContent: { turnComplete: true } });
        await Promise.all([first, second]);
    });

    it('rejects (so the browser voice takes over) when the voice cannot start', async () => {
        const voice = _createNaturalVoice();
        voice.configure({ enabled: true });
        const done = voice.say('Hola.');
        await vi.waitFor(() => expect(FakeWebSocket.all).toHaveLength(1));
        FakeWebSocket.all[0].onclose?.({ code: 1011 });
        await expect(done).rejects.toThrow(/could not start/);
    });

    it('is off until the app turns it on', () => {
        expect(_createNaturalVoice().available()).toBe(false);
    });
});

describe('language hints', () => {
    beforeEach(() => {
        FakeWebSocket.all = [];
        vi.stubGlobal('WebSocket', FakeWebSocket);
        vi.stubGlobal('AudioContext', FakeAudioContext);
        _setLiveConfig({ proxyUrl: '', devApiKey: 'dev-key' });
    });
    afterEach(() => vi.unstubAllGlobals());

    it('names the language of a single-language line so short words get the right accent', async () => {
        const voice = _createNaturalVoice();
        voice.configure({ enabled: true });
        void voice.say('pan', 'Spanish');
        await vi.waitFor(() => expect(FakeWebSocket.all[0]?.sent.length).toBe(1));
        FakeWebSocket.all[0].server({ setupComplete: {} });
        await vi.waitFor(() => expect(FakeWebSocket.all[0].sent[1]).toEqual({ realtimeInput: { text: '<script language="Spanish">pan</script>' } }));
    });

    it('maps locales to language names', async () => {
        const { languageNameForLocale } = await import('../services/languages');
        expect(languageNameForLocale('es-MX')).toBe('Spanish');
        expect(languageNameForLocale('yua')).toBe('Yucatec Mayan');
        expect(languageNameForLocale('xx-YY')).toBeUndefined();
    });
});
