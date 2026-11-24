import type { Plugin } from 'vite';

/**
 * Fails a production build if any output file contains one of the given secret values.
 * Guards against the Gemini API key being baked into the public JavaScript again.
 */
export function forbidSecretsInBundle(secrets: Record<string, string | undefined>): Plugin {
    const entries = Object.entries(secrets).filter(([, value]) => typeof value === 'string' && value.length >= 10) as [string, string][];
    return {
        name: 'glossos-forbid-secrets-in-bundle',
        apply: 'build',
        generateBundle(_options, bundle) {
            for (const file of Object.values(bundle)) {
                const text = file.type === 'chunk'
                    ? file.code
                    : typeof file.source === 'string' ? file.source : Buffer.from(file.source).toString('utf8');
                for (const [name, value] of entries) {
                    if (text.includes(value)) {
                        this.error(`${name} was found in ${file.fileName}. Secrets must never be shipped to the browser.`);
                    }
                }
            }
        },
    };
}
