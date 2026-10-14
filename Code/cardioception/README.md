# Cardioception on LSL peak pulses

Runs [Cardioception](https://github.com/embodied-computation-group/Cardioception)'s
Heart Rate Discrimination (HRD) and Heartbeat Counting (HBC) tasks on heartbeats
detected by ADInstruments' Fast Response Output (FRO), forwarded from LabChart to
LSL by [`labchart_to_lsl`](../labchart_to_lsl), instead of a Nonin pulse oximeter.

Cardioception itself is installed unmodified from pip. This folder only holds a
launcher and an adapter.

## Install

Python **3.10 or 3.11** (Cardioception refuses anything else).

```bash
python3.11 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

Cardioception is pinned to a GitHub commit, not the PyPI release: 0.7.1 on PyPI
freezes the confidence slider on macOS in mouse mode (upstream issue #103).

## Run

1. Start LabChart with the FRO pulse channel, then `labchart_to_lsl` (`python gui.py`).
2. `python run.py`
3. In the dialog, pick the task and the **Peak stream**. The first stream with
   "peak" in its name is preselected; choose *Rescan for streams...* if it isn't
   listed yet.

Results are written to `./data/<participant><session>/` as usual.

Without LabChart, `python simulate_peaks.py` publishes an identical-looking
stream (`Sim_ECG_Peaks`: 5 V, 20 ms pulses at 1 kHz, 70 BPM).

### Pulse threshold

`auto` (the default) records 6 s, puts the threshold halfway between the lowest
and highest value, and refuses to start unless that finds at least 3 beats at a
plausible rate (30–200 BPM). For 5 V pulses that lands near 2.5 V. Enter a number
instead to fix it, in the stream's units.

## How it works

The stream is regular-rate, sits at 0 and pulses to a fixed level on each beat.
A **beat is a rising edge**: the first sample at or above the threshold after one
below it, at that sample's LSL timestamp (from LabChart's hardware clock, via the
bridge). A 250 ms refractory period stops a noisy edge counting twice.

That timestamp is when FRO *detected* the beat, a short delay after the R-peak.
A constant delay cancels out of heart rate, but for exact R-peak times use the
raw ECG channel offline.

[`lsl_peaks.py`](lsl_peaks.py) — `LSLPeakRecorder` reproduces the part of
systole's `Oximeter` the tasks use (`setup`, `read`, `readInWaiting`, `waitBeat`,
`save`, `channels["Channel_0"]`).

[`run.py`](run.py) — the dialog, plus three patches:

| Where | What | Why |
|---|---|---|
| `HRD.parameters`, `HBC.parameters`: `serial`, `Oximeter` | Return the LSL recorder, only during `getParameters()` | Keeps `setup="behavioral"`: full screen and the real-data code paths |
| `HRD.task.ppg_peaks` | Return the last 6 s of pulse-edge beats on a 1 kHz grid | The task estimates each trial's heart rate with `ppg_peaks()` on the signal it read; the BPM line after it is unchanged |
| `texts["checkOximeter"]` (English) | ECG wording | Shown when no beats are found |

`run.py` checks the patched names still exist and warns if the Cardioception
version is not 0.7.1. Re-check the patches before changing the pin.

## Event markers

Every task event also goes out on an LSL string stream,
`Cardioception_<task>_Markers`, at the moment it happens:

| Code | HRD | HBC |
|---|---|---|
| 1 | `HRD_trial_start` | `HBC_listening_start` |
| 2 | `HRD_listening_start` | `HBC_listening_stop` |
| 3 | `HRD_sound_start` | |
| 4 | `HRD_rating_start` | |
| 5 | `HRD_trial_end` | |

`labchart_to_lsl` picks the stream up within a couple of seconds and writes the
markers into LabChart as comments. LabRecorder can also record it next to the
pulse and raw ECG streams.

The codes are still written into the `Channel_0` column of the saved recordings,
as with the oximeter.

## Saved recordings

Same files and columns as with the oximeter (`signal`, `peaks`, `instant_rr`,
`time`, `Channel_0`), with these differences:

- `signal` is the pulse train at the stream's rate, not PPG at 75 Hz.
- `peaks` marks the rising edges.
- `time` is the LSL timestamp.
- The HRD `*_signal.txt` holds each trial's pulse train resampled to 1 kHz,
  where it used to hold the PPG.

The bundled analysis notebooks re-detect peaks with `ppg_peaks(..., sfreq=75)`.
For this data, use the `peaks` column or the edges instead.

## Known issues

- The HRD tutorial still shows the pulse-oximeter screens and asks which finger
  the sensor is on. Answer anything. The tutorial can be switched off in the dialog.
- Beat detection quality is set by the FRO configuration in LabChart. The only
  checks here are the refractory period and Cardioception's 40–120 BPM cutoff.
