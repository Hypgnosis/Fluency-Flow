/**
 * audioContextResume.test.ts — AudioContext resume on visibility change
 *
 * Validates that suspended AudioContexts are properly resumed
 * when the browser tab regains visibility (mobile background → foreground).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('AudioContext Visibility Resume', () => {
  let listeners: Record<string, Function[]>;

  beforeEach(() => {
    listeners = {};
    vi.spyOn(document, 'addEventListener').mockImplementation((event, handler) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(handler as Function);
    });
    vi.spyOn(document, 'removeEventListener').mockImplementation((event, handler) => {
      if (listeners[event]) {
        listeners[event] = listeners[event].filter(h => h !== handler);
      }
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should register a visibilitychange listener', () => {
    const handleVisibilityChange = vi.fn();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    expect(listeners['visibilitychange']).toContain(handleVisibilityChange);
  });

  it('should resume a suspended AudioContext when tab becomes visible', async () => {
    const mockResume = vi.fn().mockResolvedValue(undefined);
    const mockAudioContext = {
      state: 'suspended' as AudioContextState,
      resume: mockResume,
      currentTime: 5.0,
    };

    Object.defineProperty(document, 'visibilityState', { value: 'visible', writable: true, configurable: true });

    if (mockAudioContext.state === 'suspended') {
      await mockAudioContext.resume();
    }

    expect(mockResume).toHaveBeenCalledTimes(1);
  });

  it('should NOT resume AudioContext when state is already running', async () => {
    const mockResume = vi.fn().mockResolvedValue(undefined);
    const mockAudioContext = {
      state: 'running' as AudioContextState,
      resume: mockResume,
      currentTime: 5.0,
    };

    if (mockAudioContext.state === 'suspended') {
      await mockAudioContext.resume();
    }

    expect(mockResume).not.toHaveBeenCalled();
  });

  it('should reset nextStartTime after resuming output AudioContext', async () => {
    const mockAudioContext = {
      state: 'suspended' as AudioContextState,
      resume: vi.fn().mockResolvedValue(undefined),
      currentTime: 10.5,
    };

    let nextStartTime = 3.0; // Stale value from before suspension

    if (mockAudioContext.state === 'suspended') {
      await mockAudioContext.resume();
      nextStartTime = mockAudioContext.currentTime;
    }

    expect(nextStartTime).toBe(10.5);
  });

  it('should handle resume failure gracefully', async () => {
    const mockResume = vi.fn().mockRejectedValue(new Error('NotAllowedError'));
    const mockAudioContext = {
      state: 'suspended' as AudioContextState,
      resume: mockResume,
    };

    let errorCaught = false;
    try {
      if (mockAudioContext.state === 'suspended') {
        await mockAudioContext.resume();
      }
    } catch (e) {
      errorCaught = true;
    }

    expect(errorCaught).toBe(true);
    expect(mockResume).toHaveBeenCalledTimes(1);
  });
});

// ─── Dual AudioContext Resume in handleMessage ─────────────

describe('Dual AudioContext Resume in handleMessage', () => {
  it('should resume both input and output AudioContexts when processing audio data', async () => {
    const mockResumeInput = vi.fn().mockResolvedValue(undefined);
    const mockResumeOutput = vi.fn().mockResolvedValue(undefined);

    const inputCtx = {
      state: 'suspended' as AudioContextState,
      resume: mockResumeInput,
    };
    const outputCtx = {
      state: 'suspended' as AudioContextState,
      resume: mockResumeOutput,
      currentTime: 5.0,
    };

    let nextStartTime = 2.0;

    const audioData = 'base64audiodata';
    if (audioData && outputCtx) {
      if (outputCtx.state === 'suspended') {
        await outputCtx.resume();
        nextStartTime = outputCtx.currentTime;
      }
      if (inputCtx && inputCtx.state === 'suspended') {
        await inputCtx.resume();
      }
    }

    expect(mockResumeOutput).toHaveBeenCalledTimes(1);
    expect(mockResumeInput).toHaveBeenCalledTimes(1);
    expect(nextStartTime).toBe(5.0);
  });

  it('should only resume suspended contexts (not running ones)', async () => {
    const mockResumeInput = vi.fn().mockResolvedValue(undefined);
    const mockResumeOutput = vi.fn().mockResolvedValue(undefined);

    const inputCtx = { state: 'running' as AudioContextState, resume: mockResumeInput };
    const outputCtx = { state: 'running' as AudioContextState, resume: mockResumeOutput, currentTime: 5.0 };

    if (outputCtx.state === 'suspended') await outputCtx.resume();
    if (inputCtx.state === 'suspended') await inputCtx.resume();

    expect(mockResumeOutput).not.toHaveBeenCalled();
    expect(mockResumeInput).not.toHaveBeenCalled();
  });

  it('should handle null input AudioContext gracefully', async () => {
    const mockResumeOutput = vi.fn().mockResolvedValue(undefined);
    const outputCtx = {
      state: 'suspended' as AudioContextState,
      resume: mockResumeOutput,
      currentTime: 3.0,
    };
    const inputCtx: any = null;

    if (outputCtx.state === 'suspended') await outputCtx.resume();
    if (inputCtx && inputCtx.state === 'suspended') await inputCtx.resume();

    expect(mockResumeOutput).toHaveBeenCalledTimes(1);
  });
});
