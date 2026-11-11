import logging
from pathlib import Path
import pyxdf

from stream_summary import summarize_streams
from task_markers import marker_streams, pair_task_markers, summarize_task_markers, write_task_markers_csv

"""
I/O
"""
XDF_DIR = "./xdf"

"""
LOGGING
"""
log = logging.getLogger(__name__)


def summarize_xdf(path):
    path = Path(path)

    try:
        streams, _header = pyxdf.load_xdf(str(path))
    except Exception as e:
        log.error("Could not load %s: %s", path, e)
        return

    summary_path = path.with_name(f"summary_{path.stem}.txt")
    csv_path = path.with_name(f"task_markers_{path.stem}.csv")

    lines = [
        "=" * 70,
        f"Folder: {path.parent.name}",
        f"{path}  ({len(streams)} stream{'' if len(streams) == 1 else 's'})",
    ]
    lines += summarize_streams(streams)

    markers = marker_streams(streams)
    if markers:
        pairs, unmatched = pair_task_markers(markers)
        lines += summarize_task_markers(pairs, unmatched, csv_path.name)
        write_task_markers_csv(pairs, csv_path)

    for line in lines:
        log.info("%s", line)

    summary_path.write_text("\n".join(lines) + "\n")
    log.info("Wrote %s", summary_path)
    if markers:
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
