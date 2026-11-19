# VideoSync Pro → LSL Bridge

Records when Mangold VideoSync Pro starts and stops a video. VideoSync Pro sends a UDP signal on recording start and stop; this bridge pushes each one as a marker to the LSL stream `VideoSyncMarkers`, timestamped on arrival. With the stream in the XDF, every data timestamp converts to a position in the video:

```
video_time = lsl_time - <timestamp of video_record_start>
```

`post/process_xdfs` does this automatically and writes `video_times.csv` (see below).

Purpose: the video is only used to check what happened in the lab when something in the data looks odd. Expect an offset of a fraction of a second (VideoSync Pro's delay between sending the signal and its first frame is unknown and not calibrated). That's fine for finding a moment in the video; it isn't meant for frame-accurate analysis.

---

## Requirements

| Package | Source |
|---|---|
| `pylsl` | `pip install -r requirements.txt` |

Python 3.8+. The Electron app starts the bridge with the repo-root `.venv` (the one `lsl_ws_bridge/` uses, which already has `pylsl`). For running it on its own, optionally create a `.venv` in this folder; `start_bridge.bat` uses it if present, otherwise the system `python`.

---

## Setup

### VideoSync Pro

*Signalling Settings → Trigger Settings → UDP Signal*: enable **"send UDP signal to the network device with address"** and set:

| Field | Value |
|---|---|
| Receiver IP | IP of the PC running this bridge (`127.0.0.1` if it runs on the VideoSync Pro PC) |
| Receiver Port | `LISTEN_PORT` from `config.py` (default `5000`) |
| Start Signal | `video_record_start` |
| Stop Signal | `video_record_stop` |

If the bridge runs on a different PC than VideoSync Pro: allow inbound UDP on that port in the bridge PC's Windows firewall, and send over the lab network adapter (see `LAB_NOTES.md`; the univie domain adapter blocks it).

### `config.py`

| Setting | Meaning |
|---|---|
| `LISTEN_PORT` | UDP port; must match *Receiver Port* |
| `START_SIGNAL` / `STOP_SIGNAL` | must match *Start Signal* / *Stop Signal* exactly |
| `START_MARKER` / `STOP_MARKER` | LSL markers pushed for them; `post/process_xdfs` relies on these, leave unchanged |

Any other datagram is pushed as `videosync_unknown_<text>` with a warning in the console, so a typo in VideoSync Pro shows up instead of being lost.

---

## Running

Order matters: the start signal must arrive while LabRecorder is recording.

1. Start the bridge. The Electron app (`app/`) starts it automatically and keeps it running until the app quits; its output appears in the app's console prefixed with `[videosync]`. Without the app: `start_bridge.bat`, or `python videosync_to_lsl.py`. Don't do both: only one process can listen on the UDP port. The bridge creates the `VideoSyncMarkers` stream right away.
2. In LabRecorder, select `VideoSyncMarkers` together with the other streams and start recording.
3. Start the VideoSync Pro recording. The bridge console logs `video_record_start`.
4. Run the experiment.
5. Stop VideoSync Pro **before** stopping LabRecorder. The bridge logs `video_record_stop`.

Several videos within one XDF recording are fine; they're numbered in order.

---

## Result: `video_times.csv`

For every XDF recording that contains `video_record_start` markers, `post/process_xdfs` writes `video_times.csv` with every marker of the other marker streams:

| Column | |
|---|---|
| `timestamp` | LSL timestamp of the marker |
| `stream`, `marker` | marker stream name and text |
| `video_index` | which video (1, 2, …); empty if no video was recording |
| `video_time` | seconds from the start of that video |
| `video_timecode` | the same as `H:MM:SS.mmm`, to jump to in the video player |

For a data sample without a marker: look up the timestamp of the matching `video_record_start` in the `summary.txt` of the recording and subtract it.

---

## Testing without VideoSync Pro

`mock_videosync.py` sends the start signal, waits, and sends the stop signal:

```
python videosync_to_lsl.py                     # terminal 1
python mock_videosync.py --duration 10         # terminal 2
```

`--host` points it at a bridge on another PC, e.g. to test the firewall.
