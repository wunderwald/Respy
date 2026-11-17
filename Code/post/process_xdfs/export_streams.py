import csv
import io
import os
import re
from collections import deque

import numpy as np

from stream_summary import channel_labels, info_value

TIME_COLUMNS = ["timestamp", "time_from_task_start", "time_from_recording_start"]
CSV_BLOCK_ROWS = 2_000                       # rows converted to text at once (bounds the memory of the CSV export)
BLOCKS_IN_FLIGHT = 2 * (os.cpu_count() or 1)  # blocks queued or converted in parallel at any time

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


def format_rows(time_stamps, samples, t0):
    """Return the CSV text of one block of rows. Runs in the worker processes, so it must stay a top-level function.

    Numeric streams are arrays, string streams lists of lists; astype(str) writes each value in its
    shortest exact form for its dtype (float32 without float64 noise digits).
    """
    if isinstance(samples, np.ndarray):
        samples = samples.astype(str).tolist()
    f = io.StringIO()
    csv.writer(f).writerows([ts, round(ts - t0, 6), *sample] for ts, sample in zip(time_stamps.tolist(), samples))
    return f.getvalue()


def map_in_order(executor, fn, arg_tuples, window):
    """Like executor.map, but with at most `window` blocks in flight, so memory stays bounded for large streams."""
    pending = deque()
    for args in arg_tuples:
        pending.append(executor.submit(fn, *args))
        if len(pending) >= window:
            yield pending.popleft().result()
    while pending:
        yield pending.popleft().result()


def write_stream_csv(stream, path, t0, time_column, executor=None):
    """Write one stream as CSV: timestamp, <time_column> (timestamp - t0), then one column per channel.

    The rows are converted to text block by block (as text, a stream takes ~30x its numeric size in memory);
    with an executor (process pool) the blocks of numeric streams are converted in parallel.
    Streams without samples get a header-only file.
    """
    info = stream["info"]
    n_channels = int(info_value(info, "channel_count", 0))

    time_stamps = np.asarray(stream["time_stamps"], dtype=float)
    time_series = stream["time_series"]
    blocks = ((time_stamps[i:i + CSV_BLOCK_ROWS], time_series[i:i + CSV_BLOCK_ROWS], t0)
              for i in range(0, len(time_stamps), CSV_BLOCK_ROWS))

    with open(path, "w", newline="") as f:
        csv.writer(f).writerow(["timestamp", time_column] + channel_columns(info, n_channels))
        if executor is not None and isinstance(time_series, np.ndarray):
            texts = map_in_order(executor, format_rows, blocks, window=BLOCKS_IN_FLIGHT)
        else:
            texts = (format_rows(*block) for block in blocks)
        for text in texts:
            f.write(text)


def write_stream_csvs(streams, out_dir, t0, time_column="time_from_task_start", executor=None):
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
        write_stream_csv(stream, out_dir / f"{name}.csv", t0, time_column, executor)
