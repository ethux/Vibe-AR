// ─── PCM Processor — AudioWorklet ───
// Captures Float32 audio frames, converts to Int16 PCM S16LE,
// and posts to main thread for WebSocket streaming to Voxtral Realtime.

const CHUNK_SAMPLES = 4096; // ~85ms at 48kHz

class PcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buf = new Float32Array(CHUNK_SAMPLES);
    this._off = 0;
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;

    for (let i = 0; i < input.length; i++) {
      this._buf[this._off++] = input[i];

      if (this._off >= CHUNK_SAMPLES) {
        const pcm = new Int16Array(CHUNK_SAMPLES);
        for (let j = 0; j < CHUNK_SAMPLES; j++) {
          const s = Math.max(-1, Math.min(1, this._buf[j]));
          pcm[j] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        this.port.postMessage(pcm.buffer, [pcm.buffer]);
        this._buf = new Float32Array(CHUNK_SAMPLES);
        this._off = 0;
      }
    }
    return true;
  }
}

registerProcessor('pcm-processor', PcmProcessor);
