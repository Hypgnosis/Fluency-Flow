/**
 * useMobileResilience.ts — Custom hook for mobile-specific fixes
 *
 * Handles two mobile-specific concerns:
 * 1. Resuming AudioContexts when the browser tab regains visibility
 * 2. Acquiring/releasing a Wake Lock to prevent screen sleep during sessions
 */
import { useEffect, useRef } from 'react';
import { mobileLog } from '../utils/debugLog';

/** Configuration constants */
const WAKE_LOCK_TYPE = 'screen' as const;

interface UseMobileResilienceOptions {
  /** Current connection state — resilience only activates when CONNECTED */
  connectionState: string;
  /** Ref to the input (microphone) AudioContext */
  inputAudioContextRef: React.MutableRefObject<AudioContext | null>;
  /** Ref to the output (playback) AudioContext */
  outputAudioContextRef: React.MutableRefObject<AudioContext | null>;
  /** Ref to the next scheduled playback time */
  nextStartTimeRef: React.MutableRefObject<number>;
  /** Callback to add a message to the debug log */
  addDebugLog: (msg: string) => void;
}

/**
 * Resumes suspended AudioContexts when the browser tab becomes visible again.
 * Mobile browsers aggressively suspend AudioContexts when the tab goes to
 * background, causing the tutor to appear "frozen".
 */
function useVisibilityResume({
  connectionState,
  inputAudioContextRef,
  outputAudioContextRef,
  nextStartTimeRef,
  addDebugLog,
}: UseMobileResilienceOptions): void {
  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (document.visibilityState === 'visible' && connectionState === 'CONNECTED') {
        mobileLog('Tab visible again — resuming AudioContexts');
        try {
          if (inputAudioContextRef.current?.state === 'suspended') {
            await inputAudioContextRef.current.resume();
            mobileLog('Input AudioContext resumed');
            addDebugLog('Input AudioCtx resumed (tab return)');
          }
          if (outputAudioContextRef.current?.state === 'suspended') {
            await outputAudioContextRef.current.resume();
            // Reset playback scheduling so queued audio doesn't all play simultaneously
            nextStartTimeRef.current = outputAudioContextRef.current.currentTime;
            mobileLog('Output AudioContext resumed');
            addDebugLog('Output AudioCtx resumed (tab return)');
          }
        } catch (e) {
          console.error('[GLOSSOS-MOBILE] Failed to resume AudioContext:', e);
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [connectionState, inputAudioContextRef, outputAudioContextRef, nextStartTimeRef, addDebugLog]);
}

/**
 * Acquires a Wake Lock when connected and releases it when disconnected.
 * Prevents the mobile screen from sleeping during active tutoring sessions.
 */
function useWakeLock(connectionState: string, addDebugLog: (msg: string) => void): void {
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    const acquireWakeLock = async () => {
      if (connectionState === 'CONNECTED' && 'wakeLock' in navigator) {
        try {
          wakeLockRef.current = await navigator.wakeLock.request(WAKE_LOCK_TYPE);
          mobileLog('Wake Lock acquired');
          addDebugLog('Wake Lock acquired');
          wakeLockRef.current.addEventListener('release', () => {
            mobileLog('Wake Lock released');
          });
        } catch (e) {
          mobileLog('Wake Lock not available:', e);
        }
      }
    };

    const releaseWakeLock = () => {
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(e => mobileLog('Wake Lock release failed:', e));
        wakeLockRef.current = null;
      }
    };

    if (connectionState === 'CONNECTED') {
      acquireWakeLock();
    } else {
      releaseWakeLock();
    }

    return () => releaseWakeLock();
  }, [connectionState, addDebugLog]);
}

/**
 * Combined hook that applies all mobile resilience measures.
 * Use this in Conversation.tsx instead of inlining the logic.
 */
export function useMobileResilience(options: UseMobileResilienceOptions): void {
  useVisibilityResume(options);
  useWakeLock(options.connectionState, options.addDebugLog);
}

/**
 * Resumes both AudioContexts during audio message processing.
 * Call this at the top of the audio playback path in handleMessage.
 */
export async function resumeAudioContextsIfSuspended(
  inputAudioContextRef: React.MutableRefObject<AudioContext | null>,
  outputAudioContextRef: React.MutableRefObject<AudioContext | null>,
  nextStartTimeRef: React.MutableRefObject<number>,
): Promise<void> {
  if (outputAudioContextRef.current?.state === 'suspended') {
    await outputAudioContextRef.current.resume();
    nextStartTimeRef.current = outputAudioContextRef.current.currentTime;
    mobileLog('Output AudioContext resumed (in handleMessage)');
  }
  if (inputAudioContextRef.current?.state === 'suspended') {
    await inputAudioContextRef.current.resume();
    mobileLog('Input AudioContext resumed (in handleMessage)');
  }
}
