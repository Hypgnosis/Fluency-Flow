/**
 * Language metadata shared by the speech services and Lens Teacher.
 * Keys are the English display names used across Glossos (see LANGUAGES in Conversation.tsx).
 */

export interface LanguageInfo {
    /** BCP-47 tag used for speech recognition and synthesis. */
    locale: string;
    /** ISO 639 code. */
    code: string;
    /** Whether the browser is likely to have a speech voice / recognizer for it. */
    speechSupported: boolean;
}

const LANGUAGE_INFO: Record<string, LanguageInfo> = {
    english: { locale: 'en-US', code: 'en', speechSupported: true },
    spanish: { locale: 'es-MX', code: 'es', speechSupported: true },
    french: { locale: 'fr-FR', code: 'fr', speechSupported: true },
    german: { locale: 'de-DE', code: 'de', speechSupported: true },
    italian: { locale: 'it-IT', code: 'it', speechSupported: true },
    japanese: { locale: 'ja-JP', code: 'ja', speechSupported: true },
    portuguese: { locale: 'pt-BR', code: 'pt', speechSupported: true },
    korean: { locale: 'ko-KR', code: 'ko', speechSupported: true },
    chinese: { locale: 'zh-CN', code: 'zh', speechSupported: true },
    russian: { locale: 'ru-RU', code: 'ru', speechSupported: true },
    slovak: { locale: 'sk-SK', code: 'sk', speechSupported: true },
    'yucatec mayan': { locale: 'yua', code: 'yua', speechSupported: false },
};

export function getLanguageInfo(name: string): LanguageInfo {
    return LANGUAGE_INFO[name.trim().toLowerCase()] ?? { locale: 'en-US', code: 'en', speechSupported: false };
}

export function localeFor(name: string): string {
    return getLanguageInfo(name).locale;
}

export function languageCode(name: string): string {
    return getLanguageInfo(name).code;
}
