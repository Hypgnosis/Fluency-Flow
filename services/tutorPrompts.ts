/** System prompts and templates for the text tutor (Chat) and Writing Lab. */

export interface TutorContext {
    nativeLanguage: string;
    learnLanguage: string;
    level: string;
}

const LEVEL_STYLE: Record<string, string> = {
    Beginner: 'Use only very common words and short sentences (at most 8 words). After each reply, add a one-line explanation in {NATIVE} in square brackets.',
    Intermediate: 'Use everyday vocabulary and natural sentences. Add a short explanation in {NATIVE} in square brackets only when something new comes up.',
    Advanced: 'Speak naturally, including idioms. Use {NATIVE} only if the learner asks.',
};

/** System prompt for the text chat tutor. Short, because small on-device models follow short prompts best. */
export function chatTutorSystemPrompt({ nativeLanguage, learnLanguage, level }: TutorContext): string {
    const style = (LEVEL_STYLE[level] ?? LEVEL_STYLE.Beginner).replaceAll('{NATIVE}', nativeLanguage);
    return [
        `You are GLOSSOS, a friendly ${learnLanguage} tutor chatting by text with a ${level.toLowerCase()} learner whose native language is ${nativeLanguage}.`,
        `Reply in ${learnLanguage}. ${style}`,
        `If the learner's message has a mistake, first show the corrected sentence with the fix in **bold**, then continue the conversation.`,
        'Keep each reply to 2-4 short sentences and end with a question that keeps the conversation going.',
    ].join('\n');
}

export type TemplateId = 'free' | 'correct' | 'rewrite' | 'translate' | 'explain' | 'conjugate' | 'summarize';

export interface TemplateOption {
    id: string;
    label: string;
}

export interface WritingTemplate {
    id: TemplateId;
    label: string;
    description: string;
    placeholder: string;
    /** Options for the template's choice (tone, direction, style...). */
    options?: TemplateOption[];
    defaultOption?: string;
    examples: string[];
    /** The instruction placed before the learner's text (Gallery highlights this part). */
    prefix: (ctx: TutorContext, option?: string) => string;
}

const TONES = ['formal', 'casual', 'friendly', 'polite', 'enthusiastic', 'concise'];
const SUMMARY_STYLES = [
    'key bullet points (3-5)', 'short paragraph (1-2 sentences)', 'concise summary (~50 words)', 'headline / title', 'one-sentence summary',
];

/**
 * Writing Lab templates: Gallery's Prompt Lab (free form, rewrite tone, summarize) adapted for
 * language learners, plus correction, translation, sentence explanations and conjugation tables.
 */
export const WRITING_TEMPLATES: WritingTemplate[] = [
    {
        id: 'correct',
        label: 'Correct my writing',
        description: 'Fixes mistakes and explains each change.',
        placeholder: 'Paste or write something in the language you are learning…',
        examples: ['Ayer yo va al mercado y compré mucho frutas.', 'Je suis allé à la plage avec mes amis hier et nous avons mangé des glace.'],
        prefix: ({ learnLanguage, nativeLanguage, level }) =>
            `Correct this ${learnLanguage} text written by a ${level.toLowerCase()} learner. First give the corrected text with every change in **bold**. Then list each change with a short explanation in ${nativeLanguage}. If it is already correct, say so and suggest one more natural way to say it.\n\nText: `,
    },
    {
        id: 'rewrite',
        label: 'Rewrite tone',
        description: 'Same message, different tone.',
        placeholder: 'Write a message to rewrite…',
        options: TONES.map(t => ({ id: t, label: t[0].toUpperCase() + t.slice(1) })),
        defaultOption: 'formal',
        examples: ['Hola, ¿me puedes mandar el documento? Lo necesito ya.', 'I can not come tomorrow, sorry.'],
        prefix: ({ learnLanguage }, tone = 'formal') => `Rewrite the following text in ${learnLanguage} using a ${tone} tone: `,
    },
    {
        id: 'translate',
        label: 'Translate',
        description: 'Natural translation plus alternatives.',
        placeholder: 'Text to translate…',
        options: [{ id: 'to-learn', label: 'Into the language I learn' }, { id: 'to-native', label: 'Into my language' }],
        defaultOption: 'to-learn',
        examples: ['Could you tell me where the train station is?', 'Me encantaría probar la comida típica de aquí.'],
        prefix: ({ learnLanguage, nativeLanguage }, dir = 'to-learn') => {
            const target = dir === 'to-native' ? nativeLanguage : learnLanguage;
            return `Translate the following into natural ${target}. Then give two alternative ways to say it and when each fits: `;
        },
    },
    {
        id: 'explain',
        label: 'Explain a sentence',
        description: 'Word-by-word breakdown and grammar.',
        placeholder: 'A sentence you want to understand…',
        examples: ['Ojalá que llueva café en el campo.', 'Il faut que tu viennes demain.'],
        prefix: ({ learnLanguage, nativeLanguage, level }) =>
            `Explain this ${learnLanguage} sentence for a ${level.toLowerCase()} learner, in ${nativeLanguage}: translate it, break it down word by word, and explain the grammar points in it. Sentence: `,
    },
    {
        id: 'conjugate',
        label: 'Conjugate a verb',
        description: 'Present, past and future as a table.',
        placeholder: 'A verb (e.g. hablar, être, sein)…',
        examples: ['tener', 'ir', 'hacer'],
        prefix: ({ learnLanguage, nativeLanguage }) =>
            `Conjugate this ${learnLanguage} verb in the present, the main past tense and the future, as a Markdown table with one column per tense. Then give one short example sentence per tense with a ${nativeLanguage} translation. Verb: `,
    },
    {
        id: 'summarize',
        label: 'Summarize',
        description: 'Short summary of a longer text.',
        placeholder: 'A text to summarize…',
        options: SUMMARY_STYLES.map(s => ({ id: s, label: s[0].toUpperCase() + s.slice(1) })),
        defaultOption: SUMMARY_STYLES[0],
        examples: ['Pega aquí una noticia o un artículo en el idioma que estudias.'],
        prefix: (_ctx, style = SUMMARY_STYLES[0]) => `Please summarize the following in ${style}: `,
    },
    {
        id: 'free',
        label: 'Free form',
        description: 'Ask anything, no template.',
        placeholder: 'Ask anything…',
        examples: ['Give me 5 phrases to order food at a restaurant.', 'What is the difference between por and para?'],
        prefix: () => '',
    },
];

export function buildWritingPrompt(template: WritingTemplate, ctx: TutorContext, input: string, option?: string): string {
    return `${template.prefix(ctx, option ?? template.defaultOption)}${input.trim()}`;
}
