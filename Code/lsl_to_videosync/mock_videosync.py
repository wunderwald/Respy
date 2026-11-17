"""
mock_videosync.py — Stand-in for VideoSync Pro's External Marker input
=======================================================================
Listens on a UDP port and prints every datagram it receives, so the
bridge can be tested without VideoSync Pro.

Usage:
    python mock_videosync.py
    python mock_videosync.py --port 5000

Not for use alongside VideoSync Pro on the same port.
"""

import argparse
import socket
from datetime import datetime

import config


if __name__ == "__main__":
    p = argparse.ArgumentParser(description="Print UDP datagrams (VideoSync Pro stand-in)")
    p.add_argument("--port", type=int, default=config.VIDEOSYNC_PORT,
                   help=f"UDP port to listen on (default {config.VIDEOSYNC_PORT})")
    args = p.parse_args()

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind(("0.0.0.0", args.port))
    sock.settimeout(0.5)  # lets Ctrl+C through on Windows
    print(f"[mock_videosync] Listening on udp://0.0.0.0:{args.port}. Ctrl+C to stop.")

    try:
        while True:
            try:
                data, addr = sock.recvfrom(65535)
            except socket.timeout:
                continue
            now = datetime.now().strftime("%H:%M:%S.%f")[:-3]
            print(f"[{now}] from {addr[0]}: {data!r}")
    except KeyboardInterrupt:
        print("\n[mock_videosync] Stopped.")
    finally:
        sock.close()
