/**
 * Tiny Markdown-to-HTML renderer for model answers (headings, bold, italics, inline code, lists,
 * tables, code blocks, paragraphs). All text is HTML-escaped first, so model output can never
 * inject markup.
 */

function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Small models sometimes write arrows as LaTeX ($\rightarrow$); show them as plain arrows. */
function normalizeSymbols(s: string): string {
    return s
        .replace(/\$?\\(?:rightarrow|Rightarrow|longrightarrow|to)\b\$?/g, '→')
        .replace(/\$?\\(?:leftarrow|Leftarrow)\b\$?/g, '←');
}

function inline(s: string): string {
    return escapeHtml(normalizeSymbols(s))
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
        .replace(/(^|[^_\w])_([^_\s][^_]*)_(?!\w)/g, '$1<em>$2</em>');
}

const isTableRow = (line: string) => /^\s*\|.*\|\s*$/.test(line);
const isTableDivider = (line: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
const cells = (line: string) => line.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());

export function renderMarkdown(src: string): string {
    const lines = src.replace(/\r\n/g, '\n').split('\n');
    const out: string[] = [];
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];

        if (/^\s*```/.test(line)) {
            const body: string[] = [];
            i++;
            while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++]);
            i++;
            out.push(`<pre><code>${escapeHtml(body.join('\n'))}</code></pre>`);
            continue;
        }

        const heading = /^(#{1,4})\s+(.*)$/.exec(line);
        if (heading) {
            const level = Math.min(heading[1].length + 2, 6); // keep headings small inside cards
            out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
            i++;
            continue;
        }

        if (isTableRow(line) && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
            const head = cells(line);
            i += 2;
            const rows: string[][] = [];
            while (i < lines.length && isTableRow(lines[i])) rows.push(cells(lines[i++]));
            out.push(`<table><thead><tr>${head.map(h => `<th>${inline(h)}</th>`).join('')}</tr></thead><tbody>${
                rows.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
            continue;
        }

        const listMatch = /^\s*([-*•]|\d+[.)])\s+/.exec(line);
        if (listMatch) {
            const ordered = /\d/.test(listMatch[1]);
            const items: string[] = [];
            while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) {
                items.push(`<li>${inline(lines[i].replace(/^\s*([-*•]|\d+[.)])\s+/, ''))}</li>`);
                i++;
            }
            out.push(ordered ? `<ol>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`);
            continue;
        }

        if (!line.trim()) {
            i++;
            continue;
        }

        const para: string[] = [];
        while (i < lines.length && lines[i].trim() && !/^\s*(```|#{1,4}\s|[-*•]\s|\d+[.)]\s)/.test(lines[i]) && !isTableRow(lines[i])) {
            para.push(inline(lines[i++]));
        }
        if (para.length) out.push(`<p>${para.join('<br>')}</p>`);
        else out.push(`<p>${inline(lines[i++])}</p>`);
    }
    return out.join('');
}
