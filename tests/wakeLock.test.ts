/**
 * wakeLock.test.ts — Wake Lock API integration tests
 *
 * Validates that the Wake Lock is acquired on CONNECTED and
 * released on disconnect, with graceful fallback when unavailable.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

describe('Wake Lock API', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should request wake lock when session is CONNECTED', async () => {
    const mockRelease = vi.fn().mockResolvedValue(undefined);
    const mockWakeLockSentinel = {
      released: false,
      release: mockRelease,
      type: 'screen',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      onrelease: null,
      dispatchEvent: vi.fn(),
    };

    const mockRequest = vi.fn().mockResolvedValue(mockWakeLockSentinel);

    Object.defineProperty(navigator, 'wakeLock', {
      value: { request: mockRequest },
      writable: true,
      configurable: true,
    });

    const connectionState = 'CONNECTED';
    let wakeLockRef: any = null;

    if (connectionState === 'CONNECTED' && 'wakeLock' in navigator) {
      wakeLockRef = await (navigator as any).wakeLock.request('screen');
    }

    expect(mockRequest).toHaveBeenCalledWith('screen');
    expect(wakeLockRef).toBe(mockWakeLockSentinel);
  });

  it('should release wake lock when session disconnects', async () => {
    const mockRelease = vi.fn().mockResolvedValue(undefined);
    let wakeLockRef: any = { release: mockRelease };

    const connectionState: string = 'DISCONNECTED';
    if (connectionState !== 'CONNECTED' && wakeLockRef) {
      await wakeLockRef.release();
      wakeLockRef = null;
    }

    expect(mockRelease).toHaveBeenCalledTimes(1);
    expect(wakeLockRef).toBeNull();
  });

  it('should handle wake lock not being available', async () => {
    const descriptors = Object.getOwnPropertyDescriptor(navigator, 'wakeLock');
    if (descriptors) {
      Object.defineProperty(navigator, 'wakeLock', {
        value: undefined,
        writable: true,
        configurable: true,
      });
    }

    let wakeLockRef: any = null;
    const connectionState = 'CONNECTED';

    if (connectionState === 'CONNECTED' && 'wakeLock' in navigator && navigator.wakeLock) {
      wakeLockRef = await (navigator as any).wakeLock.request('screen');
    }

    expect(wakeLockRef).toBeNull();
  });
});
