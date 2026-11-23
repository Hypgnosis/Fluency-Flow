import React, { useEffect, useMemo, useRef, useState } from 'react';
import { WRITING_TEMPLATES, buildWritingPrompt, type TemplateId } from '../../services/tutorPrompts';
import { engineReady, streamReply, type EngineKind, type ReplyStats } from '../../services/textEngine';
import { renderMarkdown } from '../../utils/miniMarkdown';
import { EngineSwitch } from '../offline/EngineSwitch';
import { useEnginePreference } from '../offline/useOnDevice';
import { StatsLine } from '../chat/StatsLine';

const MONO = { fontFamily: "'IBM Plex Mono', monospace" };

interface WritingLabProps {
    nativeLanguage: string;
    learnLanguage: string;
    level: string;
    onManageModels: () => void;
}

/**
 * Writing Lab: single-turn writing tools with adjustable sampling. Port of Google AI Edge Gallery's
 * Prompt Lab (templates, prompt preview, temperature / top-k / top-p / max tokens), adapted for
 * language learners. Runs on Gemini or on the on-device model.
 */
export const WritingLab: React.FC<WritingLabProps> = ({ nativeLanguage, learnLanguage, level, onManageModels }) => {
    const [engine, setEngine] = useEnginePreference();
    const [templateId, setTemplateId] = useState<TemplateId>('correct');
    const template = WRITING_TEMPLATES.find(t => t.id === templateId)!;
    const [option, setOption] = useState<string | undefined>(template.defaultOption);
    const [input, setInput] = useState('');
    const [output, setOutput] = useState('');
    const [running, setRunning] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [stats, setStats] = useState<ReplyStats | null>(null);
    const [showPreview, setShowPreview] = useState(false);
    const [showParams, setShowParams] = useState(false);
    const [params, setParams] = useState({ temperature: 0.7, topK: 64, topP: 0.95, maxOutputTokens: 1024 });
    const [copied, setCopied] = useState(false);
    const abort = useRef<AbortController | null>(null);

    useEffect(() => {
        setOption(template.defaultOption);
        setOutput('');
        setStats(null);
    }, [templateId, template.defaultOption]);
    useEffect(() => () => abort.current?.abort(), []);

    const ctx = { nativeLanguage, learnLanguage, level };
    const prompt = buildWritingPrompt(template, ctx, input || template.placeholder, option);
    const html = useMemo(() => renderMarkdown(output), [output]);

    const run = async () => {
        if (!input.trim()) return;
        if (!engineReady(engine)) {
            setError('Load an on-device model first, or switch to Cloud.');
            return;
        }
        setError(null);
        setOutput('');
        setStats(null);
        setRunning(true);
        const controller = new AbortController();
        abort.current = controller;
        try {
            let text = '';
            for await (const chunk of streamReply(engine, {
                message: buildWritingPrompt(template, ctx, input, option),
                params,
                signal: controller.signal,
                onStats: setStats,
            })) {
                text += chunk;
                setOutput(text);
            }
        } catch (err) {
            if ((err as Error).name !== 'AbortError') setError((err as Error).message || 'Something went wrong.');
        } finally {
            setRunning(false);
            abort.current = null;
        }
    };

    const copy = async () => {
        await navigator.clipboard?.writeText(output).catch(() => undefined);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };

    const slider = (key: keyof typeof params, label: string, min: number, max: number, step: number) => (
        <label className="block text-[11px] text-slate-400" style={MONO}>
            <span className="flex justify-between"><span>{label}</span><span className="text-slate-200">{params[key]}</span></span>
            <input type="range" min={min} max={max} step={step} value={params[key]}
                onChange={e => setParams(p => ({ ...p, [key]: Number(e.target.value) }))} className="w-full accent-[#00FF41]" />
        </label>
    );

    return (
        <div className="p-4 sm:p-6 max-w-2xl mx-auto space-y-4">
            <div className="flex items-center justify-between gap-2 flex-wrap">
                <h2 className="text-white text-lg font-bold">Writing Lab</h2>
                <EngineSwitch value={engine} onChange={setEngine} onManageModels={onManageModels} />
            </div>

            <div className="flex gap-2 overflow-x-auto pb-1">
                {WRITING_TEMPLATES.map(t => (
                    <button key={t.id} onClick={() => setTemplateId(t.id)} title={t.description}
                        className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs border transition-colors ${t.id === templateId
                            ? 'bg-[#FFBF00]/15 text-[#FFBF00] border-[#FFBF00]/30'
                            : 'text-slate-400 border-white/[0.08] hover:text-slate-200'}`}>
                        {t.label}
                    </button>
                ))}
            </div>

            {template.options && (
                <select value={option} onChange={e => setOption(e.target.value)}
                    className="bg-black/30 border border-white/[0.08] text-slate-300 text-xs rounded-full px-3 py-1.5" style={MONO}>
                    {template.options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
            )}

            <div className="rounded-2xl border border-white/[0.08] bg-[#0d0d0e]/95 p-3">
                <textarea value={input} onChange={e => setInput(e.target.value)} placeholder={template.placeholder} rows={4}
                    className="w-full bg-transparent text-sm text-[#F5F5F7] placeholder:text-slate-600 resize-y focus:outline-none" />
                <div className="flex items-center gap-2 flex-wrap mt-2">
                    {template.examples.map(ex => (
                        <button key={ex} onClick={() => setInput(ex)} className="text-[11px] text-slate-500 hover:text-slate-300 truncate max-w-[16rem]" title={ex}>“{ex}”</button>
                    ))}
                </div>
            </div>

            <div className="flex items-center gap-3 flex-wrap">
                {running ? (
                    <button onClick={() => abort.current?.abort()} className="px-4 py-2 rounded-full bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs font-bold" style={MONO}>Stop</button>
                ) : (
                    <button onClick={run} disabled={!input.trim()} className="px-5 py-2 rounded-full bg-[#00FF41]/15 border border-[#00FF41]/40 text-[#00FF41] text-xs font-bold disabled:opacity-40" style={MONO}>Run</button>
                )}
                <button onClick={() => setShowPreview(v => !v)} className="text-[11px] text-slate-500 hover:text-slate-300" style={MONO}>{showPreview ? 'Hide' : 'Preview'} prompt</button>
                <button onClick={() => setShowParams(v => !v)} className="text-[11px] text-slate-500 hover:text-slate-300" style={MONO}>{showParams ? 'Hide' : 'Model'} settings</button>
            </div>

            {showPreview && (
                <pre className="whitespace-pre-wrap text-[11px] text-slate-400 bg-black/30 border border-white/[0.05] rounded-xl p-3" style={MONO}>
                    <span className="text-[#FFBF00]">{template.prefix(ctx, option ?? template.defaultOption)}</span>{input || template.placeholder}
                </pre>
            )}
            {showParams && (
                <div className="grid grid-cols-2 gap-3 rounded-xl border border-white/[0.05] bg-black/20 p-3">
                    {slider('temperature', 'Temperature', 0, 2, 0.05)}
                    {slider('topK', 'Top-K', 1, 100, 1)}
                    {slider('topP', 'Top-P', 0, 1, 0.01)}
                    {slider('maxOutputTokens', 'Max tokens', 128, 2048, 64)}
                </div>
            )}

            {error && <p className="text-rose-300 text-xs">{error}</p>}

            {(output || running) && (
                <div className="rounded-2xl border border-[#00FF41]/[0.08] bg-[#0d0d0e]/95 p-4">
                    <div className="glossos-md text-sm text-[#F5F5F7] leading-relaxed" dangerouslySetInnerHTML={{ __html: html || '<p>…</p>' }} />
                    <div className="flex items-center justify-between mt-3">
                        <StatsLine stats={stats} />
                        {output && !running && <button onClick={copy} className="text-[11px] text-slate-500 hover:text-slate-300" style={MONO}>{copied ? 'Copied ✓' : 'Copy'}</button>}
                    </div>
                </div>
            )}
            <p className="text-[10px] text-slate-600" style={MONO}>Prompt templates adapted from Google AI Edge Gallery's Prompt Lab.</p>
        </div>
    );
};
