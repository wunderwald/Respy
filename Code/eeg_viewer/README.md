# eeg-viewer

Minimalistic Electron app for viewing EEG data from CSV files.

## Run

```bash
npm install
npm start
```

To build a distributable:

```bash
npm install --save-dev electron-builder
npx electron-builder --mac    # macOS .dmg
npx electron-builder --win    # Windows installer
npx electron-builder --linux  # Linux AppImage
```

## Interactions

**Sidebar**
- *Open EEG CSV* — load an EEG recording; resets the view and clears any loaded markers.
- *Load Marker CSV* — load one or more marker files (multi-select). Markers overlay all channel views and the filter pane. Requires an EEG file to be loaded first.
- Channel checkboxes — show or hide individual channels. *all / none* toggles the whole set.

**Filter pane** (butterfly plot at the bottom)
- Drag on empty space to draw a time selection; the channel views zoom to that window.
- Drag inside the shaded region to pan the selection left/right.
- Drag either white edge handle to resize the selection.
- Click without dragging to clear the selection (shows the full recording).

**View pane** (channel traces)
- Scroll vertically to move through channels.
- Two-finger swipe horizontally (trackpad) to pan through the recording — requires an active time selection in the filter pane.
- Pinch on the trackpad to zoom: spread fingers to zoom in (shrinks the selection), pinch together to zoom out. Creates a full-range selection automatically if none exists.
- Drag the thin bar at the bottom of any channel track to resize its height.

## CSV formats

**EEG file** — one `time` column, one column per channel:

```
time,Fp1,Fp2,F3,F4
0.000,12.3,-4.5,0.1,3.2
0.004,11.8,-4.2,0.3,3.0
```

**Marker file** — `time` and `value` columns:

```
time,value
0.512,stimulus_onset
1.204,response
```

**Time column** — instead of `time`, the stream CSVs written by `post/process_xdfs` also work. The first column found is used, in this order: `time`, `time_from_task_start`, `time_from_recording_start`, `timestamp`. Any other time column is ignored. In a marker file without a `value` column, the first non-time column holds the marker values. Load EEG and marker files exported together, so they share the same time base.

Multiple marker files can be selected at once; their events are merged. Invalid files trigger a warning popup and are skipped.
