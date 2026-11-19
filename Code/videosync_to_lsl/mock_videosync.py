"""
mock_videosync.py — Stand-in for VideoSync Pro's UDP start/stop signal
=======================================================================
Sends the start signal, waits, then sends the stop signal, the way
VideoSync Pro does when a recording starts and stops. For testing the
bridge without VideoSync Pro.

Usage:
    python mock_videosync.py
    python mock_videosync.py --host 192.168.10.12 --port 5000 --duration 10
"""

import argparse
import socket
import time

import config


if __name__ == "__main__":
    p = argparse.ArgumentParser(description="Send VideoSync Pro-style UDP start/stop signals")
    p.add_argument("--host", default="127.0.0.1", help="PC running the bridge (default 127.0.0.1)")
    p.add_argument("--port", type=int, default=config.LISTEN_PORT,
                   help=f"Bridge UDP port (default {config.LISTEN_PORT})")
    p.add_argument("--duration", type=float, default=5.0,
                   help="Seconds between start and stop signal (default 5)")
    args = p.parse_args()

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    addr = (args.host, args.port)

    sock.sendto(config.START_SIGNAL.encode(), addr)
    print(f"[mock_videosync] Sent {config.START_SIGNAL!r} to udp://{args.host}:{args.port}")
    time.sleep(args.duration)
    sock.sendto(config.STOP_SIGNAL.encode(), addr)
    print(f"[mock_videosync] Sent {config.STOP_SIGNAL!r}")
    sock.close()
