"""
lsl_to_videosync.py — Forward LSL markers to Mangold VideoSync Pro
=======================================================================
Subscribes to the experiment's LSL marker stream and sends every marker
as a UDP External Marker to VideoSync Pro, so the same markers appear
in the XDF recording and on the video timeline.

Usage:
    python lsl_to_videosync.py
    python lsl_to_videosync.py --host 192.168.10.12 --port 5000
    python lsl_to_videosync.py --test "hello"    # send one marker, no LSL

Dependencies:
    pip install pylsl
"""

import argparse
import logging
import socket

import config

log = logging.getLogger("lsl_to_videosync")


# ── UDP sender ────────────────────────────────────────────────────────────────

class VideoSyncSender:
    """Formats markers with MESSAGE_TEMPLATE and sends them as UDP datagrams."""

    def __init__(self, host: str, port: int):
        self.addr = (host, port)
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)

    def send(self, marker: str) -> None:
        payload = config.MESSAGE_TEMPLATE.format(marker=marker).encode(config.ENCODING)
        try:
            self.sock.sendto(payload, self.addr)
        except OSError as e:
            # UDP is fire-and-forget; never let one failed send stop the bridge
            log.warning(f"Send failed for {marker!r}: {e}")
            return
        log.info(f"→ VideoSync: {marker!r}")

    def close(self) -> None:
        self.sock.close()


# ── LSL forwarding loop ───────────────────────────────────────────────────────

def forward(stream_name: str, sender: VideoSyncSender) -> None:
    from pylsl import StreamInlet, resolve_byprop
    try:
        from pylsl.util import LostError   # pylsl >= 1.16
    except ImportError:
        from pylsl import LostError        # older pylsl

    while True:
        log.info(f"Waiting for LSL stream '{stream_name}'…")
        infos = []
        while not infos:
            infos = resolve_byprop("name", stream_name, timeout=config.RESOLVE_TIMEOUT)

        inlet = StreamInlet(infos[0])
        log.info(f"Connected to '{stream_name}' "
                 f"(source_id={infos[0].source_id() or 'n/a'}, host={infos[0].hostname()})")

        try:
            while True:
                sample, _ = inlet.pull_sample(timeout=config.PULL_TIMEOUT)
                if sample is not None:
                    sender.send(str(sample[0]))
        except LostError:
            log.warning(f"Lost stream '{stream_name}', reconnecting…")
        finally:
            inlet.close_stream()


# ── Main ──────────────────────────────────────────────────────────────────────

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Forward LSL markers to Mangold VideoSync Pro via UDP")
    p.add_argument("--host", default=config.VIDEOSYNC_HOST,
                   help=f"VideoSync Pro PC (default {config.VIDEOSYNC_HOST})")
    p.add_argument("--port", type=int, default=config.VIDEOSYNC_PORT,
                   help=f"VideoSync Pro External Marker UDP port (default {config.VIDEOSYNC_PORT})")
    p.add_argument("--stream", default=config.MARKER_STREAM_NAME,
                   help=f"LSL marker stream name (default '{config.MARKER_STREAM_NAME}')")
    p.add_argument("--test", metavar="TEXT",
                   help="Send a single marker with this text and exit (no LSL needed)")
    return p.parse_args()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
    args = parse_args()

    sender = VideoSyncSender(args.host, args.port)
    log.info(f"Sending to VideoSync Pro at udp://{args.host}:{args.port} "
             f"(template {config.MESSAGE_TEMPLATE!r})")

    try:
        if args.test is not None:
            sender.send(args.test)
        else:
            forward(args.stream, sender)
    except KeyboardInterrupt:
        log.info("Stopped.")
    finally:
        sender.close()
