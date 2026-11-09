"""
eyelink_to_lsl.py
=================
Reads gaze samples from an EyeLink tracker via pylink and publishes them
as normalised [0.0, 1.0] screen coordinates on an LSL outlet.

LSL stream spec
---------------
  Name     : "GazeXY"
  Type     : "Gaze"
  Channels : 2  ->  [x_norm, y_norm]
               x: 0.0 = left edge,  1.0 = right edge
               y: 0.0 = top edge,   1.0 = bottom edge
  Format   : float32
  Rate     : nominal 500 Hz (matches tracker sample_rate command)

Missing / blink samples are pushed as [-1.0, -1.0].

Calibration
-----------
Calibration visuals are drawn on the experiment display via
PsychopyCalibrationDisplay (or any CalibrationDisplay you provide).
Pass the PsychoPy window to the bridge at construction time.
Recalibrate mid-session via bridge.recalibrate() — call it from the thread
that created the window (normally the main thread); OpenGL contexts and the
Win32 message queue are bound to that thread.
"""

import logging
import threading
import time
from typing import Callable, Protocol, runtime_checkable

import pylink # !!! SR Research EyeLink Developer Kit (NOT the PyPI pylink package)
from pylsl import StreamInfo, StreamOutlet, local_clock

log = logging.getLogger(__name__)

MISSING_VAL: float = -1.0

# Eye / missing-data codes from the EyeLink C API (eye_data.h).  Recent pylink
# releases no longer export these as module attributes, so fall back to the
# documented values.
LEFT_EYE: int = getattr(pylink, "LEFT_EYE", 0)
RIGHT_EYE: int = getattr(pylink, "RIGHT_EYE", 1)
BINOCULAR: int = getattr(pylink, "BINOCULAR", 2)
MISSING_DATA: int = getattr(pylink, "MISSING_DATA", -32768)
NOMINAL_RATE: float = 500.0


# ---------------------------------------------------------------------------
# Calibration display protocol
# ---------------------------------------------------------------------------

@runtime_checkable
class CalibrationDisplay(Protocol):
    """
    Minimal interface the bridge needs from a calibration display.
    Implement this to use a renderer other than PsychoPy.

    Optional hooks. The bridge looks them up with getattr(), so a display
    without them still works but loses the matching feature.
    PsychopyCalibrationDisplay implements all of them; copy from there:

      begin_setup(start_calibration: bool) -> None
          Called right before doTrackerSetup(). Must reset per-setup state,
          including an earlier abort request, and if `start_calibration` is
          set, inject a 'c' key press. Without it: no auto-start of calibration.
      end_setup() -> None
          Called after doTrackerSetup() returns, and also when setup is
          aborted or skipped. Must clear the abort request so later pylink
          calls stop receiving Esc.
      request_abort() -> None
          Thread-safe and safe to call from a signal handler: only set a
          flag, then act on it from get_input_key() (exitCalibration() / Esc)
          on the main thread. Without it, `shutdown` / Ctrl+C can't end a
          running setup; the operator has to exit setup on the Host PC first.
      abort_delivered: bool (attribute or property)
          True once get_input_key() has actually acted on request_abort()
          during the current setup. This lets the bridge tell a real abort
          apart from a request that arrived while setup was already ending.
          Without it, any abort request during setup is reported as "aborted".
      on_first_target: Callable[[], None] | None (attribute)
          Assigned by the bridge; call it when the first calibration target
          is drawn. Without it: no "calibrating" state.
    """
    def setup(self, tracker: pylink.EyeLink) -> None: ...
    def teardown(self) -> None: ...


# ---------------------------------------------------------------------------
# PsychoPy calibration display
# ---------------------------------------------------------------------------

