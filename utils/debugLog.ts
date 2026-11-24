/**
 * debugLog.ts — Production-safe logging utilities
 *
 * All `glossosLog`, `glossosWarn`, and `mobileLog` calls are gated
 * behind `IS_DEV`, so they are no-ops in production builds.
 * `glossosError` always logs — errors should never be silenced.
 *
 * Usage:
 * ```ts
 * import { glossosLog, glossosError, mobileLog } from '../utils/debugLog';
 * glossosLog('Session started');        // dev only
 * glossosError('Critical failure:', e); // always logged
 * mobileLog('AudioContext resumed');    // dev only, [GLOSSOS-MOBILE] prefix
 * ```
 */
const IS_DEV = (import.meta as any).env?.DEV ?? (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production');

/** Log a debug message with [GLOSSOS-MOBILE] prefix. Stripped in production. */
export function mobileLog(...args: any[]): void {
  if (IS_DEV) console.log('[GLOSSOS-MOBILE]', ...args);
}

/** Log a general debug message with [GLOSSOS] prefix. Stripped in production. */
export function glossosLog(...args: any[]): void {
  if (IS_DEV) console.log('[GLOSSOS]', ...args);
}

/** Log a warning with [GLOSSOS] prefix. Stripped in production. */
export function glossosWarn(...args: any[]): void {
  if (IS_DEV) console.warn('[GLOSSOS]', ...args);
}

/** Log an error with [GLOSSOS] prefix. Always logged, even in production. */
export function glossosError(...args: any[]): void {
  console.error('[GLOSSOS]', ...args);
}
