import { renderMarkdown } from '../utils/miniMarkdown';
import { WRITING_TEMPLATES, buildWritingPrompt, chatTutorSystemPrompt } from '../services/tutorPrompts';
import { benchmarkPrompt, benchmarksToCsv, toSeries, type BenchmarkResult } from '../services/onDevice/benchmark';
import { ON_DEVICE_MODELS, findModel, formatBytes, modelUrl } from '../services/onDevice/models';
import { deleteModel, downloadModel, getModelBlob, isDownloaded, modelFileName, StorageFullError } from '../services/onDevice/modelStore';
import { offlineAssets } from '../vite-plugins/offlineAssets';

describe('renderMarkdown', () => {
    it('escapes HTML so model output cannot inject markup', () => {
        const html = renderMarkdown('<img src=x onerror=alert(1)> **bold** <script>alert(1)</script>');
        expect(html).not.toContain('<img');
        expect(html).not.toContain('<script');
        expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
        expect(html).toContain('<strong>bold</strong>');
    });

    it('renders lists, tables, headings and code', () => {
        expect(renderMarkdown('- uno\n- dos')).toBe('<ul><li>uno</li><li>dos</li></ul>');
        expect(renderMarkdown('1. a\n2. b')).toBe('<ol><li>a</li><li>b</li></ol>');
        expect(renderMarkdown('| Yo | Tú |\n|---|---|\n| hablo | hablas |'))
            .toBe('<table><thead><tr><th>Yo</th><th>Tú</th></tr></thead><tbody><tr><td>hablo</td><td>hablas</td></tr></tbody></table>');
        expect(renderMarkdown('## Title')).toBe('<h4>Title</h4>');
        expect(renderMarkdown('```\n<b>x</b>\n```')).toBe('<pre><code>&lt;b&gt;x&lt;/b&gt;</code></pre>');
        expect(renderMarkdown('Hola *mundo* y `code`\nsegunda')).toBe('<p>Hola <em>mundo</em> y <code>code</code><br>segunda</p>');
        expect(renderMarkdown('**yo va** $\\rightarrow$ **yo fui**')).toBe('<p><strong>yo va</strong> → <strong>yo fui</strong></p>');
        expect(renderMarkdown('a \\to b, tomorrow')).toBe('<p>a → b, tomorrow</p>');
    });
});

describe('tutor prompts', () => {
    const ctx = { nativeLanguage: 'English', learnLanguage: 'Spanish', level: 'Beginner' };

    it('builds a short level-aware chat prompt', () => {
        const p = chatTutorSystemPrompt(ctx);
        expect(p).toContain('Spanish tutor');
        expect(p).toContain('explanation in English');
        expect(p).toContain('**bold**');
        expect(chatTutorSystemPrompt({ ...ctx, level: 'Advanced' })).toContain('idioms');
    });

    it('builds Writing Lab prompts with options, like Gallery Prompt Lab', () => {
        const byId = Object.fromEntries(WRITING_TEMPLATES.map(t => [t.id, t]));
        expect(buildWritingPrompt(byId.rewrite, ctx, ' hola ', 'casual')).toBe('Rewrite the following text in Spanish using a casual tone: hola');
        expect(buildWritingPrompt(byId.rewrite, ctx, 'hola')).toContain('formal tone');
        expect(buildWritingPrompt(byId.translate, ctx, 'hi', 'to-native')).toContain('into natural English');
        expect(buildWritingPrompt(byId.summarize, ctx, 'x')).toBe('Please summarize the following in key bullet points (3-5): x');
        expect(buildWritingPrompt(byId.free, ctx, 'anything')).toBe('anything');
        expect(buildWritingPrompt(byId.correct, ctx, 'yo soy cansado')).toMatch(/^Correct this Spanish text written by a beginner learner/);
        WRITING_TEMPLATES.forEach(t => expect(t.examples.length).toBeGreaterThan(0));
    });
});

