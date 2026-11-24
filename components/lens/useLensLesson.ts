/**
 * Lesson state machine for Lens Teacher (port of Gallery's XrLanguageTeacherLessonController):
 *
 *   viewfinder --ask--> thinking --first text--> streaming --reply done--> extracting? --> lesson
 *   lesson --follow-up--> thinking ...      any --newLesson()--> viewfinder
 *
 * Every turn bumps an epoch so callbacks from a cancelled turn are ignored.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { LensTurn, PersonaId, VocabCard } from '../../types/lens';
import type { Content } from '../../services/genaiClient';
import { extractVocabCard, runTeacherTurn } from '../../services/lensTeacher/teacher';
import {
    decidePass2Card, extractCompleteSentences, isSameVocabularyWord, parseDialogueSegments, stripTags, tagCardWord,
} from '../../services/lensTeacher/dialogue';
import { greetingFor, hasPhrases, pickFiller } from '../../services/lensTeacher/phrases';
import { languageCode, localeFor } from '../../services/languages';
import { speak, speakSegments, stopSpeaking } from '../../services/speech';
import { makeThumbnail } from '../../utils/imageUtils';
import { saveLesson } from '../../services/vocabStore';

export type LensBusy = 'none' | 'thinking' | 'streaming' | 'extracting';

export interface LensLessonOptions {
    nativeLanguage: string;
    learnLanguage: string;
    level?: string;
    persona: PersonaId;
    muted: boolean;
}

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export function useLensLesson(opts: LensLessonOptions) {
    const { nativeLanguage, learnLanguage, level, persona, muted } = opts;
    const nativeCode = languageCode(nativeLanguage);
    const nativeLocale = hasPhrases(nativeCode) ? localeFor(nativeLanguage) : 'en-US';

    const [image, setImage] = useState<string | null>(null);
    const [turns, setTurns] = useState<LensTurn[]>([]);
    const [cards, setCards] = useState<VocabCard[]>([]);
    const [selectedCard, setSelectedCard] = useState(0);
    const [busy, setBusy] = useState<LensBusy>('none');
    const [streamingReply, setStreamingReply] = useState('');
    const [error, setError] = useState<string | null>(null);

    const history = useRef<Content[]>([]);
    const cardsRef = useRef<VocabCard[]>([]);
    const turnsRef = useRef<LensTurn[]>([]);
    const lessonId = useRef(newId());
    const createdAt = useRef(Date.now());
    const thumbnail = useRef<string | undefined>(undefined);
    const epoch = useRef(0);
    const abort = useRef<AbortController | null>(null);
    const lastFiller = useRef<string | undefined>(undefined);
    const mutedRef = useRef(muted);
    mutedRef.current = muted;

    const greeting = greetingFor(nativeCode);

    const setTurnsBoth = (next: LensTurn[]) => { turnsRef.current = next; setTurns(next); };
    const setCardsBoth = (next: VocabCard[]) => { cardsRef.current = next; setCards(next); };

    const speakReplyPart = useCallback((text: string) => {
        if (mutedRef.current || !text.trim()) return;
        const focal = cardsRef.current[cardsRef.current.length - 1]?.word;
        const tagged = focal ? tagCardWord(text, focal) : text;
        const learnLocale = localeFor(learnLanguage);
        speakSegments(parseDialogueSegments(tagged).map(s => ({
            text: s.text,
            locale: s.isTargetLanguage ? learnLocale : nativeLocale,
        })));
    }, [learnLanguage, nativeLocale]);

    const speakGreeting = useCallback(() => {
        if (!mutedRef.current) speak(greeting, nativeLocale);
    }, [greeting, nativeLocale]);

    const persist = useCallback(() => {
        const allTurns = turnsRef.current;
        if (!allTurns.some(t => t.role === 'teacher')) return;
        const firstCard = cardsRef.current[0]?.word;
        const firstReply = allTurns.find(t => t.role === 'teacher')?.text;
        saveLesson({
            id: lessonId.current,
            title: firstCard || (firstReply ? stripTags(firstReply).slice(0, 60) : 'Untitled'),
            persona,
            nativeLanguage,
            learnLanguage,
            createdAt: createdAt.current,
            updatedAt: Date.now(),
            thumbnailDataUrl: thumbnail.current,
            turns: allTurns.map(t => ({ role: t.role, text: t.text, cardIndex: t.cardIndex })),
            cards: cardsRef.current,
        });
    }, [persona, nativeLanguage, learnLanguage]);

    const reset = useCallback(() => {
        epoch.current++;
        abort.current?.abort();
        abort.current = null;
        stopSpeaking();
        history.current = [];
        lessonId.current = newId();
        createdAt.current = Date.now();
        thumbnail.current = undefined;
        setImage(null);
        setTurnsBoth([]);
        setCardsBoth([]);
        setSelectedCard(0);
        setBusy('none');
        setStreamingReply('');
        setError(null);
    }, []);

    // Changing languages or persona starts a fresh lesson.
    useEffect(() => { reset(); }, [nativeLanguage, learnLanguage, persona, reset]);
    useEffect(() => () => { abort.current?.abort(); stopSpeaking(); }, []);

    /** Sends a turn. On the first turn `frame` must be the captured photo. */
    const ask = useCallback(async (question?: string, frame?: string) => {
        const q = question?.trim() || undefined;
        const isFirst = history.current.length === 0;
        const photo = isFirst ? frame ?? image : image;
        if (isFirst && !photo) {
            setError('Point the camera at something first.');
            return;
        }
        if (!isFirst && !q) return; // Gallery drops blank follow-ups.

        const myEpoch = ++epoch.current;
        abort.current?.abort();
        const controller = new AbortController();
        abort.current = controller;
        const stale = () => epoch.current !== myEpoch;

        stopSpeaking();
        setError(null);
        if (isFirst && photo) {
            setImage(photo);
            makeThumbnail(photo).then(t => { thumbnail.current = t; }).catch(() => undefined);
        }
        const turnsBefore = turnsRef.current;
        if (q) setTurnsBoth([...turnsBefore, { id: newId(), role: 'student', text: q }]);
        setBusy('thinking');
        setStreamingReply('');

        if (!mutedRef.current) {
            const filler = pickFiller(nativeCode, lastFiller.current);
            lastFiller.current = filler;
            speak(filler, nativeLocale);
        }

        let spokenUpTo = 0;
        try {
            const { replyWithTags, newHistory } = await runTeacherTurn({
                persona,
                nativeLanguage,
                learnLanguage,
                level,
                history: history.current,
                imageDataUrl: photo ?? undefined,
                question: q,
                focalWord: cardsRef.current[cardsRef.current.length - 1]?.word,
                signal: controller.signal,
                onReply: reply => {
                    if (stale()) return;
                    setBusy('streaming');
                    setStreamingReply(reply);
                    const { sentences, next } = extractCompleteSentences(reply, spokenUpTo);
                    spokenUpTo = next;
                    sentences.forEach(speakReplyPart);
                },
            });
            if (stale()) return;

            speakReplyPart(replyWithTags.slice(spokenUpTo));
            history.current = [...history.current, ...newHistory];
            const teacherTurn: LensTurn = { id: newId(), role: 'teacher', text: replyWithTags };
            setTurnsBoth([...turnsRef.current, teacherTurn]);
            setStreamingReply('');

            const decision = decidePass2Card(replyWithTags, cardsRef.current);
            const attachCard = (index: number) => {
                setTurnsBoth(turnsRef.current.map(t => (t.id === teacherTurn.id ? { ...t, cardIndex: index } : t)));
                setSelectedCard(index);
            };

            if (decision.kind === 'reuse') {
                attachCard(decision.cardIndex);
            } else if (decision.kind === 'extract') {
                setBusy('extracting');
                const card = await extractVocabCard({
                    nativeLanguage,
                    learnLanguage,
                    replyWithTags,
                    question: q,
                    existingWords: cardsRef.current.map(c => c.word),
                    signal: controller.signal,
                }).catch(err => {
                    if ((err as Error).name === 'AbortError') throw err;
                    console.warn('[GLOSSOS-LENS] Card extraction failed:', err);
                    return null;
                });
                if (stale()) return;
                if (card) {
                    const existing = cardsRef.current.findIndex(c => isSameVocabularyWord(c.word, card.word));
                    if (existing >= 0) {
                        attachCard(existing);
                    } else {
                        setCardsBoth([...cardsRef.current, card]);
                        attachCard(cardsRef.current.length - 1);
                    }
                }
            }
            setBusy('none');
            persist();
        } catch (err) {
            if (stale()) return;
            stopSpeaking();
            setBusy('none');
            setStreamingReply('');
            // Roll back this turn's student message.
            setTurnsBoth(turnsBefore);
            if (isFirst && !turnsBefore.some(t => t.role === 'teacher')) setImage(null);
            if ((err as Error).name !== 'AbortError') {
                console.error('[GLOSSOS-LENS] Teacher turn failed:', err);
                setError(`Couldn't generate a response. ${(err as Error).message || 'Please try again.'}`);
            }
        }
    }, [image, persona, nativeLanguage, learnLanguage, level, nativeCode, nativeLocale, speakReplyPart, persist]);

    /** Stops the running turn. Before the first reply this returns to the viewfinder. */
    const stop = useCallback(() => {
        epoch.current++;
        abort.current?.abort();
        abort.current = null;
        stopSpeaking();
        setBusy('none');
        setStreamingReply('');
        const hasTeacher = turnsRef.current.some(t => t.role === 'teacher');
        if (!hasTeacher) {
            setImage(null);
            setTurnsBoth([]);
            history.current = [];
        } else {
            // Drop trailing student turns that never got an answer.
            const lastTeacher = turnsRef.current.map(t => t.role).lastIndexOf('teacher');
            setTurnsBoth(turnsRef.current.slice(0, lastTeacher + 1));
        }
    }, []);

    return {
        image,
        turns,
        cards,
        selectedCard,
        setSelectedCard,
        busy,
        streamingReply,
        error,
        setError,
        greeting,
        nativeLocale,
        hasLesson: history.current.length > 0 || image !== null,
        thumbnail: () => thumbnail.current,
        ask,
        stop,
        newLesson: reset,
        speakGreeting,
        speakReplyPart,
    };
}
