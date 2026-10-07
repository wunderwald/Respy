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
| **Signal type** | *Physiological* (default) or *Peaks only* — see [Input signal types](#input-signal-types) below. Locked immediately if a loaded preset defines it, otherwise locked once calibration begins. |
| **Preset** | *None (sync only)* (default), one of the bundled presets, or *Browse…* for any other preset file — see [Presets](#presets) below. |
| **Animation display** | Show a 5-second pre-trial animation before each trial begins. |
| **Use eye tracking** | Off by default. When on, reveals a shared group with the rest of the eye-tracking controls and status — see [Eye tracking](#eye-tracking-eyelink) below. Locked immediately if a loaded preset defines it. |
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
- **Post-trial question** (`CONFIG.QUESTIONS`) — after each non-aborted trial, a question is shown for up to `RESPONSE_TIMEOUT_SECS` seconds. Non-responses are recorded as `timeout`. Which question(s) can appear, in what mix, is defined by `CONFIG.QUESTIONS` — either the built-in default (100% `sync`) or a loaded preset's `questions` list. See [Presets](#presets) for the full mechanism.

### Async delay staircase

Async trials play back the participant's own real-time breath signal, delayed by a running `currentDelayMs` value:

- **Range**: `MIN_DELAY_MS` (2000 ms) to `MAX_DELAY_MS` (3000 ms), in steps of `DELAY_STEP_MS` (200 ms).
- **Start**: `currentDelayMs` is reset to `MAX_DELAY_MS` at the start of every session (i.e. at Start / calibration).
- **Adaptation**: it only changes on the `sync` question (`questionType === 'sync'`) asked after an **async** trial:
  - Answered **"no"** (correctly identified as out of sync) → `currentDelayMs` decreases by `DELAY_STEP_MS` (harder next time).
  - Answered **"yes"** (mistaken for in sync) → `currentDelayMs` increases by `DELAY_STEP_MS` (easier next time).
  - **Timeout**, or any other question type, leaves it unchanged.
  - The value is always clamped to `[MIN_DELAY_MS, MAX_DELAY_MS]`.
  - **This requires a `sync` entry in the active question set with answers `['yes', 'no']`.** If a loaded preset's `questions` omit `sync` entirely, the delay has nothing to drive it and will sit at `MAX_DELAY_MS` all session — the experimenter HUD shows a warning next to the preset selector in that case.
- The delay used for a given trial is fixed at the start of that trial and recorded in `trialData.csv` as `delayMs`.
- The current value is shown live in the experimenter HUD's **delay** readout, updated whenever the staircase steps.

---

## Configuration flags

Flags in [app/modules/ibreath/config.js](./modules/ibreath/config.js):

| Flag | Default | Effect |
|---|---|---|
| `AUTO_ADVANCE` | `true` | Skip READY state between trials |
| `SHOW_QUESTIONS` | `true` | Show a post-trial response screen after each trial |
| `QUESTIONS` | `[{ id: 'sync', ... , probability: 1 }]` | The active question set. Replaced wholesale by a loaded preset's `questions` list — see [Presets](#presets). |
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
| `questionType` | The `id` of the question asked — one of the active question set's ids (built-in default: always `sync`; see [Presets](#presets) for custom sets) |
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
| `response` | One of that trial's question's two `answers` labels (e.g. `yes`/`no`, `left`/`right`, `pufferfish`/`starfish`), or `timeout` |
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

### Input signal types

The experimenter's **Signal type** control selects how the raw stream is turned into the real-time value that calibration, the sync display, and the async delay line all read — everything *after* that point (calibration, trial logic, CSV columns, markers) is identical for both types.

- **Physiological** (default) — a continuous breath-like signal, Gaussian-smoothed over `SMOOTH_WINDOW` samples, same as always.
- **Peaks only** — for a sparse signal that's a constant baseline with brief, distinct spikes (e.g. AD Instruments' fast-response/peak-detect ECG output from LabChart, streamed to LSL). Every detected peak triggers a short swell-then-fade pulse instead of running the raw signal through the Gaussian smoother, so it reads as one plucky "heartbeat" per peak:
  - **Peak detection** is an adaptive rising-edge threshold: it tracks the lowest and highest raw values seen so far and fires on every upward crossing of the point `PEAK_CROSS_FRACTION` of the way between them — no fixed voltage/unit threshold needed, and no refractory period. Assumes a genuinely clean signal (constant baseline, distinct peaks); if that doesn't hold in practice, the detector needs rework, not just retuning.
  - **The pulse shape**: `PEAK_SWELL_MS` (default 80 ms) to rise to full level, then `PEAK_FADE_MS` (default 260 ms) to decay back to 0. A peak that arrives before the previous pulse has fully faded simply restarts the swell from the envelope's current level — no special-casing, since the signal is assumed clean enough that this shouldn't normally happen.
  - Unlike the Gaussian smoother, the envelope is **not** reset between trials (there's no window to re-seed, and resetting could clip a pulse mid-trial-transition) — it runs continuously across the whole session, only reset at Start.
  - All three constants live in [config.js](./modules/ibreath/config.js) and can be retuned without touching the detection/envelope logic itself.

---

## Presets

A preset is a JSON file that bundles a set of iBreath settings — the experimenter's **Preset** control loads one from the dropdown (six are shipped under [`presets/`](../presets/)) or via its **Browse…** option (any `.json` file, through a native file picker). Loading a preset immediately pre-fills and **locks** every control it defines, right away — not deferred to Start — while leaving anything it doesn't mention free for the experimenter to set as usual. Switching to a different preset (or back to **None (sync only)**) re-applies this: fields the new selection doesn't define become editable again.

### File format

```json
{
  "name": "iBreath_adults",
  "description": "optional human-readable blurb",
  "inputSignalType": "physiological",
  "useEyeTracking": true,
  "questions": [
    { "id": "sync",        "probability": 0.8, "text": "Was the fish in sync with your breathing?", "answers": ["yes", "no"] },
    { "id": "placeholder", "probability": 0.2, "text": "Placeholder question — replace before use", "answers": ["yes", "no"] }
  ],
  "configOverrides": { "PEAK_SWELL_MS": 80 }
}
```

Every field is optional except `questions`' internal shape (if `questions` is present at all, each entry needs `id`/`text`/`answers`/`probability`):

| Field | Effect |
|---|---|
| `inputSignalType` | `'physiological'` or `'peaksOnly'` — pre-fills and locks the **Signal type** control. Omit to leave it to the experimenter. |
| `useEyeTracking` | `true` or `false` — pre-fills and locks the **Use eye tracking** checkbox (and applies it immediately, same as checking it by hand). Omit (or `null`) to leave it to the experimenter. |
| `questions` | Replaces `CONFIG.QUESTIONS` wholesale for the session (applied at Start). Omit to keep the built-in default (100% `sync`). |
| `configOverrides` | Arbitrary `key: value` pairs applied directly onto `CONFIG` at Start (after resetting CONFIG to its hardcoded defaults, so a previous session's preset never silently lingers). Any key in [config.js](./modules/ibreath/config.js) can be overridden this way — this is how the iBeat presets carry their peak-envelope timings. |

**Question entries** (`questions[i]`):

| Field | Meaning |
|---|---|
| `id` | Stable identifier — used by the adaptive delay logic (`questionType === 'sync'`), CSV (`questionType` column), and markers. **Not** translated; invent new ids freely (e.g. `placeholder`) but keep `sync` as `sync` if you want one. |
| `text` | The prompt shown on screen. Freely overridable per preset — e.g. for translations — even for `sync`/`flash`/`lr`/`img`'s built-in ids. |
| `answers` | `[leftLabel, rightLabel]` — what ← and → record as `response`. **A `sync`-id question must use `['yes', 'no']`** for the adaptive delay staircase to make sense. |
| `probability` | This question's share of trials, as a fraction (all entries' probabilities should sum to ~1). Realized via the smallest shuffled block that reproduces the given probabilities exactly (e.g. 0.8/0.2 → a 5-trial block of 4×this + 1×that) — see [Trial design](#trial-design). Built separately for sync and async trials, so both see the same mix, not just the combined pool overall. |

If the resulting question set has no `sync`-id entry, the experimenter HUD shows a warning next to the preset selector (the adaptive delay has nothing to drive it in that case — see [Async delay staircase](#async-delay-staircase)).

The `img` id keeps its special image-based answer rendering (pufferfish/starfish sprites instead of text) regardless of what `answers` says; every other id (including custom ones like `placeholder`) renders as plain "← leftLabel          rightLabel →" text. The `flash` id also keeps its small pink-fish icon in the prompt.

### Bundled presets

| File | Signal type | Questions | Eye tracking |
|---|---|---|---|
| `iBreath_mixed_questions` | Physiological | Mixed: 50% sync, ~16.7% each flash/lr/img | Left to experimenter |
| `iBreath_only_sync_question` | Physiological | 100% sync | Left to experimenter |
| `iBreath_adults` | Physiological | 80% sync, 20% placeholder | Activated |
| `iBeat_mixed_questions` | Peaks only | Mixed: 50% sync, ~16.7% each flash/lr/img | Left to experimenter |
| `iBeat_only_sync_question` | Peaks only | 100% sync | Left to experimenter |
| `iBeat_adults` | Peaks only | 80% sync, 20% placeholder | Activated |

The `iBeat_*` presets' `configOverrides` carry today's default `PEAK_SWELL_MS`/`PEAK_FADE_MS`/`PEAK_CROSS_FRACTION` explicitly, so they stay self-contained if those defaults ever change in `config.js`. The `_adults` presets' `placeholder` question is an intentional stand-in — replace its `text`/`answers` before using that preset for a real session.

---

## Eye tracking (EyeLink)

Checking **Use eye tracking** reveals a shared group in the experimenter controls with everything eye-tracking-related: the **show gaze position** checkbox, the **Recalibrate gaze** button, and a live **eye tracker** status readout (the EyeLink bridge's own lifecycle state — `connected`, `calibrating`, `calibrated`, `recording`, `stopped`, or `disconnected`). The group stays hidden while eye tracking is off.

iBreath talks to the EyeLink tracker via the [`eyelink_to_lsl`](../../eyelink_to_lsl/README.md) bridge, over two separate connections:

- `EYELINK_CONTROL_URL` (`ws://localhost:9002` by default) — the control channel (`modules/stream/eyelinkControl.js`) used to trigger calibration and receive the status broadcasts shown in the group above.
- `GAZE_STREAM_URL` (see [Signal input](#signal-input) above) — the actual gaze samples, forwarded the same way the resp signal is.

**Networking**: the EyeLink Host and the PC running this app communicate over a dedicated link (default Host IP `100.1.1.1`). The PC's tracking NIC must be given a **static IP on the same `100.1.1.x` subnet** (e.g. `100.1.1.2 / 255.255.255.0`) — without it, the bridge cannot connect to the tracker at all. See the bridge's own README for the full hardware setup.

**Fullscreen windows don't fight each other.** The bridge's calibration window shares Screen 2 with this app's own fullscreen scene window. The bridge keeps its window minimized except while it's actually drawing calibration targets (see "Key design notes" in the bridge's README); on this app's side, `#beginEyeCalibration()`/`#finishEyeCalibration()` minimize and restore the scene window around every recalibration for the same reason.