describe('benchmark stats', () => {
    it('computes Gallery-style value series with linear percentiles', () => {
        const s = toSeries([10, 30, 20, 40, NaN]);
        expect(s).toMatchObject({ min: 10, max: 40, avg: 25, median: 25, pct25: 17.5, pct75: 32.5 });
        expect(toSeries([])).toMatchObject({ min: 0, max: 0, avg: 0, median: 0 });
    });

    it('builds prompts of roughly the requested size and exports CSV', () => {
        expect(benchmarkPrompt(256).length).toBeGreaterThan(1000);
        expect(benchmarkPrompt(1).length).toBeGreaterThan(60);
        const series = toSeries([12.5]);
        const result: BenchmarkResult = {
            id: '1', modelId: 'gemma-4-e2b', modelName: 'Gemma 4 E2B', startedAt: 0, endedAt: 1, runs: 1, prefillTarget: 256, decodeTarget: 128,
            adapter: 'nvidia "blackwell"', initMs: 4200, stats: { ttftMs: toSeries([300]), prefillTokensPerSec: series, decodeTokensPerSec: series, decodeTokens: series },
        };
        const csv = benchmarksToCsv([result]).split('\n');
        expect(csv[0]).toMatch(/^model,started,runs/);
        expect(csv[1]).toBe(`Gemma 4 E2B,${new Date(0).toISOString()},1,256,128,4200,300,12.5,12.5,12.5,12.5,"nvidia 'blackwell'"`);
    });
});

describe('model catalog', () => {
    it('pins web model files to a commit', () => {
        const e2b = findModel('gemma-4-e2b')!;
        expect(e2b.recommended).toBe(true);
        expect(modelUrl(e2b)).toBe('https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/2e12bfd869b2962984f97a1f2a26807316d534cc/gemma-4-E2B-it-gpu.litertlm');
        ON_DEVICE_MODELS.forEach(m => {
            expect(m.sha256).toMatch(/^[0-9a-f]{64}$/);
            expect(m.file.endsWith('-gpu.litertlm')).toBe(true);
        });
        expect(formatBytes(2_340_870_772)).toBe('2.34 GB');
        expect(formatBytes(5_000_000)).toBe('5 MB');
    });
});

/** In-memory stand-in for the Origin Private File System. */
function fakeOpfs() {
    const files = new Map<string, Uint8Array>();
    const dir = {
        getFileHandle: async (name: string, opts?: { create?: boolean }) => {
            if (!files.has(name) && !opts?.create) throw new DOMException('missing', 'NotFoundError');
            if (!files.has(name)) files.set(name, new Uint8Array());
            return {
                getFile: async () => new File([files.get(name)!], name),
                createWritable: async () => {
                    const parts: Uint8Array[] = [];
                    return new WritableStream<Uint8Array>({
                        write: chunk => { parts.push(chunk); },
                        close: () => {
                            const total = parts.reduce((n, p) => n + p.length, 0);
                            const out = new Uint8Array(total);
                            let o = 0;
                            parts.forEach(p => { out.set(p, o); o += p.length; });
                            files.set(name, out);
                        },
                        abort: () => { /* discard, like OPFS */ },
                    });
                },
            };
        },
        removeEntry: async (name: string) => { files.delete(name); },
    };
    return { files, root: { getDirectoryHandle: async () => dir } };
}

