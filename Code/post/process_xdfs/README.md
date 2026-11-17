# process_xdfs

Backs up and processes the XDF recordings of the study. Meant to be run after each recording session: recordings that
already have an output folder are skipped, so only new ones are processed.

```
python process_xdfs.py [--input DIR] [--output DIR] [--backup DIR] [--overwrite] [--disable_backup]
```

| Argument | Default (constant in `process_xdfs.py`) | |
|---|---|---|
| `--input` | `INPUT_DIR` | directory searched recursively for `.xdf` files |
| `--output` | `OUTPUT_DIR` | directory for the processed data |
| `--backup` | `BACKUP_DIR` | directory the `.xdf` files are copied to |
| `--overwrite` | `OVERWRITE = False` | reprocess recordings that already have an output folder (the folder is replaced) |
| `--disable_backup` | `DISABLE_BACKUP = False` | do not copy the `.xdf` files to the backup directory |

The exit code is 1 if any recording could not be loaded, processed or backed up.

## Backup

Every `.xdf` file is copied to `BACKUP_DIR/<path relative to INPUT_DIR>`. Files already in the backup (same size) are
skipped. A backup file that differs from the recording is never replaced; a warning is logged instead.

## Output

For `INPUT_DIR/<path>/<name>.xdf`:

```
OUTPUT_DIR/<path>/<name>/
  summary.txt             stream summary (type, format, shape, srate, duration, labels) + task marker pairs
  task_markers.csv        task_name, index, start_marker, end_marker, start_time, end_time; one row per pair
  <task>_<index>/         one folder per task, e.g. rest_1, breathing_game_2_aborted
    summary.txt           task times + stream summary of the data within the task
    <stream name>.csv     timestamp, time_from_task_start, one column per channel
```

- **Task markers** are read from all streams with `marker` in their name. `task_start_<task>` is paired with the next
  `task_end_<task>` or `task_abort_<task>` (folder suffix `_aborted`) if no other task marker lies between them;
  the index counts the pairs per task. Unmatched task markers are listed in the top-level `summary.txt` only.
- **Stream CSVs** hold the samples with `start_time <= timestamp <= end_time` of every stream, marker streams included.
  Channel columns are named by the channel labels from the recording, or `ch0`, `ch1`, ... if there are none. A stream
  without samples in a task gets a header-only CSV and a warning in the task's `summary.txt`.
  Data outside of tasks is not exported.
- **Recordings without task marker pairs** (no marker stream, or no matching start/end) get no task folders; instead
  the full recording of every stream is written to `<stream name>.csv` directly in `OUTPUT_DIR/<path>/<name>/`, with
  `time_from_recording_start` (from the earliest timestamp of all streams) as second column. This is logged as a
  warning and noted in `summary.txt`.
- Output is written to a hidden `.<name>.partial` folder and renamed when complete, so an interrupted run never leaves
  a folder that would be skipped as processed.

## Files

| File | |
|---|---|
| `process_xdfs.bat` | Windows launcher with the settings at the top |
| `process_xdfs.py` | settings, CLI, backup, finding the recordings to process |
| `process_recording.py` | processing of one recording into its output folder |
| `stream_summary.py` | stream and task summaries, cutting streams to a time window |
| `task_markers.py` | finding marker streams, pairing task markers, task marker table/CSV |
| `export_streams.py` | writing streams to CSV |
