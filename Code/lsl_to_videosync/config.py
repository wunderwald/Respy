# ── VideoSync Pro (UDP External Marker input) ─────────────────────────────────

# PC running Mangold VideoSync Pro. "127.0.0.1" if the bridge runs on the same PC.
VIDEOSYNC_HOST = "127.0.0.1"

# UDP port VideoSync Pro listens on for External Markers (see its settings).
# TODO: confirm in VideoSync Pro — placeholder until then.
VIDEOSYNC_PORT = 5000

# Datagram payload sent for each marker. "{marker}" is replaced by the LSL
# marker string. Adjust to the format VideoSync Pro's API test application
# produces, e.g. "MARKER {marker}" or "{marker}\r\n".
# TODO: confirm in VideoSync Pro — plain marker text until then.
MESSAGE_TEMPLATE = "{marker}"

ENCODING = "utf-8"


# ── LSL ───────────────────────────────────────────────────────────────────────

# Marker stream to forward (published by lsl_ws_bridge).
MARKER_STREAM_NAME = "RespFishMarkers"

RESOLVE_TIMEOUT = 2.0   # seconds per discovery attempt
PULL_TIMEOUT = 1.0      # seconds; bounds how quickly Ctrl+C is handled
