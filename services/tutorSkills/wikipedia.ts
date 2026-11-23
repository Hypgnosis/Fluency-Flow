/**
 * Wikipedia lookup for the tutor. Port of Google AI Edge Gallery's built-in `query-wikipedia` skill
 * (skills/built-in/query-wikipedia, Apache License 2.0): one search hit's intro extract, plus the
 * article's infobox, truncated per language.
 */

/** Gallery's per-language character limits (other languages use the default). */
const LIMITS: Record<string, number> = { zh: 1500, fr: 4300, es: 4500 };
const DEFAULT_LIMIT = 5000;
const MAX_INFOBOX_ROWS = 25;

export interface WikiResult {
    title: string;
    url: string;
    extract: string;
    infobox: string;
    /** INFOBOX + SUMMARY text, truncated, as returned to the model. */
    text: string;
    lang: string;
}

export function normalizeWikiLang(lang: unknown): string {
    const l = String(lang ?? '').trim().toLowerCase();
    return /^[a-z]{2,3}(-[a-z]{2,8})?$/.test(l) ? l : 'en';
}

function apiUrl(lang: string, params: Record<string, string>): string {
    const qs = new URLSearchParams({ format: 'json', formatversion: '2', origin: '*', ...params });
    return `https://${lang}.wikipedia.org/w/api.php?${qs}`;
}

/** Extracts "label: value" lines from the first `table.infobox` in article HTML. */
export function parseInfobox(html: string): string {
    if (typeof DOMParser === 'undefined' || !html) return '';
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const table = doc.querySelector('table.infobox');
    if (!table) return '';
    const clean = (s: string | null | undefined) => (s ?? '').replace(/\[\d+\]/g, '').replace(/\s+/g, ' ').trim();
    const lines: string[] = [];
    table.querySelectorAll('tr').forEach(row => {
        if (lines.length >= MAX_INFOBOX_ROWS) return;
        const label = clean(row.querySelector('th')?.textContent);
        const value = clean(row.querySelector('td')?.textContent);
        if (label && value) lines.push(`${label}: ${value}`);
    });
    return lines.join('\n');
}

export async function queryWikipedia(
    topic: string,
    langInput: string,
    fetchImpl: typeof fetch = fetch,
): Promise<WikiResult | null> {
    const lang = normalizeWikiLang(langInput);
    const search = await fetchImpl(apiUrl(lang, {
        action: 'query',
        generator: 'search',
        gsrsearch: topic,
        gsrlimit: '1',
        prop: 'extracts|info',
        exintro: '1',
        explaintext: '1',
        inprop: 'url',
    }));
    if (!search.ok) throw new Error(`Wikipedia search failed (${search.status})`);
    const page = (await search.json())?.query?.pages?.[0];
    if (!page?.title) return null;

    let infobox = '';
    try {
        const parsed = await fetchImpl(apiUrl(lang, { action: 'parse', page: page.title, prop: 'text', section: '0' }));
        if (parsed.ok) infobox = parseInfobox((await parsed.json())?.parse?.text ?? '');
    } catch { /* the infobox is optional */ }

    const extract = String(page.extract ?? '').trim();
    const full = `${infobox ? `--- INFOBOX ---\n${infobox}\n\n` : ''}--- SUMMARY ---\n${extract}`;
    return {
        title: page.title,
        url: page.fullurl || `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`,
        extract,
        infobox,
        text: full.slice(0, LIMITS[lang.split('-')[0]] ?? DEFAULT_LIMIT),
        lang,
    };
}
