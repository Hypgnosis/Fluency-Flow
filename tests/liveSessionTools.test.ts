vi.mock('../services/firebase', () => ({ auth: null, db: null, isFirebaseConfigured: false }));

import { _setLiveConfig, liveModelOrder, startLiveSession } from '../services/geminiService';

class FakeWebSocket {
    static OPEN = 1;
    static last: FakeWebSocket | null = null;
    static all: FakeWebSocket[] = [];
    readyState = 1;
    sent: any[] = [];
    onopen: (() => void) | null = null;
    onmessage: ((ev: { data: string }) => void) | null = null;
    onerror: ((ev: unknown) => void) | null = null;
    onclose: ((ev: unknown) => void) | null = null;
    constructor(public url: string) {
        FakeWebSocket.last = this;
        FakeWebSocket.all.push(this);
        setTimeout(() => this.onopen?.(), 0);
    }
    send(data: string) { this.sent.push(JSON.parse(data)); }
    close() { /* noop */ }
}

describe('startLiveSession with Tutor Skills', () => {
    beforeEach(() => {
        FakeWebSocket.last = null;
        FakeWebSocket.all = [];
        vi.stubGlobal('WebSocket', FakeWebSocket);
        _setLiveConfig({ proxyUrl: '', devApiKey: 'dev-key', model: 'gemini-3.8-live' });
    });
    afterEach(() => vi.unstubAllGlobals());

    const callbacks = () => ({ onOpen: vi.fn(), onMessage: vi.fn(), onError: vi.fn(), onClose: vi.fn() });
    /** Waits until the session has opened its socket and sent the setup message. */
    const setupSent = async () => {
        await vi.waitFor(() => expect(FakeWebSocket.last?.sent.length).toBeGreaterThan(0));
        return FakeWebSocket.last!;
    };

    it('declares tools in setup, appends their instructions, and sends tool responses', async () => {
        const cb = callbacks();
        const tools = {
            functionDeclarations: [{ name: 'lookup_wikipedia', description: 'd', parameters: { type: 'OBJECT' } }],
            instructions: 'TOOLS:\n- lookup_wikipedia: d',
        };
        const pending = startLiveSession(cb, 'Spanish', 'LEARNER PROFILE', 'Beginner', 'English', 'Puck', tools);
        const ws = await setupSent();
        const setup = ws.sent[0].setup;
        expect(setup.tools).toEqual([{ functionDeclarations: tools.functionDeclarations }]);
        const instruction: string = setup.systemInstruction.parts[0].text;
        expect(instruction.indexOf('LEARNER PROFILE')).toBeGreaterThan(0);
        expect(instruction.endsWith('\n\nTOOLS:\n- lookup_wikipedia: d')).toBe(true);

        ws.onmessage!({ data: JSON.stringify({ setupComplete: {} }) });
        const session = await pending;
        session.sendToolResponse([{ id: 'c1', name: 'lookup_wikipedia', response: { result: 'Frida Kahlo...' } }]);
        expect(ws.sent[1]).toEqual({
            toolResponse: { functionResponses: [{ id: 'c1', name: 'lookup_wikipedia', response: { result: 'Frida Kahlo...' } }] },
        });

        // Tool calls are forwarded to the message handler like any other server message.
        ws.onmessage!({ data: JSON.stringify({ toolCall: { functionCalls: [{ id: 'c2', name: 'show_card', args: {} }] } }) });
        expect(cb.onMessage).toHaveBeenCalledWith({ toolCall: { functionCalls: [{ id: 'c2', name: 'show_card', args: {} }] } });
    });

    it('omits tools when none are enabled', async () => {
        startLiveSession(callbacks(), 'Spanish', '', 'Beginner', 'English', 'Puck');
        expect((await setupSent()).sent[0].setup.tools).toBeUndefined();
    });

    it('sends microphone audio in the current realtimeInput.audio format', async () => {
        const pending = startLiveSession(callbacks(), 'Spanish', '', 'Beginner', 'English', 'Puck');
        const ws = await setupSent();
        expect(ws.sent[0].setup.model).toBe('models/gemini-3.8-live');
        ws.onmessage!({ data: JSON.stringify({ setupComplete: {} }) });
        const session = await pending;
        session.sendRealtimeInput({ media: { data: 'QUJD', mimeType: 'audio/pcm;rate=16000' } });
        expect(ws.sent[1]).toEqual({ realtimeInput: { audio: { data: 'QUJD', mimeType: 'audio/pcm;rate=16000' } } });
        expect(JSON.stringify(ws.sent[1])).not.toContain('mediaChunks');
    });

    it('falls back to the next Live model when one cannot start', async () => {
        expect(liveModelOrder()).toEqual(['gemini-3.8-live', 'gemini-3.1-flash-live-preview', 'gemini-2.5-flash-native-audio-latest']);
        const cb = callbacks();
        const pending = startLiveSession(cb, 'Spanish', '', 'Beginner', 'English', 'Puck');
        const first = await setupSent();
        first.onclose!({ code: 1008, reason: 'model not found' });
        await vi.waitFor(() => expect(FakeWebSocket.all).toHaveLength(2));
        const second = FakeWebSocket.all[1];
        await vi.waitFor(() => expect(second.sent.length).toBe(1));
        expect(second.sent[0].setup.model).toBe('models/gemini-3.1-flash-live-preview');
        second.onmessage!({ data: JSON.stringify({ setupComplete: {} }) });
        await expect(pending).resolves.toBeTruthy();
        expect(cb.onOpen).toHaveBeenCalledTimes(1);
        expect(cb.onClose).not.toHaveBeenCalled(); // the failed attempt must not trigger reconnect logic
    });

    it('reports an error when no Live model can start', async () => {
        const cb = callbacks();
        const pending = startLiveSession(cb, 'Spanish', '', 'Beginner', 'English', 'Puck');
        for (let i = 0; i < 3; i++) {
            await vi.waitFor(() => expect(FakeWebSocket.all[i]?.sent.length).toBe(1));
            FakeWebSocket.all[i].onclose!({ code: 1008, reason: 'unavailable' });
        }
        await expect(pending).rejects.toThrow('Could not start a voice session (1008 unavailable)');
        expect(cb.onError).toHaveBeenCalledWith({ message: 'Could not start a voice session (1008 unavailable)' });
        expect(cb.onClose).not.toHaveBeenCalled();
    });

    it('closes after setup still reach the reconnect handler', async () => {
        const cb = callbacks();
        const pending = startLiveSession(cb, 'Spanish', '', 'Beginner', 'English', 'Puck');
        const ws = await setupSent();
        ws.onmessage!({ data: JSON.stringify({ setupComplete: {} }) });
        await pending;
        ws.onclose!({ code: 1006, reason: '' });
        expect(cb.onClose).toHaveBeenCalledWith({ code: 1006, reason: '' });
    });
});
