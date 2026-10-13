// AudioWorklet processor — computes a windowed RMS envelope from the
// (already bandpass-filtered, see useMicBreathSignal.js) mic signal.
// Mirrors simulation/mic_breath.py's RMS-envelope stage: a circular buffer
// of squared samples, RMS = sqrt(mean(buffer)), recomputed continuously and
// posted to the main thread at a decimated rate (~100 Hz) rather than on
// every ~2.7ms render quantum, to keep postMessage traffic reasonable.

const RMS_WINDOW_SECS = 0.1;   // 100ms, same as mic_breath.py's RMS_WINDOW_MS
const POST_INTERVAL_SECS = 0.01; // ~100 Hz output, same as mic_breath.py's LSL_RATE

class BreathEnvelopeProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.windowSize = Math.max(1, Math.round(sampleRate * RMS_WINDOW_SECS));
    this.buf = new Float32Array(this.windowSize);
    this.idx = 0;
    this.filled = 0;
    this.sumSq = 0;

    this.quantaPerPost = Math.max(1, Math.round((sampleRate * POST_INTERVAL_SECS) / 128));
    this.quantaCount = 0;
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (channel) {
      for (let i = 0; i < channel.length; i++) {
        const sq = channel[i] * channel[i];
        this.sumSq -= this.buf[this.idx];
        this.buf[this.idx] = sq;
        this.sumSq += sq;
        this.idx = (this.idx + 1) % this.windowSize;
        if (this.filled < this.windowSize) this.filled++;
      }

      this.quantaCount++;
      if (this.quantaCount >= this.quantaPerPost) {
        this.quantaCount = 0;
        const rms = Math.sqrt(Math.max(0, this.sumSq) / Math.max(1, this.filled));
        this.port.postMessage(rms);
      }
    }
    return true; // keep the processor alive for the life of the stream
  }
}

registerProcessor('breath-envelope-processor', BreathEnvelopeProcessor);
