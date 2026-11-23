import { DAY_MS, describeNextReview, isDue, newSrsState, review } from '../services/srs';
import { matchesSpokenWord, normalizeForMatch } from '../services/speechMatch';
import { wordId } from '../services/vocabStore';

describe('spaced repetition', () => {
    const now = 1_000_000_000_000;

    it('starts due immediately', () => {
        expect(isDue(newSrsState(now), now)).toBe(true);
    });

    it('grows intervals with good answers', () => {
        let s = newSrsState(now);
        s = review(s, 'good', now);
        expect(s.intervalDays).toBe(1);
        s = review(s, 'good', now);
        expect(s.intervalDays).toBe(3);
        s = review(s, 'good', now);
        expect(s.intervalDays).toBe(7.5);
        expect(s.due).toBe(now + 7.5 * DAY_MS);
        expect(isDue(s, now)).toBe(false);
    });

    it('resets and lowers ease on again, with a floor', () => {
        let s = review(review(newSrsState(now), 'good', now), 'again', now);
        expect(s).toMatchObject({ reps: 0, lapses: 1, intervalDays: 0 });
        expect(s.ease).toBeCloseTo(2.3);
        for (let i = 0; i < 20; i++) s = review(s, 'again', now);
        expect(s.ease).toBe(1.3);
    });

    it('describes the next review', () => {
        const s = newSrsState(now);
        expect(describeNextReview(s, 'again', now)).toBe('1 min');
        expect(describeNextReview(s, 'hard', now)).toBe('12 h');
        expect(describeNextReview(s, 'good', now)).toBe('1 d');
        expect(describeNextReview(s, 'easy', now)).toBe('3 d');
    });
});

describe('speech matching', () => {
    it('normalizes accents, case, punctuation and katakana', () => {
        expect(normalizeForMatch('¡Él está AQUÍ!')).toBe('el esta aqui');
        expect(normalizeForMatch('コーヒー')).toBe('こーひー');
    });

    it('matches the word inside a longer utterance, with small mistakes', () => {
        expect(matchesSpokenWord('creo que es la taza', 'la taza')).toBe(true);
        expect(matchesSpokenWord('mariposa', 'la mariposa')).toBe(true);
        expect(matchesSpokenWord('es una maripoza', 'la mariposa')).toBe(true);
        expect(matchesSpokenWord('perro', 'el gato')).toBe(false);
        expect(matchesSpokenWord('', 'gato')).toBe(false);
    });

    it('requires exact short words', () => {
        expect(matchesSpokenWord('sol', 'sol')).toBe(true);
        expect(matchesSpokenWord('sal', 'sol')).toBe(false);
    });

    it('accepts alternative forms', () => {
        expect(matchesSpokenWord('coche', 'el carro / el coche')).toBe(true);
    });

    it('matches space-free scripts by substring or near miss', () => {
        expect(matchesSpokenWord('これはマグカップです', 'マグカップ')).toBe(true);
        expect(matchesSpokenWord('我想要这个杯子', '杯子')).toBe(true);
        expect(matchesSpokenWord('りんご', 'みかん')).toBe(false);
    });
});

describe('wordId', () => {
    it('is stable, lowercase and safe for Firestore paths', () => {
        expect(wordId('Spanish', 'La Taza')).toBe('spanish_la_taza');
        expect(wordId('French', "l'eau/froide")).toBe("french_l'eau_froide");
        expect(wordId('German', 'x'.repeat(100))).toHaveLength(64);
    });
});
