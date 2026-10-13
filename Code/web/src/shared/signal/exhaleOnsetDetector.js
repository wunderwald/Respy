/**
 * exhaleOnsetDetector.js — Rising-edge exhale onset detection
 * =============================================================
 * Extracted from trainingGame's inline breath-tracking logic. Detects the
 * moment a normalised resp signal crosses a threshold from below (an
 * "exhale onset"), debounced so a single noisy crossing doesn't fire twice.
 *
 * Usage:
 *   const detector = new ExhaleOnsetDetector({ threshold: 0.40, debounceMs: 400 });
 *   const onset = detector.feed(value, performance.now()); // call on every sample
 *   if (onset) { ... }
 */
export class ExhaleOnsetDetector {
  #threshold;
  #debounceMs;
  #inBreath = false;
  #lastOnsetMs = -Infinity;

  constructor({ threshold = 0.40, debounceMs = 1500 } = {}) {
    this.#threshold = threshold;
    this.#debounceMs = debounceMs;
  }

  /**
   * Feed a new sample.
   * @param {number} value  Normalised signal in [0, 1]
   * @param {number} now    Timestamp in ms (e.g. performance.now())
   * @returns {boolean} true if this sample triggered an onset
   */
  feed(value, now) {
    const above = value >= this.#threshold;
    const onset = above && !this.#inBreath && (now - this.#lastOnsetMs > this.#debounceMs);
    if (onset) this.#lastOnsetMs = now;
    this.#inBreath = above;
    return onset;
  }

  get inBreath() { return this.#inBreath; }
}

export default ExhaleOnsetDetector;
