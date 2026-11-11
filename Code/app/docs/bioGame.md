# bioGame — Biofeedback Breath Game

A breath-controlled underwater game. The participant guides a puffer fish up and down by breathing, collecting starfish that drift across the screen along a target breath curve.

---

## Run

```bash
cd app && npm run bioGame
```

Two windows open:
- **Scene window** — shown on the participant's screen (fullscreen underwater world)
- **Experimenter window** — your control panel, can stay on the operator screen

---

## Experimenter controls

| Control | What it does |
|---|---|
| **Subject** | Type the subject code before pressing Start. Locked once calibration begins. Only letters, digits, `-` and `_` (empty = `TEST`); anything else shows a red hint under the field and disables Start. If data for this code already exists, an amber hint warns that Start will overwrite it (Start stays enabled). |
| **Group** | *Target (slow 6 BPM)* — fish follows a 6 BPM breath curve, starfish appear on that curve. *Control (natural)* — curve uses the participant's natural BPM (set the BPM field). |
| **Natural BPM** | Only visible in the natural condition. Sets the target curve frequency. Filled in automatically from the subject's **Resting** baseline (the average of the methods in `output_data/baseline/<subject>_baseline_resting_estimates.csv` within 4–25 BPM; older recordings without a name: `<subject>_baseline_estimates.csv`), re-checked whenever the subject code changes. Other baselines (Post slow, …) are never used. If that average is outside `NATURAL_BPM_RANGE` (currently **7–15 BPM**), it is not used: the field is set to the default `NATURAL_BPM` (currently **11 BPM**) and an amber ⚠ warning next to it shows the rejected average. Without a Resting baseline, the field also starts at `NATURAL_BPM`; enter the value manually if needed (a typed value is kept when the subject code changes and no baseline is found). |
| **Show target curve** | Overlays the sinusoidal target curve on screen (for debugging / operator monitoring). |
| **Cal secs** | How many seconds to calibrate the breath signal (default 10 s). Calibration captures the participant's breathing range. |
| **Smoothing** | Breath-smoothing window in samples: 64 (default), 128, 256, 512 or 1024. Locked once the session starts; recorded in the data. Larger = smoother fish but more delay — about half the window, so its length in seconds depends on the stream's sample rate (e.g. 1024 at 100 Hz ≈ 10 s window, ≈ 5 s delay). |
| **Retry calibration** | Appears only if calibration fails (no signal received, or the signal was flat). Restarts the calibration recording. |
| **Use default calibration** | Appears only if calibration fails. Skips to the ready state using `CONFIG.DEFAULT_CAL_RANGE` instead of a measured range. |
| **Data dir** | Folder where CSV files are saved. Click **…** to pick a different folder. Default: `bioGameData/` inside the app folder. |
| **Score** | Live count of starfish collected in the current game. |
| **Start** | Begins calibration. Requires a connected resp stream. |
| **Start game 1** | Appears on the explanation screen after calibration. Starts the game (also triggered by Space). |
| **Abort game** | Shown throughout the game (both groups). Ends the game and saves its data (`block_abort` event / marker); with one game that ends the task (`task_end_biogame`). Also triggered by Escape. |

There is only one scene, the ocean: it's always used (`bioGame_scene.js`, shared with beltTrainingGame).

**On screen during a game:** the time-left bar (top right) is shown in both groups; the score counter (top left) only in the slow/target group.

**Keyboard shortcuts** (experimenter window focused):
- `Space` — advance (explanation screens → calibration / game)
- `Escape` — abort current game

