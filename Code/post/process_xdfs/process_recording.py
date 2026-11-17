import logging
import shutil

import pyxdf

from export_streams import safe_name, write_stream_csvs
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

    Returns (number of tasks, number of unmatched task markers), or None if there is no marker stream.
    """
    lines = [
        "=" * 70,
        f"{xdf_path}  ({len(streams)} stream{'' if len(streams) == 1 else 's'})",
    ]
    lines += summarize_streams(streams)

    markers = marker_streams(streams)
    if not markers:
        lines += ["-" * 70, "No marker stream: no task markers, no task folders"]
        write_lines(out_dir / SUMMARY_NAME, lines)
        return None

    pairs, unmatched = pair_task_markers(markers)
    lines += summarize_task_markers(pairs, unmatched, TASK_MARKERS_NAME)
    write_lines(out_dir / SUMMARY_NAME, lines)
    write_task_markers_csv(pairs, out_dir / TASK_MARKERS_NAME)

    for pair in pairs:
        task_dir = out_dir / task_dir_name(pair)
        task_dir.mkdir()
        task_streams = [slice_stream(s, pair["start_time"], pair["end_time"]) for s in streams]
        write_lines(task_dir / SUMMARY_NAME, summarize_task(pair, task_streams))
        write_stream_csvs(task_streams, task_dir, t0=pair["start_time"])

    return len(pairs), len(unmatched)


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

    if result is None:
        log.info("  %d streams, no marker stream -> %s", len(streams), out_dir)
    else:
        n_tasks, n_unmatched = result
        log.info("  %d streams, %d tasks, %d unmatched task markers -> %s", len(streams), n_tasks, n_unmatched, out_dir)
    return True
