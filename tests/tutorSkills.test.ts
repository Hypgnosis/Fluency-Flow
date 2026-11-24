import {
    buildFunctionDeclarations, buildSkillsInstruction, enabledSkills, executeToolCalls, loadSkillPrefs, newReviewMemory,
    reviewToCalls, reviewWants, runTurnReview, saveSkillPrefs,
} from '../services/tutorSkills/registry';
import { buildReviewPrompt, buildReviewSchema, detectFixedLocally, parseReview, reviewTurn, type TurnReview } from '../services/tutorSkills/turnReview';
import { parseProfileMistakes } from '../services/sessionManager';
import { BUILT_IN_SKILLS } from '../services/tutorSkills/skills';
import { normalizeWikiLang, parseInfobox, queryWikipedia } from '../services/tutorSkills/wikipedia';
import type { SkillContext, SkillServices } from '../services/tutorSkills/types';

function makeCtx(overrides: Partial<SkillServices> = {}): SkillContext {
    return {
        nativeLanguage: 'English',
        learnLanguage: 'Spanish',
        level: 'Beginner',
        services: {
            logMistake: vi.fn().mockResolvedValue(true),
            resolveMistakeByForm: vi.fn().mockResolvedValue(true),
            saveVocab: vi.fn().mockResolvedValue(undefined),
            ...overrides,
        },
    };
}

describe('skill registry', () => {
    beforeEach(() => localStorage.clear());

    it('declares only live skills to the voice model', () => {
        const decls = buildFunctionDeclarations(BUILT_IN_SKILLS);
        expect(decls.map(d => d.name)).toEqual(['lookup_wikipedia']);
        expect(decls[0]).toEqual({ name: 'lookup_wikipedia', description: expect.stringContaining('Wikipedia'), parameters: expect.objectContaining({ type: 'OBJECT' }) });
    });

    it('tells the tutor how to use its live tools', () => {
        const text = buildSkillsInstruction(BUILT_IN_SKILLS);
        expect(text).toMatch(/^TOOLS:/);
        expect(text).toContain('never repeat what you already said after a tool result');
        expect(text).toContain('- lookup_wikipedia: ');
        expect(text).not.toContain('log_mistake');
        expect(buildSkillsInstruction(enabledSkills({ lookup_wikipedia: false }))).toBe('');
    });

    it('stores on/off preferences and falls back to defaults', () => {
        expect(enabledSkills(loadSkillPrefs())).toHaveLength(BUILT_IN_SKILLS.length);
        saveSkillPrefs({ lookup_wikipedia: false });
        expect(enabledSkills(loadSkillPrefs()).map(s => s.name)).not.toContain('lookup_wikipedia');
        localStorage.setItem('glossos_tutor_skills', 'not json');
        expect(loadSkillPrefs()).toEqual({});
    });
});

describe('executeToolCalls', () => {
    it('runs a silent skill, answers with SILENT scheduling and returns its attachment', async () => {
        const ctx = makeCtx();
        const out = await executeToolCalls([{
            id: 'c1', name: 'log_mistake',
            args: { incorrect: 'Yo soy cansado', correct: 'Estoy cansado', category: 'grammar', explanation: 'Use estar for states' },
        }], BUILT_IN_SKILLS, ctx);

        expect(ctx.services.logMistake).toHaveBeenCalledWith('Estoy cansado', 'Yo soy cansado', 'Estoy cansado', 'grammar', 'Spanish');
        expect(out.responses).toEqual([{ id: 'c1', name: 'log_mistake', response: { status: 'logged' } }]);
        expect(out.attachments).toEqual([{
            kind: 'mistake', incorrect: 'Yo soy cansado', correct: 'Estoy cansado', category: 'grammar', explanation: 'Use estar for states',
        }]);
    });

    it('matches names loosely, reports unknown tools and survives failures', async () => {
        const ctx = makeCtx({ logMistake: vi.fn().mockRejectedValue(new Error('offline')) });
        const out = await executeToolCalls([
            { id: 'a', name: 'Log-Mistake', args: { incorrect: 'x', correct: 'y', category: 'nonsense' } },
            { id: 'b', name: 'launch_rockets', args: {} },
        ], BUILT_IN_SKILLS, ctx);
        expect(ctx.services.logMistake).toHaveBeenCalledWith('y', 'x', 'y', 'grammar', 'Spanish');
        expect(out.responses[0]).toMatchObject({ id: 'a', response: { error: 'offline' } });
        expect(out.responses[1]).toEqual({ id: 'b', name: 'launch_rockets', response: { error: 'Unknown tool: launch_rockets' } });
        expect(out.attachments).toEqual([]);
    });

    it('only runs skills that are enabled', async () => {
        const ctx = makeCtx();
        const out = await executeToolCalls([{ id: 'a', name: 'log_mistake', args: { incorrect: 'x', correct: 'y' } }],
            enabledSkills({ log_mistake: false }), ctx);
        expect(out.responses[0].response).toEqual({ error: 'Unknown tool: log_mistake' });
        expect(ctx.services.logMistake).not.toHaveBeenCalled();
    });
});

