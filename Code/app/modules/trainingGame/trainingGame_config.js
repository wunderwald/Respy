export const CONFIG = {
  // ── Timing ──────────────────────────────────────────────────────────────────
  TARGET_BPM: 6,             // sets the boat's forward speed via half the breath period
  GAME_DURATION_SECS: 180,   // 3 minutes

  // ── Breath / blow detection ────────────────────────────────────────────────
  BLOW_THRESHOLD: 0.40,
  BLOW_HYSTERESIS: 0.05,     // gap between on/off thresholds, avoids flag flicker
  SMOOTH_WINDOW: 16,         // GaussianSmoother window (samples)

  // ── Boat physics ────────────────────────────────────────────────────────────
  // Forward speed (while blowing) is derived from TARGET_BPM so a single
  // sustained half-period exhale crosses the river exactly. The current
  // (drift-back speed while not blowing) is deliberately gentler.
  CURRENT_SPEED_FACTOR: 0.65,

  // ── Layout ──────────────────────────────────────────────────────────────────
  RIVER_TOP_RATIO:        0.52,
  RIVER_BOTTOM_RATIO:     0.80,
  RIVER_LEFT_BANK_RATIO:  0.16,
  RIVER_RIGHT_BANK_RATIO: 0.16,

  // ── Sheep ───────────────────────────────────────────────────────────────────
  SHEEP_COUNT_RIGHT:    4,   // always-available flock on the right bank
  SHEEP_MAX_SHOWN_LEFT: 24,  // cap on delivered-sheep icons drawn on the left bank

  // ── Background ──────────────────────────────────────────────────────────────
  CLOUD_COUNT: 5,
  CLOUD_SPEED_PX_S: 16,
  WAVE_SPEED: 1.8,           // phase rate for the traveling river-wave pattern
};

export const STATE = {
  IDLE:      'idle',
  COUNTDOWN: 'countdown',
  PLAYING:   'playing',
  GAME_OVER: 'game_over',
};
