# iBreath — Interoception Sync/Async Experiment

Port of the MATLAB version of iBreath (`ibreath_main_v2.m`) to Electron. On each trial the participant views an animation that either tracks their breath in real time (synchronous) or plays back their own real-time breath signal after a delay (asynchronous). There are multiple variations of the experiment (interoception task, exteroception task, gaze-tracked task...).

---

## Run

```bash
cd app && npm run ibreath
```

Two windows open:
- **Scene window** — shown on the participant's screen (fullscreen cloud animation)
- **Experimenter window** — your control panel

---

## Experimenter controls

| Control | What it does |
|---|---|
| **Subject** | Subject code written to the CSV filename. Locked once calibration begins. |
| **Cal secs** | Calibration recording duration (default 10 s). |
| **Retry calibration** | Appears only if calibration fails (no signal received). Restarts the calibration recording. |
| **Use default calibration** | Appears only if calibration fails. Skips ahead using `CONFIG.DEFAULT_CAL_RANGE` instead of a measured range. |
| **Data dir** | Folder for CSV output. Default: `iBreathData/` inside the app folder. |
| **Use mixed questions** | Off by default — every trial asks the sync-detection question. When on, questions are mixed (see [Trial design](#trial-design)). |
| **Animation display** | Show a 5-second pre-trial animation before each trial begins. |
| **Start** | Begins calibration. Requires a connected resp stream. |
| **Next trial** | Visible when `AUTO_ADVANCE` is off — advances to the next trial. |
| **Abort** | Ends the current trial early (marks it `aborted = true` in CSV). |

Auto-advance, sync-detection questions, and the flashing-image stimulus are always on (`AUTO_ADVANCE` / `SHOW_QUESTIONS` / `FLASHING_IMAGE` in [config.js](./modules/ibreath/config.js)) and no longer exposed as experimenter controls.

**Keyboard shortcuts** (scene or experimenter window focused):
- `Space` — advance from READY state
- `Escape` — abort current trial
- `←` — sync-detection response: yes (animation was in sync)
- `→` — sync-detection response: no (not in sync)

---

## Session flow

```
stream ready → [Start] → Calibration (10 s)
                               ↓
                   [READY — Space or Auto-advance]
                               ↓
                     [DISPLAY — 5 s animation]  (if ANIMATION_DISPLAY=true only)
                               ↓
                      Trial (up to 30 s)
                               ↓
                   [RESPONSE — ← or →]           (skipped if trial aborted)
                               ↓
                      ITI (2–3 s jitter)
                               ↓
                   Repeat until 80 trials → Done
```

The state machine is: `IDLE → CALIBRATING → [READY] → [DISPLAY] → TRIAL → [RESPONSE] → ITI → … → DONE`

The `[READY]` step is skipped when `AUTO_ADVANCE` is on. The `[DISPLAY]` step is skipped when `ANIMATION_DISPLAY` is off. The `[RESPONSE]` step is skipped when the trial was aborted.

---

## Trial design

- **80 trials** per session, balanced in blocks of 2: 1 sync, 1 async.
- **Synchronous trials** — cloud animation tracks the Gaussian-smoothed breath signal, rescaled into `[0, 1]` using the calibration range (see [calibration](calibration.md)).
- **Asynchronous trials** — cloud tracks the participant's own real-time breath signal, delayed by the current adaptive delay (see [Async delay staircase](#async-delay-staircase) below), then rescaled the same way as sync trials.
- **Flash stimulus** (`FLASHING_IMAGE`) — a lightning image appears on 50 % of trials at a random time between `FLASH_TIME_MIN` and `FLASH_TIME_MAX` seconds into the trial.
- **Post-trial question** (`MIXED_QUESTIONS`) — after each non-aborted trial, a question is shown for up to `RESPONSE_TIMEOUT_SECS` seconds. Non-responses are recorded as `timeout`.
  - **Off (default)** — every trial asks the sync-detection question: "Was the fish in sync with your breathing?"
  - **On** — questions are mixed: ~50% sync-detection, ~16.7% each of flash-detection ("Did you see the pink fish flashing?"), left/right, and pufferfish/starfish, built from shuffled 6-trial blocks.

### Async delay staircase

Async trials play back the participant's own real-time breath signal, delayed by a running `currentDelayMs` value:

- **Range**: `MIN_DELAY_MS` (2000 ms) to `MAX_DELAY_MS` (3000 ms), in steps of `DELAY_STEP_MS` (200 ms).
- **Start**: `currentDelayMs` is reset to `MAX_DELAY_MS` at the start of every session (i.e. at Start / calibration).
- **Adaptation**: it only changes on the sync-detection question (`questionType === 'sync'`) asked after an **async** trial:
  - Answered **"no"** (correctly identified as out of sync) → `currentDelayMs` decreases by `DELAY_STEP_MS` (harder next time).
  - Answered **"yes"** (mistaken for in sync) → `currentDelayMs` increases by `DELAY_STEP_MS` (easier next time).
  - **Timeout**, or any other question type (`flash`/`lr`/`img` when `MIXED_QUESTIONS` is on), leaves it unchanged.
  - The value is always clamped to `[MIN_DELAY_MS, MAX_DELAY_MS]`.
- The delay used for a given trial is fixed at the start of that trial and recorded in `trialData.csv` as `delayMs`.
- The current value is shown live in the experimenter HUD's **delay** readout, updated whenever the staircase steps.

---

## Configuration flags

Flags in [app/modules/ibreath/config.js](./modules/ibreath/config.js):

| Flag | Default | Effect |
|---|---|---|
| `AUTO_ADVANCE` | `true` | Skip READY state between trials |
| `SHOW_QUESTIONS` | `true` | Show a post-trial response screen after each trial |
| `MIXED_QUESTIONS` | `false` | `false`: every trial asks the sync-detection question. `true`: mix in flash/left-right/image questions. Exposed as the "use mixed questions" experimenter checkbox. |
| `FLASHING_IMAGE` | `true` | Enable lightning flash on 50 % of trials |
| `ANIMATION_DISPLAY` | `true` | Show 5-second pre-trial animation |
| `SEND_MARKERS` | `true` | Send LSL markers via WebSocket |
| `DEBUG_GAZE` | `false` | Overlay gaze position dot on scene |
| `MAX_NUM_TRIALS` | `80` | Total trial count |
| `MAX_TRIAL_TIME` | `30` | Trial auto-ends after this many seconds |
| `CALIBRATION_SECS` | `10` | Duration of the calibration recording |
| `MIN_DELAY_MS` | `2000` | Lower bound of the async delay staircase |
| `MAX_DELAY_MS` | `3000` | Upper bound of the async delay staircase; also its starting value each session |
| `DELAY_STEP_MS` | `200` | Step size the async delay staircase moves by per sync-question response (see [Async delay staircase](#async-delay-staircase)) |

---

## Data output

Saved to `iBreathData/<SUBJECT_CODE>/` (or your chosen data dir).

### Trial data — `trialData.csv`

One row per trial, appended after each trial ends (or after the response screen).

| Column | Description |
|---|---|
| `trialIndex` | 0-based trial number |
| `subject` | Subject code |
| `questionType` | `sync`, `flash`, `lr`, or `img` — which post-trial question was asked. Always `sync` unless `MIXED_QUESTIONS` is on (see [Trial design](#trial-design)) |
| `synchronous` | `true` / `false` |
| `img` | Cloud image variant used |
| `lr` | Cloud starting side (`left` / `right`) |
| `stimX0`, `stimY0` | Cloud start position (normalised 0–1) |
| `stimX1`, `stimY1` | Cloud end position (normalised 0–1) |
| `delayMs` | Async delay applied to this trial (ms), or empty (sync trials) — see [Async delay staircase](#async-delay-staircase) |
| `ITI` | Inter-trial interval in ms |
| `startTime` | ISO-8601 trial start time |
| `endTime` | ISO-8601 trial end time |
| `aborted` | `true` if experimenter pressed Abort |
| `response` | `yes`/`no` (`sync`/`flash` questions), `left`/`right` (`lr`), `pufferfish`/`starfish` (`img`), or `timeout` |
| `flashImage` | Image name or empty — only when `FLASHING_IMAGE` is on |
| `flashScheduledTime` | Seconds into trial when flash was scheduled |
| `flashX`, `flashY` | Flash position (normalised 0–1) |
| `flashShown` | `true` if the flash actually fired before trial ended |

### Frame data — `frameData_<N>.csv`

One row per update tick (~16 ms) during trial N.

| Column | Description |
|---|---|
| `trialIndex` | Trial number |
| `timestamp` | ISO-8601 wall-clock time |
| `breathLevel_input` | Raw LSL sample |
| `breathLevel_scaled` | Same as input (scaling pipeline pass-through) |
| `stimulusLevel` | Stimulus level sent to renderer (0–1) |
| `flashActive` | `1` while flash is on screen — only when `FLASHING_IMAGE` is on |
| `gazeX`, `gazeY` | Gaze coordinates in pixels — only when gaze stream is connected |

---

## LSL markers

Sent to `MARKER_STREAM_URL` (default `ws://localhost:9001`).

| Marker | Event |
|---|---|
| `calibration_start` | Calibration begins (re-sent for each retry attempt) |
| `calibration_end` | Calibration recording window ends |
| `calibration_failed` | Calibration recorded no samples — experimenter is prompted to retry or use defaults |
| `calibration_default_used` | Experimenter chose to skip ahead using `CONFIG.DEFAULT_CAL_RANGE` after a failed calibration |
| `display_start_t<N>` | Pre-trial animation starts for trial N |
| `trial_start_t<N>` | Trial N begins |
| `trial_end_t<N>` | Trial N ends normally |
| `trial_abort_t<N>` | Trial N aborted by experimenter |
| `response_start_t<N>` | Response screen shown after trial N |
| `response_yes_t<N>` | Participant responded "yes, in sync" |
| `response_no_t<N>` | Participant responded "no, not in sync" |
| `response_timeout_t<N>` | Response timed out |
| `flash_start_t<N>` | Flash stimulus appears |
| `flash_end_t<N>` | Flash stimulus disappears |
| `iti_start_t<N>` | ITI begins after trial N |
| `experiment_done` | All trials complete |

---

## Signal input

Any LSL stream is supported — the raw signal doesn't need to already be normalised. It's rescaled into `[0, 1]` using the calibration-derived range (see [calibration](calibration.md)), the same way bioGame does.

For testing, use:

```bash
cd resp && python simulate_lsl.py --bpm 14   # synthetic sine wave
```

An optional second gaze stream is read from `GAZE_STREAM_URL` (`ws://localhost:8766` by default). Connect a stream that pushes `[gazeX, gazeY]` pixel coordinates. If no gaze stream is connected, gaze columns are omitted from the CSV.
