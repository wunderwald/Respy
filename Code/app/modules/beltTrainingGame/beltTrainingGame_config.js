export const CONFIG = {
  // ── Experiment ───────────────────────────────────────────────────────────
  SUBJECT_CODE:          'TEST',
  SCENE:                 'ocean',   // fixed — no experimenter scene selector
  DATA_DIR:              'output_data/belt_training_game',
  SEND_MARKERS:          true,
  MARKER_STREAM_URL:     'ws://localhost:9001',

  // ── Trials ───────────────────────────────────────────────────────────────
  NUM_TRIALS:            9,
  CALIBRATION_SECS:      30,
  // TODO: measure real min/max from pilot recordings and replace these placeholders
  DEFAULT_CAL_RANGE:     [0.2, 0.8],  // used if the experimenter chooses "use default" after a failed calibration

  // ── Range adaptation ─────────────────────────────────────────────────────
  // Follows drift in the signal's range after calibration (see AdaptiveRange
  // in calibration.js). Applied continuously during training/test phases.
  RANGE_ADAPT:              true,
  RANGE_WINDOW_SECS:        60,
  RANGE_TIME_CONSTANT_SECS: 10,
  RANGE_MIN_SPAN_FRACTION:  0.3,

  // ── Signal processing ────────────────────────────────────────────────────
  SMOOTH_WINDOW:         64,    // GaussianSmoother window

  // ── Phase timing ─────────────────────────────────────────────────────────
  // The fish's x-speed over each segment follows from these durations and
  // the x-geometry below. With the defaults, speed works out to ≈0.000103/ms
  // while approaching, ≈0.00002/ms while crossing the (narrow) target zone,
  // and ≈0.000187/ms on exit — i.e. slow in the target zone, fast on exit.
  APPROACH_DURATION_MS:    8000,  // spawn → target zone
  TARGET_AREA_DURATION_MS: 3000,  // crossing the target zone
  EXIT_DURATION_MS:        1500,  // target zone → off-screen

  // ── Target geometry (normalized canvas fractions) ───────────────────────
  SPAWN_X_RATIO:    -0.08,  // fish start x (off-screen left)
  TARGET_X_START:    0.74,  // left edge of the target x-band
  TARGET_X_END:      0.80,  // right edge of the target x-band
  DESPAWN_X_RATIO:   1.08,  // fish end x (off-screen right)

  TARGET_Y_MIN:      0.25,  // random target-centre y range (normalized play area)
  TARGET_Y_MAX:      0.75,

  // Half-heights of the nested bands around the target centre, outermost last.
  TARGET_HEIGHT:        0.045,  // green band (the "hold" zone)
  TARGET_HEIGHT_YELLOW: 0.090,
  TARGET_HEIGHT_RED:    0.150,

  // ── Avatar ───────────────────────────────────────────────────────────────
  AVATAR_SIZE_MIN: 0.09,  // height as fraction of canvas height
  AVATAR_SIZE_MAX: 0.15,

  // ── Test-phase cover ─────────────────────────────────────────────────────
  BUBBLE_COUNT: 24,

  // ── Data recording ───────────────────────────────────────────────────────
  FRAME_INTERVAL_MS: 50,    // 20 fps of frame data
  FRAME_FLUSH_COUNT: 400,   // flush after this many buffered rows
};

export const STATE = {
  IDLE:        'idle',
  CALIBRATING: 'calibrating',
  READY:       'ready',       // waiting for experimenter/Space before a trial
  TRAINING:    'training',    // training phase of the current trial (target visible)
  TEST:        'test',        // test phase of the current trial (target hidden)
  DONE:        'done',
};
