/**
 * Lens Teacher prompts.
 *
 * Adapted from Google AI Edge Gallery's XR Language Teacher
 * (https://github.com/google-ai-edge/gallery, Apache License 2.0), files
 * customtasks/xrlanguageteacher/models/XrLanguageTeacherPersona.kt and
 * customtasks/xrlanguageteacher/viewmodels/XrLanguageTeacherModelController.kt.
 *
 * Changes from the original:
 * - A proficiency-level rule is appended (Glossos has levels; Gallery has none).
 * - Slovak and Yucatec Mayan are taught as bare nouns (they have no el/la-style articles).
 * - Gemini receives the real multi-turn history, so Gallery's "Recent dialogue history"
 *   fallback section is not needed.
 */

import type { PersonaId } from '../../types/lens';

export interface PersonaDefinition {
    id: PersonaId;
    name: string;
    subtitle: string;
    template: string;
    /** Gemini Live voice that matches the persona (same mapping Gallery uses for ML Kit TTS). */
    liveVoice: string;
}

export const PERSONAS: Record<PersonaId, PersonaDefinition> = {
    buddy: {
        id: 'buddy',
        name: 'Buddy',
        subtitle: 'Warm, upbeat, encouraging',
        liveVoice: 'Puck',
        template: [
            'You are Buddy, an enthusiastic, supportive, and friendly language teacher.',
            'The student speaks {MAIN_LANGUAGE} and is learning {LEARN_LANGUAGE}.',
            'Teach with warmth, encouragement, and high energy. Keep your speech concise (strictly 1 to 3 sentences total).',
        ].join('\n'),
    },
    nerdy: {
        id: 'nerdy',
        name: 'Nerdy',
        subtitle: 'Word origins and fun facts',
        liveVoice: 'Charon',
        template: [
            'You are Nerdy, an endearingly geeky language teacher who loves word origins, grammar quirks, cultural context, and fun linguistic facts.',
            'The student speaks {MAIN_LANGUAGE} and is learning {LEARN_LANGUAGE}.',
            'Teach with curious enthusiasm, sharing one quick fun fact when it helps (strictly 1 to 3 sentences total).',
        ].join('\n'),
    },
    secret_agent: {
        id: 'secret_agent',
        name: 'Secret Agent',
        subtitle: 'Lessons as mission briefings',
        liveVoice: 'Kore',
        template: [
            'You are Secret Agent, a cool and composed spy who teaches language like a covert mission briefing.',
            'The student speaks {MAIN_LANGUAGE} and is learning {LEARN_LANGUAGE}.',
            'Use light spy flair such as missions, code words, and intel while keeping the lesson clear (strictly 1 to 3 sentences total).',
        ].join('\n'),
    },
    wizard: {
        id: 'wizard',
        name: 'Wizard',
        subtitle: 'Every word is a spell',
        liveVoice: 'Aoede',
        template: [
            'You are Wizard, a wise and whimsical wizard who treats every new word like a magic spell.',
            'The student speaks {MAIN_LANGUAGE} and is learning {LEARN_LANGUAGE}.',
            'Teach with mystical, playful charm and spell-casting flair while keeping the lesson clear (strictly 1 to 3 sentences total).',
        ].join('\n'),
    },
};

const lc = (s: string) => s.trim().toLowerCase();

const BARE_NOUN_LANGUAGES = new Set([
    'english', 'japanese', 'hindi', 'korean', 'chinese', 'mandarin', 'thai', 'vietnamese', 'russian',
    // Glossos additions:
    'slovak', 'yucatec mayan',
]);

export function teachesArticle(learn: string): boolean {
    return !BARE_NOUN_LANGUAGES.has(lc(learn));
}

function pass1TermForm(learn: string): string {
    return teachesArticle(learn)
        ? 'with its singular grammatical article (e.g. el/la, le/la, der/die/das, il/la, o/a)'
        : 'as the bare noun on its own';
}

function pass1NounForm(learn: string): string {
    return teachesArticle(learn)
        ? 'with its singular article (el/la, le/la, der/die/das, il/la, o/a)'
        : 'on its own (the bare noun only)';
}

function pass2WordRule(learn: string): string {
    return teachesArticle(learn)
        ? `The isolated focal ${learn} noun taught in the reply, always written with its singular definite article (Spanish el/la, French le/la/l', German der/die/das, Italian il/lo/la/l', Portuguese o/a) whenever ${learn} has gendered articles (convert indefinite articles like un/una/une/ein/uma to el/la/le/der/o/a).`
        : `The isolated focal ${learn} noun taught in the reply, written as the bare noun only (e.g. "シャベル", not "このシャベル"; "बोतल", not "यह बोतल").`;
}

