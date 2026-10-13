/**
 * calibration.js — Respiration signal calibration
 * =================================================
 * Records the breath signal for a fixed duration, then returns the
 * [min, max] range used to scale live incoming samples to a normalized range.
 *
 * The range is taken from percentiles of the recording rather than its
 * absolute min/max, so a single artefact (cough, swallow, movement) doesn't
 * stretch it. Works on the signal's native scale — no assumption that input
 * is already in [0, 1].
 *
 * Usage:
 *   const cal = new RespCalibration({ durationSecs: 10 });
 *   cal.start();
 *   cal.push(sample);            // call for each sample during calibration
 *   if (cal.isDone) {
 *     const result = cal.finish();   // { min, max, sampleCount } | null
 *   }
 */
export class RespCalibration {
  #durationSecs;
  #lowerPercentile;
  #upperPercentile;
  #gain;
  #samples = [];
  #startTime = null;

  /**
   * @param {object} opts
   * @param {number} opts.durationSecs       How long to record before finish() is meaningful
   * @param {number} [opts.lowerPercentile]  Percentile (0–100) used as the range minimum (default 5)
   * @param {number} [opts.upperPercentile]  Percentile (0–100) used as the range maximum (default 95)
   * @param {number} [opts.gain]             Scales the range width around its centre: < 1 narrows
   *                                         (more sensitive), > 1 widens (default 1 = unchanged)
   */
  constructor({ durationSecs, lowerPercentile = 5, upperPercentile = 95, gain = 1 } = {}) {
    this.#durationSecs = durationSecs;
    this.#lowerPercentile = lowerPercentile;
    this.#upperPercentile = upperPercentile;
    this.#gain = gain;
  }

  /** Begin (or restart) recording. */
  start() {
    this.#samples = [];
    this.#startTime = performance.now();
  }

  /** Record one sample. Caller decides whether to push raw or smoothed values. */
  push(value) {
    if (Number.isFinite(value)) this.#samples.push(value);
  }

  get elapsedSecs() {
    return this.#startTime != null ? (performance.now() - this.#startTime) / 1000 : 0;
  }

  get remainingSecs() {
    return Math.max(0, this.#durationSecs - this.elapsedSecs);
  }

  /** Elapsed fraction of durationSecs, clamped to [0, 1]. */
  get progress() {
    return Math.min(1, Math.max(0, this.elapsedSecs / this.#durationSecs));
  }

  get isDone() {
    return this.elapsedSecs >= this.#durationSecs;
  }

  get sampleCount() {
    return this.#samples.length;
  }

  /**
   * Computes the scaling range from recorded samples.
   * @returns {{min: number, max: number, sampleCount: number} | null}
   *   null if no samples were recorded or the signal was flat (no usable
   *   range) — caller should retry (call start() again) or fall back.
   */
  finish() {
    if (this.#samples.length === 0) return null;

    const sorted = Float64Array.from(this.#samples).sort();
    const lo = percentile(sorted, this.#lowerPercentile);
    const hi = percentile(sorted, this.#upperPercentile);
    if (!(hi > lo)) return null;

    const centre = (lo + hi) / 2;
    const halfSpan = ((hi - lo) / 2) * this.#gain;
    return {
      min: centre - halfSpan,
      max: centre + halfSpan,
      sampleCount: this.#samples.length,
    };
  }
}

/** Linearly interpolated percentile (p in 0–100) of an ascending-sorted array. */
function percentile(sorted, p) {
  const idx = (Math.min(100, Math.max(0, p)) / 100) * (sorted.length - 1);
  const i = Math.floor(idx);
  const frac = idx - i;
  return i + 1 < sorted.length ? sorted[i] + frac * (sorted[i + 1] - sorted[i]) : sorted[i];
}
