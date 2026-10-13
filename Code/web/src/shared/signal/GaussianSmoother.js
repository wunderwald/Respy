// Copied from app/modules/signal/signalUtils.js (GaussianSmoother only —
// the other exports there are lab-specific and unused here).

/**
 * Real-time Gaussian low-pass filter over a sliding window.
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
      const last = (this.#head - 1 + this.#windowSize) % this.#windowSize;
      return this.#ring[last];
    }

    const n = this.#count;

    if (n === this.#windowSize) {
      let out = 0;
      for (let i = 0; i < n; i++) {
        out += this.#ring[(this.#head + i) % n] * this.#kernel[i];
      }
      return out;
    }

    let sum = 0;
    const weights = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      weights[i] = this.#kernel[this.#windowSize - n + i];
      sum += weights[i];
    }

    let out = 0;
    for (let i = 0; i < n; i++) {
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

export default GaussianSmoother;
