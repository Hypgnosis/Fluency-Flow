/*
 * GLOSSOS service worker: lets the app open without a connection, so on-device (offline) models
 * can be used anywhere.
 *
 * - App shell: every built file listed in /sw-manifest.json is cached at install (cache-first).
 * - Pages: network-first, falling back to the cached index.html when offline.
 * - /litert-lm/*: the on-device runtime's WebAssembly, cached the first time it is used.
 * - Never touches /api/*, other origins (Firebase, Gemini, Hugging Face), or non-GET requests.
 * - Downloaded models live in the Origin Private File System, managed by the app (see
 *   services/onDevice/modelStore.ts); the service worker never touches them.
 */

const SHELL_PREFIX = 'glossos-shell-';
const RUNTIME_CACHE = 'glossos-runtime-v1';

self.addEventListener('install', event => {
    event.waitUntil((async () => {
        try {
            const res = await fetch('/sw-manifest.json', { cache: 'no-store' });
            if (res.ok) {
                const { version, files } = await res.json();
                const cache = await caches.open(`${SHELL_PREFIX}${version}`);
                await cache.addAll(files);
            }
        } catch (err) {
            // Offline during install: the previous shell stays in use.
            console.warn('[GLOSSOS-SW] Shell precache failed:', err);
        }
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        try {
            const names = await caches.keys();
            const shells = names.filter(n => n.startsWith(SHELL_PREFIX)).sort();
            const newest = shells[shells.length - 1];
            await Promise.all(shells.filter(n => n !== newest).map(n => caches.delete(n)));
        } catch { /* nothing to clean */ }
        await self.clients.claim();
    })());
});

// Every cache call is guarded: if Cache Storage misbehaves, requests simply go to the network.
async function safeMatch(request) {
    try {
        return await caches.match(request);
    } catch {
        return undefined;
    }
}

async function networkFirstPage(request) {
    try {
        return await fetch(request);
    } catch {
        return (await safeMatch('/index.html')) || (await safeMatch('/')) || Response.error();
    }
}

async function cacheFirst(request, cacheName) {
    const cached = await safeMatch(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok) {
        caches.open(cacheName).then(cache => cache.put(request, response.clone())).catch(() => undefined);
    }
    return response;
}

self.addEventListener('fetch', event => {
    const { request } = event;
    if (request.method !== 'GET') return;
    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;
    if (url.pathname.startsWith('/api/') || url.pathname === '/sw.js' || url.pathname === '/sw-manifest.json') return;

    if (request.mode === 'navigate') {
        event.respondWith(networkFirstPage(request));
        return;
    }
    event.respondWith(cacheFirst(request, RUNTIME_CACHE));
});