describe('modelStore (OPFS)', () => {
    const model = { ...ON_DEVICE_MODELS[0], sizeBytes: 10 };
    let fs: ReturnType<typeof fakeOpfs>;

    beforeEach(() => {
        fs = fakeOpfs();
        vi.stubGlobal('navigator', {
            storage: {
                getDirectory: async () => fs.root,
                estimate: async () => ({ usage: 0, quota: 1_000 }),
                persisted: async () => false,
                persist: async () => true,
            },
        });
    });
    afterEach(() => vi.unstubAllGlobals());

    const body = (bytes: number[]) => new Response(new ReadableStream({
        start(c) { c.enqueue(new Uint8Array(bytes.slice(0, 6))); c.enqueue(new Uint8Array(bytes.slice(6))); c.close(); },
    }));

    it('downloads with progress, then serves the stored file', async () => {
        const progress: number[] = [];
        const fetchImpl = vi.fn().mockResolvedValue(body([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]));
        await downloadModel(model, { fetchImpl, onProgress: p => progress.push(p.loadedBytes) });
        expect(fetchImpl.mock.calls[0][0]).toBe(modelUrl(model));
        expect(progress[progress.length - 1]).toBe(10);
        expect(await isDownloaded(model)).toBe(true);
        expect((await getModelBlob(model))!.size).toBe(10);
        expect([...fs.files.keys()]).toEqual([modelFileName(model)]);
        await deleteModel(model);
        expect(await isDownloaded(model)).toBe(false);
        expect(await getModelBlob(model)).toBeNull();
    });

    it('rejects and removes an incomplete download', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(body([1, 2, 3]));
        await expect(downloadModel(model, { fetchImpl })).rejects.toThrow('Download incomplete (3 of 10 bytes)');
        expect(await isDownloaded(model)).toBe(false);
    });

    it('checks free space before downloading', async () => {
        const big = { ...model, sizeBytes: 5_000 };
        const fetchImpl = vi.fn();
        await expect(downloadModel(big, { fetchImpl })).rejects.toBeInstanceOf(StorageFullError);
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('reports HTTP failures', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(new Response('nope', { status: 404, statusText: 'Not Found' }));
        await expect(downloadModel(model, { fetchImpl })).rejects.toThrow('Download failed (404 Not Found)');
    });
});

describe('offlineAssets build plugin', () => {
    it('emits a service-worker manifest of the built files', () => {
        const plugin = offlineAssets() as any;
        const emitted: any[] = [];
        plugin.generateBundle.call({ emitFile: (f: any) => emitted.push(f) }, {}, {
            'assets/index-abc.js': {}, 'assets/index-abc.js.map': {}, 'assets/index-xyz.css': {}, 'index.html': {},
        });
        const manifest = JSON.parse(emitted[0].source);
        expect(emitted[0].fileName).toBe('sw-manifest.json');
        expect(manifest.files).toEqual(['/', '/index.html', '/assets/index-abc.js', '/assets/index-xyz.css']);
        expect(typeof manifest.version).toBe('number');
    });
});

import { describeAuthError } from '../utils/authErrors';

describe('describeAuthError', () => {
    it('explains configuration problems instead of "please try again"', () => {
        expect(describeAuthError({ code: 'auth/unauthorized-domain' }, 'google')).toContain('Authorized domains');
        expect(describeAuthError({ code: 'auth/admin-restricted-operation' }, 'guest')).toContain('Anonymous');
        expect(describeAuthError({ code: 'auth/operation-not-allowed' }, 'email-sign-in')).toContain('Sign-in method');
        expect(describeAuthError({ code: 'auth/popup-blocked' }, 'google')).toContain('pop-ups');
        expect(describeAuthError({ code: 'auth/invalid-credential' }, 'email-sign-in')).toContain('Invalid email or password');
        expect(describeAuthError({ code: 'auth/email-already-in-use' }, 'email-sign-up')).toContain('already exists');
    });

    it('reads codes from messages and falls back with the code shown', () => {
        expect(describeAuthError(new Error('Firebase: Error (auth/weak-password).'), 'email-sign-up')).toContain('6 characters');
        expect(describeAuthError({ code: 'auth/something-new' }, 'guest')).toBe('Guest sign-in failed. (auth/something-new)');
        expect(describeAuthError(new Error('boom'), 'google')).toBe('Google sign-in failed. Please try again.');
    });
});
