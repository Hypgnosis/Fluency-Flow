/**
 * Small versioned key-value store for billing records. Production uses Netlify Blobs (no extra
 * credentials needed inside Netlify Functions); tests use the in-memory version.
 *
 * Blobs has no atomic increment, so every change goes through `update`, a compare-and-set loop
 * on the record's ETag: two requests changing the same account never lose each other's writes.
 */

export interface VersionedStore {
    get<T>(key: string): Promise<{ value: T | null; etag?: string }>;
    /** Writes only if the record still has `etag` (or does not exist yet, when etag is undefined). */
    put<T>(key: string, value: T, etag: string | undefined): Promise<boolean>;
}

export class ConflictError extends Error {}

/** Reads `key`, applies `change`, and writes it back if nobody else wrote in between. */
export async function update<T>(store: VersionedStore, key: string, change: (current: T | null) => T, tries = 8): Promise<T> {
    for (let i = 0; i < tries; i++) {
        const { value, etag } = await store.get<T>(key);
        const next = change(value === null ? null : structuredClone(value));
        if (await store.put(key, next, etag)) return next;
        await new Promise(r => setTimeout(r, 15 + Math.random() * 40 * (i + 1)));
    }
    throw new ConflictError(`Too many concurrent updates to ${key}`);
}

export function memoryStore(): VersionedStore & { dump(): Record<string, unknown> } {
    const data = new Map<string, { value: unknown; etag: string }>();
    let version = 0;
    return {
        async get<T>(key: string) {
            const entry = data.get(key);
            return entry ? { value: structuredClone(entry.value) as T, etag: entry.etag } : { value: null };
        },
        async put<T>(key: string, value: T, etag: string | undefined) {
            const entry = data.get(key);
            if (etag === undefined ? entry !== undefined : entry?.etag !== etag) return false;
            data.set(key, { value: structuredClone(value), etag: `v${++version}` });
            return true;
        },
        dump() {
            return Object.fromEntries([...data].map(([k, v]) => [k, v.value]));
        },
    };
}

/** Netlify Blobs store with strong consistency (reads see the latest write). */
export async function blobsStore(name = 'glossos-billing'): Promise<VersionedStore> {
    const { getStore } = await import('@netlify/blobs');
    const store = getStore({ name, consistency: 'strong' });
    return {
        async get<T>(key: string) {
            const res = await store.getWithMetadata(key, { type: 'json' });
            return res ? { value: res.data as T, etag: res.etag } : { value: null };
        },
        async put<T>(key: string, value: T, etag: string | undefined) {
            const res = await store.setJSON(key, value, etag === undefined ? { onlyIfNew: true } : { onlyIfMatch: etag });
            return res.modified;
        },
    };
}
