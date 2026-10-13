# web

Browser/React counterpart to `../app`'s breath-training games — built for tablets, with no lab stream infrastructure. Each game runs standalone (mic permission + calibration handled in the browser, or no input device at all for the tap game) and can be built either together behind a launcher or as a single isolated static bundle for flashing one tablet.

## Setup

```bash
npm install
```

## Run

```bash
npm run dev               # launcher — choose a game in the UI
npm run dev:trainingGame         # River Crossing (breath)
npm run dev:trainingGameControl  # River Crossing (Tap)
npm run dev:chromeDinoGame       # Breath Runner
```

## Build

```bash
npm run build                      # launcher + every game, one combined dist/
npm run build:trainingGame         # just that game, dist/trainingGame/ — no launcher, no other game's code
npm run build:trainingGameControl
npm run build:chromeDinoGame
```

The isolated per-game builds are what you deploy to a tablet meant to run only one game.

---

## Games

| Game | Input | Description |
|---|---|---|
| River Crossing | Mic (breath) | Blow into the mic to push a boat across a river against the current; sustained slow exhales entrain slow breathing. |
| River Crossing (Tap) | Touch/tap | Same boat/river/sheep scene and physics, but tapping fast enough (instead of blowing) pushes the boat — a mic-free control condition. |
| Breath Runner | Mic (breath) | Each exhale onset makes a runner jump over obstacles; difficulty ramps up gradually over a run. |

`trainingGame` and `trainingGameControl` share the same scene rendering and boat-physics model — see `src/shared/riverCrossing/`.

---

## Structure

```
src/
  launcher/          the picker page (index.html)
  shared/
    signal/          GaussianSmoother, RollingMean, ExhaleOnsetDetector
    mic/              useMicBreathSignal hook + the AudioWorklet envelope processor
    calibration/      MicCalibration — the "blow into the mic" calibration flow
    riverCrossing/    shared scene renderer + visual config (river/bank/sheep/boat/trees)
    ui/               GamePage (mic games) / TapGamePage (tap games) — shared page shells
  trainingGame/       River Crossing (breath) — game logic + config
  trainingGameControl/  River Crossing (Tap) — game logic + config
  chromeDinoGame/     Breath Runner — game logic + renderer + config
```

## Add a game

1. Create `src/<name>/<name>.js` exporting a class with:
   - `constructor({ sceneContainer, onStateChange })`
   - `start()` — called when the player taps while idle/game-over
   - either `pushSample(value)` (mic games — fed a normalized `[0,1]` breath signal) or `registerTap()` (tap games)
2. Create `src/<name>/<name>_config.js` and, if it's a new kind of game, its own renderer; if it's another River Crossing variant, reuse `shared/riverCrossing/RiverCrossingRenderer.js`.
3. Create `src/<name>/entry.jsx` mounting `GamePage` (mic) or `TapGamePage` (tap) with your class.
4. Create `<name>.html` at the project root, modeled on an existing one.
5. Add `<name>` to `GAMES` in `vite.config.js`.
6. Add `dev:<name>` / `build:<name>` scripts to `package.json`.
7. Add a card to `src/launcher/Launcher.jsx`'s `GAMES` list.
