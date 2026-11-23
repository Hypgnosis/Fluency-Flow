vi.mock('../services/firebase', () => ({ auth: null, db: null, isFirebaseConfigured: false }));

import { _setLiveConfig, startLiveSession } from '../services/geminiService';

class FakeWebSocket {
    static OPEN = 1;
    static last: FakeWebSocket | null = null;
    readyState = 1;
    sent: any[] = [];
    onopen: (() => void) | null = null;
    onmessage: ((ev: { data: string }) => void) | null = null;
    onerror: ((ev: unknown) => void) | null = null;
    onclose: ((ev: unknown) => void) | null = null;
    constructor(public url: string) {
        FakeWebSocket.last = this;
        setTimeout(() => this.onopen?.(), 0);
    }
    send(data: string) { this.sent.push(JSON.parse(data)); }
    close() { /* noop */ }
}

describe('startLiveSession with Tutor Skills', () => {
    beforeEach(() => {
        FakeWebSocket.last = null;
        vi.stubGlobal('WebSocket', FakeWebSocket);
        _setLiveConfig({ proxyUrl: '', devApiKey: 'dev-key' });
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
});
