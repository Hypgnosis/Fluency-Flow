vi.mock('../services/firebase', () => ({ auth: null, db: null, isFirebaseConfigured: false }));

import { _setLiveConfig } from '../services/geminiService';
import {
    ConversationListener, LISTENER_MODEL, buildHelpPrompt, getAssistHelp, matchesSuggestion, parseHelp,
} from '../services/conversationAssist';

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
    server(msg: unknown) { this.onmessage?.({ data: JSON.stringify(msg) }); }
}

const context = { nativeLanguage: 'English', learnLanguage: 'Spanish', level: 'Beginner', history: [], lastReplies: [] as string[] };

describe('conversation listener', () => {
    beforeEach(() => {
        FakeWebSocket.all = [];
        vi.stubGlobal('WebSocket', FakeWebSocket);
        _setLiveConfig({ proxyUrl: '', devApiKey: 'dev-key' });
    });
    afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

    const connected = async (cb: any) => {
        const listener = new ConversationListener(cb);
        const ready = (listener as any).connect();
        await vi.waitFor(() => expect(FakeWebSocket.all[0]?.sent.length).toBe(1));
        const ws = FakeWebSocket.all[0];
        ws.server({ setupComplete: {} });
        await ready;
        return { listener, ws };
    };

    it('asks a silent Live model for live transcription only', async () => {
        const { ws } = await connected({ onPartial: vi.fn(), onSentence: vi.fn(), onError: vi.fn() });
        const setup = ws.sent[0].setup;
        expect(setup.model).toBe(`models/${LISTENER_MODEL}`);
        expect(setup.inputAudioTranscription).toEqual({});
        expect(setup.systemInstruction.parts[0].text).toMatch(/never speak/i);
    });

    it('shows words as they come and finishes a sentence when the speaker pauses', async () => {
        const cb = { onPartial: vi.fn(), onSentence: vi.fn(), onError: vi.fn() };
        const { ws } = await connected(cb);
        vi.useFakeTimers();
        ws.server({ serverContent: { inputTranscription: { text: '¿Quieres ' } } });
        ws.server({ serverContent: { inputTranscription: { text: 'algo de beber?' } } });
        expect(cb.onPartial).toHaveBeenLastCalledWith('¿Quieres algo de beber?');
        expect(cb.onSentence).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1300);
        expect(cb.onSentence).toHaveBeenCalledWith('¿Quieres algo de beber?');
    });

    it('finishes a sentence at the end of a turn', async () => {
        const cb = { onPartial: vi.fn(), onSentence: vi.fn(), onError: vi.fn() };
        const { ws } = await connected(cb);
        ws.server({ serverContent: { inputTranscription: { text: 'Son cinco euros.' } } });
        ws.server({ serverContent: { turnComplete: true } });
        expect(cb.onSentence).toHaveBeenCalledWith('Son cinco euros.');
    });
});

describe('reply help', () => {
    it('recognizes when the learner says one of the suggested replies', () => {
        const replies = ['Sí, un café, por favor.', 'No, gracias.', '¿Qué me recomienda?'];
        expect(matchesSuggestion('si un cafe por favor', replies)).toBe(true);
        expect(matchesSuggestion('No gracias', replies)).toBe(true);
        expect(matchesSuggestion('¿Quieres algo de beber?', replies)).toBe(false);
    });

    it('parses the model answer and keeps at most three replies', () => {
        const help = parseHelp(JSON.stringify({
            speaker: 'them', translation: 'Do you want something to drink?',
            replies: [{ text: 'Sí, un café.', meaning: 'Yes, a coffee.', sounds: 'see, oon kah-FEH' }, { text: 'No, gracias.', meaning: 'No, thanks.' }, { text: 'Agua, por favor.', meaning: 'Water, please.' }, { text: 'x', meaning: 'y' }],
        }));
        expect(help.speaker).toBe('them');
        expect(help.replies).toHaveLength(3);
        expect(help.replies[0].sounds).toBe('see, oon kah-FEH');
    });

    it('marks a sentence as yours when it matches a suggestion, whatever the model guessed', async () => {
        const generate = vi.fn().mockResolvedValue(JSON.stringify({ speaker: 'them', translation: 'Yes, a coffee please.', replies: [{ text: 'a', meaning: 'b' }] }));
        const help = await getAssistHelp('Sí, un café, por favor', { ...context, lastReplies: ['Sí, un café, por favor.'] }, generate);
        expect(help.speaker).toBe('me');
        expect(help.replies).toEqual([]);
    });

    it('asks for simple replies with pronunciation for beginners', () => {
        const prompt = buildHelpPrompt('¿Quieres algo de beber?', context);
        expect(prompt).toMatch(/2 to 6 words/);
        expect(prompt).toMatch(/"sounds"/);
        expect(buildHelpPrompt('x', { ...context, level: 'Advanced' })).not.toMatch(/"sounds"/);
    });
});

describe('reply help timing', () => {
    const answer = (replies: string[]) => JSON.stringify({ speaker: 'them', meant: 'x', translation: 't', replies: replies.map(text => ({ text, meaning: 'm' })) });

    it('prefers the better model when it answers in time', async () => {
        const generate = vi.fn((models: string[]) => Promise.resolve(answer([models[0] === 'gemini-3.5-flash' ? 'Un agua, por favor.' : 'Una agua, por favor.'])));
        const help = await getAssistHelp('¿Quiere algo de beber?', context, generate as any, 200);
        expect(help.replies[0].text).toBe('Un agua, por favor.');
    });

    it('uses the fast model when the better one is too slow', async () => {
        const generate = vi.fn((models: string[]) => models[0] === 'gemini-3.5-flash'
            ? new Promise(r => setTimeout(() => r(answer(["slow"])), 4000))
            : Promise.resolve(answer(['fast'])));
        const started = Date.now();
        const help = await getAssistHelp('¿Quiere algo de beber?', context, generate as any, 100);
        expect(help.replies[0].text).toBe('fast');
        expect(Date.now() - started).toBeLessThan(2500);
    });

    it('fails only when both models fail', async () => {
        const generate = vi.fn(() => Promise.reject(new Error('down')));
        await expect(getAssistHelp('hola', context, generate as any, 50)).rejects.toThrow('down');
    });
});
