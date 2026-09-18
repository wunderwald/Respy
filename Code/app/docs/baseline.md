# Baseline

Resting-state recording. The participant watches a 7-minute resting-state video full-screen while the resp signal is recorded in the background and LSL markers are sent at the start and end. If the video file isn't present, falls back to a plain countdown display for the same duration.

---

## Run

```bash
cd app && npm run baseline
```

Or select **Baseline** from the start screen (`npm start`).

---

## Experimenter controls

| Control | What it does |
|---|---|
| **Resp stream** | Select the LSL resp stream. Required before pressing Start. |
| **Subject** | Subject code used as the CSV filename prefix. Locked once recording begins. |
| **Data dir** | Folder for CSV output. Click **…** to pick a different folder. Default: `baselineData/`. |
| **Start** | Begins the recording. Requires a connected resp stream. Sends the `baseline_start` marker. |
| **Abort** | Stops early and sends `baseline_abort`. Also triggered by `Escape`. |

---

## Session flow

```
stream ready → [Start] → 7-minute video (or countdown, if missing) → baseline_end marker → Done
```

The scene window plays the resting-state video full-screen, or shows a countdown timer if it isn't available.

---

## Data output

Two files are written to `output_data/baseline/` when the recording ends (normally or via Abort). Aborted sessions save whatever was recorded up to that point.

**`<SUBJECT_CODE>_baseline.csv`** — raw signal

| Column | Description |
|---|---|
| `timestamp` | ISO-8601 wall-clock time of the sample |
| `value` | Raw LSL sample value |

**`<SUBJECT_CODE>_baseline_estimates.csv`** — breath rate estimates

One row per method. Empty `hz`/`bpm` cells mean the estimator returned null (signal too short, or no clear periodicity found).

| Column | Description |
|---|---|
| `method` | Estimator name (see below) |
| `hz` | Estimated breathing rate in Hz |
| `bpm` | Estimated breathing rate in breaths per minute |

Methods: `autocorr`, `peakTrough`, `welch`, `xcorr` (full signal), plus `autocorr_windowed`, `welch_windowed`, `xcorr_windowed` (30 s sliding windows, 50 % overlap, averaged). `peakTrough` does not have a windowed variant.

Sample rate for estimation is derived from the wall-clock timestamps in the raw CSV.

---

## LSL markers

Sent to the WebSocket marker bridge (`ws://localhost:9001` by default). Configure in `baseline_config.js`:

```js
SEND_MARKERS:      true,
MARKER_STREAM_URL: 'ws://localhost:9001',
```

| Marker | Event |
|---|---|
| `baseline_start` | Recording begins |
| `baseline_end` | `DURATION_SECS` elapsed — recording complete |
| `baseline_abort` | Experimenter pressed Abort |

---

## Resting-state video

Configured in [baseline_config.js](../modules/baseline/baseline_config.js):

```js
DURATION_SECS: 420,   // 7 minutes — also the fallback duration if the video is missing
VIDEO_PATH: 'videos/01_Inscapes_NoScannerSound_h264.mov',
VIDEO_MISSING_WARNING: '...',
```

- Checked for existence once at startup (before Start is enabled), so the file can start buffering (`preload="auto"` + `load()`) well ahead of time and starts playing smoothly the moment recording begins.
- Recording, sample collection, and the `DURATION_SECS` end-of-session check all run exactly as in the countdown-only version — the video is purely the on-screen visual; it doesn't drive the state machine.
- **If the video file is missing**, the experimenter HUD shows a persistent warning (`VIDEO_MISSING_WARNING`) and the session falls back to the plain countdown display, still for `DURATION_SECS`.
- The video is not looped — if its actual length differs from `DURATION_SECS`, the recording still ends exactly at `DURATION_SECS` regardless of whether the video has finished.
- Autoplay is enabled app-wide via the `autoplay-policy=no-user-gesture-required` Electron switch (in `main.js`), since playback is started by an IPC action from the experimenter window rather than a click inside the scene window itself.
