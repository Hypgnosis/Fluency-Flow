/**
 * On-device benchmark, adapted from Google AI Edge Gallery's ui/benchmark (Apache License 2.0).
 * Gallery calls the native LiteRT-LM benchmark with fixed prefill/decode token counts; the web
 * runtime exposes per-message stats instead, so each run sends a prompt of roughly the requested
 * size and reads `getBenchmarkInfo()` through the runtime.
 */

import { onDeviceRuntime, type DeviceRunStats } from './runtime';

export interface ValueSeries {
    values: number[];
    min: number;
    max: number;
    avg: number;
    median: number;
    pct25: number;
    pct75: number;
}

/** Percentile with linear interpolation (as Gallery computes its ValueSeries). */
function percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const idx = (sorted.length - 1) * p;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export function toSeries(values: number[]): ValueSeries {
    const clean = values.filter(v => Number.isFinite(v));
    const sorted = [...clean].sort((a, b) => a - b);
    const sum = clean.reduce((a, b) => a + b, 0);
    return {
        values: clean,
        min: sorted[0] ?? 0,
        max: sorted[sorted.length - 1] ?? 0,
        avg: clean.length ? sum / clean.length : 0,
        median: percentile(sorted, 0.5),
        pct25: percentile(sorted, 0.25),
        pct75: percentile(sorted, 0.75),
    };
}

export interface BenchmarkResult {
    id: string;
    modelId: string;
    modelName: string;
    startedAt: number;
    endedAt: number;
    runs: number;
    prefillTarget: number;
    decodeTarget: number;
    adapter?: string;
    initMs?: number;
    stats: {
        ttftMs: ValueSeries;
        prefillTokensPerSec: ValueSeries;
        decodeTokensPerSec: ValueSeries;
        decodeTokens: ValueSeries;
    };
}

const PADDING = 'The quick brown fox jumps over the lazy dog while the market opens and people buy fresh bread. ';

/** A prompt of roughly `tokens` tokens (about 4 characters per token) asking for a long answer. */
export function benchmarkPrompt(tokens: number): string {
    const target = Math.max(16, tokens) * 4;
    const filler = PADDING.repeat(Math.ceil(target / PADDING.length)).slice(0, target);
    return `${filler}\n\nIgnore the text above. Write every number from one to three hundred as Spanish words (uno, dos, tres, ...), separated by commas. Do not stop early and do not add anything else.`;
}

export async function runBenchmark(opts: {
    runs: number;
    prefillTokens: number;
    decodeTokens: number;
    adapter?: string;
    onProgress?: (run: number, stats: DeviceRunStats) => void;
    signal?: AbortSignal;
}): Promise<BenchmarkResult> {
    const model = onDeviceRuntime.loadedModel;
    if (!model) throw new Error('Load an on-device model first.');
    const startedAt = Date.now();
    const all: DeviceRunStats[] = [];
    for (let i = 0; i < opts.runs; i++) {
        if (opts.signal?.aborted) break;
        let stats: DeviceRunStats | undefined;
        // Greedy-ish sampling keeps runs comparable.
        for await (const _ of onDeviceRuntime.stream({
            message: benchmarkPrompt(opts.prefillTokens),
            params: { maxOutputTokens: opts.decodeTokens, temperature: 0.01, topK: 1, topP: 1 },
            signal: opts.signal,
            onStats: s => (stats = s),
        })) { /* drain */ }
        if (stats) {
            all.push(stats);
            opts.onProgress?.(i + 1, stats);
        }
    }
    const status = onDeviceRuntime.status;
    return {
        id: `${startedAt}`,
        modelId: model.id,
        modelName: model.name,
        startedAt,
        endedAt: Date.now(),
        runs: all.length,
        prefillTarget: opts.prefillTokens,
        decodeTarget: opts.decodeTokens,
        adapter: opts.adapter,
        initMs: status.state === 'ready' ? status.initMs : undefined,
        stats: {
            ttftMs: toSeries(all.map(s => s.ttftMs)),
            prefillTokensPerSec: toSeries(all.map(s => s.prefillTokensPerSec ?? NaN)),
            decodeTokensPerSec: toSeries(all.map(s => s.decodeTokensPerSec ?? NaN)),
            decodeTokens: toSeries(all.map(s => s.decodeTokens ?? NaN)),
        },
    };
}

const RESULTS_KEY = 'glossos_benchmarks';

export function loadBenchmarks(): BenchmarkResult[] {
    try {
        const parsed = JSON.parse(localStorage.getItem(RESULTS_KEY) || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

export function saveBenchmark(result: BenchmarkResult): BenchmarkResult[] {
    const next = [result, ...loadBenchmarks()].slice(0, 30);
    try { localStorage.setItem(RESULTS_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
    return next;
}

export function deleteBenchmark(id: string): BenchmarkResult[] {
    const next = loadBenchmarks().filter(r => r.id !== id);
    try { localStorage.setItem(RESULTS_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
    return next;
}

/** CSV like Gallery's "copy as CSV". */
export function benchmarksToCsv(results: BenchmarkResult[]): string {
    const header = 'model,started,runs,prefill_target,decode_target,init_ms,ttft_ms_median,prefill_tps_median,decode_tps_median,decode_tps_min,decode_tps_max,adapter';
    const rows = results.map(r => [
        r.modelName,
        new Date(r.startedAt).toISOString(),
        r.runs,
        r.prefillTarget,
        r.decodeTarget,
        r.initMs ?? '',
        r.stats.ttftMs.median.toFixed(0),
        r.stats.prefillTokensPerSec.median.toFixed(1),
        r.stats.decodeTokensPerSec.median.toFixed(1),
        r.stats.decodeTokensPerSec.min.toFixed(1),
        r.stats.decodeTokensPerSec.max.toFixed(1),
        `"${(r.adapter ?? '').replace(/"/g, "'")}"`,
    ].join(','));
    return [header, ...rows].join('\n');
}
