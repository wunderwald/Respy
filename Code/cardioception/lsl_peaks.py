"""
LSL peak-pulse recorder for Cardioception
=========================================
Stands in for systole's ``Oximeter`` so the Cardioception tasks can run on
heartbeats detected by ADInstruments' Fast Response Output (FRO) and
forwarded from LabChart to LSL by ``labchart_to_lsl``.

The incoming stream is a regular-rate, single-channel signal that sits at 0
and pulses to a fixed "high" level (5 V from the FRO hardware) on every
detected beat. A beat is the rising edge of a pulse: the first sample at or
above the threshold after a sample below it. Its time is that sample's LSL
timestamp, which the bridge derives from LabChart's hardware tick count.

Cardioception touches the recorder through a small surface, reproduced here:

    setup(), read(duration), readInWaiting(), waitBeat(), save(fname),
    recording, peaks, instant_rr, times, channels["Channel_0"], sfreq

Writing a non-zero code into ``channels["Channel_0"][-1]`` (how the tasks mark
events) also pushes a string marker to an LSL marker outlet, so task events
land on the same clock as the pulses and, via the bridge, as LabChart
comments.
"""

import logging
import time
from typing import Callable, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
from pylsl import (
    StreamInfo,
    StreamInlet,
    StreamOutlet,
    cf_string,
    local_clock,
    proc_clocksync,
)

log = logging.getLogger(__name__)

# Event codes the tasks write into Channel_0, from the task docstrings.
HRD_EVENTS = {
    1: "trial_start",
    2: "listening_start",
    3: "sound_start",
    4: "rating_start",
    5: "trial_end",
}
HBC_EVENTS = {
    1: "listening_start",
    2: "listening_stop",
}

# Shortest plausible interval between two beats (s). Guards against a single
# pulse being counted twice if its edge is noisy; 0.25 s caps the rate at 240 BPM.
DEFAULT_REFRACTORY = 0.25

# How long to wait for samples before warning that the stream has stalled.
STALL_WARNING_S = 2.0


# ---------------------------------------------------------------------------
# Marker outlet
# ---------------------------------------------------------------------------

class MarkerOutlet:
    """String marker stream carrying the task events.

    Irregular rate and string-typed, which is what ``labchart_to_lsl``
    discovers and writes into LabChart as comments.
    """

    def __init__(self, task: str, participant: str, session: str):
        self.task = task
        self.labels = HRD_EVENTS if task == "HRD" else HBC_EVENTS
        info = StreamInfo(
            name=f"Cardioception_{task}_Markers",
            type="Markers",
            channel_count=1,
            nominal_srate=0,
            channel_format=cf_string,
            source_id=f"cardioception_{task}_{participant}_{session}",
        )
        info.desc().append_child_value("participant", participant)
        info.desc().append_child_value("session", session)
        self.outlet = StreamOutlet(info)
        log.info("LSL marker outlet live: '%s'", info.name())

    def push(self, code: int) -> None:
        label = self.labels.get(int(code), f"code_{int(code)}")
        self.outlet.push_sample([f"{self.task}_{label}"], local_clock())


class TriggerChannel(list):
    """List that forwards non-zero writes to a marker callback.

    The tasks mark events with ``channels["Channel_0"][-1] = code``; this keeps
    that value in the saved trigger channel exactly as the Oximeter did, and
    additionally emits the event as an LSL marker at the moment it happens.
    """

    def __init__(self, on_event: Optional[Callable[[int], None]] = None):
        super().__init__()
        self.on_event = on_event

    def __setitem__(self, index, value):
        super().__setitem__(index, value)
        if self.on_event is not None and not isinstance(index, slice) and value:
            self.on_event(value)


# ---------------------------------------------------------------------------
# Stream discovery
# ---------------------------------------------------------------------------

def stream_unit(info: StreamInfo) -> str:
    """Unit of the first channel as declared in the stream metadata, or ''."""
    channel = info.desc().child("channels").child("channel")
    return channel.child_value("unit") if not channel.empty() else ""


