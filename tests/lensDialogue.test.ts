import {
    balanceTargets,
    decidePass2Card,
    extractCompleteSentences,
    extractStreamingReply,
    isSameVocabularyWord,
    parseDialogueSegments,
    parsePass2Output,
    sanitizeVocabCard,
    stripTags,
    tagCardWord,
    targetSpans,
} from '../services/lensTeacher/dialogue';
import { buildPass1Prompt, buildPass2Prompt, buildSystemPrompt } from '../services/lensTeacher/prompts';
import { pickFiller } from '../services/lensTeacher/phrases';

describe('extractStreamingReply', () => {
    it('shows nothing while only a prefix of <reply> has arrived', () => {
        expect(extractStreamingReply('<rep')).toBe('');
        expect(extractStreamingReply('  <')).toBe('');
    });

    it('returns the reply body and keeps only target tags', () => {
        const raw = '<reply>That is a cup, <target>la taza</target>! Say <b>this</b>.</reply><card>x</card>';
        expect(extractStreamingReply(raw)).toBe('That is a cup, <target>la taza</target>! Say this.');
    });

    it('drops a partial trailing tag and auto-closes an open target while streaming', () => {
        expect(extractStreamingReply('<reply>It is <target>la ta')).toBe('It is <target>la ta</target>');
        expect(extractStreamingReply('<reply>It is <tar')).toBe('It is ');
    });

    it('handles code fences, <say> tags and a missing <reply>', () => {
        expect(extractStreamingReply('```xml\n<reply>Hi <say>hola</say></reply>\n```')).toBe('Hi <target>hola</target>');
        expect(extractStreamingReply('Plain <target>gato</target>')).toBe('Plain <target>gato</target>');
    });
});

describe('balanceTargets', () => {
    it('splits unclosed pairs and drops stray closing tags', () => {
        expect(balanceTargets('<target>a<target>b</target>')).toBe('<target>a</target><target>b</target>');
        expect(balanceTargets('x</target> y')).toBe('x y');
    });
});

describe('extractCompleteSentences', () => {
    it('emits finished sentences and keeps the unfinished tail', () => {
        const text = 'That is a cup, <target>la taza</target>! To say you want it, say: <target>Quiero';
        const { sentences, next } = extractCompleteSentences(text);
        expect(sentences).toEqual(['That is a cup, <target>la taza</target>!']);
        expect(text.slice(next)).toBe('To say you want it, say: <target>Quiero');
    });

    it('never splits inside a target span or after an abbreviation', () => {
        const text = 'Say <target>Quiero esta taza. Por favor.</target> Ask Dr. Smith. Done';
        const { sentences } = extractCompleteSentences(text);
        expect(sentences).toEqual(['Say <target>Quiero esta taza. Por favor.</target>', 'Ask Dr. Smith.']);
    });

    it('splits CJK sentences without trailing spaces', () => {
        const { sentences } = extractCompleteSentences('これはコップです。次は');
        expect(sentences).toEqual(['これはコップです。']);
    });

    it('resumes from an offset', () => {
        const text = 'One. Two. Three';
        const first = extractCompleteSentences(text);
        expect(first.sentences).toEqual(['One.', 'Two.']);
        expect(extractCompleteSentences(`${text}. Four`, first.next).sentences).toEqual(['Three.']);
    });
});

describe('parseDialogueSegments', () => {
    it('splits by language and moves leading punctuation back', () => {
        expect(parseDialogueSegments('It is <target>manzana</target>! Say <target>Quiero una manzana.</target> 🍎')).toEqual([
            { text: 'It is', isTargetLanguage: false },
            { text: 'manzana!', isTargetLanguage: true },
            { text: 'Say', isTargetLanguage: false },
            { text: 'Quiero una manzana.', isTargetLanguage: true },
        ]);
    });
});

describe('tag helpers', () => {
    it('lists spans and strips tags', () => {
        expect(targetSpans('a <target>x</target> b <target> y </target>')).toEqual(['x', 'y']);
        expect(stripTags('a <target>x</target>  b')).toBe('a x b');
    });

    it('wraps untagged card words without nesting', () => {
        expect(tagCardWord('The taza is <target>la taza</target>, taza!', 'taza'))
            .toBe('The <target>taza</target> is <target>la taza</target>, <target>taza</target>!');
    });
});

describe('vocabulary words', () => {
    it('matches ignoring case, punctuation and leading articles', () => {
        expect(isSameVocabularyWord('La Taza', 'taza')).toBe(true);
        expect(isSameVocabularyWord('¡el perro!', 'perro')).toBe(true);
        expect(isSameVocabularyWord('die Tasse', 'Tasse.')).toBe(true);
        expect(isSameVocabularyWord('gato', 'perro')).toBe(false);
        expect(isSameVocabularyWord('', 'perro')).toBe(false);
    });

    it('decides skip / reuse / extract like Gallery', () => {
        const cards = [{ word: 'la taza', meaning: 'cup', example: '', exampleTranslation: '' }];
        expect(decidePass2Card('No Spanish here.', cards)).toEqual({ kind: 'skip' });
        expect(decidePass2Card('Again: <target>taza</target>!', cards)).toEqual({ kind: 'reuse', cardIndex: 0 });
        expect(decidePass2Card('<target>la taza</target> and <target>el plato</target>', cards)).toEqual({ kind: 'extract' });
    });
});

