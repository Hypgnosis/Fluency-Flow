import React, { forwardRef, useImperativeHandle } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../components/lens/LensViewfinder', () => ({
    LensViewfinder: forwardRef((props: { frozenImage: string | null }, ref) => {
        useImperativeHandle(ref, () => ({ capture: () => 'data:image/jpeg;base64,AAAA' }));
        return <div data-testid="viewfinder">{props.frozenImage ? 'frozen' : 'live'}</div>;
    }),
}));

vi.mock('../utils/imageUtils', () => ({
    makeThumbnail: vi.fn().mockResolvedValue('data:image/jpeg;base64,THUMB'),
    fileToSquareDataUrl: vi.fn(),
    captureSquareFrame: vi.fn(),
}));

const runTeacherTurn = vi.fn();
const extractVocabCard = vi.fn();
vi.mock('../services/lensTeacher/teacher', () => ({
    runTeacherTurn: (...args: unknown[]) => runTeacherTurn(...args),
    extractVocabCard: (...args: unknown[]) => extractVocabCard(...args),
}));

import { LensTeacher } from '../components/lens/LensTeacher';

const REPLY = 'That is a cup, <target>la taza</target>! Say <target>Quiero la taza.</target>';

describe('LensTeacher', () => {
    beforeAll(() => {
        // jsdom does not implement element scrolling.
        Element.prototype.scrollTo = () => undefined;
    });

    beforeEach(() => {
        localStorage.clear();
        runTeacherTurn.mockReset();
        extractVocabCard.mockReset();
        runTeacherTurn.mockImplementation(async (req: { onReply?: (r: string) => void; imageDataUrl?: string; question?: string }) => {
            req.onReply?.('That is a cup, <target>la ta</target>');
            req.onReply?.(REPLY);
            return { replyWithTags: REPLY, newHistory: [{ role: 'user', parts: [] }, { role: 'model', parts: [] }] };
        });
        extractVocabCard.mockResolvedValue({
            word: 'la taza', meaning: 'cup', example: 'Quiero la taza.', exampleTranslation: 'I want the cup.',
        });
    });

    it('asks about the photo, shows the card, saves it and studies it', async () => {
        render(<LensTeacher nativeLanguage="English" learnLanguage="Spanish" level="Beginner" />);

        // jsdom has no SpeechRecognition, so the typed input is shown.
        fireEvent.change(screen.getByPlaceholderText(/Ask about what you see/), { target: { value: 'What is this?' } });
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Ask' })); });

        expect(runTeacherTurn).toHaveBeenCalledTimes(1);
        const req = runTeacherTurn.mock.calls[0][0];
        expect(req).toMatchObject({
            nativeLanguage: 'English', learnLanguage: 'Spanish', level: 'Beginner', persona: 'buddy',
            question: 'What is this?', imageDataUrl: 'data:image/jpeg;base64,AAAA', history: [],
        });
        expect(extractVocabCard).toHaveBeenCalledWith(expect.objectContaining({ replyWithTags: REPLY, existingWords: [] }));

        expect(await screen.findByText('What is this?')).toBeInTheDocument();
        expect(screen.getByTestId('viewfinder')).toHaveTextContent('frozen');
        expect(screen.getByText('Vocab found')).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'la taza' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'la taza' })).toBeInTheDocument(); // tap-to-pronounce span

        // Save the card.
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })); });
        await waitFor(() => expect(screen.getByRole('button', { name: 'Saved' })).toBeInTheDocument());
        const stored = JSON.parse(localStorage.getItem('glossos_vocab_guest') || '[]');
        expect(stored).toHaveLength(1);
        expect(stored[0]).toMatchObject({ id: 'spanish_la_taza', word: 'la taza', learnLanguage: 'Spanish', imageDataUrl: 'data:image/jpeg;base64,THUMB' });

        // Follow-up re-uses history and the focal word.
        const followUpReply = 'Yes, <target>la taza</target> is big.';
        runTeacherTurn.mockImplementationOnce(async () => ({ replyWithTags: followUpReply, newHistory: [] }));
        fireEvent.change(screen.getByPlaceholderText(/Ask a follow-up/), { target: { value: 'Is it big?' } });
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Ask' })); });
        expect(runTeacherTurn.mock.calls[1][0]).toMatchObject({ question: 'Is it big?', focalWord: 'la taza' });
        expect(runTeacherTurn.mock.calls[1][0].history).toHaveLength(2);
        // Same spans as an existing card -> reused, no second extraction.
        expect(extractVocabCard).toHaveBeenCalledTimes(1);

        // Study it.
        fireEvent.click(screen.getByRole('button', { name: /^Study/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Start' }));
        expect(screen.getByText('cup')).toBeInTheDocument();
        fireEvent.click(screen.getByText('cup'));
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Good/ })); });
        expect(screen.getByText('Session complete')).toBeInTheDocument();
        await waitFor(() => {
            const after = JSON.parse(localStorage.getItem('glossos_vocab_guest') || '[]');
            expect(after[0].srs.reps).toBe(1);
        });
    }, 20000); // first render in jsdom can be slow on a cold start

    it('rolls back the turn and shows an error when the model call fails', async () => {
        runTeacherTurn.mockRejectedValueOnce(new Error('quota exceeded'));
        render(<LensTeacher nativeLanguage="English" learnLanguage="Spanish" />);
        fireEvent.change(screen.getByPlaceholderText(/Ask about what you see/), { target: { value: 'Hi?' } });
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Ask' })); });
        expect(await screen.findByText(/Couldn't generate a response\. quota exceeded/)).toBeInTheDocument();
        expect(screen.queryByText('Hi?')).not.toBeInTheDocument();
        expect(screen.getByTestId('viewfinder')).toHaveTextContent('live');
    });

    it('asks for a different language when native and target match', () => {
        render(<LensTeacher nativeLanguage="Spanish" learnLanguage="Spanish" />);
        expect(screen.getByText(/Pick a learning language that is different/)).toBeInTheDocument();
    });
});
