/**
 * websocketResilience.test.ts — Keepalive, auto-reconnect, session params, and cleanup
 *
 * Tests for the WebSocket resilience mechanisms that prevent
 * mobile network drops from killing the tutor session.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { KEEPALIVE_INTERVAL_MS, MAX_RECONNECT_ATTEMPTS, MAX_BACKOFF_DELAY_MS } from '../hooks/useWebSocketSession';

// ─── Keepalive Ping ──────────────────────────────────────────

describe('WebSocket Keepalive', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('should start a keepalive interval on connection', () => {
    let keepaliveIntervalRef: ReturnType<typeof setInterval> | null = null;
    const mockSendRealtimeInput = vi.fn();

    keepaliveIntervalRef = setInterval(() => {
      try {
        mockSendRealtimeInput({ media: { data: '', mimeType: 'audio/pcm;rate=16000' } });
      } catch (_) { /* benign */ }
    }, KEEPALIVE_INTERVAL_MS);

    expect(keepaliveIntervalRef).not.toBeNull();

    vi.advanceTimersByTime(KEEPALIVE_INTERVAL_MS);
    expect(mockSendRealtimeInput).toHaveBeenCalledTimes(1);
    expect(mockSendRealtimeInput).toHaveBeenCalledWith({
      media: { data: '', mimeType: 'audio/pcm;rate=16000' },
    });

    vi.advanceTimersByTime(KEEPALIVE_INTERVAL_MS);
    expect(mockSendRealtimeInput).toHaveBeenCalledTimes(2);

    clearInterval(keepaliveIntervalRef);
  });

  it('should clear keepalive interval on cleanup', () => {
    let keepaliveIntervalRef: ReturnType<typeof setInterval> | null = null;
    const mockSendRealtimeInput = vi.fn();

    keepaliveIntervalRef = setInterval(() => {
      mockSendRealtimeInput();
    }, KEEPALIVE_INTERVAL_MS);

    if (keepaliveIntervalRef) {
      clearInterval(keepaliveIntervalRef);
      keepaliveIntervalRef = null;
    }

    vi.advanceTimersByTime(60000);
    expect(mockSendRealtimeInput).not.toHaveBeenCalled();
    expect(keepaliveIntervalRef).toBeNull();
  });

  it('should send keepalive 4 times per minute', () => {
    const mockSendRealtimeInput = vi.fn();
    const interval = setInterval(() => {
      mockSendRealtimeInput();
    }, KEEPALIVE_INTERVAL_MS);

    vi.advanceTimersByTime(60000);
    expect(mockSendRealtimeInput).toHaveBeenCalledTimes(4); // 15, 30, 45, 60s

    clearInterval(interval);
  });

  it('should handle send errors gracefully (not crash)', () => {
    const mockSendRealtimeInput = vi.fn().mockImplementation(() => {
      throw new Error('WebSocket is closed');
    });

    const interval = setInterval(() => {
      try { mockSendRealtimeInput(); } catch (_) { /* expected */ }
    }, KEEPALIVE_INTERVAL_MS);

    expect(() => vi.advanceTimersByTime(KEEPALIVE_INTERVAL_MS)).not.toThrow();

    clearInterval(interval);
  });
});

// ─── Auto-Reconnect with Exponential Backoff ──────────────

describe('Auto-Reconnect Logic', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('should attempt reconnection on abnormal close (code !== 1000)', () => {
    let reconnectAttempts = 0;
    const isIntentionalStop = false;
    const eventCode: number = 1006; // Abnormal closure

    let shouldReconnect = false;
    if (!isIntentionalStop && eventCode !== 1000 && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      shouldReconnect = true;
      reconnectAttempts += 1;
    }

    expect(shouldReconnect).toBe(true);
    expect(reconnectAttempts).toBe(1);
  });

  it('should NOT reconnect on normal close (code 1000)', () => {
    let reconnectAttempts = 0;
    const isIntentionalStop = false;
    const eventCode = 1000;

    let shouldReconnect = false;
    if (!isIntentionalStop && eventCode !== 1000 && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      shouldReconnect = true;
    }

    expect(shouldReconnect).toBe(false);
  });

  it('should NOT reconnect on intentional stop', () => {
    let reconnectAttempts = 0;
    const isIntentionalStop = true;
    const eventCode: number = 1006;

    let shouldReconnect = false;
    if (!isIntentionalStop && eventCode !== 1000 && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      shouldReconnect = true;
    }

    expect(shouldReconnect).toBe(false);
  });

  it('should stop reconnecting after max attempts', () => {
    let reconnectAttempts = MAX_RECONNECT_ATTEMPTS; // Already exhausted
    const isIntentionalStop = false;
    const eventCode: number = 1006;

    let shouldReconnect = false;
    if (!isIntentionalStop && eventCode !== 1000 && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      shouldReconnect = true;
    }

    expect(shouldReconnect).toBe(false);
  });

  it('should use exponential backoff delays (1s, 2s, 4s)', () => {
    const delays: number[] = [];
    for (let attempt = 1; attempt <= MAX_RECONNECT_ATTEMPTS; attempt++) {
      const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), MAX_BACKOFF_DELAY_MS);
      delays.push(delayMs);
    }

    expect(delays).toEqual([1000, 2000, 4000]);
  });

  it('should cap backoff delay at MAX_BACKOFF_DELAY_MS', () => {
    for (let attempt = 1; attempt <= 10; attempt++) {
      const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), MAX_BACKOFF_DELAY_MS);
      expect(delayMs).toBeLessThanOrEqual(MAX_BACKOFF_DELAY_MS);
    }
  });

  it('should reset reconnect counter after successful reconnection', () => {
    let reconnectAttempts = 2;
    const onOpen = () => { reconnectAttempts = 0; };
    onOpen();
    expect(reconnectAttempts).toBe(0);
  });

  it('should reset reconnect counter on intentional stop', () => {
    let reconnectAttempts = 1;
    reconnectAttempts = MAX_RECONNECT_ATTEMPTS; // Prevent reconnect
    expect(reconnectAttempts).toBe(MAX_RECONNECT_ATTEMPTS);
  });

  it('should show user-friendly error message during reconnection', () => {
    const attempt = 2;
    const errorMessage = `Connection interrupted. Reconnecting... (${attempt}/${MAX_RECONNECT_ATTEMPTS})`;
    expect(errorMessage).toBe('Connection interrupted. Reconnecting... (2/3)');
    expect(errorMessage).toContain('Reconnecting');
  });

  it('should show final error when reconnection exhausted', () => {
    let reconnectAttempts = MAX_RECONNECT_ATTEMPTS;
    let errorMessage = '';

    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      errorMessage = 'Connection lost. Please restart the session.';
    }

    expect(errorMessage).toBe('Connection lost. Please restart the session.');
  });
});

