import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { loadSkillPrefs, saveSkillPrefs, type SkillPrefs } from '../../services/tutorSkills/registry';

export interface LanguageEntry {
    name: string;
    native: string;
    code: string;
    hello: string;
    /** Still in testing: the AI makes more mistakes, and voice recognition is weak (Maya, measured 2026-11-24). */
    beta?: boolean;
}

/** Languages Glossos teaches, with how each is written in its own language, a short code and a first phrase to try. */
export const LANGUAGES: LanguageEntry[] = [
    { name: 'English', native: 'English', code: 'EN', hello: 'Hi! How are you today?' },
    { name: 'Spanish', native: 'Español', code: 'ES', hello: '¡Hola! ¿Qué tal tu día?' },
    { name: 'French', native: 'Français', code: 'FR', hello: 'Bonjour ! Comment ça va ?' },
    { name: 'German', native: 'Deutsch', code: 'DE', hello: 'Hallo! Wie geht’s dir?' },
    { name: 'Italian', native: 'Italiano', code: 'IT', hello: 'Ciao! Come stai?' },
    { name: 'Portuguese', native: 'Português', code: 'PT', hello: 'Olá! Tudo bem?' },
    { name: 'Japanese', native: '日本語', code: 'JA', hello: 'こんにちは！元気ですか？' },
    { name: 'Korean', native: '한국어', code: 'KO', hello: '안녕하세요! 잘 지내요?' },
    { name: 'Chinese', native: '中文', code: 'ZH', hello: '你好！你今天怎么样？' },
    { name: 'Russian', native: 'Русский', code: 'RU', hello: 'Привет! Как дела?' },
    { name: 'Slovak', native: 'Slovenčina', code: 'SK', hello: 'Ahoj! Ako sa máš?' },
    { name: 'Yucatec Mayan', native: 'Maaya t’aan', code: 'YUA', hello: '¡Ba’ax ka wa’alik!', beta: true },
];

export const languageMeta = (name: string): LanguageEntry => LANGUAGES.find(l => l.name === name) ?? { name, native: name, code: name.slice(0, 2).toUpperCase(), hello: '' };

/** Second line under a language in pickers: its English name if different, and "Beta". */
export const languageDescription = (l: LanguageEntry): string | undefined =>
    [l.native !== l.name ? l.name : '', l.beta ? 'Beta' : ''].filter(Boolean).join(' · ') || undefined;

export const LEVELS = [
    { id: 'Beginner', label: 'Beginner', tag: 'Foundation', description: 'Short sentences, lots of help in your language.' },
    { id: 'Intermediate', label: 'Intermediate', tag: 'Bridge', description: 'Natural pace, explanations only when you are stuck.' },
    { id: 'Advanced', label: 'Advanced', tag: 'Pantheon', description: 'Full immersion, idioms and native speed.' },
] as const;

/** Gemini Live voices, presented by character instead of model voice IDs. */
export const VOICES = [
    { id: 'Puck', label: 'Warm', description: 'Friendly and upbeat' },
    { id: 'Kore', label: 'Bright', description: 'Clear and energetic' },
    { id: 'Charon', label: 'Calm', description: 'Deep and steady' },
    { id: 'Aoede', label: 'Melodic', description: 'Smooth and expressive' },
    { id: 'Fenrir', label: 'Bold', description: 'Confident and direct' },
] as const;

export const voiceLabel = (id: string) => VOICES.find(v => v.id === id)?.label ?? 'Warm';

interface LearningSettings {
    nativeLanguage: string;
    learnLanguage: string;
    level: string;
    voice: string;
    sceneImages: boolean;
    skillPrefs: SkillPrefs;
    setNativeLanguage: (v: string) => void;
    setLearnLanguage: (v: string) => void;
    setLevel: (v: string) => void;
    setVoice: (v: string) => void;
    setSceneImages: (v: boolean) => void;
    setSkillPrefs: (v: SkillPrefs) => void;
}

const Ctx = createContext<LearningSettings | null>(null);

function read(key: string, fallback: string): string {
    try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function write(key: string, value: string) {
    try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
}

/** Learning settings shared by every page and remembered on this device. */
export const LearningSettingsProvider: React.FC<{ children: React.ReactNode; defaults?: { native?: string; learning?: string } }> = ({ children, defaults }) => {
    const [nativeLanguage, setNative] = useState(() => read('glossos_native_lang', defaults?.native ?? 'English'));
    const [learnLanguage, setLearn] = useState(() => read('glossos_learning_lang', defaults?.learning ?? 'Spanish'));
    const [level, setLevelState] = useState(() => read('glossos_level', 'Beginner'));
    const [voice, setVoiceState] = useState(() => read('glossos_voice', 'Puck'));
    const [sceneImages, setScene] = useState(() => read('glossos_scene_images', 'true') === 'true');
    const [skillPrefs, setSkills] = useState<SkillPrefs>(() => loadSkillPrefs());

    const setNativeLanguage = useCallback((v: string) => { setNative(v); write('glossos_native_lang', v); }, []);
    const setLearnLanguage = useCallback((v: string) => { setLearn(v); write('glossos_learning_lang', v); }, []);
    const setLevel = useCallback((v: string) => { setLevelState(v); write('glossos_level', v); }, []);
    const setVoice = useCallback((v: string) => { setVoiceState(v); write('glossos_voice', v); }, []);
    const setSceneImages = useCallback((v: boolean) => { setScene(v); write('glossos_scene_images', String(v)); }, []);
    const setSkillPrefs = useCallback((v: SkillPrefs) => { setSkills(v); saveSkillPrefs(v); }, []);

    const value = useMemo(() => ({
        nativeLanguage, learnLanguage, level, voice, sceneImages, skillPrefs,
        setNativeLanguage, setLearnLanguage, setLevel, setVoice, setSceneImages, setSkillPrefs,
    }), [nativeLanguage, learnLanguage, level, voice, sceneImages, skillPrefs,
        setNativeLanguage, setLearnLanguage, setLevel, setVoice, setSceneImages, setSkillPrefs]);

    return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};

export function useLearningSettings(): LearningSettings {
    const ctx = useContext(Ctx);
    if (!ctx) throw new Error('useLearningSettings must be used inside LearningSettingsProvider');
    return ctx;
}
