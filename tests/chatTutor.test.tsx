import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const streamReply = vi.fn();
vi.mock('../services/textEngine', () => ({
    streamReply: (...args: unknown[]) => streamReply(...args),
    engineReady: (kind: string) => kind === 'cloud',
    engineLabel: () => 'Gemini (cloud)',
}));

const speech = vi.hoisted(() => ({
    speakSegments: vi.fn(() => Promise.resolve()),
    stopSpeaking: vi.fn(),
    dictations: [] as any[],
}));
vi.mock('../services/speech', () => ({
    isTtsSupported: () => true,
    isDictationSupported: () => true,
    speakSegments: speech.speakSegments,
    stopSpeaking: speech.stopSpeaking,
    Dictation: class {
        constructor(public locale: string, public onTranscript: (t: string) => void) { speech.dictations.push(this); }
        start() { this.onTranscript('Hola, quiero un café'); }
        finish() { return Promise.resolve('Hola, quiero un café'); }
        cancel() { /* noop */ }
    },
}));

import { ChatTutor } from '../components/chat/ChatTutor';

describe('ChatTutor (Phase 3: voice in text chat)', () => {
    beforeAll(() => { Element.prototype.scrollTo = () => undefined; });
    beforeEach(() => {
        localStorage.clear();
        streamReply.mockReset();
        speech.speakSegments.mockClear();
        speech.dictations.length = 0;
        streamReply.mockImplementation(async function* (_kind: string, req: any) {
            yield '¡Muy bien! **Estoy cansado.** ';
            yield '[In English: use estar for feelings.] ¿Y tú?';
            req.onStats?.({ engine: 'cloud', label: 'Gemini (cloud)', ttftMs: 300, totalMs: 900 });
        });
    });

    const renderTutor = () => render(<ChatTutor nativeLanguage="English" learnLanguage="Spanish" level="Beginner" onManageModels={() => undefined} />);

    it('sends the message with the tutor prompt and history, and reads the reply aloud', async () => {
        renderTutor();
        fireEvent.change(screen.getByPlaceholderText('Write in Spanish…'), { target: { value: 'Yo soy cansado' } });
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })); });

        expect(streamReply).toHaveBeenCalledTimes(1);
        const [kind, req] = streamReply.mock.calls[0];
        expect(kind).toBe('cloud');
        expect(req.message).toBe('Yo soy cansado');
        expect(req.system).toContain('Spanish tutor');
        expect(req.history).toEqual([]);
        expect(await screen.findByText('Estoy cansado.')).toBeInTheDocument();
        expect(screen.getByText(/first token 300 ms/)).toBeInTheDocument();

        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Read aloud' })); });
        expect(speech.speakSegments).toHaveBeenCalledWith([
            { text: '¡Muy bien! Estoy cansado.', locale: 'es-MX' },
            { text: 'use estar for feelings.', locale: 'en-US' },
            { text: '¿Y tú?', locale: 'es-MX' },
        ]);

        // A follow-up carries the history.
        fireEvent.change(screen.getByPlaceholderText('Write in Spanish…'), { target: { value: 'Estoy bien' } });
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })); });
        expect(streamReply.mock.calls[1][1].history.map((t: any) => t.role)).toEqual(['user', 'model']);
    });

    it('auto-reads replies when enabled and remembers the setting', async () => {
        renderTutor();
        fireEvent.click(screen.getByRole('button', { name: /Auto-read off/ }));
        expect(localStorage.getItem('glossos_chat_autoread')).toBe('true');
        fireEvent.change(screen.getByPlaceholderText('Write in Spanish…'), { target: { value: 'Hola' } });
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })); });
        await waitFor(() => expect(speech.speakSegments).toHaveBeenCalledTimes(1));
    });

    it('dictates into the message box in the language being learned', async () => {
        renderTutor();
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Speak in Spanish' })); });
        expect(speech.dictations[0].locale).toBe('es-MX');
        expect(screen.getByDisplayValue('Hola, quiero un café')).toBeInTheDocument();
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Stop dictation' })); });
        expect(screen.getByDisplayValue('Hola, quiero un café')).toBeInTheDocument();
    });

    it('asks for a model when on-device is selected but none is loaded', async () => {
        localStorage.setItem('glossos_text_engine', 'device');
        renderTutor();
        fireEvent.change(screen.getByPlaceholderText('Write in Spanish…'), { target: { value: 'Hola' } });
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })); });
        expect(streamReply).not.toHaveBeenCalled();
        expect(screen.getByText(/Load an on-device model first/)).toBeInTheDocument();
    });
});
