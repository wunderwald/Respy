import argparse
import logging
from pathlib import Path
import pyxdf

from stream_summary import summarize_streams, summarize_trials
from task_markers import marker_streams, pair_task_markers, summarize_task_markers, write_task_markers_csv

"""
LOGGING
"""
log = logging.getLogger(__name__)


def summarize_xdf(path, trial_details=False):
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
        if trial_details:
            lines += summarize_trials(streams, pairs)
    elif trial_details:
        log.warning("%s: no marker stream, skipping --trial_details", path)

    for line in lines:
        log.info("%s", line)

    summary_path.write_text("\n".join(lines) + "\n")
    log.info("Wrote %s", summary_path)
    if markers:
        log.info("Wrote %s", csv_path)


def find_xdf_files(input_path):
    """Return the .xdf files to summarize: the file itself, or all .xdf files below a directory."""
    if input_path.is_dir():
        return sorted(p for p in input_path.rglob("*") if p.is_file() and p.suffix.lower() == ".xdf")
    return [input_path]


def parse_args():
    parser = argparse.ArgumentParser(description="Summarize the streams and task markers of XDF recordings.")
    parser.add_argument("input", type=Path,
                        help="an .xdf file, or a directory that is searched recursively for .xdf files")
    parser.add_argument("--trial_details", "--trial-details", action="store_true",
                        help="also summarize every stream per trial (task marker pair), with trial duration "
                             "and warnings for streams that are empty in a trial")
    return parser.parse_args()


def main():
    args = parse_args()

    logging.basicConfig(level=logging.INFO, format="%(message)s")
    logging.getLogger("pyxdf").setLevel(logging.WARNING)

    if not args.input.exists():
        log.error("Input not found: %s", args.input.resolve())
        return

    xdf_files = find_xdf_files(args.input)
    if not xdf_files:
        log.warning("No .xdf files found in %s", args.input.resolve())
        return

    if args.input.is_dir():
        log.info("Found %d XDF file(s) in %s", len(xdf_files), args.input.resolve())
    for path in xdf_files:
        summarize_xdf(path, trial_details=args.trial_details)


if __name__ == "__main__":
    main()