describe('built-in skills', () => {
    const skill = (name: string) => BUILT_IN_SKILLS.find(s => s.name === name)!;

    it('save_vocabulary saves to the deck and reports failures', async () => {
        const ctx = makeCtx();
        const ok = await skill('save_vocabulary').run(
            { word: 'la taza', meaning: 'cup', example: 'Quiero la taza.', example_translation: 'I want the cup.' }, ctx);
        expect(ctx.services.saveVocab).toHaveBeenCalledWith(
            { word: 'la taza', meaning: 'cup', example: 'Quiero la taza.', exampleTranslation: 'I want the cup.' }, 'Spanish', 'English');
        expect(ok).toMatchObject({ response: { status: 'saved' }, attachment: { kind: 'vocab', saved: true } });

        const failing = makeCtx({ saveVocab: vi.fn().mockRejectedValue(new Error('denied')) });
        expect(await skill('save_vocabulary').run({ word: 'el gato', meaning: 'cat' }, failing))
            .toMatchObject({ response: { status: 'not_saved' }, attachment: { saved: false } });
        expect((await skill('save_vocabulary').run({ word: '' }, ctx)).response).toHaveProperty('error');
    });

    it('show_card cleans rows and requires content', async () => {
        const rows = Array.from({ length: 12 }, (_, i) => ({ target: `t${i}`, native: `n${i}` }));
        const out = await skill('show_card').run({ title: 'At the café', rows: [{ target: '' }, ...rows, 'junk'], tip: 'Be polite' }, makeCtx());
        expect(out.attachment).toMatchObject({ kind: 'card', title: 'At the café', tip: 'Be polite' });
        expect((out.attachment as any).rows).toHaveLength(8);
        expect((await skill('show_card').run({ title: 'x', rows: [] }, makeCtx())).response).toHaveProperty('error');
    });

    it('mark_mistake_fixed only shows a chip when something was resolved', async () => {
        const ctx = makeCtx({ resolveMistakeByForm: vi.fn().mockResolvedValue(false) });
        const out = await skill('mark_mistake_fixed').run({ incorrect: 'yo soy cansado' }, ctx);
        expect(out).toEqual({ response: { status: 'not_found' }, attachment: undefined });
        expect(ctx.services.resolveMistakeByForm).toHaveBeenCalledWith('yo soy cansado', 'Spanish');
    });

    it('lookup_wikipedia defaults to the target language and returns text to the model', async () => {
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify({ query: { pages: [{ title: 'Frida Kahlo', extract: 'Pintora mexicana.', fullurl: 'https://es.wikipedia.org/wiki/Frida_Kahlo' }] } })))
            .mockResolvedValueOnce(new Response(JSON.stringify({ parse: { text: '' } })));
        const out = await skill('lookup_wikipedia').run({ topic: 'Frida Kahlo' }, makeCtx({ fetchImpl }));
        expect(fetchImpl.mock.calls[0][0]).toMatch(/^https:\/\/es\.wikipedia\.org\/w\/api\.php\?/);
        expect(out.response).toEqual({ title: 'Frida Kahlo', result: '--- SUMMARY ---\nPintora mexicana.' });
        expect(out.attachment).toMatchObject({ kind: 'wiki', title: 'Frida Kahlo', url: 'https://es.wikipedia.org/wiki/Frida_Kahlo', lang: 'es' });
    });

    it('lookup_wikipedia turns network failures into an error the tutor can mention', async () => {
        const out = await skill('lookup_wikipedia').run({ topic: 'x', lang: 'fr' }, makeCtx({ fetchImpl: vi.fn().mockRejectedValue(new Error('offline')) }));
        expect(out.response.error).toMatch(/Wikipedia is unavailable right now/);
    });
});

