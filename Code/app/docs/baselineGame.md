# Baseline Game

**Placeholder frontend — no game design yet.** This is a scaffolded skeleton: it's launchable from the start screen and wired into the app the same way every other frontend is, but there's no actual game, no CSV output, and no subject field yet. Fill in the real design in [`modules/baselineGame/baselineGame.js`](../modules/baselineGame/baselineGame.js).

Intended as the "game" counterpart to [Baseline (video)](baseline.md) — a resting-state recording presented as a game rather than a video — but the specifics (mechanics, data to record) haven't been decided.

---

## Run

```bash
cd app && npm run baselineGame
```

Or select **Baseline Game** from the start screen (`npm start`).

---

## Current state

- **State machine**: `IDLE → PLAYING → DONE`, via Start/Abort in the experimenter window (also `Escape` to abort).
- **Scene**: a plain full-screen canvas showing "Baseline Game — coming soon" (idle), an elapsed-time counter (playing), or "Done".
- **`pushSample(value)`** is wired up but does nothing yet — the live signal isn't connected to anything on screen.
- **LSL markers**: `baselineGame_start`, `baselineGame_end`, `baselineGame_abort`, sent to `MARKER_STREAM_URL` (default `ws://localhost:9001`) — same convention as every other frontend. Configure in [`baselineGame_config.js`](../modules/baselineGame/baselineGame_config.js).
- **No data output yet** — nothing is written to disk.
