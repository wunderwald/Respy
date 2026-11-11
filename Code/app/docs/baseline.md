# Baseline

Resting-state recording. The participant watches a resting-state video full-screen while the resp signal is recorded in the background and LSL markers are sent at the start and end. Each recording has a **name** (Resting, Post natural, …) so several baselines per subject can be recorded and told apart. If the video file isn't present, a plain countdown is shown instead.

---

## Run

```bash
cd app && npm run baseline
```

Or select **Baseline Video** from the start screen (`npm start`).

---

## Experimenter controls

| Control | What it does |
|---|---|
| **Resp stream** | Select the LSL resp stream. Required before pressing Start. |
| **Subject** | Subject code — first part of the file names. Locked once recording begins. Only letters, digits, `-` and `_` (empty = `TEST`); anything else shows a red hint under the field and disables Start. If data for this code already exists, an amber hint warns that Start will overwrite it (Start stays enabled). The existing-data check uses the selected **Name**. |
| **Name** | *Resting*, *Post natural*, *Post slow*, *Post stressor* or *Post slow post stressor* (`NAMES` in `baseline_config.js`). Written to both CSVs' `name` column, into the file names and as a `baseline_name_<slug>` marker. Locked once recording begins. |
| **Play full video** (settings bar) | On by default: the recording ends when the video ends. Off: the **secs** field becomes editable and the recording ends after that many seconds (the video is paused then). The hint next to it shows the video's length, and warns if the entered time is longer than the video — its last frame then stays on screen until the time is up. Locked once recording begins. |
| **Start** | Locks the settings and shows the explanation screen to the child (`instructions_start` marker). Requires a connected resp stream (and a duration > 0 when "play full video" is off). |
| **Start video** | Shown on the explanation screen (also **Space**): begins the recording. Sends `recording_start` and `baseline_name_<slug>`. |
| **Abort** | Stops early and sends `task_abort_baseline`. Also triggered by `Escape`. |

Without a playable video, "play full video" means a `DURATION_SECS` (7 min) countdown. If the video fails mid-recording, the recording continues on a timer (the video's length, if known, else `DURATION_SECS`) with a countdown on screen and a warning for the experimenter.

Closing the window mid-recording also keeps the data: the pending rows are written before it goes away, and a best-effort `task_abort_baseline` marker is sent (also when closed during the explanation). Only the estimates file is skipped (see [Data output](#data-output)).

---

## Session flow

```
stream ready → [Start] → explanation ("Wir zeigen dir jetzt ein Video …") → [Space / Start video] → video until it ends (or for the set secs; countdown if no video) → task_end_baseline marker → Done
```

---

## Data output

Two files per recording in `output_data/baseline/`, named by subject and baseline name (`<slug>`: `resting`, `post_natural`, `post_slow`, `post_stressor`, `post_slow_post_stressor`). Recording the same subject + name again overwrites that pair; different names never collide.

- The raw signal CSV is written **during** the recording: its header at Start, then new rows every `FLUSH_INTERVAL_MS` (1 s). An abort, crash or closed window therefore loses at most the last second; if the window is closed mid-recording, the pending rows are flushed synchronously before it goes away.
- The estimates CSV is written when the recording ends (normally or via Abort), from everything recorded up to that point. After a crash it's missing, but can be recomputed from the raw CSV.

**`<SUBJECT_CODE>_baseline_<slug>.csv`** — raw signal

| Column | Description |
|---|---|
| `timestamp` | ISO-8601 wall-clock time of the sample |
| `value` | Raw LSL sample value |
| `name` | Baseline name as shown in the dropdown, e.g. `Post slow` |

**`<SUBJECT_CODE>_baseline_<slug>_estimates.csv`** — breath rate estimates

One row per method. Empty `hz`/`bpm` cells mean the estimator returned null (signal too short, or no clear periodicity found).

| Column | Description |
|---|---|
| `method` | Estimator name (see below) |
| `hz` | Estimated breathing rate in Hz |
| `bpm` | Estimated breathing rate in breaths per minute |
| `name` | Baseline name, as above |

Methods: `autocorr`, `peakTrough`, `welch`, `xcorr` (full signal), plus `autocorr_windowed`, `welch_windowed`, `xcorr_windowed` (30 s sliding windows, 50 % overlap, averaged). `peakTrough` does not have a windowed variant.

Sample rate for estimation is derived from the wall-clock timestamps in the raw CSV.

bioGame's natural-BPM auto-load reads the subject's **Resting** estimates (`<subject>_baseline_resting_estimates.csv`), falling back to the pre-name file `<subject>_baseline_estimates.csv` for older data.

---

## LSL markers

Sent to the WebSocket marker bridge (`ws://localhost:9001` by default). Configure in `baseline_config.js`:

```js
SEND_MARKERS:      true,
MARKER_STREAM_URL: 'ws://localhost:9001',
```

| Marker | Event |
|---|---|
| `instructions_start` | Explanation screen shown (Start pressed) |
| `task_start_baseline` | Start pressed — session begins (explanation screen shown) |
| `recording_start` | Video + recording begin (Space / Start video) |
| `baseline_name_<slug>` | Sent right after `recording_start`: which baseline this is (e.g. `baseline_name_post_slow`) |
| `task_end_baseline` | Recording complete (video ended, or the set duration elapsed) — session complete |
| `task_abort_baseline` | Experimenter pressed Abort, or the window was closed during the explanation / recording (best effort — the marker connection may already be gone) |

---

## Resting-state video

Configured in [baseline_config.js](../modules/baseline/baseline_config.js):

```js
DURATION_SECS: 420,   // fallback length without a playable video; default of the secs field
VIDEO_PATH: 'videos/01_Inscapes_NoScannerSound_h264.mov',
VIDEO_MISSING_WARNING: '...',
```

- Checked for existence once at startup (before Start is enabled), so the file can start buffering (`preload="auto"` + `load()`) well ahead of time and starts playing smoothly the moment recording begins. Its length is reported to the experimenter window once the metadata has loaded.
- **Play full video** ends the recording on the video's `ended` event; with a set duration, a timer ends it (independently of the video).
- **If the video file is missing** (or can't be loaded), the experimenter HUD shows a persistent warning and the session falls back to the plain countdown display.
- The video is not looped.
- Autoplay is enabled app-wide via the `autoplay-policy=no-user-gesture-required` Electron switch (in `main.js`), since playback is started by an IPC action from the experimenter window rather than a click inside the scene window itself.
