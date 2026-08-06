# trainingGame — River Crossing

A breath-controlled ferry game. A ship starts on the right bank, picks up a sheep, and needs to cross to the left bank against a river current. Blowing into the mic pushes the boat left; pausing lets the current drift it back right. Each delivered sheep scores a point. The boat then drifts back on its own to pick up the next one.

---

## Run

```bash
cd app && npm run trainingGame
```

Two windows open:
- **Scene window** — shown on the participant's screen (river, boat, banks)
- **Experimenter window** — your control panel

---

## Experimenter controls

| Control | What it does |
|---|---|
| **Stream selector** | Choose the resp LSL stream. Required before pressing Start. |
| **Start** | Begins the 3-second countdown then the game. |
| **Score** | Live count of sheep delivered to the left bank. |

---

## How it works

### Boat physics

The boat's position is a single continuous value `boatPos` in `[0, 1]` (0 = docked right, 1 = docked left):

- While the (smoothed, thresholded) breath signal is above `BLOW_THRESHOLD`: `boatPos += FORWARD_SPEED · dt` (toward the left bank).
- Otherwise: `boatPos -= CURRENT_SPEED · dt` (the current drifts it back toward the right bank).

This single rule governs both legs of the trip — no separate "returning" state is needed. `FORWARD_SPEED` is derived from `TARGET_BPM` so that one sustained half-breath-period exhale crosses the full distance:

```
halfPeriodSec = (60 / TARGET_BPM) / 2
FORWARD_SPEED = 1 / halfPeriodSec
CURRENT_SPEED = FORWARD_SPEED * CURRENT_SPEED_FACTOR   (gentler — CURRENT_SPEED_FACTOR < 1)
```

There's no hard success/fail gate — any pause in blowing just costs proportional ground, which the player makes up with more blowing. This deliberately entrains slow, sustained breathing without punishing imperfect pacing.

### Blow detection

The raw signal is smoothed with a `GaussianSmoother` (window `SMOOTH_WINDOW`) before thresholding, and the on/off decision uses hysteresis (`BLOW_HYSTERESIS`) around `BLOW_THRESHOLD` to avoid the boat/sail flickering on noisy input.

### Delivery / pickup

When `boatPos` reaches `1` with a sheep aboard: score increments, the sheep is delivered (drawn on the left bank), and the boat becomes empty. When `boatPos` returns to `0` while empty, it picks up a new sheep from the right bank — a small flock that's always available there, it never runs out.

### Timer

A `GAME_DURATION_SECS` (default 180s / 3 minutes) countdown starts once the 3-2-1-GO countdown ends. The game ends and shows the final score when it reaches 0.

---

## Configuration

In [app/modules/trainingGame/trainingGame_config.js](../modules/trainingGame/trainingGame_config.js):

| Parameter | Default | Description |
|---|---|---|
| `TARGET_BPM` | `6` | Sets the boat's forward speed via half the breath period |
| `GAME_DURATION_SECS` | `180` | Total game length in seconds |
| `BLOW_THRESHOLD` | `0.40` | Smoothed signal level counted as "blowing" |
| `BLOW_HYSTERESIS` | `0.05` | Gap between on/off thresholds, avoids flicker |
| `SMOOTH_WINDOW` | `16` | GaussianSmoother window (samples) |
| `CURRENT_SPEED_FACTOR` | `0.65` | Current (drift-back) speed relative to forward (blow) speed |
| `SHEEP_COUNT_RIGHT` | `4` | Size of the always-available flock on the right bank |
| `SHEEP_MAX_SHOWN_LEFT` | `24` | Cap on delivered-sheep icons drawn on the left bank |

---

## Signal input

Any LSL stream pushing normalised `[0, 1]` floats. The signal is assumed to already be normalised — no in-game calibration is performed.

For testing, use the microphone streamer as resp input:

```bash
cd resp && python mic_breath.py              # microphone
```
