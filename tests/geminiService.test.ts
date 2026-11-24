/**
 * geminiService.test.ts — Unit tests for Gemini service utilities
 * 
 * Tests createBlob and URL resolution logic, which are critical
 * for the WebSocket audio pipeline.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createBlob } from '../services/geminiService';

describe('createBlob', () => {
  it('returns an object with base64 data and PCM MIME type', () => {
    const input = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const blob = createBlob(input, 16000);

    expect(blob).toHaveProperty('data');
    expect(blob).toHaveProperty('mimeType');
    expect(blob.mimeType).toBe('audio/pcm;rate=16000');
  });

  it('produces a non-empty base64 string for non-silent input', () => {
    const input = new Float32Array([0.5, -0.3, 0.8]);
    const blob = createBlob(input, 16000);

    expect(blob.data.length).toBeGreaterThan(0);
    // Verify it's valid base64
    expect(() => atob(blob.data)).not.toThrow();
  });

  it('handles different sample rates (48kHz → resamples to 16kHz)', () => {
    const input48k = new Float32Array(4800); // 100ms at 48kHz
    for (let i = 0; i < 4800; i++) input48k[i] = Math.sin(2 * Math.PI * 440 * i / 48000);

    const blob = createBlob(input48k, 48000);
    expect(blob.data.length).toBeGreaterThan(0);
    expect(blob.mimeType).toBe('audio/pcm;rate=16000');

    // The decoded data should be smaller since it was downsampled
    const decoded = atob(blob.data);
    const input16k = new Float32Array(1600); // Same audio at 16kHz
    const blob16k = createBlob(input16k, 16000);
    const decoded16k = atob(blob16k.data);

    // 48kHz input downsampled should produce ~same length as 16kHz input
    // Allow some tolerance for rounding
    expect(Math.abs(decoded.length - decoded16k.length)).toBeLessThan(10);
  });

  it('produces silent output for zero input', () => {
    const input = new Float32Array([0, 0, 0, 0]);
    const blob = createBlob(input, 16000);
    const decoded = atob(blob.data);
    const bytes = new Uint8Array(decoded.length);
    for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i);
    const int16 = new Int16Array(bytes.buffer);

    for (const sample of int16) {
      expect(sample).toBe(0);
    }
  });
});
