import numpy as np

"""
HELPERS
"""
def info_value(info, key, default="?"):
    value = info.get(key)
    if isinstance(value, list):
        value = value[0] if value else None
    return default if value is None else value


def channel_labels(info):
    """Return the channel labels from the stream's description <desc>, if LabRecorder stored any."""
    desc = info_value(info, "desc", None)

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


def slice_stream(stream, t_start, t_end):
    """Return the stream holding only the samples with t_start <= timestamp <= t_end.

    With sorted timestamps (the normal case) the arrays are views into the original stream, not copies,
    so slicing large streams costs no memory.
    """
    time_stamps = np.asarray(stream["time_stamps"])
    time_series = stream["time_series"]

    if (time_stamps[1:] >= time_stamps[:-1]).all():
        i0 = np.searchsorted(time_stamps, t_start, side="left")
        i1 = np.searchsorted(time_stamps, t_end, side="right")
        return {**stream, "time_series": time_series[i0:i1], "time_stamps": time_stamps[i0:i1]}

    mask = (time_stamps >= t_start) & (time_stamps <= t_end)
    if isinstance(time_series, np.ndarray):
        time_series = time_series[mask]
    else:
        time_series = [sample for sample, keep in zip(time_series, mask) if keep]
    return {**stream, "time_series": time_series, "time_stamps": time_stamps[mask]}


"""
SUMMARY
"""
def summarize_streams(streams, warn_empty=False):
    """Return the per-stream summary (name, type, format, shape, srate, ...) as a list of text lines.

    warn_empty: add a WARNING line for streams without any samples.
    """
    lines = []

    def out(msg, *args):
        lines.append(msg % args if args else msg)

    for stream in streams:
        info = stream["info"]
        name = info_value(info, "name")
        stream_type = info_value(info, "type")
        channel_count = int(info_value(info, "channel_count", 0))
        channel_format = info_value(info, "channel_format")
        nominal_srate = float(info_value(info, "nominal_srate", 0))

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
        if warn_empty and n_samples == 0:
            out("  WARNING:  stream is empty")
        out("  srate:    %s", "irregular" if nominal_srate == 0 else f"{nominal_srate:g} Hz")
        if n_samples > 1:
            duration = time_stamps[-1] - time_stamps[0]
            out("  duration: %.2f s (effective srate %.2f Hz)", duration, (n_samples - 1) / duration if duration else 0)

        labels = channel_labels(info)
        if labels:
            out("  labels:   %s", ", ".join(labels))

    return lines


def summarize_task(pair, task_streams):
    """Return the summary of one task (marker pair, see task_markers.pair_task_markers) as text lines.

    task_streams: the recording's streams cut to [start_time, end_time] of the pair (see slice_stream);
    streams without samples in that window get a warning.
    """
    n_empty = sum(len(s["time_stamps"]) == 0 for s in task_streams)

    lines = [
        "=" * 70,
        f"Task: {pair['task_name']} #{pair['index']}",
        f"  markers:  {pair['start_marker']} -> {pair['end_marker']}",
        f"  start:    {pair['start_time']:.3f} s",
        f"  end:      {pair['end_time']:.3f} s",
        f"  duration: {pair['end_time'] - pair['start_time']:.2f} s",
    ]
    if n_empty:
        lines.append(f"  WARNING:  {n_empty} of {len(task_streams)} stream(s) empty in this task")
    lines += summarize_streams(task_streams, warn_empty=True)

    return lines
