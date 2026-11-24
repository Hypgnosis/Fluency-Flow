/**
 * audio-processor-worklet.js — AudioWorklet processor for microphone input
 *
 * Runs on a dedicated audio thread (off the main thread), preventing
 * jank and frame drops that ScriptProcessorNode causes on mobile.
 *
 * Receives PCM float32 samples from the microphone, buffers them to
 * BUFFER_SIZE frames, then posts the batch to the main thread.
 *
 * Messages OUT → main thread:
 *   { type: 'audio', buffer: Float32Array }
 *
 * This file must be served as a static asset (placed in /public).
 */

const BUFFER_SIZE = 2048;

class AudioCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = new Float32Array(BUFFER_SIZE);
    this._writeIndex = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input.length) return true;

    const channelData = input[0]; // mono channel
    if (!channelData) return true;

    for (let i = 0; i < channelData.length; i++) {
      this._buffer[this._writeIndex++] = channelData[i];

      if (this._writeIndex >= BUFFER_SIZE) {
        // Post a copy — the buffer will be reused
        this.port.postMessage({
          type: 'audio',
          buffer: this._buffer.slice(),
        });
        this._writeIndex = 0;
      }
    }

    return true; // Keep processor alive
  }
}

registerProcessor('audio-capture-processor', AudioCaptureProcessor);
