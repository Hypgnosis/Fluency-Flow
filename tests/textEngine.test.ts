const fakeAuth = vi.hoisted(() => ({ currentUser: null }));
vi.mock('../services/firebase', () => ({ auth: fakeAuth, db: null, isFirebaseConfigured: false }));

const runtimeMock = vi.hoisted(() => ({
    loadedModel: null as null | { name: string },
    stream: vi.fn(),
}));
vi.mock('../services/onDevice/runtime', () => ({ onDeviceRuntime: runtimeMock }));

import { _resetModelCooldown, _setGenaiConfig } from '../services/genaiClient';
import { engineLabel, engineReady, streamReply, type ReplyStats } from '../services/textEngine';

const sse = (...texts: string[]) => new Response(
    texts.map(t => `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: t }] } }] })}\n\n`).join(''),
    { status: 200 },
);

describe('textEngine', () => {
    beforeEach(() => {
        _setGenaiConfig({ apiKey: 'test-key', apiBase: '' });
        _resetModelCooldown();
        runtimeMock.loadedModel = null;
        runtimeMock.stream.mockReset();
    });
    afterEach(() => vi.unstubAllGlobals());

    it('streams from Gemini with history, system prompt and sampling params', async () => {
        const fetchMock = vi.fn().mockResolvedValue(sse('¡Hola', '! ¿Qué tal?'));
        vi.stubGlobal('fetch', fetchMock);
        let stats: ReplyStats | undefined;
        let text = '';
        for await (const chunk of streamReply('cloud', {
            system: 'Be a tutor.',
            history: [{ role: 'user', text: 'hola' }, { role: 'model', text: 'hola!' }],
            message: '¿cómo estás?',
            params: { temperature: 0.4, topK: 20, topP: 0.9, maxOutputTokens: 200 },
            onStats: s => (stats = s),
        })) text += chunk;

        expect(text).toBe('¡Hola! ¿Qué tal?');
        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.systemInstruction).toEqual({ parts: [{ text: 'Be a tutor.' }] });
        expect(body.contents.map((c: any) => c.role)).toEqual(['user', 'model', 'user']);
        expect(body.contents[2].parts[0].text).toBe('¿cómo estás?');
        expect(body.generationConfig).toMatchObject({ temperature: 0.4, topK: 20, topP: 0.9, maxOutputTokens: 200 });
        expect(stats).toMatchObject({ engine: 'cloud', label: 'Gemini (cloud)' });
        expect(stats!.ttftMs).toBeGreaterThanOrEqual(0);
    });

    it('routes on-device requests to the local runtime and maps its stats', async () => {
        runtimeMock.loadedModel = { name: 'Gemma 4 E2B' };
        runtimeMock.stream.mockImplementation(async function* (opts: any) {
            yield 'Hola';
            opts.onStats({ ttftMs: 120, totalMs: 900, decodeTokensPerSec: 31.5, prefillTokensPerSec: 800, decodeTokens: 22 });
        });
        expect(engineReady('device')).toBe(true);
        expect(engineLabel('device')).toBe('Gemma 4 E2B (on this device)');
        let stats: ReplyStats | undefined;
        const out: string[] = [];
        for await (const c of streamReply('device', { message: 'hi', system: 's', onStats: s => (stats = s) })) out.push(c);
        expect(out).toEqual(['Hola']);
        expect(runtimeMock.stream.mock.calls[0][0]).toMatchObject({ message: 'hi', system: 's' });
        expect(stats).toEqual({ engine: 'device', label: 'Gemma 4 E2B (on this device)', ttftMs: 120, totalMs: 900, decodeTokensPerSec: 31.5, prefillTokensPerSec: 800, outputTokens: 22 });
    });

    it('reports the on-device engine as not ready until a model is loaded', () => {
        expect(engineReady('device')).toBe(false);
        expect(engineReady('cloud')).toBe(true);
        expect(engineLabel('device')).toBe('On-device model');
    });
});