class PsychopyCalibrationDisplay(pylink.EyeLinkCustomDisplay):
    """
    Draws EyeLink calibration/validation targets on a PsychoPy window.

    pylink calls the draw_* methods on the Host PC's schedule.  We keep
    it deliberately minimal: a filled circle target with a small centre dot.
    Extend draw_line / play_beep etc. as needed for your setup.
    """

    TARGET_OUTER_RADIUS = 20    # px
    TARGET_INNER_RADIUS = 4     # px
    TARGET_COLOR_OUTER  = "white"
    TARGET_COLOR_INNER  = "black"
    BG_COLOR            = "grey"

    def __init__(self, window):
        super().__init__()
        self._win = window
        self._w, self._h = window.size  # pixel dimensions

        # Set by the bridge: called once per doTrackerSetup() when the first
        # calibration/validation target is drawn (i.e. the operator has
        # actually started calibrating, not just entered camera setup).
        self.on_first_target = None
        self._target_drawn = False
        self._pending_keys: list[int] = []   # synthetic key presses for get_input_key()
        self._tracker = None
        # Set from any thread by request_abort(); acted on in get_input_key(),
        # which pylink polls on the main thread throughout setup mode.
        self._abort_requested = False
        self._abort_sent = False

        # Import here so the rest of the module works without PsychoPy.
        from psychopy import visual, event
        self._event = event

        self._outer = visual.Circle(
            window, radius=self.TARGET_OUTER_RADIUS,
            fillColor=self.TARGET_COLOR_OUTER,
            lineColor=self.TARGET_COLOR_OUTER,
            units="pix",
        )
        self._inner = visual.Circle(
            window, radius=self.TARGET_INNER_RADIUS,
            fillColor=self.TARGET_COLOR_INNER,
            lineColor=self.TARGET_COLOR_INNER,
            units="pix",
        )

    # -- Required pylink.EyeLinkCustomDisplay callbacks --------------------

    def setup_cal_display(self):
        self._set_window_visible(True)
        self._win.setColor(self.BG_COLOR)
        self._win.flip()

    def clear_cal_display(self):
        self._win.setColor(self.BG_COLOR)
        self._win.flip()

    def exit_cal_display(self):
        self._win.setColor(self.BG_COLOR)
        self._win.flip()
        self._set_window_visible(False)

    def draw_cal_target(self, x, y):
        """Draw calibration target at tracker pixel coords (x, y)."""
        if not self._target_drawn:
            self._target_drawn = True
            if self.on_first_target is not None:
                self.on_first_target()
        pos = self._tracker_to_psychopy(x, y)
        self._outer.pos = pos
        self._inner.pos = pos
        self._win.setColor(self.BG_COLOR)
        self._outer.draw()
        self._inner.draw()
        self._win.flip()

    def erase_cal_target(self):
        self._win.setColor(self.BG_COLOR)
        self._win.flip()

    def draw_line(self, x1, y1, x2, y2, colorindex):
        # Optional: draw gaze-contingent lines during validation.
        pass

    def play_beep(self, beep_id):
        # Optional: audio feedback during calibration.
        pass

    def get_input_key(self):
        """
        Forward keyboard input to the EyeLink Host during calibration.
        Returns a list of pylink.KeyInput objects, or an empty list.
        """
        if self._abort_requested:
            return self._abort_keys()
        keys = self._event.getKeys(keyList=None, modifiers=False)
        mapped = [pylink.KeyInput(code, 0) for code in self._pending_keys]
        self._pending_keys.clear()
        for k in keys:
            keycode = self._key_to_eyelink(k)
            if keycode is not None:
                mapped.append(pylink.KeyInput(keycode, 0))
        return mapped

    # Camera-image / misc callbacks the EyeLink core may invoke (e.g. when
    # Enter is pressed during setup). Explicit no-ops so a call never lands
    # on an unimplemented base-class method.
    def setup_image_display(self, width, height):
        return 1

    def exit_image_display(self):
        pass

    def image_title(self, text):
        pass

    def draw_image_line(self, width, line, totlines, buff):
        pass

    def set_image_palette(self, r, g, b):
        pass

    def draw_lozenge(self, x, y, width, height, colorindex):
        pass

    def get_mouse_state(self):
        return ((0, 0), 0)

    def record_abort_hide(self):
        pass

    def alert_printf(self, msg):
        log.warning("EyeLink alert: %s", msg)

    def request_abort(self) -> None:
        """
        Thread-safe: make the running doTrackerSetup() return as soon as
        possible. Only sets a flag — the actual abort happens on the main
        thread in get_input_key() (exitCalibration() + Esc presses as a
        fallback: Esc aborts a running calibration, a second Esc leaves setup).
        end_setup() and begin_setup() clear the flag again.
        """
        self._abort_requested = True

    @property
    def abort_delivered(self) -> bool:
        """True once get_input_key() has acted on request_abort() in this setup."""
        return self._abort_sent

    def _abort_keys(self):
        if not self._abort_sent:
            self._abort_sent = True
            try:
                if self._tracker is not None:
                    self._tracker.exitCalibration()
            except Exception:
                log.exception("exitCalibration() failed; falling back to Esc key presses.")
        return [pylink.KeyInput(pylink.ESC_KEY, 0)]

    def end_setup(self) -> None:
        """Called by the bridge after doTrackerSetup() returns (or setup is skipped)."""
        # Stop answering get_input_key() with Esc: other pylink calls that
        # poll it outside setup mode must get the operator's real keys.
        self._abort_requested = False
        # exit_cal_display() normally hides the window already; make sure,
        # including after an abort.
        self._set_window_visible(False)

    def begin_setup(self, start_calibration: bool = False) -> None:
        """
        Called by the bridge right before doTrackerSetup(). Resets the
        first-target detection and, if `start_calibration`, queues a 'c'
        key press — exactly as if the operator pressed C on this PC — so the
        tracker leaves camera setup and starts calibrating right away.
        """
        self._target_drawn = False
        self._pending_keys.clear()
        self._abort_requested = False
        self._abort_sent = False
        if start_calibration:
            self._pending_keys.append(ord("c"))

    def setup(self, tracker: pylink.EyeLink) -> None:
        self._tracker = tracker
        pylink.openGraphicsEx(self)
        # Not calibrating yet — keep the window out of the way until the
        # first setup_cal_display() call actually needs it on screen.
        self._set_window_visible(False)

    def teardown(self) -> None:
        pylink.closeGraphics()

    # -- Helpers -----------------------------------------------------------

    def _set_window_visible(self, visible: bool) -> None:
        """
        Show/raise or hide the fullscreen calibration window.

        Hides (SW_HIDE) rather than minimizes: pyglet's set_visible(True)
        uses SetWindowPos(SWP_SHOWWINDOW), which does not restore an
        *iconified* window on Windows — a minimized calibration window
        would stay minimized while pylink draws targets into it.

        This window lives on the same display as the experiment app's own
        fullscreen window (Screen 2). It only needs to be on screen while
        pylink is actively drawing calibration targets; the rest of the
        time (including throughout normal recording) it must stay in the
        background so it never covers or steals focus from the app.

        Uses the pyglet window handle PsychoPy's default backend exposes.
        Best-effort: swallows errors so a backend without this handle (or a
        platform quirk) degrades to "window stays visible" rather than
        crashing calibration.
        """
        try:
            handle = getattr(self._win, "winHandle", None)
            if handle is None:
                return
            if visible:
                handle.set_visible(True)
                handle.activate()
            else:
                handle.set_visible(False)
        except Exception:
            log.exception("Could not change calibration window visibility (visible=%s).", visible)

    def _tracker_to_psychopy(self, x, y):
        """
        Convert EyeLink pixel coords (origin top-left) to PsychoPy pix coords
        (origin centre, y-axis flipped).
        """
        px = x - self._w / 2.0
        py = self._h / 2.0 - y
        return (px, py)

    def _key_to_eyelink(self, key: str):
        """Map PsychoPy key name to an EyeLink key code."""
        _MAP = {
            "return": pylink.ENTER_KEY,
            "escape": pylink.ESC_KEY,
            "up":     pylink.CURS_UP,
            "down":   pylink.CURS_DOWN,
            "left":   pylink.CURS_LEFT,
            "right":  pylink.CURS_RIGHT,
            "space":  ord(" "),
            "a":      ord("a"),
            "c":      ord("c"),
            "v":      ord("v"),
            "o":      ord("o"),
        }
        return _MAP.get(key)


