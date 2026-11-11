import csv
import re

from stream_summary import info_value

TASK_MARKER_RE = re.compile(r"^task_(start|end|abort)_(.+)$")
CSV_FIELDS = ["task_name", "index", "start_marker", "end_marker", "start_time", "end_time"]

"""
HELPERS
"""
def marker_streams(streams):
    """Return the streams with 'marker' in their name (case-insensitive)."""
    return [s for s in streams if "marker" in str(info_value(s["info"], "name")).lower()]


def _marker_values(stream):
    """Yield (timestamp, marker string) for each sample of a marker stream (first channel)."""
    for ts, sample in zip(stream["time_stamps"], stream["time_series"]):
        value = sample[0] if len(sample) else ""
        yield float(ts), str(value)


"""
PAIRING
"""
def pair_task_markers(streams):
    """Pair task_start_<name> with the next task_end_<name> / task_abort_<name> across the given marker streams.

    Only task_<start|end|abort>_<name> markers are considered;
    a pair must not have any other task marker between its start and end/abort.
    Returns (pairs, unmatched): pairs as dicts (keys = CSV_FIELDS) with a per-task 1-based index,
    unmatched as (timestamp, marker) tuples.
    """
    markers = [m for stream in streams for m in _marker_values(stream)]

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


"""
OUTPUT
"""
def summarize_task_markers(pairs, unmatched, csv_name=None):
    """Return the task marker pairs and unmatched markers as a list of text lines."""
    lines = []

    def out(msg, *args):
        lines.append(msg % args if args else msg)

    out("-" * 70)
    out("Task markers (%d pair%s, %d unmatched)%s", len(pairs), "" if len(pairs) == 1 else "s", len(unmatched),
        f" -> {csv_name}" if csv_name else "")
    if pairs:
        task_width = max(len("task_name"), *(len(p["task_name"]) for p in pairs))
        out("  %-*s | %5s | %s", task_width, "task_name", "index", "markers")
        for p in pairs:
            out("  %-*s | %5d | %s, %s", task_width, p["task_name"], p["index"], p["start_marker"], p["end_marker"])
    if unmatched:
        out("  Unmatched task markers:")
        for ts, marker in unmatched:
            out("    %.3f  %s", ts, marker)

    return lines


def write_task_markers_csv(pairs, path):
    with open(path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_FIELDS)
        writer.writeheader()
        writer.writerows(pairs)