describe('parsePass2Output', () => {
    it('parses fenced JSON and maps example_translation', () => {
        const card = parsePass2Output('```json\n{"word":"la taza","meaning":"cup","example":"Esta es la taza.","example_translation":"This is the cup."}\n```');
        expect(card).toEqual({ word: 'la taza', meaning: 'cup', example: 'Esta es la taza.', exampleTranslation: 'This is the cup.' });
    });

    it('extracts the object from surrounding text and strips byte tokens', () => {
        expect(parsePass2Output('Here: {"word":"ka<0xE3>sa","meaning":"house"} done')?.word).toBe('kasa');
    });

    it('rejects echoed labels, missing words and junk', () => {
        expect(parsePass2Output('{"word":"word","meaning":"meaning: x","example":"","example_translation":""}')).toBeNull();
        expect(parsePass2Output('{"word":"","meaning":"cup"}')).toBeNull();
        expect(parsePass2Output('{"word":"taza","meaning":"","example_translation":""}')).toBeNull();
        expect(parsePass2Output('not json')).toBeNull();
        expect(parsePass2Output('{"word":"taz')).toBeNull();
    });
});

describe('sanitizeVocabCard', () => {
    it('cleans punctuation, quotes and empty fields', () => {
        const card = sanitizeVocabCard(
            { word: '"la taza."', meaning: 'cup.', example: '<target>Esta es la taza.</target>', exampleTranslation: '' },
            '<target>la taza</target>',
        );
        expect(card).toEqual({ word: 'la taza', meaning: 'cup', example: 'Esta es la taza.', exampleTranslation: 'cup' });
    });

    it('keeps paired Spanish exclamation marks and unwraps Japanese brackets', () => {
        expect(sanitizeVocabCard({ word: '¡Hola!', meaning: 'hi', example: '', exampleTranslation: 'hi' }, '').word).toBe('¡Hola!');
        expect(sanitizeVocabCard({ word: '「つくえ」', meaning: 'desk', example: '', exampleTranslation: '' }, '').word).toBe('つくえ');
    });

    it('prefers a shorter target span when the word is a whole phrase', () => {
        const card = sanitizeVocabCard(
            { word: 'quiero la taza roja', meaning: 'I want the red cup', example: '', exampleTranslation: '' },
            'Say <target>la taza roja</target> or <target>la taza</target>',
        );
        expect(card.word).toBe('la taza roja');
        expect(card.example).toBe('quiero la taza roja');
    });
});

describe('prompts', () => {
    it('builds the persona system prompt with rules, example and level', () => {
        const prompt = buildSystemPrompt('buddy', 'English', 'Spanish', 'Beginner');
        expect(prompt).toContain('You are Buddy');
        expect(prompt).toContain('The student speaks English and is learning Spanish.');
        expect(prompt).toContain('3. Write all English words OUTSIDE <target>.');
        expect(prompt).toContain('4. The student is a beginner');
        expect(prompt).toContain('<target>la taza</target>');
        expect(prompt).toContain('<target>Quiero esta taza, por favor.</target>');
    });

    it('omits the example for languages without a curated sample', () => {
        expect(buildSystemPrompt('wizard', 'English', 'Slovak')).not.toContain('Example (');
    });

    it('builds photo-only, question and follow-up Pass 1 prompts', () => {
        expect(buildPass1Prompt({ main: 'English', learn: 'Spanish', isFollowUp: false }))
            .toMatch(/^Identify the focal item in English.*grammatical article/s);
        expect(buildPass1Prompt({ main: 'English', learn: 'Japanese', isFollowUp: false }))
            .toContain('as the bare noun on its own');
        const followUp = buildPass1Prompt({ main: 'English', learn: 'Spanish', question: 'Is it big?', isFollowUp: true, focalWord: 'la taza' });
        expect(followUp).toMatch(/^The active lesson subject is "la taza"/);
        expect(followUp).toContain('Follow-up: "Is it big?"');
        expect(followUp).toContain('Mandatory: All non-target explanations must be strictly in English.');
    });

    it('builds the Pass 2 prompt with question, known words and reply', () => {
        const prompt = buildPass2Prompt({
            main: 'English', learn: 'Spanish', replyWithTags: 'It is <target>la taza</target>.',
            question: 'What is it?', existingWords: ['el plato', 'el plato', ' '],
        });
        expect(prompt).toContain('always written with its singular definite article');
        expect(prompt).toContain('(e.g. for "la llave"');
        expect(prompt).toContain('Student question: "What is it?"');
        expect(prompt).toContain('Words already taught this session (do not re-extract): el plato\n');
        expect(prompt.endsWith('It is <target>la taza</target>.')).toBe(true);
    });
});

describe('pickFiller', () => {
    it('never repeats the previous filler and falls back to English', () => {
        const first = pickFiller('es', undefined, () => 0);
        expect(pickFiller('es', first, () => 0)).not.toBe(first);
        expect(pickFiller('xx', undefined, () => 0)).toBe('Let me see…');
    });
});
