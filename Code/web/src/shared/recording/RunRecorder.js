// RunRecorder — collects one game run's events and time series, with all
// timestamps as ms since the run started (performance.now() based, so
// monotonic and sub-ms precise). Wall-clock start/end come from
// performance.timeOrigin, so both are on the same clock.
//
// Time series are stored column-wise ({t_ms: [...], colA: [...], ...}) —
// compact JSON and loads directly as a table (e.g. pandas.DataFrame(ts)).

export function round(x, decimals) {
  if (x == null || !Number.isFinite(x)) return null;
  const f = 10 ** decimals;
  return Math.round(x * f) / f;
}

/** Round to `digits` significant digits — for small raw signal values. */
export function sig(x, digits = 5) {
  if (x == null || !Number.isFinite(x)) return null;
  return x === 0 ? 0 : Number(x.toPrecision(digits));
}

export class RunRecorder {
  #columns;
  #t0 = null;
  #endedAt = null;
  #events = [];
  #series = null;

  /** @param {string[]} columns  time-series columns besides t_ms */
  constructor(columns) {
    this.#columns = columns;
  }

  start(now) {
    this.#t0 = now;
    this.#endedAt = null;
    this.#events = [];
    this.#series = { t_ms: [] };
    for (const c of this.#columns) this.#series[c] = [];
  }

  get running() { return this.#t0 != null && this.#endedAt == null; }

  /** ms since run start, 0.1 ms resolution */
  t(now) { return round(now - this.#t0, 1); }

  event(now, type, data = {}) {
    if (!this.running) return;
    this.#events.push({ t_ms: this.t(now), type, ...data });
  }

  sample(now, row) {
    if (!this.running) return;
    this.#series.t_ms.push(this.t(now));
    for (const c of this.#columns) this.#series[c].push(row[c] ?? null);
  }

  finish(now) {
    if (this.running) this.#endedAt = now;
  }

  get events() { return this.#events; }

  /** Durations (s) between each `startType` event and the next `endType` event. */
  intervals(startType, endType) {
    const out = [];
    let start = null;
    for (const e of this.#events) {
      if (e.type === startType) start = e.t_ms;
      else if (e.type === endType && start != null) {
        out.push((e.t_ms - start) / 1000);
        start = null;
      }
    }
    return out;
  }

  /** null until a run has started and finished. */
  data() {
    if (this.#t0 == null || this.#endedAt == null) return null;
    const startEpoch = performance.timeOrigin + this.#t0;
    const endEpoch = performance.timeOrigin + this.#endedAt;
    const n = this.#series.t_ms.length;
    const durationS = (this.#endedAt - this.#t0) / 1000;
    return {
      time: {
        started_at: new Date(startEpoch).toISOString(),
        ended_at: new Date(endEpoch).toISOString(),
        started_at_epoch_ms: round(startEpoch, 1),
        duration_s: round(durationS, 3),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? null,
        utc_offset_min: -new Date(startEpoch).getTimezoneOffset(),
      },
      events: this.#events,
      timeseries: {
        n_samples: n,
        effective_rate_hz: durationS > 0 ? round(n / durationS, 2) : null,
        ...this.#series,
      },
    };
  }
}

export function mean(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
}

export function sum(arr) {
  return arr.reduce((a, b) => a + b, 0);
}
