# trainingGame

> Being redesigned — the previous cloud/sun concept has been removed. The module currently only contains bare scaffolding (state machine, HUD wiring, render loop) with no game content yet.

---

## Run

```bash
cd app && npm run trainingGame
```

Two windows open:
- **Scene window** — shown on the participant's screen
- **Experimenter window** — your control panel

---

## Experimenter controls

| Control | What it does |
|---|---|
| **Stream selector** | Choose the resp LSL stream. Required before pressing Start. |
| **Start** | Begins the 3-second countdown then the game. |
| **Score** | Live score, once implemented. |

---

## Signal input

Any LSL stream pushing normalised `[0, 1]` floats. The signal is assumed to already be normalised — no in-game calibration is performed.

For testing, use the microphone streamer as resp input:

```bash
cd resp && python mic_breath.py              # microphone
```
