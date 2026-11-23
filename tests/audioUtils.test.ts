/**
 * audioUtils.test.ts — Unit tests for audio utility functions
 * 
 * Tests the core audio encoding/decoding/resampling functions used
 * by the Gemini Live API integration.
 */
import { describe, it, expect } from 'vitest';
import { encode, decode, pcmTo16kInt16, encodeWAV } from '../utils/audioUtils';

// ─── encode / decode (Base64 roundtrip) ───────────────────────

describe('Base64 encode/decode', () => {
  it('roundtrips a simple byte array', () => {
    const original = new Uint8Array([0, 1, 2, 127, 128, 255]);
    const encoded = encode(original);
    const decoded = decode(encoded);
    expect(decoded).toEqual(original);
  });

  it('encodes an empty array to an empty string', () => {
    const encoded = encode(new Uint8Array([]));
    expect(encoded).toBe('');
  });

  it('decodes an empty string to an empty array', () => {
    const decoded = decode('');
    expect(decoded.length).toBe(0);
  });

  it('produces valid base64 characters only', () => {
    const data = new Uint8Array(256);
    for (let i = 0; i < 256; i++) data[i] = i;
    const encoded = encode(data);
    expect(encoded).toMatch(/^[A-Za-z0-9+/=]*$/);
  });

  it('roundtrips a large array accurately', () => {
    const size = 16384; // 16KB like a real audio chunk
    const original = new Uint8Array(size);
    for (let i = 0; i < size; i++) original[i] = i % 256;
    const decoded = decode(encode(original));
    expect(decoded).toEqual(original);
  });
});

// ─── pcmTo16kInt16 ────────────────────────────────────────────

describe('pcmTo16kInt16', () => {
  it('converts float32 PCM at 16kHz without resampling', () => {
    // At 16kHz input, output length should equal input length
    const input = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const result = pcmTo16kInt16(input, 16000);
    expect(result.length).toBe(input.length);
  });

  it('clamps values to [-1, 1] range', () => {
    const input = new Float32Array([2.0, -3.0, 0.5]);
    const result = pcmTo16kInt16(input, 16000);
    // Max positive int16 = 32767, max negative = -32768
    expect(result[0]).toBe(32767);  // clamped 2.0 → 1.0 → 32767
    expect(result[1]).toBe(-32768); // clamped -3.0 → -1.0 → -32768
  });

  it('produces silence for zero input', () => {
    const input = new Float32Array([0, 0, 0, 0]);
    const result = pcmTo16kInt16(input, 16000);
    for (const sample of result) {
      expect(sample).toBe(0);
    }
  });

  it('downsamples from 48kHz to 16kHz (3:1 ratio)', () => {
    const inputLength = 4800; // 100ms at 48kHz
    const input = new Float32Array(inputLength);
    for (let i = 0; i < inputLength; i++) input[i] = Math.sin(2 * Math.PI * 440 * i / 48000);
    
    const result = pcmTo16kInt16(input, 48000);
    // 48k → 16k = 3:1 ratio, so output should be ~1600 samples
    expect(result.length).toBe(Math.ceil(inputLength / 3));
  });

  it('downsamples from 44.1kHz to 16kHz correctly', () => {
    const inputLength = 4410; // 100ms at 44.1kHz
    const input = new Float32Array(inputLength);
    const result = pcmTo16kInt16(input, 44100);
    const expectedLength = Math.ceil(inputLength / (44100 / 16000));
    expect(result.length).toBe(expectedLength);
  });

  it('preserves signal polarity after conversion', () => {
    const input = new Float32Array([0.5, -0.5]);
    const result = pcmTo16kInt16(input, 16000);
    expect(result[0]).toBeGreaterThan(0);
    expect(result[1]).toBeLessThan(0);
  });
});

// ─── encodeWAV ────────────────────────────────────────────────

describe('encodeWAV', () => {
  it('produces a WAV blob with correct MIME type', () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const blob = encodeWAV(samples, 16000, 1);
    expect(blob.type).toBe('audio/wav');
  });

  it('produces a blob with correct byte size (44 header + 2 bytes per sample)', () => {
    const numSamples = 100;
    const samples = new Float32Array(numSamples);
    const blob = encodeWAV(samples, 16000, 1);
    expect(blob.size).toBe(44 + numSamples * 2);
  });

  it('produces a valid WAV header', async () => {
    const samples = new Float32Array(10);
    const blob = encodeWAV(samples, 24000, 1);
    const buffer = await blob.arrayBuffer();
    const view = new DataView(buffer);

    // Check RIFF header
    expect(String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3))).toBe('RIFF');
    // Check WAVE format
    expect(String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11))).toBe('WAVE');
    // Check format (PCM = 1)
    expect(view.getUint16(20, true)).toBe(1);
    // Check channel count
    expect(view.getUint16(22, true)).toBe(1);
    // Check sample rate
    expect(view.getUint32(24, true)).toBe(24000);
    // Check bits per sample
    expect(view.getUint16(34, true)).toBe(16);
  });

  it('handles stereo audio (2 channels)', () => {
    const samples = new Float32Array(200);
    const blob = encodeWAV(samples, 48000, 2);
    const buffer = new ArrayBuffer(44 + 200 * 2);
    expect(blob.size).toBe(44 + 200 * 2);
  });
});
