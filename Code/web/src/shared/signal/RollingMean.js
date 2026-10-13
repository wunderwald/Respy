// Simple rolling-mean smoother — mirrors the smoothing stage in
// simulation/mic_breath.py (a plain rolling average over the last N
// samples), distinct from GaussianSmoother's weighted kernel. Used right
// after the mic envelope is computed, before anything else sees it.

export class RollingMean {
  #buf;
  #idx = 0;
  #filled = 0;
  #sum = 0;

  constructor(size = 5) {
    this.#buf = new Float64Array(size);
  }

  /** Push a new sample and return the updated rolling mean. */
  push(value) {
    this.#sum -= this.#buf[this.#idx];
    this.#buf[this.#idx] = value;
    this.#sum += value;
    this.#idx = (this.#idx + 1) % this.#buf.length;
    if (this.#filled < this.#buf.length) this.#filled++;
    return this.#sum / this.#filled;
  }

  reset() {
    this.#buf.fill(0);
    this.#idx = 0;
    this.#filled = 0;
    this.#sum = 0;
  }
}

export default RollingMean;