def describe_stream(info: StreamInfo) -> str:
    rate = info.nominal_srate()
    rate_txt = f"{rate:g} Hz" if rate > 0 else "irregular"
    return f"{info.name()}  ({info.type()}, {rate_txt}, {info.hostname()})"


def default_stream_index(infos: List[StreamInfo]) -> int:
    """First stream with 'peak' in its name, else the first stream."""
    for i, info in enumerate(infos):
        if "peak" in info.name().lower():
            return i
    return 0


# ---------------------------------------------------------------------------
# Recorder
# ---------------------------------------------------------------------------

class LSLPeakRecorder:
    """Oximeter-compatible recorder for an LSL peak-pulse stream.

    Parameters
    ----------
    info :
        The resolved peak stream.
    threshold :
        Level a sample must reach to count as the start of a pulse, in the
        stream's units. ``None`` calibrates it from the first seconds of data:
        halfway between the lowest and highest value seen.
    refractory :
        Minimum time between two beats (s).
    markers :
        Outlet for task events, or ``None`` to only store them in Channel_0.
    calibration_s :
        Length of the calibration recording when ``threshold`` is ``None``.
    """

    def __init__(
        self,
        info: StreamInfo,
        threshold: Optional[float] = None,
        refractory: float = DEFAULT_REFRACTORY,
        markers: Optional[MarkerOutlet] = None,
        calibration_s: float = 6.0,
    ):
        if info.nominal_srate() <= 0:
            raise ValueError(
                f"Stream '{info.name()}' has an irregular rate. Expected the "
                "regular-rate pulse channel forwarded from LabChart."
            )
        if info.channel_count() != 1:
            log.warning(
                "Stream '%s' has %d channels; using the first.",
                info.name(), info.channel_count(),
            )
        self.name = info.name()
        self.sfreq = info.nominal_srate()
        self.refractory = refractory
        self.markers = markers
        self.inlet = StreamInlet(
            info, max_buflen=360, processing_flags=proc_clocksync
        )
        self.inlet.open_stream(timeout=10.0)
        # Resolved infos carry no metadata; the inlet's copy does.
        self.info = self.inlet.info(timeout=10.0)
        self.unit = stream_unit(self.info)

        # Edge-detector state, kept across chunks and across setup() calls so
        # a pulse that straddles a chunk boundary is neither missed nor doubled.
        self._prev_high = True  # don't fire on a pulse already in progress
        self._last_peak_time = -np.inf
        self.peak_times: List[float] = []  # every beat since start (LSL time)

        self.n_channels = 1
        self.reset()

        if threshold is None:
            self.threshold = self._calibrate(calibration_s)
        else:
            self.threshold = float(threshold)
        log.info(
            "Peak stream '%s' @ %g Hz, threshold %g %s",
            self.name, self.sfreq, self.threshold, self.unit,
        )

    # -- Oximeter-compatible interface -------------------------------------

    def reset(self) -> "LSLPeakRecorder":
        """Clear the stored recording (not the beat history)."""
        self.recording: List[float] = []
        self.peaks: List[int] = []
        self.instant_rr: List[float] = []
        self.times: List[float] = []
        on_event = self.markers.push if self.markers is not None else None
        self.channels: Dict[str, TriggerChannel] = {
            "Channel_0": TriggerChannel(on_event)
        }
        return self

    def setup(
        self, read_duration: float = 1.0, clear_peaks: bool = True, **_
    ) -> "LSLPeakRecorder":
        """Drop buffered data, then record ``read_duration`` seconds.

        Mirrors ``Oximeter.setup()``, which discards the serial input buffer
        and starts a fresh recording.
        """
        self.reset()
        self._drain()
        self.read(duration=read_duration)
        if clear_peaks:
            self.peaks = [0] * len(self.peaks)
        return self

    def read(self, duration: float) -> "LSLPeakRecorder":
        """Block until ``duration`` seconds of new samples have arrived."""
        target = len(self.recording) + int(round(duration * self.sfreq))
        last_data = time.monotonic()
        while len(self.recording) < target:
            got = self._pull(timeout=0.05, max_samples=target - len(self.recording))
            now = time.monotonic()
            if got:
                last_data = now
            elif now - last_data > STALL_WARNING_S:
                log.warning("No data from '%s' for %.0f s", self.name, now - last_data)
                last_data = now
        return self

    def readInWaiting(self, stop: bool = False) -> "LSLPeakRecorder":
        """Store whatever samples have arrived, without blocking."""
        while self._pull(timeout=0.0):
            pass
        if not self.recording:
            # Tasks write a trigger into the last sample right after this
            # call; make sure there is one.
            self.read(duration=1.0 / self.sfreq)
        return self

    def waitBeat(self) -> "LSLPeakRecorder":
        """Read until a new beat is detected."""
        n_before = len(self.peak_times)
        last_data = time.monotonic()
        while len(self.peak_times) == n_before:
            got = self._pull(timeout=0.05)
            now = time.monotonic()
            if got:
                last_data = now
            elif now - last_data > STALL_WARNING_S:
                log.warning("No data from '%s' for %.0f s", self.name, now - last_data)
                last_data = now
        return self

    def save(self, fname: str) -> None:
        """Save like ``Oximeter.save``: .txt as CSV columns, else .npy.

        Columns: signal, peaks, instant_rr (ms), time (LSL timestamp, s), Channel_0.
        """
        data = {
            "signal": np.asarray(self.recording, dtype=float),
            "peaks": np.asarray(self.peaks, dtype=int),
            "instant_rr": np.asarray(self.instant_rr, dtype=float),
            "time": np.asarray(self.times, dtype=float),
            "Channel_0": np.asarray(self.channels["Channel_0"], dtype=float),
        }
        if fname.endswith(".txt"):
            pd.DataFrame(data).to_csv(fname, index=False)
        else:
            np.save(fname, np.vstack(list(data.values())))

    # -- Heart rate for the HRD task ----------------------------------------

    def peak_vector(
        self, window_s: float = 6.0, new_sfreq: int = 1000
    ) -> Tuple[np.ndarray, np.ndarray]:
        """Last ``window_s`` seconds as (signal, peaks) on a ``new_sfreq`` grid.

        This is the shape ``systole.detection.ppg_peaks(..., new_sfreq=1000)``
        returns, which the HRD task turns into BPM with
        ``60000 / np.diff(np.where(peaks[-5000:])[0])``. Beats come from the
        rising edges, not from re-detecting them in the signal.
        """
        n = int(round(window_s * new_sfreq))
        if not self.times:
            return np.zeros(n), np.zeros(n, dtype=bool)
        t_end = self.times[-1]
        t_start = t_end - window_s
        grid = t_start + np.arange(n) / new_sfreq

        times = np.asarray(self.times)
        signal = np.interp(grid, times, np.asarray(self.recording, dtype=float))

        peaks = np.zeros(n, dtype=bool)
        beats = np.asarray(self.peak_times)
        beats = beats[(beats >= t_start) & (beats <= t_end)]
        idx = np.round((beats - t_start) * new_sfreq).astype(int)
        peaks[np.clip(idx, 0, n - 1)] = True
        return signal, peaks

    # -- Internals -----------------------------------------------------------

    def _pull(self, timeout: float, max_samples: int = 1024) -> int:
        """Pull one chunk, detect beats in it, append it. Returns sample count."""
        chunk, stamps = self.inlet.pull_chunk(
            timeout=timeout, max_samples=max(1, max_samples)
        )
        if not stamps:
            return 0
        values = np.asarray(chunk, dtype=float)[:, 0]
        is_peak, rr = self._detect(values, stamps)

        self.recording.extend(values.tolist())
        self.times.extend(stamps)
        self.peaks.extend(is_peak)
        self.instant_rr.extend(rr)
        self.channels["Channel_0"].extend([0] * len(stamps))
        return len(stamps)

    def _drain(self) -> None:
        """Discard buffered samples while keeping the edge detector current."""
        while True:
            chunk, stamps = self.inlet.pull_chunk(timeout=0.0, max_samples=4096)
            if not stamps:
                return
            self._detect(np.asarray(chunk, dtype=float)[:, 0], stamps)

    def _detect(self, values: np.ndarray, stamps: List[float]):
        """Rising-edge detection. Returns per-sample peak flags and RR (ms)."""
        is_peak = [0] * len(values)
        rr = [0.0] * len(values)
        last_rr = self.instant_rr[-1] if self.instant_rr else 0.0
        for i, (v, t) in enumerate(zip(values, stamps)):
            high = v >= self.threshold
            if high and not self._prev_high and t - self._last_peak_time >= self.refractory:
                if np.isfinite(self._last_peak_time):
                    last_rr = (t - self._last_peak_time) * 1000.0
                self._last_peak_time = t
                self.peak_times.append(t)
                is_peak[i] = 1
            self._prev_high = high
            rr[i] = last_rr
        return is_peak, rr

    def _calibrate(self, seconds: float) -> float:
        """Pick the threshold from a short recording and check it finds beats.

        Halfway between the lowest and highest value works for any pulse
        height and baseline. The checks reject a recording without pulses,
        where halfway through noise would fire continuously.
        """
        log.info("Calibrating threshold from %.0f s of '%s'...", seconds, self.name)
        self.threshold = np.inf  # detect nothing while collecting
        self._drain()
        self.read(duration=seconds)
        values = np.asarray(self.recording, dtype=float)
        times = np.asarray(self.times)
        lo, hi = float(values.min()), float(values.max())
        threshold = lo + 0.5 * (hi - lo)

        high = values >= threshold
        edges = np.flatnonzero(high[1:] & ~high[:-1]) + 1
        beats = times[edges]
        if len(beats) > 1:
            keep = [0]
            for j in range(1, len(beats)):
                if beats[j] - beats[keep[-1]] >= self.refractory:
                    keep.append(j)
            beats = beats[keep]
        bpm = 60.0 / np.diff(beats) if len(beats) > 1 else np.array([])
        duty = high.mean()

        if hi - lo <= 0 or len(beats) < 3 or duty > 0.5 or not (
            30 <= np.median(bpm) <= 200
        ):
            median_bpm = f"{np.median(bpm):.0f}" if bpm.size else "n/a"
            raise RuntimeError(
                f"No clear pulses on '{self.name}' during {seconds:.0f} s of "
                f"calibration: range {lo:g} to {hi:g} {self.unit}, "
                f"{len(beats)} rising edges, {duty:.0%} of samples high, "
                f"median {median_bpm} BPM. Check that LabChart is sampling, "
                "the electrodes are attached and Fast Response Output is "
                "producing pulses, or enter a fixed threshold."
            )

        # Seed the detector with the calibration beats so the beat history
        # starts populated, then discard the calibration recording.
        self.peak_times = beats.tolist()
        self._last_peak_time = float(beats[-1])
        self._prev_high = bool(high[-1])
        self.reset()
        log.info(
            "Calibrated: range %g to %g %s, %d beats, median %.0f BPM",
            lo, hi, self.unit, len(beats), np.median(bpm),
        )
        return threshold


def make_ppg_peaks(recorder: LSLPeakRecorder) -> Callable:
    """Replacement for ``ppg_peaks`` inside ``cardioception.HRD.task``.

    The task calls ``ppg_peaks(signal, sfreq=75, new_sfreq=1000, clipping=True)``
    on the last 6 s it read from the recorder. The signal it passes is ignored;
    the beats come from the recorder's rising edges.
    """

    def ppg_peaks(signal=None, sfreq=None, new_sfreq: int = 1000, **_):
        return recorder.peak_vector(window_s=6.0, new_sfreq=new_sfreq)

    return ppg_peaks
