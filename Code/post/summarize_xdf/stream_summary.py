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
    """Return a copy of the stream holding only the samples with t_start <= timestamp <= t_end."""
    time_stamps = np.asarray(stream["time_stamps"])
    mask = (time_stamps >= t_start) & (time_stamps <= t_end)
    time_series = stream["time_series"]
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
        out("  srate:    %s", "irregular" if nominal_srate == 0 else f"{nominal_srate:g} Hz")
        if n_samples > 1:
            duration = time_stamps[-1] - time_stamps[0]
            out("  duration: %.2f s (effective srate %.2f Hz)", duration, (n_samples - 1) / duration if duration else 0)

        labels = channel_labels(info)
        if labels:
            out("  labels:   %s", ", ".join(labels))

    return lines
