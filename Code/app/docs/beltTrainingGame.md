# Belt Training Game

Gets children used to controlling the on-screen fish avatar with a respiration belt, before they play the main [BioGame](bioGame.md). Reuses BioGame's "ocean" visuals and its calibration/range-adaptation pipeline (see [`sceneRenderer.js`](../modules/bioGame/sceneRenderer.js) and [`calibration.js`](../modules/calibration/calibration.js)) so improvements to either apply to both frontends.

---

## Run

```bash
cd app && npm run beltTrainingGame
```

Or select **Belt Training Game** from the start screen (`npm start`).

---

## Trial structure

The game runs `NUM_TRIALS` trials (default **9**). Each trial has two phases, both using the **same randomly chosen target y-position**:

1. **Training phase** — the target zone (red/yellow/green/yellow/red bands, see screenshot concept) is visible, and so is the fish. The player's goal is to hold their breath level inside the **green** band for the duration of the target crossing.
2. **Test phase** — the target zone is covered by a drifting bubble overlay, and the fish **disappears** while crossing that zone. The player must reproduce the same breath level as in the training phase, blind.

Before each trial there is a **READY** screen: the fish is driven live by the participant's own breath (exactly like gameplay — `AVATAR_SIZE_MIN/MAX`-sized, tilt and all), with the caption "See how your breath moves the fish!", so the child sees the connection before the trial starts. The experimenter must press **Space** (or click **Next trial**) to continue — once per trial, not once per phase — unless **auto-proceed** is on (see below), in which case this screen is skipped entirely. A **3-2-1-GO countdown** (`COUNTDOWN_SECS`, default 3.75s) automatically precedes *each* phase — both right after READY and again between the training and test phase — showing the same "three fish bopping" animation iBreath shows before its trials (see [`animationDisplay.js`](../modules/ibreath/animationDisplay.js)) with the countdown number overlaid on top. The transition from the training phase to the test phase within a trial is otherwise automatic (no extra Space press).

During each phase, a caption reminds the participant what to do: **"Hold your breath in the green area!"** in the training phase, **"Hold your breath just like before!"** in the test phase (where the target is hidden).

In both phases the fish travels left → right through three timed segments:

| Segment | Duration constant | Behaviour |
|---|---|---|
| Approach | `APPROACH_DURATION_MS` (4000ms) | fish travels from off-screen left to the target zone |
| Target crossing | `TARGET_AREA_DURATION_MS` (3000ms) | fish crosses the (narrow) target zone slowly |
| Exit | `EXIT_DURATION_MS` (1500ms) | fish exits quickly, off-screen right |

The target zone spans `TARGET_X_START`–`TARGET_X_END` (default 0.55–0.82 of canvas width, a wide band). Given the durations above, the fish's exit speed is always clearly faster than its target-crossing speed (≈1.9x with the defaults) — matching the "fast on exit" requirement; its approach speed is comparable to its target speed.

**No scoring or feedback UI** is shown to the participant, by design — this is a pure practice tool. Performance is recorded to CSV only (see below).

---

## Target geometry

The target centre y-position is randomized per trial (uniformly within `[TARGET_Y_MIN, TARGET_Y_MAX]`, default `[0.25, 0.75]` of the play area) and reused for both phases of that trial. Three nested bands are drawn around that centre, by half-height:

- `TARGET_HEIGHT` (green, default 0.090) — the "hold" zone
- `TARGET_HEIGHT_YELLOW` (default 0.135)
- `TARGET_HEIGHT_RED` (default 0.195)

Whether the breath signal was inside the green band is tracked continuously during the target-crossing segment of each phase and logged as a fraction (see CSV below) — there's no hard pass/fail cutoff.

---

## Experimenter controls

| Control | Description |
|---|---|
| Subject code | Text field, locked once calibration starts |
| Auto-proceed | Checkbox, toggleable any time (never locked). When on, READY screens are skipped and trials chain automatically — no Space/Next trial needed between them |
| Cal secs | Calibration duration in seconds (settings bar) |
| Start | Begins calibration (enabled once the resp stream is connected) |
| Retry calibration / Use default calibration | Shown only if calibration fails (flat/no signal) |
| Next trial | Shown during the READY screen (hidden entirely if auto-proceed is on); same action as pressing **Space** |
| Abort | Ends the session immediately (available from READY, during the countdown, or during either phase) — also bound to **Escape** |
| **Press SPACE to continue** badge | Mirrors the **Next trial** button's visibility |

The resp stream selector is never locked, even once other controls lock, so the experimenter can recover from a dropped stream mid-session (see [stream.md](stream.md)).

There is no scene or group selector — the scene is fixed to "ocean."

---

## Markers

Sent to `MARKER_STREAM_URL` (default `ws://localhost:9001`), one per trial index `N` (0-based):

- `calibration_start` / `calibration_end` / `calibration_failed` / `calibration_default_used`
- `trial_start_tN` / `trial_end_tN`
- `training_start_tN` / `training_end_tN`
- `test_start_tN` / `test_end_tN`
- `target_enter_tN` / `target_leave_tN` — fired once per phase (so twice per trial); which phase it belongs to is inferred from its position relative to the `training_*`/`test_*` markers around it
- `trial_abort_tN` (on Abort)
- `experiment_done`

---

## Data output

Written to `output_data/belt_training_game/<subjectCode>/`:

- **`eventData.csv`** — `timestamp,trialIndex,phase,event,value1,value2`
  - `session_start` (value1 = scene id)
  - `target_leave` (value1 = fraction of the target-crossing segment spent inside the green band, `0`–`1`)
  - `trial_end`, `trial_abort`
- **`frameData_trial<N>.csv`** — one file per trial, ~20fps, `timestamp,trialIndex,phase,segment,breathRaw,breathSmoothed,breathNorm,normMin,normMax,fishX,fishY,targetY`
  - `phase` is `training` or `test`; `segment` is `approach`, `target`, or `exit`
  - `fishX`/`fishY` and `targetY` are normalized canvas fractions (`targetY` is the trial's fixed target centre, repeated on every row for convenience)

---

## Implementation notes

- Calibration and range-adaptation (`RespCalibration`, `AdaptiveRange`) are the same classes BioGame uses, with the same config fields (`RANGE_ADAPT`, `RANGE_WINDOW_SECS`, etc.) — see [calibration.md](calibration.md).
- Visuals (background texture, fish sprite) are drawn via the shared [`SceneRenderer`](../modules/bioGame/sceneRenderer.js), also used by BioGame's renderer — changes to the ocean scenery or fish sprite apply to both frontends automatically.
- All config is in [`beltTrainingGame_config.js`](../modules/beltTrainingGame/beltTrainingGame_config.js).
