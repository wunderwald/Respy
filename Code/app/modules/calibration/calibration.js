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

/**
 * Tracks slow drift in the signal's range after calibration.
 *
 * Keeps a rolling window of recent samples (decimated to one every
 * `sampleIntervalMs`, so cost doesn't depend on the stream's sample rate),
 * periodically recomputes the same percentile range as RespCalibration over
 * that window, and moves the current range toward it exponentially — so the
 * mapping follows baseline wander / changing breath depth without jumping.
 *
 * The range never narrows below `minSpanFraction` × the reference span (the
 * calibrated span, or — after a default-range fallback — the first span
 * measured from data), so a breath hold or very shallow breathing doesn't
 * blow noise up to full scale.
 *
 * Usage:
 *   const tracker = new AdaptiveRange({ windowSecs: 60 });
 *   tracker.push(performance.now(), value);   // every sample, from calibration on
 *   tracker.seed([min, max]);                 // once calibration is done
 *   tracker.range;                            // current [min, max] (a copy), or null before seed()
 */
export class AdaptiveRange {
  #windowMs;
  #lowerPercentile;
  #upperPercentile;
  #gain;
  #updateMs;
  #alpha;            // per-update blend factor toward the window's target range
  #minSpanFraction;
  #minDataMs;
  #sampleIntervalMs;

  #times = [];
  #values = [];
  #head = 0;         // index of the oldest sample still inside the window
  #lastStored = -Infinity;
  #lastUpdate = -Infinity;
  #range = null;
  #refSpan = null;

  /**
   * @param {object} [opts]
   * @param {number} [opts.windowSecs]        Rolling window length (default 60)
   * @param {number} [opts.lowerPercentile]   Range minimum percentile (default 5)
   * @param {number} [opts.upperPercentile]   Range maximum percentile (default 95)
   * @param {number} [opts.gain]              Width scale around the centre, as in RespCalibration (default 1)
   * @param {number} [opts.timeConstantSecs]  How quickly the range follows the window's percentiles (default 10)
   * @param {number} [opts.minSpanFraction]   Floor on range width relative to the reference span (default 0.3)
   * @param {number} [opts.updateSecs]        How often the target is recomputed (default 1)
   * @param {number} [opts.minDataSecs]       Window must cover at least this much data before adapting (default 10)
   * @param {number} [opts.sampleIntervalMs]  Decimation interval for stored samples (default 20)
   */
  constructor({
    windowSecs = 60, lowerPercentile = 5, upperPercentile = 95, gain = 1,
    timeConstantSecs = 10, minSpanFraction = 0.3, updateSecs = 1,
    minDataSecs = 10, sampleIntervalMs = 20,
  } = {}) {
    this.#windowMs = windowSecs * 1000;
    this.#lowerPercentile = lowerPercentile;
    this.#upperPercentile = upperPercentile;
    this.#gain = gain;
    this.#updateMs = updateSecs * 1000;
    this.#alpha = 1 - Math.exp(-updateSecs / timeConstantSecs);
    this.#minSpanFraction = minSpanFraction;
    this.#minDataMs = minDataSecs * 1000;
    this.#sampleIntervalMs = sampleIntervalMs;
  }

  /**
   * Set the starting range (normally the calibration result).
   * @param {[number, number]} range
   * @param {object} [opts]
   * @param {boolean} [opts.fromData]  false for a placeholder/default range — its span
   *                                   then isn't used as the min-span reference (default true)
   */
  seed(range, { fromData = true } = {}) {
    this.#range = [range[0], range[1]];
    this.#refSpan = fromData ? range[1] - range[0] : null;
  }

  /** Record one sample; also recomputes the range every `updateSecs` once seeded. */
  push(now, value) {
    if (!Number.isFinite(value)) return;

    if (now - this.#lastStored >= this.#sampleIntervalMs) {
      this.#times.push(now);
      this.#values.push(value);
      this.#lastStored = now;
    }

    const cutoff = now - this.#windowMs;
    while (this.#head < this.#times.length && this.#times[this.#head] < cutoff) this.#head++;
    if (this.#head > 1024 && this.#head * 2 > this.#times.length) {
      this.#times = this.#times.slice(this.#head);
      this.#values = this.#values.slice(this.#head);
      this.#head = 0;
    }

    if (this.#range && now - this.#lastUpdate >= this.#updateMs) {
      this.#lastUpdate = now;
      this.#update();
    }
  }

  /** Current [min, max] — a copy, safe to hold onto as a snapshot — or null before seed(). */
  get range() {
    return this.#range ? [this.#range[0], this.#range[1]] : null;
  }

  /** Discard all samples and the current range (call at session start). */
  reset() {
    this.#times = [];
    this.#values = [];
    this.#head = 0;
    this.#lastStored = -Infinity;
    this.#lastUpdate = -Infinity;
    this.#range = null;
    this.#refSpan = null;
  }

  #update() {
    const n = this.#times.length - this.#head;
    if (n < 2 || this.#times[this.#times.length - 1] - this.#times[this.#head] < this.#minDataMs) return;

    const sorted = Float64Array.from(this.#values.slice(this.#head)).sort();
    const lo = percentile(sorted, this.#lowerPercentile);
    const hi = percentile(sorted, this.#upperPercentile);
    if (!(hi > lo)) return;

    const centre = (lo + hi) / 2;
    let halfSpan = ((hi - lo) / 2) * this.#gain;
    if (this.#refSpan == null) this.#refSpan = 2 * halfSpan;
    halfSpan = Math.max(halfSpan, (this.#refSpan * this.#minSpanFraction) / 2);

    this.#range[0] += this.#alpha * (centre - halfSpan - this.#range[0]);
    this.#range[1] += this.#alpha * (centre + halfSpan - this.#range[1]);
  }
}

/** Linearly interpolated percentile (p in 0–100) of an ascending-sorted array. */
function percentile(sorted, p) {
  const idx = (Math.min(100, Math.max(0, p)) / 100) * (sorted.length - 1);
  const i = Math.floor(idx);
  const frac = idx - i;
  return i + 1 < sorted.length ? sorted[i] + frac * (sorted[i + 1] - sorted[i]) : sorted[i];
}
