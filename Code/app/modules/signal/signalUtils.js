/**
 * signalUtils.js — Real-time signal processing utilities
 * =======================================================
 * Exports:
 *   class    GaussianSmoother — real-time Gaussian low-pass filter
 *   class    SignalDelayLine  — time-based delay buffer (async stimulus source)
 *   function mapRange(v, from, to)
 *
 * All frequency/rate estimators live in breathRateEstimators.js.
 */


// ── mapRange ─────────────────────────────────────────────────────────────────
// Direct port of mapRange.m

/**
 * Maps value from one range to another.
 * @param {number} value
 * @param {[number,number]} from  [min, max] of input range
 * @param {[number,number]} to    [min, max] of output range
 * @returns {number}
 */
export function mapRange(value, from, to) {
  const span = from[1] - from[0];
  if (span === 0) return (to[0] + to[1]) / 2;
  return to[0] + ((value - from[0]) / span) * (to[1] - to[0]);
}



// ── GaussianSmoother ─────────────────────────────────────────────────────────

/**
 * Real-time Gaussian low-pass filter over a sliding window.
 * Matches the behaviour of applyGaussianLPF.m + smoothBreathRT.m.
 *
 * Usage:
 *   const smoother = new GaussianSmoother(64);
 *   smoother.push(rawSample);
 *   const smoothed = smoother.value;  // current smoothed output
 */
export class GaussianSmoother {
  #windowSize;
  #kernel;      // normalised Gaussian kernel (Float32Array)
  #ring;        // circular buffer of raw samples
  #head = 0;    // next write position
  #count = 0;   // samples pushed so far (saturates at windowSize)

  /**
   * @param {number} windowSize  Number of samples in the smoothing window (default 64)
   */
  constructor(windowSize = 64) {
    this.#windowSize = windowSize;
    this.#kernel = GaussianSmoother.#makeKernel(windowSize);
    this.#ring = new Float32Array(windowSize);
  }

  /** Push a new raw sample into the smoother. */
  push(sample) {
    this.#ring[this.#head] = sample;
    this.#head = (this.#head + 1) % this.#windowSize;
    if (this.#count < this.#windowSize) this.#count++;
  }

  /**
   * Current smoothed value (weighted average of the buffer).
   * Returns the raw last sample if fewer than 2 samples have been pushed.
   */
  get value() {
    if (this.#count < 2) {
      // Return the most recent sample raw
      const last = (this.#head - 1 + this.#windowSize) % this.#windowSize;
      return this.#ring[last];
    }

    const n = this.#count;  // actual filled length (≤ windowSize)

    // Build a kernel trimmed to n samples and re-normalised
    let sum = 0;
    const weights = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      // Take from the end of the full kernel so the shape stays consistent
      weights[i] = this.#kernel[this.#windowSize - n + i];
      sum += weights[i];
    }

    let out = 0;
    for (let i = 0; i < n; i++) {
      // oldest sample first: ring index offset from current head
      const ringIdx = (this.#head - n + i + this.#windowSize * 2) % this.#windowSize;
      out += this.#ring[ringIdx] * (weights[i] / sum);
    }
    return out;
  }

  /** Discard all buffered samples (e.g. between trials). */
  reset() {
    this.#ring.fill(0);
    this.#head = 0;
    this.#count = 0;
  }

  // Build a normalised Gaussian kernel (σ = windowSize / 6)
  static #makeKernel(size) {
    const kernel = new Float32Array(size);
    const sigma = size / 6;
    const center = (size - 1) / 2;
    let sum = 0;
    for (let i = 0; i < size; i++) {
      const x = i - center;
      kernel[i] = Math.exp(-(x * x) / (2 * sigma * sigma));
      sum += kernel[i];
    }
    for (let i = 0; i < size; i++) kernel[i] /= sum;
    return kernel;
  }
}


// ── SignalDelayLine ────────────────────────────────────────────────────────────

/**
 * Time-based delay buffer: continuously records timestamped samples and lets
 * the caller read back the value from an arbitrary number of milliseconds ago,
 * linearly interpolated between the two nearest recorded points.
 *
 * Used to drive the iBreath async stimulus — the participant's own real-time
 * breath signal, played back after a delay — instead of a synthesized signal.
 *
 * Usage:
 *   const line = new SignalDelayLine({ maxAgeMs: 3500 });
 *   line.push(performance.now(), value);   // call on every incoming sample
 *   const delayed = line.sample(performance.now(), 2500);  // value from 2.5s ago
 *   line.reset();
 */
export class SignalDelayLine {
  #buf = [];   // [{ t, v }, ...] ascending by t
  #maxAgeMs;

  /**
   * @param {object} opts
   * @param {number} [opts.maxAgeMs]  Samples older than this (relative to the
   *                                  most recent push) are discarded. Should be
   *                                  at least as large as the longest delay
   *                                  ever passed to sample(). Default 5000.
   */
  constructor({ maxAgeMs = 5000 } = {}) {
    this.#maxAgeMs = maxAgeMs;
  }

  /**
   * Record a new sample.
   * @param {number} t  Timestamp in ms (e.g. performance.now())
   * @param {number} v  Sample value
   */
  push(t, v) {
    this.#buf.push({ t, v });
    const cutoff = t - this.#maxAgeMs;
    let i = 0;
    while (i < this.#buf.length && this.#buf[i].t < cutoff) i++;
    if (i > 0) this.#buf.splice(0, i);
  }

  /**
   * Value from `delayMs` milliseconds before `t`, linearly interpolated
   * between the nearest recorded samples. Clamped to the oldest/newest
   * buffered value if the requested time falls outside the buffered range.
   * Returns 0 if nothing has been pushed yet.
   * @param {number} t        Current time in ms (e.g. performance.now())
   * @param {number} delayMs  How far back to look
   * @returns {number}
   */
  sample(t, delayMs) {
    const n = this.#buf.length;
    if (n === 0) return 0;

    const target = t - delayMs;
    if (target <= this.#buf[0].t) return this.#buf[0].v;
    const last = this.#buf[n - 1];
    if (target >= last.t) return last.v;

    // Binary search for the pair of samples bracketing `target`.
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.#buf[mid].t <= target) lo = mid; else hi = mid;
    }
    const a = this.#buf[lo], b = this.#buf[hi];
    const frac = (target - a.t) / (b.t - a.t || 1);
    return a.v + (b.v - a.v) * frac;
  }

  /** Discard all buffered samples (e.g. at the start of a new session). */
  reset() {
    this.#buf = [];
  }
}
