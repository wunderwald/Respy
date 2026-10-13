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