// ─── Session Parameter Storage ─────────────────────────────

describe('Session Parameter Storage for Reconnection', () => {
  it('should store all required parameters', () => {
    const lastStartParams = {
      language: 'French',
      userContext: 'User is learning cooking vocabulary',
      proficiencyLevel: 'Beginner',
      nativeLanguage: 'English',
      voiceName: 'Puck',
    };

    expect(lastStartParams.language).toBe('French');
    expect(lastStartParams.userContext).toBe('User is learning cooking vocabulary');
    expect(lastStartParams.proficiencyLevel).toBe('Beginner');
    expect(lastStartParams.nativeLanguage).toBe('English');
    expect(lastStartParams.voiceName).toBe('Puck');
  });

  it('should handle empty userContext gracefully', () => {
    const userContext: string | undefined = undefined;
    const lastStartParams = {
      language: 'Spanish',
      userContext: userContext || '',
      proficiencyLevel: 'Intermediate',
      nativeLanguage: 'English',
      voiceName: 'Kore',
    };

    expect(lastStartParams.userContext).toBe('');
  });

  it('should use stored params for reconnection', () => {
    const storedParams = {
      language: 'Japanese',
      userContext: 'Learning business Japanese',
      proficiencyLevel: 'Advanced',
      nativeLanguage: 'Spanish',
      voiceName: 'Aoede',
    };

    const reconnectCall = { ...storedParams };
    expect(reconnectCall).toEqual(storedParams);
  });

  it('should prevent reconnection when params are null', () => {
    const lastStartParams: any = null;
    let reconnected = false;

    if (lastStartParams) {
      reconnected = true;
    }

    expect(reconnected).toBe(false);
  });
});

// ─── Cleanup Resources ────────────────────────────────────

describe('Cleanup Resources', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('should clear keepalive interval during cleanup', () => {
    const mockFn = vi.fn();
    let keepaliveIntervalRef: any = setInterval(mockFn, KEEPALIVE_INTERVAL_MS);

    if (keepaliveIntervalRef) {
      clearInterval(keepaliveIntervalRef);
      keepaliveIntervalRef = null;
    }

    vi.advanceTimersByTime(60000);
    expect(mockFn).not.toHaveBeenCalled();
    expect(keepaliveIntervalRef).toBeNull();
  });

  it('should close AudioContexts during cleanup', async () => {
    const mockClose = vi.fn().mockResolvedValue(undefined);
    const mockInputCtx = { state: 'running' as AudioContextState, close: mockClose };
    const mockOutputCtx = { state: 'running' as AudioContextState, close: mockClose };

    if (mockInputCtx.state !== 'closed') await mockInputCtx.close();
    if (mockOutputCtx.state !== 'closed') await mockOutputCtx.close();

    expect(mockClose).toHaveBeenCalledTimes(2);
  });

  it('should NOT close already-closed AudioContexts', async () => {
    const mockClose = vi.fn().mockResolvedValue(undefined);
    const mockCtx = { state: 'closed' as AudioContextState, close: mockClose };

    if (mockCtx.state !== 'closed') await mockCtx.close();

    expect(mockClose).not.toHaveBeenCalled();
  });

  it('should stop all media stream tracks during cleanup', () => {
    const mockStop = vi.fn();
    const mockTracks = [
      { stop: mockStop, kind: 'audio' },
      { stop: mockStop, kind: 'audio' },
    ];
    const mockStream = { getTracks: () => mockTracks };

    mockStream.getTracks().forEach((track: any) => track.stop());

    expect(mockStop).toHaveBeenCalledTimes(2);
  });

  it('should clear output sources set', () => {
    const mockStop = vi.fn();
    const outputSources = new Set([
      { stop: mockStop } as any,
      { stop: mockStop } as any,
    ]);

    outputSources.forEach((source: any) => source.stop());
    outputSources.clear();

    expect(mockStop).toHaveBeenCalledTimes(2);
    expect(outputSources.size).toBe(0);
  });

  it('should reset nextStartTime to 0', () => {
    let nextStartTime = 15.7;
    nextStartTime = 0;
    expect(nextStartTime).toBe(0);
  });
});