describe('wikipedia port', () => {
    it('normalizes language codes', () => {
        expect(normalizeWikiLang('ES')).toBe('es');
        expect(normalizeWikiLang('zh-hans')).toBe('zh-hans');
        expect(normalizeWikiLang('../evil')).toBe('en');
        expect(normalizeWikiLang(undefined)).toBe('en');
    });

    it('extracts infobox rows', () => {
        const html = '<table class="infobox"><tr><th>Born</th><td>6 July 1907[1]</td></tr><tr><td>no label</td></tr><tr><th>Known for</th><td>Painting</td></tr></table>';
        expect(parseInfobox(html)).toBe('Born: 6 July 1907\nKnown for: Painting');
        expect(parseInfobox('<p>none</p>')).toBe('');
    });

    it('combines infobox and summary and truncates per language like Gallery', async () => {
        const long = 'a'.repeat(6000);
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify({ query: { pages: [{ title: 'Tema', extract: long }] } })))
            .mockResolvedValueOnce(new Response(JSON.stringify({ parse: { text: '<table class="infobox"><tr><th>K</th><td>V</td></tr></table>' } })));
        const result = await queryWikipedia('tema', 'es', fetchImpl);
        expect(result!.text.startsWith('--- INFOBOX ---\nK: V\n\n--- SUMMARY ---\naaa')).toBe(true);
        expect(result!.text).toHaveLength(4500);
        expect(result!.url).toBe('https://es.wikipedia.org/wiki/Tema');
    });

    it('returns null when nothing is found', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ batchcomplete: true })));
        expect(await queryWikipedia('zzzz', 'en', fetchImpl)).toBeNull();
    });
});

describe('turn review', () => {
    const wantsAll = { mistakes: true, fixed: true, words: true, card: true };
    const input = {
        learnerText: 'yo soy cansado', tutorText: 'Se dice "estoy cansado".', nativeLanguage: 'English', learnLanguage: 'Spanish',
        level: 'Beginner', profileMistakes: [{ incorrect: 'yo tengo calor', correct: 'tengo calor' }], knownWords: ['la taza'], shownCards: [], wants: wantsAll,
    };

    it('asks only for enabled parts and includes context', () => {
        const prompt = buildReviewPrompt(input);
        expect(prompt).toContain('LEARNER said: "yo soy cansado"');
        expect(prompt).toContain('speech-recognition transcript');
        expect(prompt).toContain('1. wrong: "yo tengo calor" | right: "tengo calor"');
        expect((buildReviewSchema(wantsAll) as any).properties.fixed).toEqual({ type: 'ARRAY', items: { type: 'INTEGER' } });
        expect(prompt).toContain('skip these: "la taza"');
        const partial = { mistakes: true, fixed: false, words: false, card: false };
        expect(buildReviewPrompt({ ...input, wants: partial })).not.toContain('"new_words"');
        expect(Object.keys((buildReviewSchema(partial) as any).properties)).toEqual(['mistakes']);
        expect((buildReviewSchema(wantsAll) as any).properties.phrase_card.nullable).toBe(true);
    });

    it('parses and cleans model output', () => {
        const review = parseReview('```json\n' + JSON.stringify({
            mistakes: [{ incorrect: 'soy cansado', correct: 'estoy cansado', category: 'grammar', explanation: 'estar' }, { incorrect: 'x', correct: 'X' }, 'junk'],
            fixed: [1, 'yo tengo calor', 5],
            new_words: [{ word: 'cansado', meaning: 'tired' }, { word: 'a', meaning: 'b' }, { word: 'c', meaning: 'd' }, { word: '', meaning: 'e' }],
            phrase_card: { title: 'Café', rows: [{ target: 'Un café', native: 'A coffee' }, { target: '' }] },
        }) + '\n```', [{ incorrect: 'yo tengo calor', correct: 'tengo calor' }]);
        expect(review.mistakes).toEqual([{ incorrect: 'soy cansado', correct: 'estoy cansado', category: 'grammar', explanation: 'estar' }]);
        expect(review.fixed).toEqual(['yo tengo calor', 'yo tengo calor']);
        expect(review.new_words.map(w => w.word)).toEqual(['cansado']);
        expect(review.phrase_card).toEqual({ title: 'Café', rows: [{ target: 'Un café', native: 'A coffee' }], tip: undefined });
        expect(parseReview('not json')).toEqual({ mistakes: [], fixed: [], new_words: [], phrase_card: null });
    });

    it('maps fixed numbers to the profile, drops unknown ones and adds exact-phrase fixes', async () => {
        const generate = vi.fn().mockResolvedValue(JSON.stringify({ mistakes: [], fixed: [1, 7, 'invented'], new_words: [], phrase_card: null }));
        const review = await reviewTurn(input, generate as any);
        expect(review.fixed).toEqual(['yo tengo calor']);

        const silentModel = vi.fn().mockResolvedValue(JSON.stringify({ mistakes: [], fixed: [], new_words: [], phrase_card: null }));
        const local = await reviewTurn({
            ...input,
            learnerText: 'Tengo calor y el problema es el sol',
            profileMistakes: [{ incorrect: 'yo tengo calor', correct: 'tengo calor' }, { incorrect: 'la problema', correct: 'el problema' }],
        }, silentModel as any);
        expect(local.fixed).toEqual(['yo tengo calor', 'la problema']);
        const [models, build] = generate.mock.calls[0];
        expect(models[0]).toBe('gemini-3.5-flash-lite');
        expect(build('gemini-2.5-flash').generationConfig).toMatchObject({ responseMimeType: 'application/json', thinkingConfig: { thinkingBudget: 0 } });
    });

    it('maps reviews to skill calls once per session', () => {
        const memory = newReviewMemory();
        const review: TurnReview = {
            mistakes: [{ incorrect: 'Soy cansado', correct: 'estoy cansado', category: 'grammar', explanation: '' }],
            fixed: ['yo tengo calor'],
            new_words: [{ word: 'cansado', meaning: 'tired', example: '', example_translation: '' }],
            phrase_card: { title: 'Café', rows: [{ target: 'Un café', native: 'A coffee' }] },
        };
        expect(reviewToCalls(review, memory, wantsAll).map(c => c.name)).toEqual(['log_mistake', 'mark_mistake_fixed', 'save_vocabulary', 'show_card']);
        expect(reviewToCalls({ ...review, mistakes: [{ ...review.mistakes[0], incorrect: 'soy cansado!' }] }, memory, wantsAll)).toEqual([]);
        expect(reviewToCalls(review, newReviewMemory(), { ...wantsAll, words: false, card: false }).map(c => c.name)).toEqual(['log_mistake', 'mark_mistake_fixed']);
        expect(reviewWants(enabledSkills({ show_card: false }))).toEqual({ mistakes: true, fixed: true, words: true, card: false });
    });

    it('runs the review skills end to end and skips trivial turns', async () => {
        const ctx = makeCtx();
        const review = vi.fn().mockResolvedValue({
            mistakes: [{ incorrect: 'soy cansado', correct: 'estoy cansado', category: 'grammar', explanation: 'estar' }],
            fixed: [], new_words: [{ word: 'cansado', meaning: 'tired', example: 'Estoy cansado.', example_translation: 'I am tired.' }], phrase_card: null,
        });
        const memory = newReviewMemory();
        const attachments = await runTurnReview({
            learnerText: 'hola yo soy cansado', tutorText: 'Se dice estoy cansado.', skills: BUILT_IN_SKILLS, ctx, profileMistakes: [], memory, review,
        });
        expect(attachments.map(a => a.kind)).toEqual(['mistake', 'vocab']);
        expect(ctx.services.logMistake).toHaveBeenCalledWith('estoy cansado', 'soy cansado', 'estoy cansado', 'grammar', 'Spanish');
        expect(review.mock.calls[0][0].wants).toEqual(wantsAll);

        expect(await runTurnReview({ learnerText: 'sí', tutorText: 'Bien.', skills: BUILT_IN_SKILLS, ctx, profileMistakes: [], memory, review })).toEqual([]);
        expect(review).toHaveBeenCalledTimes(1);

        const failing = vi.fn().mockRejectedValue(new Error('503'));
        expect(await runTurnReview({ learnerText: 'yo va al mercado', tutorText: 'Fui.', skills: BUILT_IN_SKILLS, ctx, profileMistakes: [], memory, review: failing })).toEqual([]);
    });
});

