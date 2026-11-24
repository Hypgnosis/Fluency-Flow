import React, { useCallback, useEffect, useState } from 'react';
import type { PersonaId, SavedWord, SrsState, VocabCard } from '../../types/lens';
import { LensView } from './LensView';
import { SavedWords } from './SavedWords';
import { StudyDeck } from './StudyDeck';
import { PERSONAS } from '../../services/lensTeacher/prompts';
import { deleteWord, findSaved, listSavedWords, saveWord, updateSrs } from '../../services/vocabStore';
import { isDue } from '../../services/srs';
import { stopSpeaking } from '../../services/speech';
import { useAuth } from '../AuthModal';

const MONO = { fontVariantNumeric: 'tabular-nums' } as const;
type Tab = 'lens' | 'saved' | 'study';

const PERSONA_KEY = 'glossos_lens_persona';
const MUTED_KEY = 'glossos_lens_muted';

function readPref(key: string, fallback: string): string {
    try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function writePref(key: string, value: string) {
    try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
}

interface LensTeacherProps {
    nativeLanguage: string;
    learnLanguage: string;
    level?: string;
}

/**
 * Lens Teacher: point the camera at something, ask about it, learn the word, save it, study it.
 * Port of the "XR Language Teacher" from Google AI Edge Gallery, running on Gemini.
 */
export const LensTeacher: React.FC<LensTeacherProps> = ({ nativeLanguage, learnLanguage, level }) => {
    const { user } = useAuth();
    const [tab, setTab] = useState<Tab>('lens');
    const [persona, setPersona] = useState<PersonaId>(() => {
        const stored = readPref(PERSONA_KEY, 'buddy');
        return (stored in PERSONAS ? stored : 'buddy') as PersonaId;
    });
    const [muted, setMuted] = useState(() => readPref(MUTED_KEY, 'false') === 'true');
    const [words, setWords] = useState<SavedWord[]>([]);
    const [loading, setLoading] = useState(true);
    const [storeError, setStoreError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        listSavedWords()
            .then(list => { if (!cancelled) setWords(list); })
            .catch(err => {
                console.error('[GLOSSOS-LENS] Could not load saved words:', err);
                if (!cancelled) setStoreError('Could not load your saved words. Check your connection and Firestore rules.');
            })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [user?.uid]);

    useEffect(() => () => stopSpeaking(), []);

    const toggleSave = useCallback(async (card: VocabCard, imageDataUrl?: string) => {
        const existing = findSaved(words, learnLanguage, card.word);
        setStoreError(null);
        try {
            if (existing) {
                setWords(ws => ws.filter(w => w.id !== existing.id));
                await deleteWord(existing.id);
            } else {
                const saved = await saveWord(card, { learnLanguage, nativeLanguage, imageDataUrl });
                setWords(ws => [saved, ...ws.filter(w => w.id !== saved.id)]);
            }
        } catch (err) {
            console.error('[GLOSSOS-LENS] Save failed:', err);
            setStoreError('Could not update your saved words. Please try again.');
            listSavedWords().then(setWords).catch(() => undefined);
        }
    }, [words, learnLanguage, nativeLanguage]);

    const removeWord = useCallback(async (word: SavedWord) => {
        setWords(ws => ws.filter(w => w.id !== word.id));
        try {
            await deleteWord(word.id);
        } catch {
            setStoreError('Could not delete that word.');
            listSavedWords().then(setWords).catch(() => undefined);
        }
    }, []);

    const reviewed = useCallback((word: SavedWord, srs: SrsState) => {
        setWords(ws => ws.map(w => (w.id === word.id ? { ...w, srs } : w)));
        updateSrs(word.id, srs).catch(err => console.warn('[GLOSSOS-LENS] Review not saved:', err));
    }, []);

    const dueCount = words.filter(w => isDue(w.srs)).length;
    const sameLanguage = nativeLanguage === learnLanguage;

    const tabButton = (id: Tab, label: string, badge?: number) => (
        <button
            onClick={() => { stopSpeaking(); setTab(id); }}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${tab === id
                ? 'bg-[#FFBF00]/15 text-[#FFBF00] border border-[#FFBF00]/30'
                : 'text-slate-500 border border-transparent hover:text-slate-300'}`}
            style={MONO}
        >
            {label}{badge ? <span className="ml-1.5 text-[10px] text-[#3DF5A0]">{badge}</span> : null}
        </button>
    );

    return (
        <div className="flex flex-col h-full min-h-0">
            <div className="flex items-center justify-between gap-2 px-4 sm:px-6 py-2 border-b border-white/[0.04] flex-wrap">
                <div className="flex items-center gap-1">
                    {tabButton('lens', 'Lens')}
                    {tabButton('saved', 'Saved', words.length)}
                    {tabButton('study', 'Study', dueCount)}
                </div>
                {tab === 'lens' && (
                    <div className="flex items-center gap-2">
                        <select
                            value={persona}
                            onChange={e => { const p = e.target.value as PersonaId; setPersona(p); writePref(PERSONA_KEY, p); }}
                            className="bg-black/30 border border-white/[0.08] text-slate-300 text-xs rounded-full px-3 py-1.5"
                            title="Teacher persona"
                            style={MONO}
                        >
                            {Object.values(PERSONAS).map(p => <option key={p.id} value={p.id}>{p.name} · {p.subtitle}</option>)}
                        </select>
                        <button
                            onClick={() => { const m = !muted; setMuted(m); writePref(MUTED_KEY, String(m)); if (m) stopSpeaking(); }}
                            className={`p-1.5 rounded-full border ${muted ? 'border-white/[0.08] text-slate-600' : 'border-[#3DF5A0]/30 text-[#3DF5A0]'}`}
                            title={muted ? 'Voice off' : 'Voice on'}
                            aria-label={muted ? 'Turn voice on' : 'Turn voice off'}
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                {muted
                                    ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5L6 9H2v6h4l5 4V5zM23 9l-6 6M17 9l6 6" />
                                    : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072M11 5L6 9H2v6h4l5 4V5z" />}
                            </svg>
                        </button>
                    </div>
                )}
            </div>

            {storeError && (
                <div className="mx-4 sm:mx-6 mt-2 bg-amber-500/10 border border-amber-500/20 p-2.5 rounded-xl text-amber-200 text-xs">{storeError}</div>
            )}

            <div className="flex-grow min-h-0 overflow-y-auto">
                {tab === 'lens' && (sameLanguage ? (
                    <div className="h-full flex items-center justify-center p-8 text-center text-slate-400 text-sm">
                        Pick a learning language that is different from the language you speak to use Lens.
                    </div>
                ) : (
                    <LensView
                        nativeLanguage={nativeLanguage}
                        learnLanguage={learnLanguage}
                        level={level}
                        persona={persona}
                        muted={muted}
                        savedWords={words}
                        onToggleSave={toggleSave}
                    />
                ))}
                {tab === 'saved' && (
                    <SavedWords words={words} loading={loading} onDelete={removeWord} onStudy={() => setTab('study')} />
                )}
                {tab === 'study' && (
                    <StudyDeck words={words} defaultLanguage={learnLanguage} onReviewed={reviewed} />
                )}
            </div>
        </div>
    );
};

export default LensTeacher;