# ---------------------------------------------------------------------------
# Bridge
# ---------------------------------------------------------------------------

class EyeLinkLSLBridge:
    """
    Connects to an EyeLink Host, streams gaze as normalised LSL samples,
    and supports operator-initiated recalibration mid-experiment.

    Parameters
    ----------
    host_ip : str
        IP address of the EyeLink Host PC (default link is 100.1.1.1).
    screen_w, screen_h : int
        Pixel dimensions of the experiment display (Screen 2).
    window : PsychoPy Window
        The experiment display window used to draw calibration targets.
        Ignored if you supply a custom `display`.
    sample_rate : float
        Tracker sample rate in Hz. Must match the tracker's configuration.
    edf_filename : str
        Base name of the EDF file recorded on the Host PC (max 8 chars).
    display : CalibrationDisplay, optional
        Custom calibration display. If omitted, PsychopyCalibrationDisplay
        is constructed automatically from `window`.
    on_state : callable, optional
        Called with a single state-name string whenever the bridge's
        lifecycle state changes: "connecting", "connected", "setup", "calibrating", "calibrated", "aborted",
        "recording", "stopped", "disconnected". Useful for driving a
        control API (e.g. broadcasting status over WebSocket) without
        polling. May be called from the pump thread; keep it fast and
        non-blocking. Exceptions raised by it are logged and swallowed.
    """

    def __init__(
        self,
        host_ip: str,
        screen_w: int,
        screen_h: int,
        window=None,
        sample_rate: float = NOMINAL_RATE,
        edf_filename: str = "session",
        display: CalibrationDisplay | None = None,
        on_state: "Callable[[str], None] | None" = None,
    ):
        self.host_ip = host_ip
        self.screen_w = screen_w
        self.screen_h = screen_h
        self.sample_rate = sample_rate
        self.edf_filename = edf_filename[:8]  # EyeLink 8-char limit

        if display is not None:
            self._display = display
        elif window is not None:
            self._display = PsychopyCalibrationDisplay(window)
        else:
            raise ValueError("Provide either `window` or a custom `display`.")

        self._tracker: pylink.EyeLink | None = None
        self._in_setup = False         # True while doTrackerSetup() is (about to be) running
        self._abort_pending = False    # sticky; set by abort_setup()
        self._outlet: StreamOutlet | None = None
        self._thread: threading.Thread | None = None
        self._running = False
        self._on_state = on_state
        self._display_open = False

    # ------------------------------------------------------------------ #
    #  Public API                                                          #
    # ------------------------------------------------------------------ #

    @property
    def is_recording(self) -> bool:
        """True while the LSL pump thread is active."""
        return self._running

    def connect(self) -> None:
        """Open connection to the EyeLink Host and configure the tracker."""
        log.info("Connecting to EyeLink Host at %s", self.host_ip)
        self._emit_state("connecting")
        self._tracker = pylink.EyeLink(self.host_ip)
        self._tracker.openDataFile(self.edf_filename + ".edf")

        self._tracker.sendCommand(
            f"screen_pixel_coords = 0 0 {self.screen_w - 1} {self.screen_h - 1}"
        )
        self._tracker.sendMessage(
            f"DISPLAY_COORDS 0 0 {self.screen_w - 1} {self.screen_h - 1}"
        )
        self._tracker.sendCommand(f"sample_rate {int(self.sample_rate)}")
        self._tracker.sendCommand("recording_parse_type = GAZE")
        # Make sure gaze is actually sent over the link / written to the EDF,
        # instead of relying on whatever the Host's INI defaults are.
        self._tracker.sendCommand(
            "file_sample_data = LEFT,RIGHT,GAZE,HREF,RAW,AREA,GAZERES,BUTTON,STATUS,INPUT"
        )
        self._tracker.sendCommand(
            "file_event_filter = LEFT,RIGHT,FIXATION,SACCADE,BLINK,MESSAGE,BUTTON,INPUT"
        )
        self._tracker.sendCommand("link_sample_data = LEFT,RIGHT,GAZE,GAZERES,AREA,STATUS,INPUT")
        self._tracker.sendCommand(
            "link_event_filter = LEFT,RIGHT,FIXATION,SACCADE,BLINK,BUTTON,FIXUPDATE,INPUT"
        )
        # NB: monocular/binocular mode is left as configured on the Host.
        # eyeAvailable() is only meaningful while recording, so it can't be
        # used here to decide binocular_enabled (it returns -1 before
        # startRecording(), which used to force the tracker into monocular).

        # Register custom display with pylink before any calibration call.
        self._display.setup(self._tracker)
        self._display_open = True
        self._setup_lsl_outlet()
        log.info("Connected.")
        self._emit_state("connected")

    def calibrate(self, start_calibration: bool = False) -> bool:
        """
        Enter EyeLink setup mode and block until the operator leaves it.

        doTrackerSetup() first shows *camera setup*; calibration only starts
        when C is pressed (Host PC or this PC), validation on V, and the call
        returns only once the operator exits setup (Esc). States emitted:
          "setup"        — in setup mode, waiting for the operator
          "calibrating"  — first calibration/validation target drawn
          "calibrated"   — setup mode exited
          "aborted"      — setup was cut short (or never entered) because
                           abort_setup() was called; a calibration in progress
                           is discarded, the tracker keeps the last accepted one
        With `start_calibration=True` a C key press is injected so targets
        appear immediately (skips camera setup — the operator can still press
        Esc to go back to it).

        Returns True if the operator exited setup, False if it was aborted.
        Must be called from the thread that created the calibration window.
        """
        log.info("Entering EyeLink setup (start_calibration=%s) ...", start_calibration)
        begin = getattr(self._display, "begin_setup", None)
        if begin is not None:
            begin(start_calibration)
        elif start_calibration:
            log.warning("Custom display has no begin_setup(); can't auto-start calibration.")
        if hasattr(self._display, "on_first_target"):
            self._display.on_first_target = lambda: self._emit_state("calibrating")

        # Set _in_setup *before* checking _abort_pending; abort_setup() does
        # the reverse (sets _abort_pending, then reads _in_setup). That way a
        # concurrent abort is never lost: either we see it here and skip
        # setup, or abort_setup() sees _in_setup and signals the display.
        # Its flag can't be cleared by begin_setup() anymore, because that
        # already ran above.
        self._in_setup = True
        if self._abort_pending:
            self._in_setup = False
            self._end_display_setup()
            log.warning("Setup aborted before it started — shutdown requested.")
            self._emit_state("aborted")
            return False

        self._emit_state("setup")
        try:
            self._tracker.doTrackerSetup()
        finally:
            self._in_setup = False
            # Read this before end_setup(): did an abort actually reach
            # pylink, or did the request only arrive while setup was already
            # ending (operator accepted / pressed Esc at the same moment)?
            delivered = getattr(self._display, "abort_delivered", None)
            self._end_display_setup()
        aborted = self._abort_pending if delivered is None else bool(delivered)
        if aborted:
            log.warning("Setup aborted — in-progress calibration discarded.")
            self._emit_state("aborted")
            return False
        log.info("Setup exited — calibration complete.")
        self._emit_state("calibrated")
        return True

    def abort_setup(self) -> bool:
        """
        Thread-safe, and safe to call from a signal handler: end EyeLink
        setup mode for good. Meant for shutdown. A running calibrate()
        returns as soon as possible without waiting for the operator, and
        every later calibrate() returns immediately. Both report "aborted".

        Returns True if a running setup was signalled, False if none was
        running or the display can't abort (custom display without
        request_abort()). Later calibrate() calls are skipped either way.
        """
        # Order matters; see the matching comment in calibrate().
        self._abort_pending = True
        if not self._in_setup:
            return False
        req = getattr(self._display, "request_abort", None)
        if req is None:
            log.warning("Display has no request_abort(); can't abort setup mode. "
                        "Exit setup on the Host PC.")
            return False
        log.info("Aborting EyeLink setup mode ...")
        req()
        return True

    def recalibrate(self, start_calibration: bool = True) -> None:
        """
        Pause recording (if running), calibrate, and resume recording.
        Recording is *not* resumed if setup was aborted (shutdown in
        progress). Blocking. Like calibrate(), must be called from the thread
        that created the calibration window — never from the pump thread.
        By default skips camera setup and goes straight to the targets.
        """
        was_recording = self._running
        if was_recording:
            self.stop()
        completed = self.calibrate(start_calibration)
        if was_recording:
            if completed:
                self.start()
            else:
                log.info("Not resuming recording after aborted setup.")

    def start(self) -> None:
        """Start EyeLink recording and launch the background LSL pump thread."""
        if self._running:
            log.warning("Bridge is already running.")
            return
        self._start_recording()
        self._running = True
        self._thread = threading.Thread(
            target=self._pump, name="EyeLinkLSLPump", daemon=True
        )
        self._thread.start()
        log.info("EyeLink -> LSL pump started.")
        self._emit_state("recording")

    def stop(self) -> None:
        """Stop the pump thread and end EyeLink recording."""
        self._running = False
        if self._thread:
            self._thread.join(timeout=2.0)
            self._thread = None
        pylink.endRealTimeMode()
        self._tracker.stopRecording()
        log.info("EyeLink -> LSL pump stopped.")
        self._emit_state("stopped")

    def disconnect(self) -> None:
        """Transfer the EDF file to PC 1, close the tracker, tear down graphics."""
        if self._tracker:
            self._tracker.setOfflineMode()
            pylink.msecDelay(500)
            self._tracker.closeDataFile()

            local_edf = self.edf_filename + ".edf"
            log.info("Transferring EDF -> %s ...", local_edf)
            self._tracker.receiveDataFile(self.edf_filename + ".edf", local_edf)

            self._tracker.close()
            self._tracker = None

        if self._display_open:
            self._display.teardown()
            self._display_open = False
        log.info("EyeLink disconnected.")
        self._emit_state("disconnected")

    # ------------------------------------------------------------------ #
    #  Internal                                                            #
    # ------------------------------------------------------------------ #

    def _end_display_setup(self) -> None:
        end = getattr(self._display, "end_setup", None)
        if end is not None:
            end()

    def _emit_state(self, state: str) -> None:
        if self._on_state is None:
            return
        try:
            self._on_state(state)
        except Exception:
            log.exception("on_state callback raised for state=%r", state)

    def _start_recording(self) -> None:
        # startRecording(samples_to_file, events_to_file,
        #                samples_over_link, events_over_link)
        err = self._tracker.startRecording(1, 1, 1, 1)
        if err:
            raise RuntimeError(f"EyeLink startRecording() failed with code {err}")
        time.sleep(0.1)             # let the tracker spin up
        pylink.beginRealTimeMode(100)
        # Only valid once recording: which eye(s) the Host is actually tracking.
        eye = self._tracker.eyeAvailable()
        names = {LEFT_EYE: "left", RIGHT_EYE: "right", BINOCULAR: "binocular"}
        if eye in names:
            log.info("Recording eye: %s", names[eye])
        else:
            log.warning("eyeAvailable() returned %r — no eye tracked? Check the Host PC camera setup.", eye)

    def _pump(self) -> None:
        """Poll for new samples and push each one to LSL exactly once."""
        last_time = None
        while self._running:
            sample = self._tracker.getNewestSample()
            # getNewestSample() keeps returning the same sample until the
            # tracker produces a new one; without this check the loop pushes
            # each sample thousands of times and floods the LSL outlet.
            if sample is None or sample.getTime() == last_time:
                time.sleep(0.0005)
                continue
            last_time = sample.getTime()

            x, y = self._extract_gaze(sample)
            self._outlet.push_sample([x, y], local_clock())

    def _setup_lsl_outlet(self) -> None:
        info = StreamInfo(
            name="GazeXY",
            type="Gaze",
            channel_count=2,
            nominal_srate=self.sample_rate,
            channel_format="float32",
            source_id=f"EyeLink@{self.host_ip}",
        )
        chns = info.desc().append_child("channels")
        for label in ("x_norm", "y_norm"):
            ch = chns.append_child("channel")
            ch.append_child_value("label", label)
            ch.append_child_value("unit", "normalized_screen")
            ch.append_child_value("type", "Gaze")

        self._outlet = StreamOutlet(info)
        log.info("LSL outlet 'GazeXY' created.")

    def _extract_gaze(self, sample) -> tuple[float, float]:
        """
        Return normalised (x, y) from a pylink sample.

        Decided per sample from the eye data the sample actually carries, so
        it works for left, right or binocular recording without relying on
        eyeAvailable(). Binocular: averages both eyes, falls back to
        whichever is valid.
        """
        points = []
        if sample.isLeftSample():
            points.append(sample.getLeftEye().getGaze())
        if sample.isRightSample():
            points.append(sample.getRightEye().getGaze())
        points = [(x, y) for x, y in points
                  if x != MISSING_DATA and y != MISSING_DATA]
        if not points:
            return MISSING_VAL, MISSING_VAL

        px = sum(p[0] for p in points) / len(points)
        py = sum(p[1] for p in points) / len(points)
        return px / self.screen_w, py / self.screen_h
