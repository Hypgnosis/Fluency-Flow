import fs from 'fs';
import path from 'path';
import type { Plugin } from 'vite';

/** Public URL path where the LiteRT-LM WebAssembly files are served. */
export const LITERT_WASM_URL = '/litert-lm/';

const WASM_CONTENT_TYPES: Record<string, string> = {
    '.wasm': 'application/wasm',
    '.js': 'text/javascript',
};

function litertWasmDir(root: string): string {
    return path.resolve(root, 'node_modules/@litert-lm/core/wasm');
}

/**
 * Offline support for production builds:
 * - Serves (dev) and copies (build) the LiteRT-LM WebAssembly runtime to /litert-lm/, so on-device
 *   models load from this site instead of a CDN and keep working offline.
 * - Emits `sw-manifest.json`, the list of built files the service worker (public/sw.js) caches so
 *   the app shell opens without a connection.
 */
export function offlineAssets(): Plugin {
    let root = process.cwd();
    let outDir = 'dist';
    return {
        name: 'glossos-offline-assets',
        configResolved(config) {
            root = config.root;
            outDir = path.resolve(config.root, config.build.outDir);
        },
        configureServer(server) {
            server.middlewares.use(LITERT_WASM_URL, (req, res, next) => {
                const name = path.basename((req.url || '').split('?')[0]);
                const file = path.join(litertWasmDir(root), name);
                if (!name || !fs.existsSync(file)) return next();
                res.setHeader('Content-Type', WASM_CONTENT_TYPES[path.extname(name)] ?? 'application/octet-stream');
                fs.createReadStream(file).pipe(res);
            });
        },
        generateBundle(_options, bundle) {
            const files = Object.keys(bundle)
                .filter(name => !name.endsWith('.map') && name !== 'sw-manifest.json')
                .map(name => `/${name}`);
            this.emitFile({
                type: 'asset',
                fileName: 'sw-manifest.json',
                // Deduplicated: Cache.addAll() rejects a list that contains the same URL twice.
                source: JSON.stringify({ version: Date.now(), files: [...new Set(['/', '/index.html', ...files])] }, null, 2),
            });
        },
        closeBundle() {
            const src = litertWasmDir(root);
            if (!fs.existsSync(src) || !fs.existsSync(outDir)) return;
            const dest = path.join(outDir, LITERT_WASM_URL);
            fs.mkdirSync(dest, { recursive: true });
            for (const name of fs.readdirSync(src)) {
                if (WASM_CONTENT_TYPES[path.extname(name)]) fs.copyFileSync(path.join(src, name), path.join(dest, name));
            }
        },
    };
}
