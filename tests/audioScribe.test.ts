const fakeAuth = vi.hoisted(() => ({ currentUser: null }));
vi.mock('../services/firebase', () => ({ auth: fakeAuth, db: null, isFirebaseConfigured: false }));

import { _resetModelCooldown, _setGenaiConfig } from '../services/genaiClient';
import { MAX_CLIP_SECONDS, TRANSCRIBE_MODELS, VERBATIM_PROMPT, buildAnalysisPrompt, parseAnalysis, toMono16k, transcribeClip } from '../services/audioScribe';

describe('audio scribe', () => {
    beforeEach(() => {
        _setGenaiConfig({ apiKey: 'test-key', apiBase: '' });
        _resetModelCooldown();
    });
    afterEach(() => vi.unstubAllGlobals());

    it('downmixes stereo, resamples to 16 kHz and trims long clips', () => {
        const left = new Float32Array(48_000).fill(0.5);
        const right = new Float32Array(48_000).fill(-0.5);
        const mono = toMono16k([left, right], 48_000);
        expect(mono.length).toBe(16_000);
        expect(Math.abs(mono[100])).toBeLessThan(0.001);

        const long = new Float32Array(16_000 * (MAX_CLIP_SECONDS + 5)).fill(0.25);
        expect(toMono16k([long], 16_000).length).toBe(16_000 * MAX_CLIP_SECONDS);
    });

    it('transcribes verbatim, then asks for translation, words and corrections', () => {
        expect(VERBATIM_PROMPT).toContain('Do not correct grammar');
        expect(TRANSCRIBE_MODELS[0]).toBe('gemini-3.5-transcribe');
        const p = buildAnalysisPrompt('Ayer yo va al mercado', 'English', 'Spanish', 'Beginner');
        expect(p).toContain('Transcript: """Ayer yo va al mercado"""');
        expect(p).toContain('beginner learner of Spanish');
        expect(p).toContain('"corrections"');
        expect(p).toContain('up to 5 useful Spanish words');
    });

    it('parses the analysis, keeping the verbatim transcript', () => {
        const r = parseAnalysis('```json\n' + JSON.stringify({
            detected_language: 'Spanish', translation: 'Yesterday I went to the market.',
            words: [{ word: 'el mercado', meaning: 'market', example: 'Ayer fui al mercado.', example_translation: 'Yesterday I went to the market.' }, { word: '' }],
            corrections: [{ incorrect: 'yo va', correct: 'yo fui', explanation: 'past tense' }, { incorrect: 'x', correct: 'X' }],
        }) + '\n```', 'Ayer yo va al mercado.');
        expect(r).toEqual({
            detectedLanguage: 'Spanish', transcript: 'Ayer yo va al mercado.', translation: 'Yesterday I went to the market.',
            words: [{ word: 'el mercado', meaning: 'market', example: 'Ayer fui al mercado.', exampleTranslation: 'Yesterday I went to the market.' }],
            corrections: [{ incorrect: 'yo va', correct: 'yo fui', explanation: 'past tense' }],
        });
        expect(() => parseAnalysis('not json', 'x')).toThrow('unexpected format');
    });

    it('sends the audio to the transcription model, then the text to the analysis model', async () => {
        const reply = (text: string) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 });
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(reply('Ayer yo va al mercado.'))
            .mockResolvedValueOnce(reply(JSON.stringify({ detected_language: 'Spanish', translation: 'Yesterday...', words: [], corrections: [] })));
        vi.stubGlobal('fetch', fetchMock);
        const wav = new Blob([new Uint8Array([82, 73, 70, 70])], { type: 'audio/wav' });
        const result = await transcribeClip({ wav, nativeLanguage: 'English', learnLanguage: 'Spanish', level: 'Beginner' });
        expect(result.transcript).toBe('Ayer yo va al mercado.');

        const [url1, init1] = fetchMock.mock.calls[0];
        expect(url1).toContain('gemini-3.5-transcribe:generateContent');
        const body1 = JSON.parse(init1.body);
        expect(body1.contents[0].parts[0]).toEqual({ inlineData: { mimeType: 'audio/wav', data: 'UklGRg==' } });
        expect(body1.generationConfig.thinkingConfig).toBeUndefined();

        const body2 = JSON.parse(fetchMock.mock.calls[1][1].body);
        expect(body2.contents[0].parts).toHaveLength(1);
        expect(body2.contents[0].parts[0].text).toContain('Ayer yo va al mercado.');
        expect(body2.generationConfig).toMatchObject({ responseMimeType: 'application/json', temperature: 0 });
    });

    it('skips the analysis when there is no speech', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '  ' }] } }] }), { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        const result = await transcribeClip({ wav: new Blob([new Uint8Array(4)]), nativeLanguage: 'English', learnLanguage: 'Spanish', level: 'Beginner' });
        expect(result).toEqual({ detectedLanguage: '', transcript: '', translation: '', words: [], corrections: [] });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});

import { cleanForReading, replySegments } from '../services/readAloud';

describe('read aloud', () => {
    it('strips markdown, tables, code and emoji before speaking', () => {
        expect(cleanForReading('**Estoy** cansado 😴\n- uno\n| a | b |\n```x```')).toBe('Estoy cansado uno');
    });

    it('speaks target-language text and [native explanations] with different voices', () => {
        expect(replySegments('¡Muy bien! **Estoy cansado.** [In English: use estar for feelings.] ¿Y tú?', 'es-MX', 'en-US')).toEqual([
            { text: '¡Muy bien! Estoy cansado.', locale: 'es-MX' },
            { text: 'use estar for feelings.', locale: 'en-US' },
            { text: '¿Y tú?', locale: 'es-MX' },
        ]);
        expect(replySegments('Hola [ ]', 'es-MX', 'en-US')).toEqual([{ text: 'Hola', locale: 'es-MX' }]);
    });
});