**Ending a session early:** close the window. Buffered frame rows and a `session_closed` event are written synchronously before it goes away (see [Data output](#data-output)).

**Frame-drop warning:** if the display renders fewer than `FRAME_DROP_WARN_RATIO` (90%) of `SIM_FPS` frames for `FRAME_DROP_WARN_SECS` (3) seconds in a row, a warning appears next to the controls and `frame_drop_warning` is logged; it stays until the next game starts.

---

## Timing

Gameplay runs on a **fixed-step simulation** at `SIM_FPS` (60) steps per second: game time is `frame / SIM_FPS`, and item movement, the target curve, `trial_<N>` markers, curve cues and the block end all use that clock. Steps are caught up to the wall clock from both the render loop and a 100 ms timer, so the game stays in real time even if rendering stalls or drops frames, and a game is always exactly `BLOCK_DURATION_SECS × SIM_FPS` steps.

**Render interpolation:** each drawn frame shows the game blended between the last two steps, by how far that frame falls between them. Motion is smooth on any refresh rate (60, 120, 144 Hz …), and the data rate stays `SIM_FPS` on every machine. The picture runs at most one step (~17 ms) behind the newest state.

**If the display can't keep up**, only the picture suffers: the game, markers and data stay in real time, but fewer steps are shown. The frame CSV's `drawn` column records which steps were on screen, and the frame-drop warning (above) flags sustained drops.

---

## Session flow

```
stream ready → [Start] → Explanation: "Let's get ready!"  → [Space / Next]
                              ↓
                         Calibration
                              ↓
                         Explanation: "Catch the stars!"  → [Space / Next]
                              ↓
                         Countdown (3-2-1-GO)
                              ↓
                         Game  (5 min)
                              ↓
                          Done screen
```

The task is **one game** (`NUM_BLOCKS: 1` in `bioGame_config.js`). The code still supports more: with `NUM_BLOCKS` > 1, an intermission screen (score of the finished game, Space / Next to continue) comes between the games, and the end screen adds a per-game breakdown.

Explanation screens for the child (large text, simple words) come before the calibration and before the task. They always wait for the experimenter (**Space** / **Next**), so the text can be read aloud. All wording is German, in [instructionTexts.js](../modules/instructions/instructionTexts.js); the game's other screen texts are in [bioGame_texts.js](../modules/bioGame/bioGame_texts.js).

---

## Sound

- **Ambience** loop plus a **noise** layer whose volume follows the avatar's height — both fade in/out per block.
- **Curve cue**: a one-shot sound every time the target curve reaches a **peak or minimum** as it passes the avatar (every half breath period; the minima coincide with the `trial_<N>` markers). For now it plays a random pick from the scene's former item-collect sounds (`sounds.collect` in [bioGame_scene.js](../modules/bioGame/bioGame_scene.js)); volume is `CURVE_CUE_VOLUME` in [bioGame_sound_config.js](../modules/bioGame/bioGame_sound_config.js).
- Collecting an item is **silent**.

---

## Signal input

Any LSL stream that pushes normalized `[0, 1]` floats is supported. The bridge auto-discovers streams — select one in the **resp stream** selector before pressing Start.

For testing without real hardware:

```bash
# Synthetic sine-wave breath
cd resp && python simulate_lsl.py --bpm 14

# or (better): mouse Y as breath
cd resp && python mouse_y_to_lsl.py
```

---

## Data output

Saved to `output_data/bio_game/<SUBJECT_CODE>/`.

### Frame data — `frameData_block<N>.csv` (N = 1, 2, …)

One row per simulation frame (`SIM_FPS`, 60 per second) during game N.

| Column | Description |
|---|---|
| `timestamp` | ISO-8601 wall-clock time the frame was simulated (frames caught up after a stall share a timestamp) |
| `blockIndex` | Game number, 1-based — always `1` with one game |
| `frame` | Simulation frame number within the game (1, 2, …) |
| `blockTime` | Game time in seconds, `frame / SIM_FPS` |
| `drawn` | `1` if a rendered frame showed this step as its newest state, `0` if the display skipped it (slow rendering, a stall, or the game's last step). At display rate ≈ `SIM_FPS`, an occasional `0` from timing jitter is normal. |
| `breathRaw` | Raw LSL sample |
| `breathSmoothed` | Gaussian-smoothed sample |
| `breathNorm` | Normalized to the current signal range, `[0, 1]` |
| `normMin`, `normMax` | Signal range (native units) used for `breathNorm` at this frame — calibrated, then drift-tracked (`RANGE_ADAPT`, see [calibration](calibration.md#adaptiverange)) |
| `avatarY` | Avatar vertical position `[0 = bottom, 1 = top]` |
| `targetY` | Target curve value at this frame |
| `itemCount` | Items currently on screen (not yet passed the avatar) |
| `smoothWindow` | Breath-smoothing window (samples) used in this session — the **Smoothing** control |

### Events — `eventData.csv`

Session settings rows: `target_bpm` (6 in the slow group, else the entered natural BPM), `natural_bpm_source` (where the natural-BPM field's value came from: `baseline` = Resting average, `fallback` = average outside `NATURAL_BPM_RANGE` so `NATURAL_BPM` was used, `manual` = typed by the experimenter, `default` = no usable baseline found, so `NATURAL_BPM` was used), `baseline_bpm` (the Resting average, empty if none was found; recorded even when out of range or overridden), `show_curve`, `calibration_secs`, `smooth_window`, `num_blocks`, `block_duration_secs`, `sim_fps`.

| Column | Description |
|---|---|
| `timestamp` | ISO-8601 wall-clock time |
| `blockIndex` | 1 / 2 / … (1-based); empty for session-level rows (`session_start`, `setting`, calibration) |
| `event` | `session_start`, `setting` (session settings, written right after `session_start`: value1 = name, value2 = value; a later `setting` row with the same name = changed mid-session), `calibration_complete` / `calibration_default_used` (value1 = range min, value2 = max), `calibration_failed`, `item_collect`, `item_miss`, `block_end`, `block_abort`, `frame_drop_warning`, `frame_drop_recovered`, `session_closed` |
| `value1` | Score at collect / block end — group for `session_start` — render ratio (0–1) for `frame_drop_*` — state the window was closed in for `session_closed` |
| `value2` | Block time in seconds at the event — scene for `session_start` |

---

## LSL markers

Sent to the WebSocket marker bridge (`ws://localhost:8765` by default). Enable/disable in `bioGame_config.js`:

```js
SEND_MARKERS:      true,
MARKER_STREAM_URL: 'ws://localhost:8765',
```

| Marker | Event |
|---|---|
| `instructions_cal_start` / `instructions_task_start` | explanation screen before calibration / before game 1 shown |
| `calibration_start` / `calibration_end` | calibration phase (re-sent for each retry attempt) |
| `calibration_failed` | calibration recorded no samples — experimenter is prompted to retry or use defaults |
| `calibration_default_used` | experimenter chose to skip to `CONFIG.DEFAULT_CAL_RANGE` after a failed calibration |
| `countdown_start_block1` | countdown before the game (game numbers are 1-based) |
| `block_start_1` | game begins |
| `block_end_1` | game ends normally |
| `block_abort_1` | game aborted (ends the task) |
| `trial_<N>` | target curve minimum — inhale onset; N increments from 1 |
| `item_collect_b<N>_s<score>` | item collected |
| `item_miss_b<N>` | item missed |
| `task_start_biogame` | Start pressed — session begins (before the calibration explanation) |
| `task_end_biogame` | last game finished (or aborted) — session complete |
| `task_abort_biogame` | window closed before the session was done (best effort — the marker connection may already be gone) |
