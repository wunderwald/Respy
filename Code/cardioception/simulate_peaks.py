"""
Simulated Fast Response Output peak stream
==========================================
Publishes what labchart_to_lsl forwards from a Fast Response Output channel:
a regular-rate signal at 0 V that jumps to a fixed level for a fixed width on
every heartbeat. For testing run.py without LabChart.

    python simulate_peaks.py                # 70 BPM, 5 V, 20 ms pulses @ 1 kHz
    python simulate_peaks.py --bpm 55 --hrv 0.08
"""

import argparse
import time

import numpy as np
from pylsl import StreamInfo, StreamOutlet, local_clock


def main():
    p = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    p.add_argument("--name", default="Sim_ECG_Peaks", help="LSL stream name")
    p.add_argument("--rate", type=float, default=1000.0, help="sampling rate (Hz)")
    p.add_argument("--bpm", type=float, default=70.0, help="mean heart rate")
    p.add_argument("--hrv", type=float, default=0.05,
                   help="beat-to-beat SD as a fraction of the mean interval")
    p.add_argument("--high", type=float, default=5.0, help="pulse level (V)")
    p.add_argument("--width", type=float, default=0.02, help="pulse width (s)")
    p.add_argument("--noise", type=float, default=0.005, help="baseline noise SD (V)")
    args = p.parse_args()

    info = StreamInfo(args.name, "ECG", 1, args.rate, "float32", f"sim_{args.name}")
    ch = info.desc().append_child("channels").append_child("channel")
    ch.append_child_value("label", "Peaks")
    ch.append_child_value("unit", "V")
    ch.append_child_value("type", "ECG")
    outlet = StreamOutlet(info, chunk_size=0, max_buffered=360)
    print(f"Streaming '{args.name}' @ {args.rate:g} Hz, {args.bpm:g} BPM. Ctrl+C to stop.")

    rng = np.random.default_rng()
    mean_rr = 60.0 / args.bpm
    dt = 1.0 / args.rate
    t0 = local_clock()
    n_sent = 0
    next_beat = 0.5
    pulse_end = -1.0
    try:
        while True:
            time.sleep(0.02)  # the bridge polls LabChart about every 20 ms
            n_due = int((local_clock() - t0) * args.rate)
            if n_due <= n_sent:
                continue
            t = (np.arange(n_sent, n_due)) * dt
            values = rng.normal(0.0, args.noise, len(t))
            for i, ti in enumerate(t):
                if ti >= next_beat:
                    pulse_end = next_beat + args.width
                    next_beat += max(0.3, rng.normal(mean_rr, args.hrv * mean_rr))
                if ti < pulse_end:
                    values[i] += args.high
            outlet.push_chunk(values.reshape(-1, 1).tolist(), (t0 + t).tolist())
            n_sent = n_due
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
