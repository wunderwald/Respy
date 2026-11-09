export const CONFIG = {
  // Recording length. "Play full video" (default) ends the recording when the
  // video ends; unticked, the experimenter's seconds value is used instead.
  // DURATION_SECS is the fallback when the video is missing (or can't play),
  // and the default value of the experimenter's seconds field.
  DURATION_SECS:     420,   // 7 minutes
  SUBJECT_CODE:      'TEST',

  // Baseline name — the experimenter's "name" dropdown. `label` is written to
  // the CSVs' `name` column; `slug` goes into the file names (so several
  // baselines of one subject don't overwrite each other) and the
  // `baseline_name_<slug>` marker. bioGame's natural-BPM auto-load reads the
  // 'resting' one.
  NAMES: [
    { label: 'Resting',                 slug: 'resting' },
    { label: 'Post natural',            slug: 'post_natural' },
    { label: 'Post slow',               slug: 'post_slow' },
    { label: 'Post stressor',           slug: 'post_stressor' },
    { label: 'Post slow post stressor', slug: 'post_slow_post_stressor' },
  ],

  DATA_DIR:          'output_data/baseline', // do not change
  FLUSH_INTERVAL_MS: 1000,  // recorded rows are appended to the CSV this often (max data lost on a crash)

  // Resting-state video. Plays full-screen during the recording; if the file
  // is missing, falls back to the plain countdown display (DURATION_SECS).
  VIDEO_PATH: 'videos/01_Inscapes_NoScannerSound_h264.mov',
  VIDEO_MISSING_WARNING: 'video missing: download 01_Inscapes_NoScannerSound_h264.mov ' +
    'from https://www.headspacestudios.org/inscapes and place it in app/videos/.',

  SEND_MARKERS:      true,
  MARKER_STREAM_URL: 'ws://localhost:9001',
};

export const STATE = {
  IDLE:    'idle',
  PLAYING: 'playing',
  DONE:    'done',
};
