"""Back up and process all XDF recordings below INPUT_DIR (see README.md).

For every .xdf file, with <rel> = its path relative to INPUT_DIR:
  - copy it to BACKUP_DIR/<rel>, unless backups are disabled
  - process it into OUTPUT_DIR/<rel without .xdf>/, unless that folder exists already (or OVERWRITE is set)
"""
import argparse
import logging
import shutil
import sys
from pathlib import Path

from process_recording import process_recording

"""
SETTINGS (defaults; the command line arguments override them)
"""
INPUT_DIR = Path("recordings")    # placeholder: LabRecorder study root
OUTPUT_DIR = Path("processed")    # placeholder
BACKUP_DIR = Path("backup")       # placeholder
OVERWRITE = False                 # reprocess recordings that already have an output folder
DISABLE_BACKUP = False            # skip copying the .xdf files to BACKUP_DIR

"""
LOGGING
"""
log = logging.getLogger(__name__)


"""
HELPERS
"""
def find_xdf_files(input_dir, exclude_dirs):
    """Return all .xdf files below input_dir, except those inside exclude_dirs (output/backup inside the input)."""
    exclude_dirs = [d.resolve() for d in exclude_dirs]
    return sorted(
        p for p in input_dir.rglob("*")
        if p.is_file() and p.suffix.lower() == ".xdf"
        and not any(p.resolve().is_relative_to(d) for d in exclude_dirs)
    )


def backup_file(src, dst):
    """Copy src to dst. Skips if dst exists with the same size; never replaces a differing dst.

    Returns True if dst holds a copy of src afterwards.
    """
    if dst.exists():
        if dst.stat().st_size == src.stat().st_size:
            return True
        log.warning("  Backup %s exists but differs from the recording, not replacing it", dst)
        return False

    dst.parent.mkdir(parents=True, exist_ok=True)
    tmp = dst.with_name(f".{dst.name}.partial")
    shutil.copy2(src, tmp)
    tmp.replace(dst)
    log.info("  Backed up to %s", dst)
    return True


"""
MAIN
"""
def parse_args():
    parser = argparse.ArgumentParser(description="Back up and process the XDF recordings in a directory.")
    parser.add_argument("--input", type=Path, default=INPUT_DIR,
                        help=f"directory searched recursively for .xdf files (default: {INPUT_DIR})")
    parser.add_argument("--output", type=Path, default=OUTPUT_DIR,
                        help=f"directory for the processed data (default: {OUTPUT_DIR})")
    parser.add_argument("--backup", type=Path, default=BACKUP_DIR,
                        help=f"directory the .xdf files are copied to (default: {BACKUP_DIR})")
    parser.add_argument("--overwrite", action="store_true", default=OVERWRITE,
                        help="reprocess recordings that already have an output folder")
    parser.add_argument("--disable_backup", "--disable-backup", action="store_true", default=DISABLE_BACKUP,
                        help="do not copy the .xdf files to the backup directory")
    return parser.parse_args()


def main():
    args = parse_args()

    logging.basicConfig(level=logging.INFO, format="%(message)s")
    logging.getLogger("pyxdf").setLevel(logging.WARNING)

    if not args.input.is_dir():
        log.error("Input directory not found: %s", args.input.resolve())
        return 1

    xdf_files = find_xdf_files(args.input, exclude_dirs=[args.output, args.backup])
    log.info("Found %d XDF file(s) in %s", len(xdf_files), args.input.resolve())

    n_processed = n_skipped = n_failed = 0
    for path in xdf_files:
        rel = path.relative_to(args.input)
        log.info("%s", rel)

        if not args.disable_backup:
            try:
                if not backup_file(path, args.backup / rel):
                    n_failed += 1
            except OSError as e:
                log.error("  Backup failed: %s", e)
                n_failed += 1

        out_dir = args.output / rel.parent / rel.stem
        if out_dir.exists() and not args.overwrite:
            log.info("  Already processed, skipping")
            n_skipped += 1
            continue

        if process_recording(path, out_dir):
            n_processed += 1
        else:
            n_failed += 1

    log.info("Done: %d processed, %d already processed, %d error(s)", n_processed, n_skipped, n_failed)
    return 1 if n_failed else 0


if __name__ == "__main__":
    sys.exit(main())
