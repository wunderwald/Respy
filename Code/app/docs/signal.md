# signal — Signal Processing Utilities

Three modules:

| Module | Purpose |
|---|---|
| [breathFilter.js](../modules/signal/breathFilter.js) | The live breath filter shared by iBreath, bioGame and beltTrainingGame |
| [signalUtils.js](../modules/signal/signalUtils.js) | Real-time utilities: Gaussian smoothing, delay line, range mapping |
| [breathRateEstimators.js](../modules/signal/breathRateEstimators.js) | Offline breath rate estimation from recordings |

---

## Breath filter

[breathFilter.js](../modules/signal/breathFilter.js) decides how every task smooths the live breath signal. Settings in `BREATH_FILTER`:

| Key | Default | |
|---|---|---|
| `TYPE` | `'butterworth'` | `'butterworth'` or `'gaussian'` (switch back to the old filter) |
| `CUTOFF_HZ` | `1.5` | Butterworth cut-off. Breathing is below 1 Hz, so the breath curve passes unchanged; faster noise is removed |
| `GAUSSIAN_WINDOW` | `64` | Window in samples, only with `TYPE: 'gaussian'` |
| `DEFAULT_SAMPLE_RATE` | `100` | Used if the stream's rate is unknown |

**Why Butterworth:** the Gaussian window is centred, so its output is always half a window old — 31.5 samples at 64, ≈ 0.3–0.37 s at 85–100 Hz. That lag made the games feel delayed, and made iBreath's "sync" trials ≈ 0.35 s late (with the async delays on top). The 2nd-order Butterworth low-pass is causal and removes noise about as well, with ≈ 0.13–0.15 s delay at 1.5 Hz (measured on a recorded session and a 15 BPM test signal).

**Sample rate:** the Butterworth coefficients depend on the stream's rate. Each task tracks it with `StreamRate`: the LSL stream's nominal rate from the bridge's `connected` status, else the rate counted from incoming samples (last 5 s), else `DEFAULT_SAMPLE_RATE`. The filter is built at Start with that rate.

**Recorded:** the filter's `label` — e.g. `butterworth2_1.5Hz_fs100` (type, cut-off, sample rate) or `gaussian_w64` — goes into the data (`breathFilter` column / `breath_filter` setting), plus `sample_rate_source` (`nominal` / `measured` / `default`) in the games' event data.

```js
import { createBreathFilter, StreamRate } from './modules/signal/breathFilter.js';

const rate = new StreamRate();
rate.setStatus(statusEvent);           // on every stream status
rate.tick();                           // on every sample
const filter = createBreathFilter(rate.current.hz);   // at Start
filter.push(rawSample);
const smoothed = filter.value;
filter.label;                          // 'butterworth2_1.5Hz_fs100'
```

The Butterworth filter starts at the first sample's value (no swing up from 0) and ignores non-finite samples. iBreath doesn't reset it between trials (its state is always valid); with `TYPE: 'gaussian'`, iBreath restarts the window per trial as before.

---

## signalUtils.js

### GaussianSmoother

Real-time Gaussian low-pass filter over a sliding window. Matches `applyGaussianLPF.m` + `smoothBreathRT.m`. No longer the default (see [Breath filter](#breath-filter)): kept for `BREATH_FILTER.TYPE = 'gaussian'`.

```js
import { GaussianSmoother } from './modules/signal/signalUtils.js';

const smoother = new GaussianSmoother(64);  // window size in samples
smoother.push(rawSample);
const smoothed = smoother.value;
smoother.reset();
```

---

### SignalDelayLine

Time-based delay buffer: continuously records timestamped samples and reads back the value from an arbitrary number of milliseconds ago, linearly interpolated. Drives the iBreath async stimulus — the participant's own real-time breath signal, played back after a delay.

```js
import { SignalDelayLine } from './modules/signal/signalUtils.js';

const line = new SignalDelayLine({ maxAgeMs: 3500 });  // discard samples older than this
line.push(performance.now(), value);                  // call on every incoming sample
const delayed = line.sample(performance.now(), 2500);  // value from 2.5s ago, clamped to
                                                        // the buffered range if out of bounds
line.reset();
```

---

### mapRange

```js
import { mapRange } from './modules/signal/signalUtils.js';

mapRange(value, [inMin, inMax], [outMin, outMax]);  // linear range mapping
```

---

## breathRateEstimators.js

### Offline rate estimators

Return **Hz** (number) or `null` on failure.

### cleanSignal

Zero-phase first-order Butterworth bandpass filter (0.05–3 Hz default), following neurokit2's `rsp_clean()` approach. Applied with reflect edge padding to match scipy's `filtfilt` behaviour.

```js
import { cleanSignal } from './modules/signal/breathRateEstimators.js';

const cleaned = cleanSignal(signal, sampleRate);
// optional: cleanSignal(signal, sampleRate, { lowCut: 0.05, highCut: 3.0 })
```

All estimators apply this automatically when `clean: true` (default).

---

### AutocorrRateEstimator

Finds the first prominent positive peak in the normalised autocorrelation. Supports optional sliding window (50 % overlap).

```js
new AutocorrRateEstimator({ minPeriod: 2, maxPeriod: 12, clean: true, windowSecs: 30 })
  .estimate(signal, sampleRate)  // → Hz | null
```

---

### PeakTroughEstimator

Finds local minima below the signal mean (troughs), computes inter-trough intervals, filters to the physiological range, and averages. Based on neurokit2's `"trough"` method.

```js
new PeakTroughEstimator({ minPeriod: 2, maxPeriod: 12, clean: true })
  .estimate(signal, sampleRate)  // → Hz | null
```

---

### WelchEstimator

Divides the signal into overlapping (50 %) Hann-windowed segments, accumulates Goertzel power at each candidate frequency, and returns the peak in the physiological range. Returns `null` if the signal is shorter than `minSignalSecs` (default 20 s).

```js
new WelchEstimator({
  clean: true, windowSecs: null,
  minFreq: 0.05, maxFreq: 1.0, freqStep: 0.01,
  minSignalSecs: 20,
}).estimate(signal, sampleRate)  // → Hz | null
```

---

### XcorrEstimator

Cross-correlates the signal with template sinusoids at candidate frequencies (equivalent to evaluating the DFT at those frequencies) and returns the strongest match. Based on neurokit2's `'xcorr'` method.

```js
new XcorrEstimator({
  clean: true, windowSecs: null,
  minFreq: 0.05, maxFreq: 1.0, freqStep: 0.005,
}).estimate(signal, sampleRate)  // → Hz | null
```

---

### estimateBreathRate

Runs all four estimators and returns a dict. Each value is Hz | null.

```js
import { estimateBreathRate } from './modules/signal/breathRateEstimators.js';

const { autocorr, peakTrough, welch, xcorr } = estimateBreathRate(signal, sampleRate);

// Per-estimator options can be passed:
estimateBreathRate(signal, sampleRate, {
  welch: { windowSecs: 30 },
  xcorr: { freqStep: 0.01 },
});
```

---

### Sliding window

`AutocorrRateEstimator`, `WelchEstimator`, and `XcorrEstimator` support `windowSecs`. When set, the full signal is cleaned once, then split into overlapping 50 %-overlap windows of that length, each estimated independently. The returned value is the average of all non-null window results (null if none succeeded).

```js
const hz = new WelchEstimator({ windowSecs: 30 }).estimate(signal, sampleRate);
```
