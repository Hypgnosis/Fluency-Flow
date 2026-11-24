/**
 * Fixed spoken phrases for Lens Teacher: the opening greeting and the short "thinking" fillers
 * played while the model works. Text adapted from Google AI Edge Gallery
 * (spokenphrases/XrLanguageTeacherSpokenPhrases.kt, Apache License 2.0).
 */

interface PhraseSet {
    greeting: string;
    fillers: string[];
}

const PHRASES: Record<string, PhraseSet> = {
    en: {
        greeting: 'Hi there! What are you looking to learn about today?',
        fillers: ['Let me see…', 'Hmm, let me take a look…', "Let's check this out…", 'Looking at this…', 'One moment, let me see…', 'Hmm, interesting…', "Let's see what we have here…"],
    },
    es: {
        greeting: '¡Hola! ¿Sobre qué te gustaría aprender hoy?',
        fillers: ['A ver…', 'Mmm, déjame echar un vistazo…', 'Vamos a ver esto…', 'Fíjate en esto…', 'Un momento, a ver…', 'Mmm, interesante…', 'Veamos qué tenemos aquí…'],
    },
    fr: {
        greeting: "Bonjour ! Qu'aimerais-tu apprendre aujourd'hui ?",
        fillers: ['Voyons voir…', 'Hmm, laisse-moi jeter un œil…', 'Regardons ça…', "Alors, qu'est-ce que c'est…", 'Un instant, voyons…', 'Hmm, intéressant…', "Voyons ce qu'on a ici…"],
    },
    de: {
        greeting: 'Hallo! Worüber möchtest du heute etwas lernen?',
        fillers: ['Mal sehen…', 'Hmm, lass mich mal schauen…', 'Schauen wir uns das mal an…', 'Wenn ich mir das so ansehe…', 'Einen Moment, mal sehen…', 'Hmm, interessant…', 'Mal sehen, was wir hier haben…'],
    },
    it: {
        greeting: 'Ciao! Cosa ti piacerebbe imparare oggi?',
        fillers: ["Vediamo un po'…", "Mmm, fammi dare un'occhiata…", "Diamo un'occhiata a questo…", 'Osserviamo bene…', 'Un momento, vediamo…', 'Mmm, interessante…', 'Vediamo cosa abbiamo qui…'],
    },
    ja: {
        greeting: 'こんにちは！今日は何について学びたいですか？',
        fillers: ['えーと…', 'うーん、ちょっと見てみますね…', 'これを見てみましょう…', 'これを見ると…', '少し待ってくださいね、えーと…', 'うーん、面白いですね…', 'さて、何があるか見てみましょう…'],
    },
    ko: {
        greeting: '안녕하세요! 오늘은 무엇을 배워 볼까요?',
        fillers: ['어디 보자…', '음, 한번 볼게요…', '이거 한번 살펴볼까요…', '이걸 보니까…', '잠깐만요, 어디 보자…', '음, 흥미롭네요…', '여기 뭐가 있는지 볼까요…'],
    },
    pt: {
        greeting: 'Olá! O que gostaria de aprender hoje?',
        fillers: ['Vamos ver…', 'Hmm, vou dar uma olhada…', 'Vamos ver isto…', 'Olhando para isto…', 'Um momento, vamos ver…', 'Hmm, interessante…', 'Vamos ver o que temos aqui…'],
    },
    ru: {
        greeting: 'Привет! О чём ты хочешь узнать сегодня?',
        fillers: ['Так, посмотрим…', 'Хм, дай-ка взгляну…', 'Давай посмотрим на это…', 'Если посмотреть на это…', 'Секунду, посмотрим…', 'Хм, интересно…', 'Посмотрим, что тут у нас…'],
    },
    zh: {
        greeting: '你好！今天想学点什么呢？',
        fillers: ['让我看看…', '嗯，我来看一下…', '我们来看看这个…', '这个嘛…', '稍等，让我看看…', '嗯，真有意思…', '我们来看看这里有什么…'],
    },
};

function phraseSet(code: string): PhraseSet {
    return PHRASES[code] ?? PHRASES.en;
}

export function greetingFor(code: string): string {
    return phraseSet(code).greeting;
}

/** A random filler for `code` that differs from `previous` when possible. */
export function pickFiller(code: string, previous?: string, random: () => number = Math.random): string {
    const fillers = phraseSet(code).fillers;
    const pool = fillers.filter(f => f !== previous);
    const choices = pool.length ? pool : fillers;
    return choices[Math.floor(random() * choices.length)];
}

/** Whether `code` has localized phrases (otherwise English is used and spoken in English). */
export function hasPhrases(code: string): boolean {
    return code in PHRASES;
}
