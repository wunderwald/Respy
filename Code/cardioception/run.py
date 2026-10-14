"""
Cardioception on LSL peak pulses
================================
Runs Cardioception's Heart Rate Discrimination (HRD) or Heartbeat Counting
(HBC) task with heartbeats taken from an LSL stream of Fast Response Output
pulses instead of a Nonin pulse oximeter.

    python run.py

A dialog lists the LSL streams on the network and preselects the first one
with "peak" in its name. See README.md for what is patched and why.
"""

import logging
import sys
import types
from unittest import mock

from psychopy import core, gui
from pylsl import resolve_streams

import cardioception
import cardioception.HBC.parameters as hbc_parameters
import cardioception.HBC.task as hbc_task
import cardioception.HRD.parameters as hrd_parameters
import cardioception.HRD.task as hrd_task

from lsl_peaks import (
    LSLPeakRecorder,
    MarkerOutlet,
    default_stream_index,
    describe_stream,
    make_ppg_peaks,
)

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
log = logging.getLogger("run")

# The patches below replace names inside these modules. They were written
# against this commit; check them again before changing the pin.
TESTED_VERSION = "0.7.1"
RESCAN = "Rescan for streams..."
AUTO = "auto"


def check_cardioception() -> None:
    if cardioception.__version__ != TESTED_VERSION:
        log.warning(
            "cardioception %s installed, wrapper tested with %s",
            cardioception.__version__, TESTED_VERSION,
        )
    for module, names in [
        (hrd_parameters, ("serial", "Oximeter")),
        (hbc_parameters, ("serial", "Oximeter")),
        (hrd_task, ("ppg_peaks",)),
    ]:
        missing = [n for n in names if not hasattr(module, n)]
        if missing:
            sys.exit(
                f"{module.__name__} no longer has {missing}; the LSL patches "
                "do not fit this Cardioception version."
            )


def ask_settings():
    """Dialog for task settings and the peak stream. Returns (settings, info)."""
    previous = {}
    while True:
        log.info("Looking for LSL streams...")
        infos = resolve_streams(wait_time=2.0)
        labels = [describe_stream(i) for i in infos] or ["(no streams found)"]
        default = previous.get("stream", default_stream_index(infos))

        dlg = gui.Dlg(title="Cardioception (LSL peaks)")
        dlg.addField("task", previous.get("task", "HRD"), choices=["HRD", "HBC"],
                     label="Task")
        dlg.addField("participant", previous.get("participant", "Participant"),
                     label="Participant")
        dlg.addField("session", previous.get("session", "001"), label="Session")
        dlg.addField("stream", default, choices=labels + [RESCAN],
                     label="Peak stream")
        dlg.addField("threshold", previous.get("threshold", AUTO),
                     label="Pulse threshold",
                     tip="'auto' calibrates from 6 s of data, or a number in "
                         "the stream's units (e.g. 2.5 for 5 V pulses)")
        dlg.addField("device", previous.get("device", "mouse"),
                     choices=["mouse", "keyboard"], label="Response device (HRD)")
        dlg.addField("language", previous.get("language", "english"),
                     choices=["english", "danish", "danish_children", "french"],
                     label="Language (HRD)")
        dlg.addField("tutorial", previous.get("tutorial", True), label="Run tutorial")
        dlg.addField("screen", previous.get("screen", 0), label="Screen number")
        dlg.addField("fullscr", previous.get("fullscr", True), label="Full screen")

        data = dlg.show()
        if not dlg.OK:
            core.quit()

        settings = dict(data)
        choice = settings["stream"]
        settings["stream"] = labels.index(choice) if choice in labels else default
        previous = settings
        if choice == RESCAN:
            continue
        if not infos:
            gui.criticalDlg("No streams", "No LSL streams found. Start the "
                            "LabChart bridge, then choose Rescan.")
            continue

        threshold = str(settings["threshold"]).strip().lower()
        if threshold in ("", AUTO):
            settings["threshold"] = None
        else:
            try:
                settings["threshold"] = float(threshold)
            except ValueError:
                gui.criticalDlg("Threshold", f"'{threshold}' is not 'auto' or a number.")
                previous["threshold"] = AUTO
                continue
        return settings, infos[settings["stream"]]


def build_parameters(settings, recorder):
    """getParameters() with the Nonin oximeter swapped for the LSL recorder.

    ``setup="behavioral"`` keeps the full-screen window and the real-data
    code paths. In that branch getParameters opens ``serial.Serial(port)`` and
    wraps it in ``Oximeter(...)``; both names are replaced, in that module
    only, for the duration of the call.
    """
    module = hrd_parameters if settings["task"] == "HRD" else hbc_parameters
    no_serial = types.SimpleNamespace(Serial=lambda *a, **k: None)
    common = dict(
        participant=settings["participant"],
        session=settings["session"],
        setup="behavioral",
        screenNb=int(settings["screen"]),
        fullscr=bool(settings["fullscr"]),
    )
    with mock.patch.object(module, "serial", no_serial), \
            mock.patch.object(module, "Oximeter", lambda *a, **k: recorder):
        if settings["task"] == "HRD":
            parameters = module.getParameters(
                device=settings["device"],
                language=settings["language"],
                stairType="psi",
                catchTrials=0.0,
                nTrials=120,
                exteroception=True,
                **common,
            )
        else:
            parameters = module.getParameters(**common)

    if settings["task"] == "HRD" and settings["language"] == "english":
        parameters["texts"]["checkOximeter"] = (
            "No heartbeats detected. Please wait while the ECG signal is checked."
        )
    return parameters


def main():
    check_cardioception()
    settings, info = ask_settings()

    markers = MarkerOutlet(settings["task"], settings["participant"], settings["session"])
    try:
        recorder = LSLPeakRecorder(info, threshold=settings["threshold"], markers=markers)
    except RuntimeError as err:
        gui.criticalDlg("Peak stream", str(err))
        core.quit()

    parameters = build_parameters(settings, recorder)
    log.info("Results go to %s", parameters["resultPath"])

    if settings["task"] == "HRD":
        # The task estimates each trial's heart rate with ppg_peaks() on the
        # signal it just read. Beats come from the pulse edges instead.
        hrd_task.ppg_peaks = make_ppg_peaks(recorder)
        hrd_task.run(parameters, confidenceRating=True, runTutorial=settings["tutorial"])
    else:
        hbc_task.run(parameters, runTutorial=settings["tutorial"])

    parameters["win"].close()
    core.quit()


if __name__ == "__main__":
    main()
