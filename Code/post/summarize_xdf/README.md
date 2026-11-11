# summarize_xdf

Summarizes XDF recordings: one block per stream (type, format, shape, srate, duration, labels) and, if a stream with
`marker` in its name exists, the `task_start_<task>` / `task_end_<task>` / `task_abort_<task>` pairs.

```
python summarize_xdf.py <input> [--trial_details]
```

| Argument | |
|---|---|
| `input` | an `.xdf` file, or a directory that is searched recursively for `.xdf` files |
| `--trial_details` | additionally summarize every stream per trial (task marker pair): trial duration, and warnings for streams without samples in the trial |

Output is written next to each `.xdf` file (and printed to the console):

- `summary_<name>.txt` — stream summary, task marker pairs, unmatched task markers (and the per-trial summaries with `--trial_details`)
- `task_markers_<name>.csv` — `task_name, index, start_marker, end_marker, start_time, end_time`, one row per pair (only if there is a marker stream)
