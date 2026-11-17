# LSL → VideoSync Pro Bridge

Forwards every marker from the experiment's LSL marker stream (`RespFishMarkers`) to Mangold VideoSync Pro as a UDP **External Marker**. The same markers then appear both in the XDF recording and on the video timeline.

Purpose: the video is only used to check what happened in the lab when something in the data looks odd. Find the nearest marker in the XDF (e.g. `trial_start_t12`), then jump to the same marker in VideoSync Pro. Accuracy is network latency (a few ms) plus VideoSync Pro's own camera/encoder delay. That isn't calibrated and isn't meant for frame-accurate analysis.

---

## Requirements

| Package | Source |
|---|---|
| `pylsl` | `pip install -r requirements.txt` |

Python 3.8+. Optionally create a `.venv` in this folder; `start_bridge.bat` uses it if present, otherwise the system `python`.

---

## Setup

### VideoSync Pro

1. Enable the **External Marker** (UDP) input in VideoSync Pro's settings and note the UDP port.
2. Check how VideoSync Pro expects marker messages. The fastest way is the API test application that ships with VideoSync Pro: it shows the exact message for a marker.
3. If the bridge runs on a different PC: allow inbound UDP on that port in the Windows firewall, and use the lab network adapter (see `LAB_NOTES.md`; the univie domain adapter blocks it).

### `config.py`

| Setting | Meaning |
|---|---|
| `VIDEOSYNC_HOST` | IP of the VideoSync Pro PC (`127.0.0.1` if the bridge runs there) |
| `VIDEOSYNC_PORT` | External Marker UDP port from VideoSync Pro's settings |
| `MESSAGE_TEMPLATE` | Datagram payload; `{marker}` is replaced by the marker text. Use `{{` / `}}` for literal braces. |
| `MARKER_STREAM_NAME` | LSL stream to forward (default `RespFishMarkers`) |

> [!NOTE]
> `VIDEOSYNC_PORT` and `MESSAGE_TEMPLATE` are placeholders until confirmed against VideoSync Pro.

### Check the connection

With VideoSync Pro **recording**, send a single test marker. This doesn't need LSL:

```
start_bridge.bat --test "hello"
```

The marker should show up in VideoSync Pro's marker list. If it doesn't, the port, template or firewall is wrong.

---

## Running

1. Start the VideoSync Pro recording **before** the experiment starts. Markers sent while VideoSync Pro isn't recording are lost.
2. Start the bridge (`start_bridge.bat`, or `python lsl_to_videosync.py`). It waits for the marker stream, forwards markers as they arrive and reconnects on its own if `lsl_ws_bridge` restarts.

Markers sent before the bridge connects aren't forwarded later; they're still in the XDF.

Command-line options override `config.py`: `--host`, `--port`, `--stream`, `--test TEXT`.

---

## Testing without VideoSync Pro

`mock_videosync.py` listens on the UDP port and prints whatever arrives:

```
python mock_videosync.py            # terminal 1
python lsl_to_videosync.py          # terminal 2
python ../simulation/send_marker.py --name RespFishMarkers   # terminal 3, type markers
```
