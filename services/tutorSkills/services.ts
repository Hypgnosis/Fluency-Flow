/** Real persistence for Tutor Skills (Firestore via sessionManager / vocabStore). */

import type { SkillAttachment, SkillServices } from './types';
import { logMistake, resolveMistakeByForm } from '../sessionManager';
import { saveWord } from '../vocabStore';

export const defaultSkillServices: SkillServices = {
    logMistake,
    resolveMistakeByForm,
    saveVocab: async (card, learnLanguage, nativeLanguage) => {
        await saveWord(card, { learnLanguage, nativeLanguage });
    },
};

/** Plain-text line for an attachment, used in saved session transcripts. */
export function describeAttachment(attachment: SkillAttachment): string {
    switch (attachment.kind) {
        case 'mistake': return `[Noted: ${attachment.incorrect} → ${attachment.correct}]`;
        case 'fixed': return `[Fixed: ${attachment.incorrect}]`;
        case 'vocab': return `[Saved word: ${attachment.card.word} — ${attachment.card.meaning}]`;
        case 'card': return `[Card: ${attachment.title}]`;
        case 'wiki': return `[Wikipedia: ${attachment.title}]`;
        default: return '';
    }
}
