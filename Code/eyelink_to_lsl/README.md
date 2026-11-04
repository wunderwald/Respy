# EyeLink → LSL Bridge

Connects an SR Research EyeLink eye tracker to LSL (Lab Streaming Layer). Gaze is published as normalised `[0.0, 1.0]` screen coordinates so any LSL consumer can work with it without knowing the display resolution.

---

## Requirements

| Package | Source |
|---|---|
| `pylink` | SR Research EyeLink Developer Kit — **not** the PyPI `pylink` package |
| `pylsl` | `pip install pylsl` |
| `psychopy` | `pip install psychopy` |
| `websockets` | `pip install websockets` — only needed to run `run_bridge.py`'s control API |

`pylink` ships as a compiled extension inside the EyeLink Developer Kit. Make sure its directory is on `PYTHONPATH` before importing.

> [!IMPORTANT]
> **PsychoPy needs its own virtual environment.** As of 2026, PsychoPy's PyPI metadata restricts it to `>=3.10, <3.13` — it will not install (or will misbehave) on a newer or older system Python. Don't install these requirements into your global/system Python or a shared project env. Instead, create a dedicated `.venv` inside `eyelink_to_lsl/` using Python 3.11.9, and always run the bridge (or any experiment script that imports it) through that venv.


---

## Hardware setup

```
PC 3 (EyeLink Host) ──Ethernet──► PC 1 (Experiment)
                                        ├─ Screen 1: Experimenter UI
                                        └─ Screen 2: Experiment display
                                                     (eye-tracking camera mounted here)
```

The default EyeLink link IP is `100.1.1.1`. Configure a static address on PC 1's tracking NIC to match (e.g. `100.1.1.2 / 255.255.255.0`).

---

## LSL stream

| Property | Value |
|---|---|
| Name | `GazeXY` |
| Type | `Gaze` |
| Channels | 2 — `x_norm`, `y_norm` |
| Format | `float32` |
| Rate | 500 Hz (nominal) |
| Missing / blink | `[-1.0, -1.0]` |

`x_norm` and `y_norm` are in `[0.0, 1.0]` where `(0, 0)` is the top-left corner of the experiment display.

---

## Quickstart

```python
from psychopy import visual
from eyelink_to_lsl import EyeLinkLSLBridge

# Open the experiment display on Screen 2
win = visual.Window(
    size=(1920, 1080),
    screen=1,           # 0-indexed; Screen 2 is index 1
    fullscr=True,
    units="pix",
)

bridge = EyeLinkLSLBridge(
    host_ip="100.1.1.1",
    screen_w=1920,
    screen_h=1080,
    window=win,         # used to draw calibration targets
    edf_filename="sub01",
)

bridge.connect()        # open tracker connection, register display
bridge.calibrate()      # show targets on Screen 2, operator confirms on PC 3
bridge.start()          # begin recording + LSL stream (non-blocking)

# --- run your experiment ---

bridge.stop()
bridge.disconnect()     # transfers EDF file to PC 1 and closes connection
```

---

## Setup mode, and skipping camera setup

`calibrate()` calls pylink's `doTrackerSetup()`, which puts the tracker into **setup mode** and blocks until the operator leaves it. Setup mode opens on the camera-setup screen. The operator then:

- presses **C** to show calibration targets,
- presses **V** to validate,
- presses **Enter** to accept,
- presses **Esc** to exit setup, which is when `calibrate()` returns.

The keys work on the Host PC, or on this PC while the calibration window has focus. The bridge reports these phases as states:

| State | Meaning |
|---|---|
| `setup` | In setup mode, waiting for the operator (camera setup) |
| `calibrating` | The first calibration/validation target has been drawn |
| `calibrated` | Setup mode exited |

`calibrate(start_calibration=True)` injects a **C** key press, exactly as if the operator pressed C on this PC, so the targets appear right away. The operator can still press Esc to get back to camera setup. `run_bridge.py` uses it as configured in `config.py`:

| Setting | Default | CLI override |
|---|---|---|
| `STARTUP_SKIP_CAMERA_SETUP` | `False`: the first calibration opens on camera setup, to adjust focus and thresholds | `--startup-skip-camera-setup` |
| `RECAL_SKIP_CAMERA_SETUP` | `True`: recalibrations from the app go straight to the targets | `--recal-camera-setup` |

Either way, the operator still has to accept and exit setup (Esc) on the Host PC.

**Ending a calibration without the operator.** Disconnecting the app doesn't affect a running calibration: the calibration window is part of the bridge and stays up until the operator exits setup. To stop the bridge in the middle of a calibration, send `shutdown` or press **Ctrl+C** in its console (press twice to force). Either one aborts setup mode via `abort_setup()`, which calls `exitCalibration()` and falls back to Esc key presses, then shuts down cleanly with the EDF transfer. An aborted calibration is reported as state `aborted`, and the tracker keeps its previous calibration.

## Recalibration mid-experiment

Call `recalibrate()` **from the thread that created the PsychoPy window** (normally the main thread):

```python
bridge.recalibrate()
```

It stops the pump, runs a calibration on Screen 2 (straight to targets by default; pass `start_calibration=False` to open on camera setup) (blocking until the operator accepts on PC 3), then resumes recording. The LSL outlet stays open; no samples are pushed during calibration, so it shows up as a gap in the stream.

Don't call it from a background thread (a WebSocket handler, the pump thread, an executor): on Windows the window's OpenGL context and message queue belong to the thread that created it, so a calibration driven from elsewhere draws nothing and receives no key presses. If commands arrive on another thread, queue them and run them on the main thread — that's what `run_bridge.py` does.

