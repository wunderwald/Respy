// Breath-signal filter shared by every task (iBreath, bioGame,
// beltTrainingGame): one place that decides how the live breath is smoothed.
//
// Default: a 2nd-order Butterworth low-pass (causal, ~130 ms delay at
// 1.5 Hz). It replaced the centred Gaussian window (GaussianSmoother in
// signalUtils.js), which delays the breath by half its window, ≈ 0.35 s at
// 64 samples / ~90 Hz, and made the games feel laggy. To switch back, set
// BREATH_FILTER.TYPE to 'gaussian'.
//
// Both filters have the same interface: push(sample), value, reset(), and
// `label` (a short description written to the data files).

import { GaussianSmoother } from './signalUtils.js';

export const BREATH_FILTER = {
  TYPE:            'butterworth',   // 'butterworth' | 'gaussian'
  CUTOFF_HZ:       1.5,             // Butterworth cut-off; breathing is < 1 Hz, so it passes unchanged
  GAUSSIAN_WINDOW: 64,              // samples — only used with TYPE 'gaussian'
  // Butterworth coefficients depend on the sample rate: taken from the LSL
  // stream's nominal rate, or measured from incoming samples if the stream
  // has none (irregular rate), or this value if neither is known yet.
  DEFAULT_SAMPLE_RATE: 100,
};

/**
 * The configured breath filter for a stream at `sampleRate` Hz.
 * @param {number} sampleRate
 */
export function createBreathFilter(sampleRate) {
  if (BREATH_FILTER.TYPE === 'gaussian') {
    const f = new GaussianSmoother(BREATH_FILTER.GAUSSIAN_WINDOW);
    f.label = `gaussian_w${BREATH_FILTER.GAUSSIAN_WINDOW}`;
    return f;
  }
  return new ButterworthLowpass(BREATH_FILTER.CUTOFF_HZ, sampleRate);
}

// ── ButterworthLowpass ───────────────────────────────────────────────────────

/**
 * Real-time 2nd-order Butterworth low-pass (bilinear transform, transposed
 * direct form II). Causal: each output only uses past samples, and the delay
 * is small (≈ 130 ms at 1.5 Hz, ≈ 100 ms at 2 Hz) instead of half a window.
 *
 * The first sample after construction / reset() initialises the filter to a
 * steady state at that value, so there is no start-up swing from 0.
 */
export class ButterworthLowpass {
  #b0; #b1; #b2; #a1; #a2;
  #z1 = 0; #z2 = 0;
  #y  = 0;
  #primed = false;

  /**
   * @param {number} cutoffHz
   * @param {number} sampleRate  Hz
   */
  constructor(cutoffHz, sampleRate) {
    const fs = sampleRate > 0 ? sampleRate : BREATH_FILTER.DEFAULT_SAMPLE_RATE;
    // The cut-off must stay below Nyquist; at very low rates cap it there.
    const fc = Math.min(cutoffHz, fs * 0.45);
    const k  = Math.tan(Math.PI * fc / fs);
    const q  = Math.SQRT2;
    const a0 = 1 + q * k + k * k;
    this.#b0 = (k * k) / a0;
    this.#b1 = 2 * this.#b0;
    this.#b2 = this.#b0;
    this.#a1 = 2 * (k * k - 1) / a0;
    this.#a2 = (1 - q * k + k * k) / a0;
    this.label = `butterworth2_${+fc.toFixed(3)}Hz_fs${+fs.toFixed(1)}`;
  }

  push(x) {
    if (!Number.isFinite(x)) return;
    if (!this.#primed) this.#prime(x);
    const y  = this.#b0 * x + this.#z1;
    this.#z1 = this.#b1 * x - this.#a1 * y + this.#z2;
    this.#z2 = this.#b2 * x - this.#a2 * y;
    this.#y  = y;
  }

  get value() { return this.#y; }

  reset() {
    this.#z1 = this.#z2 = this.#y = 0;
    this.#primed = false;
  }

  // Steady state for a constant input v (unity DC gain): output v.
  #prime(v) {
    this.#z1 = v * (1 - this.#b0);
    this.#z2 = v * (this.#b2 - this.#a2);
    this.#y  = v;
    this.#primed = true;
  }
}

// ── Stream sample rate ───────────────────────────────────────────────────────

/**
 * Tracks the resp stream's sample rate for the filter: the nominal rate from
 * the LSL "connected" status, else a rate measured from sample arrivals over
 * the last few seconds (arrivals come in bursts, but their average is right).
 *
 * Usage (in a frontend):
 *   setStatus(event)  → rate.setStatus(event)
 *   pushSample(v)     → rate.tick()
 *   at session start  → createBreathFilter(rate.current.hz)
 */
export class StreamRate {
  #nominal = 0;
  #times = [];
  static #WINDOW_MS = 5000;

  setStatus({ type, stream } = {}) {
    if (type === 'connected') {
      const r = Number(stream?.sample_rate);
      this.#nominal = Number.isFinite(r) && r > 0 ? r : 0;
      this.#times = [];
    }
  }

  tick(now = performance.now()) {
    this.#times.push(now);
    const cutoff = now - StreamRate.#WINDOW_MS;
    let i = 0;
    while (i < this.#times.length && this.#times[i] < cutoff) i++;
    if (i) this.#times.splice(0, i);
  }

  /** { hz, source: 'nominal' | 'measured' | 'default' } */
  get current() {
    if (this.#nominal > 0) return { hz: this.#nominal, source: 'nominal' };
    const n = this.#times.length;
    const span = n > 1 ? this.#times[n - 1] - this.#times[0] : 0;
    if (span >= 2000) return { hz: (n - 1) / (span / 1000), source: 'measured' };
    return { hz: BREATH_FILTER.DEFAULT_SAMPLE_RATE, source: 'default' };
  }
}