function pass2ExampleContrast(learn: string): string {
    const pairs: Record<string, string> = {
        english: 'for "key": "This is the key.", not "What is this?"',
        spanish: 'for "la llave": "Esta es la llave.", not "¿Qué es esto?"',
        french: 'for "le clavier": "Le clavier est cassé.", not "C\'est cassé."',
        italian: 'for "la chiave": "Questa è la chiave.", not "Che cos\'è questo?"',
        portuguese: 'for "a chave": "Esta é a chave.", not "O que é isso?"',
        japanese: 'for "ナイフ": "これはナイフです。", not "これを持っていますか？"',
        hindi: 'for "चाबी": "यह चाबी है।", not "यह क्या है?"',
    };
    const pair = pairs[lc(learn)];
    return pair ? ` (e.g. ${pair})` : '';
}

const SAMPLE_QUESTIONS: Record<string, string> = {
    japanese: 'これは何ですか？これが欲しいと言うにはどう言えばいいですか？',
    korean: '이건 뭐예요? 이걸 갖고 싶다고 어떻게 말해요?',
    chinese: '这是什么？想说我想要这个该怎么说？',
    mandarin: '这是什么？想说我想要这个该怎么说？',
    french: "Qu'est-ce que c'est et comment dire que je le veux ?",
    german: 'Was ist das und wie sage ich, dass ich das möchte?',
    italian: "Che cos'è questo e come dico che lo voglio?",
    portuguese: 'O que é isto e como digo que eu quero isto?',
    spanish: '¿Qué es esto y cómo digo que lo quiero?',
    russian: 'Что это и как сказать, что я это хочу?',
};

function sampleHostReply(main: string, word: string, sentence: string): string {
    switch (lc(main)) {
        case 'japanese': return `それはマグカップです、${word}！欲しいと伝えるには、${sentence}と言いましょう。`;
        case 'korean': return `그건 머그컵이에요, ${word}! 갖고 싶다고 말하려면 ${sentence}라고 하세요.`;
        case 'chinese':
        case 'mandarin': return `那是一个马克杯，${word}！想说你想要它，可以说：${sentence}`;
        case 'french': return `C'est une tasse, ${word} ! Pour dire que tu la veux, dis : ${sentence}`;
        case 'german': return `Das ist eine Tasse, ${word}! Um zu sagen, dass du sie möchtest, sag: ${sentence}`;
        case 'italian': return `Questa è una tazza, ${word}! Per dire che la vuoi, di': ${sentence}`;
        case 'portuguese': return `Isso é uma caneca, ${word}! Para dizer que você a quer, diga: ${sentence}`;
        case 'spanish': return `¡Eso es una taza, ${word}! Para decir que la quieres, di: ${sentence}`;
        case 'russian': return `Это кружка, ${word}! Чтобы сказать, что ты её хочешь, скажи: ${sentence}`;
        default: return `That is a mug, ${word}! To say you want it, say, ${sentence}`;
    }
}

const SAMPLE_TARGET_WORD: Record<string, string> = {
    english: 'a mug', japanese: 'マグカップ', korean: '머그컵', chinese: '马克杯', mandarin: '马克杯',
    french: 'la tasse', german: 'die Tasse', italian: 'la tazza', portuguese: 'a caneca',
    russian: 'кружка', spanish: 'la taza',
};

const SAMPLE_TARGET_SENTENCE: Record<string, string> = {
    english: 'I would like this mug, please.',
    japanese: 'このマグカップが欲しいです。',
    korean: '이 머그컵을 원해요.',
    chinese: '我想要这个马克杯。',
    mandarin: '我想要这个马克杯。',
    french: "Je voudrais cette tasse, s'il vous plaît.",
    german: 'Ich möchte bitte diese Tasse.',
    italian: 'Vorrei questa tazza, per favore.',
    portuguese: 'Eu quero esta caneca, por favor.',
    russian: 'Я хочу эту кружку, пожалуйста.',
    spanish: 'Quiero esta taza, por favor.',
};

const LEVEL_RULES: Record<string, string> = {
    Beginner: '4. The student is a beginner: teach only very common words and keep every <target> sentence short (at most 6 words).',
    Intermediate: '4. The student is intermediate: use everyday vocabulary and natural sentences of moderate length.',
    Advanced: '4. The student is advanced: you may teach richer vocabulary, idioms, or more nuanced phrasing.',
};

export function buildSystemPrompt(
    personaId: PersonaId,
    main: string,
    learn: string,
    level?: string,
    customTemplate?: string,
): string {
    const template = customTemplate?.trim() || PERSONAS[personaId].template;
    const persona = template.replaceAll('{MAIN_LANGUAGE}', main).replaceAll('{LEARN_LANGUAGE}', learn);

    let rules = [
        'Rules:',
        '1. Reply with ONLY one <reply>...</reply> block (1 to 3 short spoken sentences, no parentheses).',
        `2. Ground "this"/"that" to the main object in the camera view: identify the object and teach the exact sentence the student asked to say about it (e.g., wanting it, complimenting it, or asking about it) in ${learn}. If their question does not refer to the camera view, teach the requested phrase directly. If they ask what text in the image says or means, read it in <target>...</target> and explain its meaning in ${main}.`,
        `3. Write all ${main} words OUTSIDE <target>. Put ONLY ${learn} words or complete ${learn} sentences INSIDE <target>...</target>. Never put ${main} inside <target>.`,
    ].join('\n');
    if (level && LEVEL_RULES[level]) rules += `\n${LEVEL_RULES[level]}`;

    const word = SAMPLE_TARGET_WORD[lc(learn)];
    const sentence = SAMPLE_TARGET_SENTENCE[lc(learn)];
    if (!word || !sentence) return `${persona}\n\n${rules}`;

    const question = SAMPLE_QUESTIONS[lc(main)] ?? 'What is this and how do I say I want this?';
    const example = [
        `Example ("${question}"):`,
        '<reply>',
        sampleHostReply(main, `<target>${word}</target>`, `<target>${sentence}</target>`),
        '</reply>',
    ].join('\n');
    return `${persona}\n\n${rules}\n\n${example}`;
}

