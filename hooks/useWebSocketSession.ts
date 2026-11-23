/**
 * useWebSocketSession.ts — Custom hook for WebSocket connection management
 *
 * Encapsulates:
 * - Keepalive ping interval (prevents mobile carrier timeouts)
 * - Auto-reconnect with exponential backoff
 * - Session parameter storage for reconnection
 * - Proper cleanup of keepalive on close/unmount
 */
import { useRef, useCallback } from 'react';
import { startLiveSession, LiveSession, GeminiCallbacks } from '../services/geminiService';
import { mobileLog, glossosLog, glossosError } from '../utils/debugLog';

// ─── Constants (no more magic numbers) ───────────────────────

/** Keepalive ping interval in ms — mobile carriers drop idle WS after 30–60s */
export const KEEPALIVE_INTERVAL_MS = 15000;

/** Maximum reconnection attempts before giving up */
export const MAX_RECONNECT_ATTEMPTS = 3;

/** Maximum backoff delay cap in ms */
export const MAX_BACKOFF_DELAY_MS = 8000;

/** Base backoff delay in ms */
const BASE_BACKOFF_DELAY_MS = 1000;

// ─── Types ───────────────────────────────────────────────────

export interface SessionParams {
  language: string;
  userContext: string;
  proficiencyLevel: string;
  nativeLanguage: string;
  voiceName: string;
}

export interface UseWebSocketSessionReturn {
  /** Ref to the current session promise */
  sessionPromiseRef: React.MutableRefObject<Promise<LiveSession> | null>;
  /** Ref tracking whether this was an intentional stop */
  isIntentionalStopRef: React.MutableRefObject<boolean>;
  /** Ref to reconnection attempt counter */
  reconnectAttemptsRef: React.MutableRefObject<number>;
  /** Ref to stored session params for reconnection */
  lastStartParamsRef: React.MutableRefObject<SessionParams | null>;
  /** Start the keepalive ping interval for the current session */
  startKeepalive: () => void;
  /** Stop the keepalive ping interval */
  stopKeepalive: () => void;
  /** Store session params for potential reconnection */
  storeSessionParams: (params: SessionParams) => void;
  /** Mark the session as intentionally stopped (prevents auto-reconnect) */
  markIntentionalStop: () => void;
  /** Create the onClose handler with reconnection logic baked in */
  createOnCloseHandler: (deps: ReconnectDeps) => (event: CloseEvent) => void;
}

export interface ReconnectDeps {
  addDebugLog: (msg: string) => void;
  setConnectionState: (state: any) => void;
  setError: (err: string | null) => void;
  handleMessage: (message: any) => void;
  cleanupResources: () => void;
  inputAudioContextRef: React.MutableRefObject<AudioContext | null>;
  outputAudioContextRef: React.MutableRefObject<AudioContext | null>;
  outputSourcesRef: React.MutableRefObject<Set<AudioBufferSourceNode>>;
  nextStartTimeRef: React.MutableRefObject<number>;
  /** Called on final disconnect to save session and reset state */
  onFinalDisconnect: (eventCode: number) => void;
}

// ─── Hook ────────────────────────────────────────────────────

