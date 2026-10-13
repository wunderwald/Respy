# calibration — Respiration Signal Calibration

One module:

| Module | Purpose |
|---|---|
| [calibration.js](../modules/calibration/calibration.js) | Records the breath signal for a fixed duration, returns the scaling range |

---

## calibration.js

### RespCalibration

Records samples for a fixed duration, then derives a `[min, max]` range used to
normalize live incoming signal values. The range comes from **percentiles** of
the recording (5th / 95th by default), not its absolute min/max, so a single
artefact (cough, swallow, movement) doesn't stretch it. It works on the
signal's native scale — the input does **not** need to be in `[0, 1]`. Used by
[bioGame](bioGame.md) and [iBreath](ibreath.md) to turn a raw calibration
recording into a scaling range for the rest of the session.

```js
import { RespCalibration } from './modules/calibration/calibration.js';

const cal = new RespCalibration({
  durationSecs: 10,
  lowerPercentile: 5,    // default 5
  upperPercentile: 95,   // default 95
  gain: 1,               // default 1 (range width unchanged)
});
cal.start();

// push a sample each time one arrives during the calibration phase
cal.push(sample);

// each tick / frame:
if (cal.isDone) {
  const result = cal.finish();   // { min, max, sampleCount } | null
  if (!result) {
    // no samples recorded (e.g. stream hiccup), or a flat signal with no usable
    // range — caller decides what to do next
  } else {
    const [min, max] = [result.min, result.max];
  }
}

cal.progress;       // 0..1, elapsed fraction of durationSecs
cal.remainingSecs;   // seconds left
```

`RespCalibration` itself has no opinion on what to do when `finish()` returns
`null` — that choice (retry vs. fall back to a default range) is up to the
caller. [bioGame](bioGame.md) and [iBreath](ibreath.md) both surface it to the
experimenter as a **Retry calibration** / **Use default calibration** choice
in the HUD, falling back to each frontend's `CONFIG.DEFAULT_CAL_RANGE` when
"use default" is chosen.

`gain` scales the width of the percentile range **around its centre**: `< 1`
narrows it (more sensitive, saturates sooner), `> 1` widens it (headroom for
deeper breaths than during calibration). The default `1` leaves it unchanged.

`RespCalibration` only records samples and computes the range — it does not
smooth the signal (use [`GaussianSmoother`](signal.md) beforehand if needed)
or apply the scaling itself (use [`mapRange`](signal.md) with the returned
`[min, max]`).

---

### AdaptiveRange

Follows **drift** in the signal's range after calibration — baseline wander,
belt slipping, breath depth changing over a long session. Keeps a rolling
window of recent samples (default 60 s, decimated to one sample every 20 ms
so cost is independent of the stream's sample rate), recomputes the same
5th / 95th percentile range over it once per second, and moves the current
range toward that target exponentially (default time constant 10 s) — so the
mapping follows slow changes without jumping.

```js
import { AdaptiveRange } from './modules/calibration/calibration.js';

const tracker = new AdaptiveRange({
  windowSecs: 60,          // rolling window (default 60)
  timeConstantSecs: 10,    // how fast the range follows the window (default 10)
  minSpanFraction: 0.3,    // floor on range width, relative to the calibrated span (default 0.3)
});

tracker.push(performance.now(), value);    // every sample, from calibration start on
tracker.seed([cal.min, cal.max]);          // once calibration is done
tracker.seed(DEFAULT_RANGE, { fromData: false });  // …or after a "use default" fallback
tracker.range;                             // current [min, max] (a copy), or null before seed()
```

- **Min-span floor**: the range never narrows below `minSpanFraction` × the
  calibrated span, so a breath hold or a stretch of very shallow breathing
  doesn't blow noise up to full scale. After a `fromData: false` seed, the
  reference span is taken from the first span measured from data instead.
- **Default-range fallback**: since the tracker adapts from real data, a
  placeholder `DEFAULT_CAL_RANGE` on the wrong scale converges to the real
  signal range within about a minute.
- Pushing from calibration start on means the window is already full when
  `seed()` is called.

Used by [iBreath](ibreath.md) (range snapshotted at each trial start, fixed
for the trial) and [bioGame](bioGame.md) (applied continuously during play).
Both expose `RANGE_ADAPT` / `RANGE_WINDOW_SECS` / `RANGE_TIME_CONSTANT_SECS` /
`RANGE_MIN_SPAN_FRACTION` in their config; `RANGE_ADAPT: false` keeps the
calibrated range for the whole session.
