// Shared visual config + state enum for every River Crossing variant
// (breath-controlled, tap-controlled, ...). They all look identical — only
// the input mechanic that drives the boat differs — so this is the one
// place that tunes the shared scene: river/bank layout, boat/sheep size,
// tree count, wave speed. Each game's own _config.js holds only its
// input/physics-specific constants (BLOW_THRESHOLD, TAP_WINDOW_MS, ...).

export const VISUAL_CONFIG = {
  // ── Layout ──────────────────────────────────────────────────────────────
  RIVER_TOP_RATIO:        0.52,
  RIVER_BOTTOM_RATIO:     0.80,
  RIVER_LEFT_BANK_RATIO:  0.16,
  RIVER_RIGHT_BANK_RATIO: 0.16,

  // ── Sheep ───────────────────────────────────────────────────────────────
  SHEEP_COUNT_RIGHT:    4,   // always-available flock on the right bank
  SHEEP_MAX_SHOWN_LEFT: 24,  // cap on delivered-sheep icons drawn on the left bank
  SHEEP_SCALE: 1.7,

  // ── Boat / sailor size ──────────────────────────────────────────────────
  BOAT_SCALE: 2.8,

  // ── Scenery ─────────────────────────────────────────────────────────────
  WAVE_SPEED: 2.6,           // phase rate for the traveling river-wave pattern (a bit faster = stronger-looking current)
  TREE_COUNT_PER_BANK: 9,    // scattered along each bank's treeline, varied sizes
};

export const STATE = {
  IDLE:      'idle',
  COUNTDOWN: 'countdown',
  PLAYING:   'playing',
  GAME_OVER: 'game_over',
};
