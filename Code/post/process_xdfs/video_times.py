import csv

from stream_summary import info_value
from task_markers import _marker_values

# Must match videosync_to_lsl/config.py
VIDEO_STREAM_NAME = "VideoSyncMarkers"
VIDEO_START_MARKER = "video_record_start"
VIDEO_STOP_MARKER = "video_record_stop"

CSV_FIELDS = ["timestamp", "stream", "marker", "video_index", "video_time", "video_timecode"]

"""
HELPERS
"""
def is_video_stream(stream):
    return info_value(stream["info"], "name") == VIDEO_STREAM_NAME


def timecode(seconds):
    """Return seconds as H:MM:SS.mmm, the way a video player shows a position."""
    ms = round(seconds * 1000)
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h}:{m:02d}:{s:02d}.{ms:03d}"


"""
VIDEOS
"""
def find_videos(streams):
    """Return the VideoSync Pro recordings from the video_record_start / _stop markers of the given streams.

    Each video is a dict with a 1-based index, start and stop (None if no stop signal was recorded before the
    next start or the end of the recording). Stop markers without a preceding start are ignored.
    """
    markers = sorted(m for s in streams if is_video_stream(s) for m in _marker_values(s))

    videos = []
    for ts, marker in markers:
        if marker == VIDEO_START_MARKER:
            videos.append({"index": len(videos) + 1, "start": ts, "stop": None})
        elif marker == VIDEO_STOP_MARKER and videos and videos[-1]["stop"] is None:
            videos[-1]["stop"] = ts
    return videos


def video_for(ts, videos):
    """Return the video running at ts (the latest start <= ts, if not stopped before ts), or None."""
    current = None
    for video in videos:
        if video["start"] > ts:
            break
        current = video
    if current and current["stop"] is not None and ts > current["stop"]:
        return None
    return current


def video_time_rows(streams, videos):
    """Return one row (keys = CSV_FIELDS) per marker of the non-video marker streams, sorted by timestamp.

    Markers outside of any video get empty video columns.
    """
    rows = []
    for stream in streams:
        if is_video_stream(stream):
            continue
        name = info_value(stream["info"], "name")
        for ts, marker in _marker_values(stream):
            video = video_for(ts, videos)
            row = {"timestamp": ts, "stream": name, "marker": marker,
                   "video_index": "", "video_time": "", "video_timecode": ""}
            if video:
                t = ts - video["start"]
                row.update(video_index=video["index"], video_time=round(t, 3), video_timecode=timecode(t))
            rows.append(row)
    rows.sort(key=lambda r: r["timestamp"])
    return rows


"""
OUTPUT
"""
def summarize_videos(videos, rows, csv_name=None):
    """Return the videos and the number of markers mapped onto them as a list of text lines."""
    n_mapped = sum(r["video_index"] != "" for r in rows)
    lines = [
        "-" * 70,
        f"Videos ({len(videos)}, {n_mapped} of {len(rows)} markers within a video)"
        + (f" -> {csv_name}" if csv_name else ""),
    ]
    for v in videos:
        if v["stop"] is None:
            lines.append(f"  #{v['index']}  start {v['start']:.3f}  WARNING: no stop signal")
        else:
            lines.append(f"  #{v['index']}  start {v['start']:.3f}  stop {v['stop']:.3f}  "
                         f"duration {timecode(v['stop'] - v['start'])}")
    return lines


def write_video_times_csv(rows, path):
    with open(path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_FIELDS)
        writer.writeheader()
        writer.writerows(rows)