describe('parseProfileMistakes', () => {
    it('reads wrong → right pairs from the learner profile text', () => {
        const profile = 'LEARNER PROFILE - Areas needing improvement:\n- "yo tengo calor" → "tengo calor" (grammar, repeated 2x)\n- "la problema" → "el problema" (vocabulary, repeated 1x)\n\nPlease adapt...';
        expect(parseProfileMistakes(profile)).toEqual([
            { incorrect: 'yo tengo calor', correct: 'tengo calor' },
            { incorrect: 'la problema', correct: 'el problema' },
        ]);
        expect(parseProfileMistakes('')).toEqual([]);
    });
});

describe('detectFixedLocally', () => {
    const profile = [
        { incorrect: 'yo tengo calor', correct: 'tengo calor' },
        { incorrect: 'la problema', correct: 'el problema' },
        { incorrect: 'yo es', correct: 'soy' },
    ];
    it('needs the right form present and the wrong form absent', () => {
        expect(detectFixedLocally('¡Tengo calor! Y el problema es el sol.', profile)).toEqual(['yo tengo calor', 'la problema']);
        expect(detectFixedLocally('yo tengo calor', profile)).toEqual([]);
        expect(detectFixedLocally('la problema es grande', profile)).toEqual([]);
    });
    it('ignores very short corrections that could match by chance', () => {
        expect(detectFixedLocally('soy de México', profile)).toEqual([]);
    });
});