---

## Running the bridge as a controllable process

`run_bridge.py` wraps `EyeLinkLSLBridge` in a long-running process with a JSON-over-WebSocket control API, so experimenter tooling — e.g. apps in [`../app/`](../app/) — can drive calibration and recording without embedding pylink/PsychoPy itself. This mirrors the `ws://` control convention already used by [`../lsl_ws_bridge/`](../lsl_ws_bridge/).

On Windows, start it via the venv wrapper:

```bat
start_bridge.bat --edf-filename sub01
```

Or directly:

```bash
.venv/bin/python run_bridge.py --edf-filename sub01
```

On startup it opens the PsychoPy window and the control WebSocket (default `ws://localhost:9002`), then connects to the EyeLink Host, runs an initial calibration, and starts recording. Because the control socket is up first, clients see `connecting` / `calibrating` during startup instead of nothing. If startup fails, connected clients get an `error` message before the process exits. Defaults (host IP, screen size, ports, auto-calibrate/auto-start) live in `config.py`; see `--help` for the full list of overrides.

**Protocol** — client sends `{"type": "..."}`, server replies/broadcasts `{"type": "status", "state": ..., "recording": bool, ...}`:

| Command | Effect |
|---|---|
| `calibrate` | Recalibrate (`recalibrate()`): pauses and resumes recording around it if it was recording. Goes straight to the targets by default (see below). |
| `start` | Start recording (no-op if already recording). |
| `stop` | Stop recording (no-op if not recording). |
| `status` | Request an immediate status snapshot. |
| `shutdown` | Stop recording, transfer the EDF file, disconnect the tracker, and exit. If a calibration is running, it's cut short first. |

A status snapshot (`state` ∈ `idle`, `connecting`, `connected`, `setup`, `calibrating`, `calibrated`, `recording`, `stopped`, `disconnected`) is sent to every client on connect and broadcast to all connected clients whenever the bridge's lifecycle state changes — so a client doesn't need to poll to know when a recalibration it triggered has finished.

---

## Custom calibration display

If you are not using PsychoPy, implement the `CalibrationDisplay` protocol and pass it as `display`:

```python
class MyDisplay(pylink.EyeLinkCustomDisplay):
    def setup(self, tracker):
        pylink.openGraphicsEx(self)
    def teardown(self):
        pylink.closeGraphics()
    # implement draw_cal_target, clear_cal_display, get_input_key, ...

bridge = EyeLinkLSLBridge(
    host_ip="100.1.1.1",
    screen_w=1920,
    screen_h=1080,
    display=MyDisplay(),
)
```

`PsychopyCalibrationDisplay` draws a white filled circle with a black centre dot, forwards arrow/enter/escape key presses to the Host, and restores the background colour between targets. Adjust `TARGET_OUTER_RADIUS`, `TARGET_INNER_RADIUS`, `TARGET_COLOR_OUTER/INNER`, and `BG_COLOR` as class attributes if needed.

---

## EDF file

The EyeLink records a full-fidelity `.edf` file on PC 3 throughout the session. On `disconnect()`, the bridge transfers it to the working directory on PC 1 using `receiveDataFile()`. This file contains raw samples, events, and any messages sent via `tracker.sendMessage()` and serves as a ground-truth backup alongside your LSL recording.

---

## Key design notes

**Threading model.** The LSL pump runs in a background daemon thread and only reads samples. Everything that touches the PsychoPy window — `connect()`, `calibrate()`, `recalibrate()` — must run on the thread that created the window. `run_bridge.py` keeps all of that on the main thread and runs its WebSocket server in a background thread that just enqueues commands.

**`getNewestSample()` vs. event queue.** The pump polls `getNewestSample()` and pushes a sample only when its tracker timestamp changes. (`getNewestSample()` keeps returning the last sample until a new one arrives, so without that check each sample gets pushed thousands of times.) Under heavy CPU load polling can still miss the odd sample. If you need every sample (e.g. for microsaccade analysis), use the event queue instead:

```python
dt = self._tracker.getNextData()
if dt == pylink.SAMPLE_TYPE:
    sample = self._tracker.getData()
```

**Eye selection / binocular averaging.** Which eye(s) to track is configured on the Host PC; the bridge doesn't override `binocular_enabled`. Each sample is handled based on the eye data it actually carries (`isLeftSample()` / `isRightSample()`): when both eyes are present, `x_norm`/`y_norm` are their average; if one eye is missing, the valid one is used. If you need per-eye channels, add four channels (`lx`, `ly`, `rx`, `ry`) and skip the averaging in `_extract_gaze`.

**The calibration window stays backgrounded outside calibration.** `window` (Screen 2) is the same fullscreen display the experiment app (e.g. [`../app/`](../app/)) uses for its own window, so `PsychopyCalibrationDisplay` hides it as soon as `setup()` registers the display, and again as soon as `exit_cal_display()` fires at the end of a calibration/validation pass. It's only raised back to the foreground while `setup_cal_display()` has it (i.e. while pylink is actively drawing targets for the operator). This relies on the pyglet window handle PsychoPy's default backend exposes (`win.winHandle.set_visible(False)` / `.set_visible(True)` / `.activate()`). It hides the window rather than minimizing it, because on Windows pyglet's `set_visible(True)` doesn't restore a minimized window; on a backend without that handle it degrades silently to "window stays visible" rather than erroring.
