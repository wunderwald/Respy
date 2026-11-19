# ── VideoSync Pro (Signalling Settings → Trigger Settings → UDP Signal) ───────

# UDP port to listen on. Enter the same value as "Receiver Port" in VideoSync Pro.
# "Receiver IP" in VideoSync Pro is the IP of the PC running this bridge
# (127.0.0.1 if it runs on the VideoSync Pro PC).
LISTEN_PORT = 40007

# Enter these exactly as "Start Signal" / "Stop Signal" in VideoSync Pro.
START_SIGNAL = "video_start"
STOP_SIGNAL = "video_end"


# ── LSL ───────────────────────────────────────────────────────────────────────

# Markers pushed for the start / stop signal. post/process_xdfs/video_times.py
# looks for exactly these, so leave them unchanged.
START_MARKER = "video_record_start"
STOP_MARKER = "video_record_stop"

STREAM_NAME = "VideoSyncMarkers"
SOURCE_ID = "videosync_to_lsl"