/** The per-turn Pass 1 prompt (the user message that accompanies the photo or follow-up). */
export function buildPass1Prompt(opts: {
    main: string;
    learn: string;
    question?: string;
    isFollowUp: boolean;
    focalWord?: string;
}): string {
    const { main, learn, isFollowUp, focalWord } = opts;
    const question = opts.question?.trim() ?? '';

    const base = question
        ? `${isFollowUp ? 'Follow-up' : 'Student asked'}: "${question}". Answer in ${main} outside <target> (grounding "this"/"that" to the camera object). State the focal ${learn} noun ${pass1NounForm(learn)} inside <target>...</target> in your first ${main} clause, then introduce one complete ${learn} sentence inside a single unbroken <target>...</target> in the next clause (or if teaching a greeting/set phrase, wrap the complete ${learn} phrase in one <target>...</target>). Always separate <target> tags with ${main} words (never back-to-back </target><target>), never split a ${learn} sentence across tags, and never leave any ${learn} word untagged. Start immediately with <reply>.`
        : `Identify the focal item in ${main}, then teach the exact focal ${learn} vocabulary term ${pass1TermForm(learn)} followed by a complete example sentence. All conversational explanations and framing must be strictly in ${main} outside <target>. Wrap every single ${learn} word or complete ${learn} sentence inside <target>...</target>. Never place two <target> tags back-to-back without ${main} words between them, and never split a sentence across tags. Emit everything inside <reply>...</reply>.`;

    const focal = isFollowUp && focalWord
        ? `The active lesson subject is "${focalWord}". Speak strictly in ${main} outside <target>; separate <target>...</target> spans with ${main} words and keep every full ${learn} sentence inside one unbroken <target>...</target> tag.\n\n`
        : '';

    return `${focal}${base}\nMandatory: All non-target explanations must be strictly in ${main}. Wrap every ${learn} word and every complete ${learn} sentence (including its verb/ending) entirely inside <target>...</target>, separated by ${main} words. Never emit back-to-back <target> tags, never write < inside <target>, and never leave ${learn} text untagged.`;
}

/** The Pass 2 prompt that turns a tagged teacher reply into one JSON flashcard. */
export function buildPass2Prompt(opts: {
    main: string;
    learn: string;
    replyWithTags: string;
    question?: string;
    existingWords?: string[];
}): string {
    const { main, learn, replyWithTags } = opts;
    const question = opts.question?.trim() ?? '';
    const existing = [...new Set((opts.existingWords ?? []).map(w => w.trim()).filter(Boolean))];

    let prompt = [
        `Extract the key ${learn} vocabulary item taught in the teacher reply into a JSON flashcard object with keys "word", "meaning", "example", "example_translation":`,
        `1. "word": ${pass2WordRule(learn)} Strip carrier phrases like "To say that, you can say" and copulas (isolate "青いマット" from "これは青いマットです。"). Do not include demonstratives. A short greeting or set phrase is valid only if that greeting was specifically taught.`,
        `2. "meaning": Clear definition of "word" written strictly in ${main} (never English if ${main} is different).`,
        `3. "example": A complete, natural ${learn} statement written 100% in ${learn} (zero ${main} words, zero duplicate articles) that uses the base noun from "word". If the reply only used a generic question or a pronoun sentence, compose a short ${learn} statement that contains the noun from "word"${pass2ExampleContrast(learn)}.`,
        `4. "example_translation": Complete translation of "example" written strictly in ${main}.`,
    ].join('\n');
    if (question) prompt += `\nStudent question: "${question}"`;
    if (existing.length) prompt += `\nWords already taught this session (do not re-extract): ${existing.join(', ')}`;
    return `${prompt}\n${replyWithTags}`;
}

/** Gemini responseSchema for Pass 2 (Gallery: XrLanguageTeacherResponseSchema.kt). */
export const PASS2_RESPONSE_SCHEMA = {
    type: 'OBJECT',
    properties: {
        word: {
            type: 'STRING',
            description: 'main focal word/phrase discussed when multiple nouns appear; never a sentence or copula frame',
        },
        meaning: { type: 'STRING' },
        example: { type: 'STRING' },
        example_translation: { type: 'STRING' },
    },
    required: ['word', 'meaning', 'example', 'example_translation'],
    propertyOrdering: ['word', 'meaning', 'example', 'example_translation'],
} as const;
