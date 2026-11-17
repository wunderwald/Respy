import logging
import shutil

import pyxdf

from export_streams import recording_start, safe_name, write_stream_csvs
from stream_summary import slice_stream, summarize_streams, summarize_task
from task_markers import (is_aborted, marker_streams, pair_task_markers, summarize_task_markers,
                          write_task_markers_csv)

SUMMARY_NAME = "summary.txt"
TASK_MARKERS_NAME = "task_markers.csv"

"""
LOGGING
"""
log = logging.getLogger(__name__)


"""
HELPERS
"""
def task_dir_name(pair):
    """Return the folder name of a task: <task>_<index>, with an _aborted suffix for aborted tasks."""
    name = f"{safe_name(pair['task_name'])}_{pair['index']}"
    return f"{name}_aborted" if is_aborted(pair) else name


def write_lines(path, lines):
    path.write_text("\n".join(lines) + "\n")


"""
PROCESSING
"""
def write_outputs(xdf_path, streams, out_dir):
    """Write the summary, the task markers and one folder per task (summary + stream CSVs) into out_dir.

    Without any task marker pair, the stream CSVs of the full recording are written into out_dir instead.
    Returns (number of tasks, number of unmatched task markers, whether there is a marker stream).
    """
    lines = [
        "=" * 70,
        f"{xdf_path}  ({len(streams)} stream{'' if len(streams) == 1 else 's'})",
    ]
    lines += summarize_streams(streams)

    markers = marker_streams(streams)
    pairs, unmatched = pair_task_markers(markers) if markers else ([], [])
    if markers:
        lines += summarize_task_markers(pairs, unmatched, TASK_MARKERS_NAME)
        write_task_markers_csv(pairs, out_dir / TASK_MARKERS_NAME)

    if not pairs:
        reason = "No task marker pairs" if markers else "No marker stream"
        lines += ["-" * 70, f"WARNING: {reason}: stream CSVs cover the full recording"]
        write_lines(out_dir / SUMMARY_NAME, lines)
        write_stream_csvs(streams, out_dir, t0=recording_start(streams), time_column="time_from_recording_start")
        return 0, len(unmatched), bool(markers)

    write_lines(out_dir / SUMMARY_NAME, lines)
    for pair in pairs:
        task_dir = out_dir / task_dir_name(pair)
        task_dir.mkdir()
        task_streams = [slice_stream(s, pair["start_time"], pair["end_time"]) for s in streams]
        write_lines(task_dir / SUMMARY_NAME, summarize_task(pair, task_streams))
        write_stream_csvs(task_streams, task_dir, t0=pair["start_time"])

    return len(pairs), len(unmatched), True


def process_recording(xdf_path, out_dir):
    """Process one XDF file into out_dir; returns True on success.

    The output is built in a hidden .<name>.partial folder next to out_dir and only renamed to out_dir once complete,
    so an interrupted run never leaves a folder that looks processed. An existing out_dir is replaced.
    """
    try:
        streams, _header = pyxdf.load_xdf(str(xdf_path))
    except Exception as e:
        log.error("Could not load %s: %s", xdf_path, e)
        return False

    tmp_dir = out_dir.with_name(f".{out_dir.name}.partial")
    if tmp_dir.exists():
        shutil.rmtree(tmp_dir)
    tmp_dir.mkdir(parents=True)

    try:
        result = write_outputs(xdf_path, streams, tmp_dir)
    except Exception:
        log.exception("Could not process %s", xdf_path)
        shutil.rmtree(tmp_dir, ignore_errors=True)
        return False

    if out_dir.exists():
        shutil.rmtree(out_dir)
    tmp_dir.rename(out_dir)

    n_tasks, n_unmatched, has_markers = result
    if not has_markers:
        log.warning("  %d streams, no marker stream: exported the full recording -> %s", len(streams), out_dir)
    elif not n_tasks:
        log.warning("  %d streams, no task marker pairs (%d unmatched task markers): exported the full recording -> %s",
                    len(streams), n_unmatched, out_dir)
    else:
        log.info("  %d streams, %d tasks, %d unmatched task markers -> %s", len(streams), n_tasks, n_unmatched, out_dir)
    return True
