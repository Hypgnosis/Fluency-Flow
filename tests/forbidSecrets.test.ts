import { forbidSecretsInBundle } from '../vite-plugins/forbidSecrets';

function runPlugin(secrets: Record<string, string | undefined>, files: Record<string, string>) {
    const plugin = forbidSecretsInBundle(secrets) as any;
    const bundle = Object.fromEntries(Object.entries(files).map(([fileName, code]) =>
        [fileName, fileName.endsWith('.js') ? { type: 'chunk', fileName, code } : { type: 'asset', fileName, source: code }]));
    const ctx = { error: (msg: string) => { throw new Error(msg); } };
    return () => plugin.generateBundle.call(ctx, {}, bundle);
}

describe('forbidSecretsInBundle', () => {
    it('only runs for production builds', () => {
        expect(forbidSecretsInBundle({}).apply).toBe('build');
    });

    it('fails the build when a secret appears in a chunk or asset', () => {
        const secret = 'AIzaSyFAKE-not-a-real-key-123';
        expect(runPlugin({ GEMINI_API_KEY: secret }, { 'index.js': `const k="${secret}"` }))
            .toThrow('GEMINI_API_KEY was found in index.js');
        expect(runPlugin({ GEMINI_API_KEY: secret }, { 'index.html': `<script>${secret}</script>` }))
            .toThrow('index.html');
    });

    it('passes clean bundles and ignores empty or short values', () => {
        expect(runPlugin({ GEMINI_API_KEY: 'AIzaSyFAKE-not-a-real-key-123' }, { 'index.js': 'console.log(1)' })).not.toThrow();
        expect(runPlugin({ GEMINI_API_KEY: '', OTHER: 'short' }, { 'index.js': 'short' })).not.toThrow();
    });
});