export function useWebSocketSession(): UseWebSocketSessionReturn {
  const sessionPromiseRef = useRef<Promise<LiveSession> | null>(null);
  const isIntentionalStopRef = useRef<boolean>(false);
  const reconnectAttemptsRef = useRef<number>(0);
  const keepaliveIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastStartParamsRef = useRef<SessionParams | null>(null);

  /**
   * Start the keepalive ping interval.
   * Sends an empty audio packet every 15s to prevent carrier timeout.
   * Deduplicated — called from both initial connect and reconnect.
   */
  const startKeepalive = useCallback(() => {
    if (keepaliveIntervalRef.current) clearInterval(keepaliveIntervalRef.current);
    keepaliveIntervalRef.current = setInterval(() => {
      if (sessionPromiseRef.current) {
        sessionPromiseRef.current.then(session => {
          try {
            session.sendRealtimeInput({ media: { data: '', mimeType: 'audio/pcm;rate=16000' } });
          } catch (_) { /* Keepalive send failed — WebSocket likely closed; benign */ }
        }).catch(e => mobileLog('Keepalive session promise rejected:', e));
      }
    }, KEEPALIVE_INTERVAL_MS);
  }, []);

  /** Stop the keepalive ping interval. */
  const stopKeepalive = useCallback(() => {
    if (keepaliveIntervalRef.current) {
      clearInterval(keepaliveIntervalRef.current);
      keepaliveIntervalRef.current = null;
    }
  }, []);

  /** Store session parameters for potential reconnection. */
  const storeSessionParams = useCallback((params: SessionParams) => {
    lastStartParamsRef.current = params;
  }, []);

  /** Mark this as an intentional stop to suppress auto-reconnect. */
  const markIntentionalStop = useCallback(() => {
    isIntentionalStopRef.current = true;
    reconnectAttemptsRef.current = MAX_RECONNECT_ATTEMPTS;
  }, []);

  /**
   * Attempt to reconnect to the Gemini WebSocket.
   * Extracted from handleWsClose to reduce nesting depth from 7 → 3.
   */
  const attemptReconnect = useCallback((
    attempt: number,
    deps: ReconnectDeps,
    handleWsClose: (event: CloseEvent) => void,
  ) => {
    const delayMs = Math.min(BASE_BACKOFF_DELAY_MS * Math.pow(2, attempt - 1), MAX_BACKOFF_DELAY_MS);
    mobileLog(`Reconnecting in ${delayMs}ms (attempt ${attempt}/${MAX_RECONNECT_ATTEMPTS})`);
    deps.addDebugLog(`Auto-reconnect ${attempt}/${MAX_RECONNECT_ATTEMPTS} in ${delayMs}ms`);
    deps.setError(`Connection interrupted. Reconnecting... (${attempt}/${MAX_RECONNECT_ATTEMPTS})`);
    deps.setConnectionState('CONNECTING');

    // Clean up audio playback but DON'T save or reset state
    deps.outputSourcesRef.current.forEach(source => source.stop());
    deps.outputSourcesRef.current.clear();
    deps.nextStartTimeRef.current = 0;

    setTimeout(() => {
      if (isIntentionalStopRef.current) return; // User pressed stop during the wait

      const params = lastStartParamsRef.current;
      if (!params) {
        deps.setConnectionState('DISCONNECTED');
        return;
      }

      sessionPromiseRef.current = startLiveSession({
        onOpen: () => {
          deps.addDebugLog('Reconnected!');
          mobileLog('Reconnected successfully');
          deps.setConnectionState('CONNECTED');
          deps.setError(null);
          reconnectAttemptsRef.current = 0;

          startKeepalive();

          // Resume AudioContexts (may have been suspended during reconnect)
          deps.inputAudioContextRef.current?.resume().catch(e => mobileLog('Input AudioContext resume failed:', e));
          deps.outputAudioContextRef.current?.resume().catch(e => mobileLog('Output AudioContext resume failed:', e));
        },
        onMessage: deps.handleMessage,
        onError: (e: ErrorEvent) => {
          glossosError('Reconnect error:', e);
          deps.setError('Reconnection failed. Please restart the session.');
          deps.setConnectionState('ERROR');
          deps.cleanupResources();
        },
        onClose: handleWsClose,
      }, params.language, params.userContext, params.proficiencyLevel, params.nativeLanguage, params.voiceName);
    }, delayMs);
  }, [startKeepalive]);

  /**
   * Create the onClose handler for the WebSocket.
   * Uses a named function internally so it can reference itself for reconnection.
   */
  const createOnCloseHandler = useCallback((deps: ReconnectDeps) => {
    const handleWsClose = (event: CloseEvent) => {
      deps.addDebugLog(`Socket Closed: ${event.code}`);
      glossosLog('Session closed:', event.code, event.reason);

      stopKeepalive();

      // Auto-reconnect on abnormal closure (mobile network drops)
      const shouldReconnect =
        !isIntentionalStopRef.current &&
        event.code !== 1000 &&
        reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS;

      if (shouldReconnect) {
        reconnectAttemptsRef.current += 1;
        attemptReconnect(reconnectAttemptsRef.current, deps, handleWsClose);
        return;
      }

      // Reconnection exhausted or normal close — delegate final cleanup
      deps.onFinalDisconnect(event.code);
    };

    return handleWsClose;
  }, [stopKeepalive, attemptReconnect]);

  return {
    sessionPromiseRef,
    isIntentionalStopRef,
    reconnectAttemptsRef,
    lastStartParamsRef,
    startKeepalive,
    stopKeepalive,
    storeSessionParams,
    markIntentionalStop,
    createOnCloseHandler,
  };
}
