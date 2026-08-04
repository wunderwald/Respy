# trainingGameControl — Breath-Controlled Runner

A breath-controlled replica of the Chrome dino game. A 2D world scrolls left past a stick-figure character fixed at the left edge; white box obstacles approach at random intervals and each exhale onset makes the character jump. Colliding with an obstacle ends the run.

---

## Run

```bash
cd app && npm run trainingGameControl
```

Two windows open:
- **Scene window** — shown on the participant's screen (the runner)
- **Experimenter window** — your control panel

---

## Experimenter controls

| Control | What it does |
|---|---|
| **Stream selector** | Choose the resp LSL stream. Required before pressing Start. |
| **Start** | Begins the 3-second countdown then the run. |
| **Score** | Live count of obstacles successfully cleared. |

The scene window also shows a live **score** / **best** pair top-right (best score is tracked for the current app session only — it resets on restart), and the end screen shows `Score: X` / `Best score: X`.

---

## How it works

### Exhale detection → jump

Reuses the same rising-edge onset detector as `trainingGame` ([modules/signal/exhaleOnsetDetector.js](../modules/signal/exhaleOnsetDetector.js)): an onset fires when the normalised signal crosses `EXHALE_ONSET_THRESHOLD` from below, debounced by `EXHALE_DEBOUNCE_MS` so a single noisy crossing doesn't fire twice. Unlike `trainingGame`, the debounce here is tuned much shorter (400 ms vs. 1500 ms) so quick successive jumps aren't blocked — this game has no phase/success-ratio logic, an onset just triggers a jump if the character is currently grounded (no double-jump).

### Jump physics

A jump follows a simple parabolic arc over `JUMP_DURATION_MS`, peaking at `JUMP_HEIGHT_PX` at the midpoint, returning to the ground exactly at the end of the window.

### Obstacles

Spawned off the right edge of the screen at random intervals between `MIN_OBSTACLE_INTERVAL_MS` and `MAX_OBSTACLE_INTERVAL_MS`, then scroll left at `SCROLL_SPEED_PX_S`. A run ends the instant an obstacle's bounding box overlaps the character's (accounting for jump height). The game is endless — there is no fixed duration, matching the original Chrome dino game.

---

## Configuration

In [app/modules/trainingGameControl/trainingGameControl_config.js](../modules/trainingGameControl/trainingGameControl_config.js):

| Parameter | Default | Description |
|---|---|---|
| `SCROLL_SPEED_PX_S` | `320` | World scroll speed |
| `GROUND_Y_RATIO` | `0.78` | Ground line as a fraction of canvas height |
| `CHAR_X_RATIO` | `0.12` | Character's fixed x position as a fraction of canvas width |
| `CHAR_WIDTH` / `CHAR_HEIGHT` | `26` / `60` | Character bounding box (px) |
| `JUMP_HEIGHT_PX` | `150` | Jump apex height (px) |
| `JUMP_DURATION_MS` | `620` | Total jump air time (ms) |
| `OBSTACLE_WIDTH` | `22` | Obstacle width (px) |
| `OBSTACLE_HEIGHT_MIN` / `MAX` | `40` / `70` | Obstacle height range (px) |
| `MIN_OBSTACLE_INTERVAL_MS` | `900` | Minimum time between obstacle spawns |
| `MAX_OBSTACLE_INTERVAL_MS` | `2000` | Maximum time between obstacle spawns |
| `EXHALE_ONSET_THRESHOLD` | `0.40` | Signal level to detect start of exhale |
| `EXHALE_DEBOUNCE_MS` | `400` | Minimum ms between exhale detections |
| `CLOUD_COUNT` | `6` | Number of parallax background clouds |
| `CLOUD_SPEED_RATIO` | `0.35` | Cloud scroll speed as a fraction of `SCROLL_SPEED_PX_S` |

---

## Signal input

Any LSL stream pushing normalised `[0, 1]` floats. The signal is assumed to already be normalised — no in-game calibration is performed.

For testing, use the microphone streamer as resp input:

```bash
cd resp && python mic_breath.py              # microphone
```
