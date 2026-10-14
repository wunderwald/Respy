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
  // the x-geometry below. With the defaults, speed works out to ≈0.000159/ms
  // while approaching, ≈0.00009/ms while crossing the target zone, and
  // ≈0.000173/ms on exit — i.e. clearly faster on exit than in the target
  // zone (the exit segment is ~1.9x faster), matching the "fast on exit"
  // requirement. The target zone is wide, so it's no longer much slower than
  // the approach itself — only the exit speed-up is guaranteed by design.
  APPROACH_DURATION_MS:    4000,  // spawn → target zone (halved from the original 8000ms)
  TARGET_AREA_DURATION_MS: 3000,  // crossing the target zone
  EXIT_DURATION_MS:        1500,  // target zone → off-screen
  COUNTDOWN_SECS:          3.75,  // 3-2-1-GO before each phase (3 + 2 + 1 + GO! each 1s, GO 0.75s)

  // ── Target geometry (normalized canvas fractions) ───────────────────────
  SPAWN_X_RATIO:    -0.08,  // fish start x (off-screen left)
  TARGET_X_START:    0.55,  // left edge of the target x-band
  TARGET_X_END:      0.82,  // right edge of the target x-band (width = 0.27, 4.5x the original 0.06)
  DESPAWN_X_RATIO:   1.08,  // fish end x (off-screen right)

  TARGET_Y_MIN:      0.25,  // random target-centre y range (normalized play area)
  TARGET_Y_MAX:      0.75,

  // Half-heights of the nested bands around the target centre, outermost last.
  // The green band is 2x its original height; yellow/red keep their original
  // ring thickness, just pushed outward by the same amount green grew.
  TARGET_HEIGHT:        0.090,  // green band (the "hold" zone) — 2x the original 0.045
  TARGET_HEIGHT_YELLOW: 0.135,
  TARGET_HEIGHT_RED:    0.195,

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
  COUNTDOWN:   'countdown',   // 3-2-1-GO before each phase (training and test)
  TRAINING:    'training',    // training phase of the current trial (target visible)
  TEST:        'test',        // test phase of the current trial (target hidden)
  DONE:        'done',
};
