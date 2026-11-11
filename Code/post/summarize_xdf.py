import csv
import logging
import re
from pathlib import Path
import numpy as np
import pyxdf

"""
I/O
"""
XDF_DIR = "./xdf"

TASK_MARKER_RE = re.compile(r"^task_(start|end|abort)_(.+)$")

"""
LOGGING
"""
log = logging.getLogger(__name__)

"""
HELPERS
"""
def _info_value(info, key, default="?"):
    value = info.get(key)
    if isinstance(value, list):
        value = value[0] if value else None
    return default if value is None else value


def _channel_labels(info):
    """Return the channel labels from the stream's description <desc>, if LabRecorder stored any."""
    desc = _info_value(info, "desc", None)

    if not isinstance(desc, dict):
        return []
    
    try:
        channels = desc["channels"][0]["channel"]
    except (KeyError, IndexError, TypeError):
        return []
    
    labels = []
    for ch in channels:
        label = ch.get("label", [None])[0] if isinstance(ch, dict) else None
        labels.append(label or "?")

    return labels


def _marker_values(stream):
    """Yield (timestamp, marker string) for each sample of a marker stream (first channel)."""
    for ts, sample in zip(stream["time_stamps"], stream["time_series"]):
        value = sample[0] if len(sample) else ""
        yield float(ts), str(value)


def _pair_task_markers(markers):
    """Pair task_start_<name> with the next task_end_<name> / task_abort_<name>.

    markers: (timestamp, marker) tuples. Only task_<start|end|abort>_<name> markers are considered;
    a pair must not have any other task marker between its start and end/abort.
    Returns (pairs, unmatched): pairs as dicts with a per-task 1-based index,
    unmatched as (timestamp, marker) tuples.
    """
    task_markers = []
    for ts, marker in sorted(markers, key=lambda m: m[0]):
        match = TASK_MARKER_RE.match(marker)
        if match:
            task_markers.append((ts, marker, match.group(1), match.group(2)))

    pairs, unmatched = [], []
    counts = {}
    open_start = None  # (ts, marker, kind, task) of the most recent unpaired start

    for ts, marker, kind, task in task_markers:
        if kind == "start":
            if open_start:
                unmatched.append(open_start[:2])
            open_start = (ts, marker, kind, task)
        elif open_start and open_start[3] == task:
            counts[task] = counts.get(task, 0) + 1
            pairs.append({
                "task_name": task,
                "index": counts[task],
                "start_marker": open_start[1],
                "end_marker": marker,
                "start_time": open_start[0],
                "end_time": ts,
            })
            open_start = None
        else:
            # end/abort without a matching start directly before it; any open start
            # of another task can no longer be paired either.
            if open_start:
                unmatched.append(open_start[:2])
                open_start = None
            unmatched.append((ts, marker))

    if open_start:
        unmatched.append(open_start[:2])

    unmatched.sort(key=lambda m: m[0])
    return pairs, unmatched


def summarize_xdf(path):
    path = Path(path)

    try:
        streams, _header = pyxdf.load_xdf(str(path))
    except Exception as e:
        log.error("Could not load %s: %s", path, e)
        return

    lines = []

    def out(msg, *args):
        lines.append(msg % args if args else msg)

    out("=" * 70)
    out("Folder: %s", path.parent.name)
    out("%s  (%d stream%s)", path, len(streams), "" if len(streams) == 1 else "s")

    marker_streams = []
    for stream in streams:
        info = stream["info"]
        name = _info_value(info, "name")
        stream_type = _info_value(info, "type")
        channel_count = int(_info_value(info, "channel_count", 0))
        channel_format = _info_value(info, "channel_format")
        nominal_srate = float(_info_value(info, "nominal_srate", 0))

        time_series = stream["time_series"]
        time_stamps = stream["time_stamps"]
        n_samples = len(time_stamps)
        # string streams come back as lists of lists, not arrays
        shape = time_series.shape if isinstance(time_series, np.ndarray) else (len(time_series), channel_count)

        out("-" * 70)
        out("Stream:     %s", name)
        out("  type:     %s", stream_type)
        out("  format:   %s", channel_format)
        out("  channels: %s", channel_count)
        out("  shape:    %s", shape)
        out("  samples:  %d", n_samples)
        out("  srate:    %s", "irregular" if nominal_srate == 0 else f"{nominal_srate:g} Hz")
        if n_samples > 1:
            duration = time_stamps[-1] - time_stamps[0]
            out("  duration: %.2f s (effective srate %.2f Hz)", duration, (n_samples - 1) / duration if duration else 0)

        labels = _channel_labels(info)
        if labels:
            out("  labels:   %s", ", ".join(labels))

        if "marker" in str(name).lower():
            marker_streams.append(stream)

    summary_path = path.with_name(f"summary_{path.stem}.txt")
    csv_path = path.with_name(f"task_markers_{path.stem}.csv")

    if marker_streams:
        markers = [m for stream in marker_streams for m in _marker_values(stream)]
        pairs, unmatched = _pair_task_markers(markers)

        out("-" * 70)
        out("Task markers (%d pair%s, %d unmatched) -> %s",
            len(pairs), "" if len(pairs) == 1 else "s", len(unmatched), csv_path.name)
        if pairs:
            task_width = max(len("task_name"), *(len(p["task_name"]) for p in pairs))
            out("  %-*s | %5s | %s", task_width, "task_name", "index", "markers")
            for p in pairs:
                out("  %-*s | %5d | %s, %s", task_width, p["task_name"], p["index"], p["start_marker"], p["end_marker"])
        if unmatched:
            out("  Unmatched task markers:")
            for ts, marker in unmatched:
                out("    %.3f  %s", ts, marker)

        fields = ["task_name", "index", "start_marker", "end_marker", "start_time", "end_time"]
        with csv_path.open("w", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=fields)
            writer.writeheader()
            writer.writerows(pairs)

    for line in lines:
        log.info("%s", line)

    summary_path.write_text("\n".join(lines) + "\n")
    log.info("Wrote %s", summary_path)
    if marker_streams:
        log.info("Wrote %s", csv_path)


def main():
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    logging.getLogger("pyxdf").setLevel(logging.WARNING)

    xdf_files = sorted(p for p in Path(XDF_DIR).rglob("*") if p.is_file() and p.suffix.lower() == ".xdf")
    if not xdf_files:
        log.warning("No .xdf files found in %s", Path(XDF_DIR).resolve())
        return

    log.info("Found %d XDF file(s) in %s", len(xdf_files), Path(XDF_DIR).resolve())
    for path in xdf_files:
        summarize_xdf(path)


if __name__ == "__main__":
    main()
