import React, { useEffect, useRef, useState } from 'react';
import {
    benchmarksToCsv, deleteBenchmark, loadBenchmarks, runBenchmark, saveBenchmark, type BenchmarkResult, type ValueSeries,
} from '../../services/onDevice/benchmark';
import { webGpuStatus } from '../../services/onDevice/runtime';
import { useOnDeviceStatus } from './useOnDevice';

const MONO = { fontFamily: "'IBM Plex Mono', monospace" };
type Agg = 'median' | 'avg' | 'min' | 'max';

const pick = (s: ValueSeries, agg: Agg) => s[agg];

/** Gallery-style benchmark: speed of the loaded on-device model on this hardware. */
export const BenchmarkPanel: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
    const status = useOnDeviceStatus();
    const [runs, setRuns] = useState(3);
    const [prefill, setPrefill] = useState(256);
    const [decode, setDecode] = useState(128);
    const [running, setRunning] = useState<string | null>(null);
    const [results, setResults] = useState<BenchmarkResult[]>(() => loadBenchmarks());
    const [agg, setAgg] = useState<Agg>('median');
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const abort = useRef<AbortController | null>(null);

    useEffect(() => () => abort.current?.abort(), []);

    const start = async () => {
        setError(null);
        const controller = new AbortController();
        abort.current = controller;
        setRunning(`Run 1 of ${runs}…`);
        try {
            const gpu = await webGpuStatus();
            const result = await runBenchmark({
                runs, prefillTokens: prefill, decodeTokens: decode, adapter: gpu.adapter, signal: controller.signal,
                onProgress: done => setRunning(done < runs ? `Run ${done + 1} of ${runs}…` : 'Finishing…'),
            });
            if (result.runs > 0) setResults(saveBenchmark(result));
        } catch (err) {
            if ((err as Error).name !== 'AbortError') setError((err as Error).message);
        } finally {
            setRunning(null);
            abort.current = null;
        }
    };

    const copyCsv = async () => {
        await navigator.clipboard?.writeText(benchmarksToCsv(results)).catch(() => undefined);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };

    const ready = status.state === 'ready';
    const number = (value: number, digits = 1) => (Number.isFinite(value) && value > 0 ? value.toFixed(digits) : '—');

    return (
        <div className="p-4 sm:p-6 max-w-2xl mx-auto space-y-4">
            <div className="flex items-center justify-between">
                <h2 className="text-white text-lg font-bold">Benchmark</h2>
                {onBack && <button onClick={onBack} className="text-xs text-slate-500 hover:text-slate-300" style={MONO}>← Models</button>}
            </div>
            {!ready ? (
                <p className="text-slate-500 text-sm">Load an on-device model first, then measure how fast it runs on this device.</p>
            ) : (
                <div className="rounded-2xl border border-white/[0.08] bg-[#0d0d0e]/95 p-4 space-y-3">
                    <div className="grid grid-cols-3 gap-3 text-xs text-slate-400" style={MONO}>
                        <label>Runs
                            <input type="number" min={1} max={10} value={runs} onChange={e => setRuns(Math.min(10, Math.max(1, Number(e.target.value))))}
                                className="mt-1 w-full bg-black/30 border border-white/[0.08] rounded-lg px-2 py-1.5 text-slate-200" />
                        </label>
                        <label>Prompt tokens
                            <input type="number" min={16} max={4096} step={16} value={prefill} onChange={e => setPrefill(Math.min(4096, Math.max(16, Number(e.target.value))))}
                                className="mt-1 w-full bg-black/30 border border-white/[0.08] rounded-lg px-2 py-1.5 text-slate-200" />
                        </label>
                        <label>Output tokens
                            <input type="number" min={16} max={1024} step={16} value={decode} onChange={e => setDecode(Math.min(1024, Math.max(16, Number(e.target.value))))}
                                className="mt-1 w-full bg-black/30 border border-white/[0.08] rounded-lg px-2 py-1.5 text-slate-200" />
                        </label>
                    </div>
                    <div className="flex items-center gap-3">
                        {running ? (
                            <>
                                <span className="text-[#FFBF00] text-xs animate-pulse" style={MONO}>{running}</span>
                                <button onClick={() => abort.current?.abort()} className="ml-auto text-xs text-slate-400 hover:text-white" style={MONO}>Stop</button>
                            </>
                        ) : (
                            <button onClick={start} className="px-4 py-2 rounded-full bg-[#00FF41]/15 border border-[#00FF41]/40 text-[#00FF41] text-xs font-bold" style={MONO}>
                                Run benchmark
                            </button>
                        )}
                    </div>
                    {error && <p className="text-rose-300 text-xs">{error}</p>}
                </div>
            )}

            {results.length > 0 && (
                <div className="space-y-2">
                    <div className="flex items-center justify-between text-[11px] text-slate-500" style={MONO}>
                        <span>Show:{' '}
                            {(['median', 'avg', 'min', 'max'] as Agg[]).map(a => (
                                <button key={a} onClick={() => setAgg(a)} className={`ml-1 px-2 py-0.5 rounded-full ${agg === a ? 'bg-white/[0.08] text-slate-200' : 'hover:text-slate-300'}`}>{a}</button>
                            ))}
                        </span>
                        <button onClick={copyCsv} className="hover:text-slate-300">{copied ? 'Copied ✓' : 'Copy as CSV'}</button>
                    </div>
                    {results.map(r => (
                        <div key={r.id} className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3">
                            <div className="flex items-center justify-between text-xs">
                                <span className="text-slate-200 font-semibold">{r.modelName}</span>
                                <span className="text-slate-600" style={MONO}>{new Date(r.startedAt).toLocaleString()} · {r.runs} runs
                                    <button onClick={() => setResults(deleteBenchmark(r.id))} className="ml-2 hover:text-rose-300" aria-label="Delete result">✕</button>
                                </span>
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2 text-center" style={MONO}>
                                {[
                                    ['Decode', `${number(pick(r.stats.decodeTokensPerSec, agg))} tok/s`],
                                    ['Prefill', `${number(pick(r.stats.prefillTokensPerSec, agg), 0)} tok/s`],
                                    ['First token', `${number(pick(r.stats.ttftMs, agg), 0)} ms`],
                                    ['Load', r.initMs ? `${(r.initMs / 1000).toFixed(1)} s` : '—'],
                                ].map(([label, value]) => (
                                    <div key={label} className="rounded-xl bg-black/30 py-2">
                                        <div className="text-[#00FF41] text-sm font-semibold">{value}</div>
                                        <div className="text-[10px] text-slate-500 uppercase tracking-wider">{label}</div>
                                    </div>
                                ))}
                            </div>
                            {r.adapter && <p className="text-[10px] text-slate-600 mt-2" style={MONO}>{r.adapter} · prompt ≈{r.prefillTarget} / output ≤{r.decodeTarget} tokens</p>}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};
