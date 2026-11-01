import logging
from pathlib import Path
import numpy as np
import pyxdf

"""
I/O
"""
XDF_DIR = "./xdf"

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


def summarize_xdf(path):
    path = Path(path)

    try:
        streams, _header = pyxdf.load_xdf(str(path))
    except Exception as e:
        log.error("Could not load %s: %s", path, e)
        return

    log.info("=" * 70)
    log.info("%s  (%d stream%s)", path, len(streams), "" if len(streams) == 1 else "s")

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

        log.info("-" * 70)
        log.info("Stream:     %s", name)
        log.info("  type:     %s", stream_type)
        log.info("  format:   %s", channel_format)
        log.info("  channels: %s", channel_count)
        log.info("  shape:    %s", shape)
        log.info("  samples:  %d", n_samples)
        log.info("  srate:    %s", "irregular" if nominal_srate == 0 else f"{nominal_srate:g} Hz")
        if n_samples > 1:
            duration = time_stamps[-1] - time_stamps[0]
            log.info("  duration: %.2f s (effective srate %.2f Hz)", duration, (n_samples - 1) / duration if duration else 0)

        labels = _channel_labels(info)
        if labels:
            log.info("  labels:   %s", ", ".join(labels))


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
