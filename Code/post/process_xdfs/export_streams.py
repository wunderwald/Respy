import csv
import re

import numpy as np

from stream_summary import channel_labels, info_value

TIME_COLUMNS = ["timestamp", "time_from_task_start", "time_from_recording_start"]

"""
HELPERS
"""
def safe_name(name):
    """Return name with every run of characters that are unsafe in file names replaced by '_'."""
    return re.sub(r"[^A-Za-z0-9._-]+", "_", str(name)).strip("._") or "unnamed"


def channel_columns(info, n_channels):
    """Return the channel labels as column names, or ch0, ch1, ... if they are missing, incomplete or not unique."""
    labels = channel_labels(info)
    if (len(labels) != n_channels or "?" in labels or len(set(labels)) != len(labels)
            or set(labels) & set(TIME_COLUMNS)):
        return [f"ch{i}" for i in range(n_channels)]
    return labels


"""
EXPORT
"""
def recording_start(streams):
    """Return the earliest timestamp of all streams (0 if every stream is empty)."""
    firsts = [s["time_stamps"][0] for s in streams if len(s["time_stamps"])]
    return float(min(firsts)) if firsts else 0.0


def write_stream_csv(stream, path, t0, time_column):
    """Write one stream as CSV: timestamp, <time_column> (timestamp - t0), then one column per channel.

    Streams without samples get a header-only file.
    """
    info = stream["info"]
    n_channels = int(info_value(info, "channel_count", 0))

    time_stamps = np.asarray(stream["time_stamps"], dtype=float).tolist()
    time_series = stream["time_series"]
    # numeric streams are arrays, string streams lists of lists;
    # astype(str) writes each value in its shortest exact form for its dtype (float32 without float64 noise digits)
    samples = time_series.astype(str).tolist() if isinstance(time_series, np.ndarray) else time_series

    with open(path, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["timestamp", time_column] + channel_columns(info, n_channels))
        writer.writerows([ts, round(ts - t0, 6), *sample] for ts, sample in zip(time_stamps, samples))


def write_stream_csvs(streams, out_dir, t0, time_column="time_from_task_start"):
    """Write every stream to <out_dir>/<stream name>.csv (see write_stream_csv).

    Duplicate names (case-insensitive, for macOS/Windows file systems) get a suffix: name_2, name_3, ...
    """
    used = set()
    for stream in streams:
        base = safe_name(info_value(stream["info"], "name"))
        name, n = base, 1
        while name.lower() in used:
            n += 1
            name = f"{base}_{n}"
        used.add(name.lower())
        write_stream_csv(stream, out_dir / f"{name}.csv", t0, time_column)
