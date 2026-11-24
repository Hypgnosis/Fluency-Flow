import React, { useEffect, useRef, useState } from 'react';
import { MAX_CLIP_SECONDS, fileToWav, transcribeClip, type ScribeResult } from '../../services/audioScribe';
import { saveWord } from '../../services/vocabStore';
import { localeFor } from '../../services/languages';
import { VocabCardView, SpeakerButton } from '../lens/VocabCardView';
import { useOnline } from '../offline/useOnDevice';

const MONO = { fontVariantNumeric: 'tabular-nums' } as const;

interface AudioScribeProps {
    nativeLanguage: string;
    learnLanguage: string;
    level: string;
}

type Phase = 'idle' | 'recording' | 'ready' | 'working' | 'done';

/**
 * Audio Scribe: record or upload a clip (a song, a voice note, a podcast moment), get the
 * transcript and translation, and save the useful words. Port of Gallery's Audio Scribe.
 */
export const AudioScribe: React.FC<AudioScribeProps> = ({ nativeLanguage, learnLanguage, level }) => {
    const online = useOnline();
    const [phase, setPhase] = useState<Phase>('idle');
    const [seconds, setSeconds] = useState(0);
    const [clip, setClip] = useState<{ wav: Blob; url: string; seconds: number; trimmed: boolean } | null>(null);
    const [result, setResult] = useState<ScribeResult | null>(null);
    const [saved, setSaved] = useState<Record<string, boolean>>({});
    const [error, setError] = useState<string | null>(null);
    const recorder = useRef<MediaRecorder | null>(null);
    const stream = useRef<MediaStream | null>(null);
    const timer = useRef<ReturnType<typeof setInterval> | null>(null);
    const abort = useRef<AbortController | null>(null);
    const fileInput = useRef<HTMLInputElement>(null);

    const stopTracks = () => {
        if (timer.current) clearInterval(timer.current);
        timer.current = null;
        stream.current?.getTracks().forEach(t => t.stop());
        stream.current = null;
    };

    useEffect(() => () => {
        stopTracks();
        abort.current?.abort();
        if (recorder.current?.state === 'recording') recorder.current.stop();
    }, []);
    useEffect(() => () => { if (clip) URL.revokeObjectURL(clip.url); }, [clip]);

    const useBlob = async (blob: Blob) => {
        setError(null);
        setResult(null);
        setSaved({});
        try {
            const { wav, seconds: secs, trimmed } = await fileToWav(blob);
            if (secs < 0.5) throw new Error('That clip is too short.');
            setClip({ wav, url: URL.createObjectURL(wav), seconds: secs, trimmed });
            setPhase('ready');
        } catch (err) {
            setError(`Could not read that audio: ${(err as Error).message}`);
            setPhase('idle');
        }
    };

    const startRecording = async () => {
        setError(null);
        try {
            const media = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } });
            stream.current = media;
            const chunks: Blob[] = [];
            const rec = new MediaRecorder(media);
            rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
            rec.onstop = () => {
                stopTracks();
                useBlob(new Blob(chunks, { type: rec.mimeType }));
            };
            recorder.current = rec;
            rec.start();
            setSeconds(0);
            setPhase('recording');
            const started = Date.now();
            timer.current = setInterval(() => {
                const s = Math.floor((Date.now() - started) / 1000);
                setSeconds(s);
                if (s >= MAX_CLIP_SECONDS && rec.state === 'recording') rec.stop();
            }, 250);
        } catch {
            setError('Microphone access was blocked. Allow it in your browser settings, or upload a file instead.');
            stopTracks();
        }
    };

    const stopRecording = () => {
        if (recorder.current?.state === 'recording') recorder.current.stop();
    };

    const transcribe = async () => {
        if (!clip) return;
        setPhase('working');
        setError(null);
        const controller = new AbortController();
        abort.current = controller;
        try {
            setResult(await transcribeClip({ wav: clip.wav, nativeLanguage, learnLanguage, level, signal: controller.signal }));
            setPhase('done');
        } catch (err) {
            if ((err as Error).name !== 'AbortError') setError((err as Error).message || 'Transcription failed.');
            setPhase('ready');
        } finally {
            abort.current = null;
        }
    };

    const save = async (index: number) => {
        if (!result) return;
        const card = result.words[index];
        try {
            await saveWord(card, { learnLanguage, nativeLanguage });
            setSaved(s => ({ ...s, [card.word]: true }));
        } catch {
            setError('Could not save that word. Please try again.');
        }
    };

    const learnLocale = localeFor(learnLanguage);

    return (
        <div className="p-4 sm:p-6 max-w-2xl mx-auto space-y-4">
            <div>
                <p className="text-slate-400 text-[15px] leading-relaxed">
                    Record or upload up to {MAX_CLIP_SECONDS} seconds of audio (a song, a voice note, a podcast) and get the
                    transcript, a translation, and words to learn.
                </p>
            </div>

            {!online && <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.05] p-3 text-amber-200 text-xs">Audio Scribe uses Gemini, so it needs an internet connection.</div>}

            <div className="rounded-2xl border border-white/[0.08] bg-[#0d0d0e]/95 p-4 flex flex-col items-center gap-3">
                {phase === 'recording' ? (
                    <>
                        <div className="text-3xl font-bold text-rose-300 tabular-nums" style={MONO}>
                            0:{String(seconds).padStart(2, '0')} <span className="text-xs text-slate-500">/ 0:{MAX_CLIP_SECONDS}</span>
                        </div>
                        <button onClick={stopRecording} className="px-6 py-2.5 rounded-full bg-rose-500/15 border border-rose-500/40 text-rose-300 text-sm font-bold animate-pulse" style={MONO}>Stop</button>
                    </>
                ) : (
                    <div className="flex items-center gap-3">
                        <button onClick={startRecording} disabled={phase === 'working'}
                            className="px-5 py-2.5 rounded-full bg-[#FFBF00]/15 border border-[#FFBF00]/40 text-[#FFBF00] text-sm font-bold disabled:opacity-40" style={MONO}>
                            ● Record
                        </button>
                        <input ref={fileInput} type="file" accept="audio/*" className="hidden"
                            onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) useBlob(f); }} />
                        <button onClick={() => fileInput.current?.click()} disabled={phase === 'working'}
                            className="px-5 py-2.5 rounded-full bg-white/[0.04] border border-white/[0.1] text-slate-300 text-sm disabled:opacity-40" style={MONO}>
                            Upload audio
                        </button>
                    </div>
                )}

                {clip && phase !== 'recording' && (
                    <div className="w-full space-y-2">
                        <audio controls src={clip.url} className="w-full" />
                        <div className="flex items-center justify-between text-[11px] text-slate-500" style={MONO}>
                            <span>{clip.seconds.toFixed(1)} s{clip.trimmed ? ` (trimmed to the first ${MAX_CLIP_SECONDS} s)` : ''}</span>
                            {phase === 'working' ? (
                                <span className="flex items-center gap-3">
                                    <span className="text-[#FFBF00] animate-pulse">Transcribing…</span>
                                    <button onClick={() => abort.current?.abort()} className="hover:text-slate-300">Cancel</button>
                                </span>
                            ) : (
                                <button onClick={transcribe} disabled={!online}
                                    className="px-4 py-1.5 rounded-full bg-[#3DF5A0]/15 border border-[#3DF5A0]/40 text-[#3DF5A0] font-bold disabled:opacity-40">
                                    Transcribe
                                </button>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {error && <p className="text-rose-300 text-xs">{error}</p>}

            {result && (
                <div className="space-y-3 animate-fade-in">
                    {!result.transcript ? (
                        <p className="text-slate-400 text-sm">No speech was found in this clip.</p>
                    ) : (
                        <>
                            <div className="rounded-2xl border border-white/[0.08] bg-[#0d0d0e]/95 p-4">
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-[10px] uppercase tracking-[0.2em] text-slate-500 font-bold" style={MONO}>
                                        Transcript{result.detectedLanguage ? ` · ${result.detectedLanguage}` : ''}
                                    </span>
                                    {result.detectedLanguage.toLowerCase() === learnLanguage.toLowerCase() && (
                                        <SpeakerButton text={result.transcript} locale={learnLocale} label="Read the transcript aloud" small />
                                    )}
                                </div>
                                <p className="text-[#F5F5F7] text-sm leading-relaxed whitespace-pre-wrap">{result.transcript}</p>
                            </div>
                            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
                                <span className="text-[10px] uppercase tracking-[0.2em] text-slate-500 font-bold" style={MONO}>Translation</span>
                                <p className="text-slate-300 text-sm leading-relaxed mt-2 whitespace-pre-wrap">{result.translation}</p>
                            </div>
                        </>
                    )}
                    {result.corrections.length > 0 && (
                        <div className="rounded-2xl border border-[#FFBF00]/20 bg-[#FFBF00]/[0.04] p-4">
                            <span className="text-[10px] uppercase tracking-[0.2em] text-[#FFBF00] font-bold" style={MONO}>Mistakes in what was said</span>
                            <ul className="mt-2 space-y-2">
                                {result.corrections.map((c, i) => (
                                    <li key={i} className="text-sm">
                                        <span className="line-through text-slate-500">{c.incorrect}</span>
                                        <span className="mx-2 text-slate-500">→</span>
                                        <span className="font-semibold text-[#3DF5A0]">{c.correct}</span>
                                        {c.explanation && <p className="text-xs text-slate-400 mt-0.5">{c.explanation}</p>}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                    {result.words.length > 0 && (
                        <div className="space-y-2">
                            <span className="text-[10px] uppercase tracking-[0.2em] text-slate-500 font-bold" style={MONO}>Words to learn</span>
                            {result.words.map((w, i) => (
                                <VocabCardView key={w.word + i} card={w} learnLocale={learnLocale}
                                    saved={Boolean(saved[w.word])} onToggleSave={() => { if (!saved[w.word]) save(i); }} />
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default AudioScribe;
