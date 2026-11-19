"""
videosync_to_lsl.py — Mangold VideoSync Pro recording start/stop → LSL markers
=======================================================================
Listens for the UDP start/stop signals VideoSync Pro sends when a
recording starts or stops, and pushes a marker for each one to an LSL
stream, timestamped on arrival. The XDF then holds the LSL time of each
video's start, so any data timestamp converts to a video position:

    video_time = lsl_time - <timestamp of video_record_start>

Usage:
    python videosync_to_lsl.py
    python videosync_to_lsl.py --port 5000

Dependencies:
    pip install pylsl
"""

import argparse
import logging
import socket

from pylsl import StreamInfo, StreamOutlet, cf_string, local_clock

import config

log = logging.getLogger("videosync_to_lsl")


def decode(data: bytes) -> str:
    """Datagram → signal text, ignoring surrounding whitespace / line endings / NUL padding."""
    return data.decode("utf-8", errors="replace").strip().strip("\x00").strip()


def to_marker(text: str) -> str:
    if text == config.START_SIGNAL:
        return config.START_MARKER
    if text == config.STOP_SIGNAL:
        return config.STOP_MARKER
    # Unknown signal (e.g. a mistyped Start/Stop Signal in VideoSync Pro):
    # keep it in the recording rather than dropping it
    log.warning(f"Unknown signal {text!r}; expected {config.START_SIGNAL!r} or {config.STOP_SIGNAL!r}")
    return f"videosync_unknown_{text}"


def main() -> None:
    p = argparse.ArgumentParser(description="Forward VideoSync Pro UDP start/stop signals to LSL")
    p.add_argument("--port", type=int, default=config.LISTEN_PORT,
                   help=f"UDP port to listen on (default {config.LISTEN_PORT})")
    args = p.parse_args()

    outlet = StreamOutlet(StreamInfo(config.STREAM_NAME, "Markers", 1, 0, cf_string, config.SOURCE_ID))
    log.info(f"LSL marker outlet '{config.STREAM_NAME}' ready")

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind(("0.0.0.0", args.port))
    sock.settimeout(0.5)  # lets Ctrl+C through on Windows
    log.info(f"Listening for VideoSync Pro on udp://0.0.0.0:{args.port}")

    try:
        while True:
            try:
                data, addr = sock.recvfrom(65535)
            except socket.timeout:
                continue
            ts = local_clock()  # as close to arrival as possible
            marker = to_marker(decode(data))
            outlet.push_sample([marker], ts)
            log.info(f"{data!r} from {addr[0]} → LSL: {marker!r} (lsl_t={ts:.3f})")
    except KeyboardInterrupt:
        log.info("Stopped.")
    finally:
        sock.close()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
    main()
