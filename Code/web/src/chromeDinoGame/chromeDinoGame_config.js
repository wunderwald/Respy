export const CONFIG = {
  // ── World ───────────────────────────────────────────────────────────────────
  // Difficulty ramps smoothly from the START values (very easy) up to the
  // base/target values below over DIFFICULTY_RAMP_SECS of play — see
  // #difficultyT() in chromeDinoGame.js.
  SCROLL_SPEED_START_PX_S: 170,
  SCROLL_SPEED_PX_S: 320,
  DIFFICULTY_RAMP_SECS: 45,
  GROUND_Y_RATIO: 0.78,

  // ── Character ───────────────────────────────────────────────────────────────
  CHAR_X_RATIO: 0.12,
  CHAR_WIDTH: 26,
  CHAR_HEIGHT: 60,
  JUMP_HEIGHT_PX: 230,
  JUMP_DURATION_MS: 620,

  // ── Obstacles ───────────────────────────────────────────────────────────────
  OBSTACLE_WIDTH: 22,
  OBSTACLE_HEIGHT_MIN: 40,
  OBSTACLE_HEIGHT_MAX: 70,
  // Spacing (time between spawns) ramps from the wide START range down to
  // this smaller, tighter range as difficulty increases.
  MIN_OBSTACLE_INTERVAL_START_MS: 1800,
  MAX_OBSTACLE_INTERVAL_START_MS: 3000,
  MIN_OBSTACLE_INTERVAL_MS: 500,
  MAX_OBSTACLE_INTERVAL_MS: 1100,
  FIRST_OBSTACLE_DELAY_MS: 2000,

  // ── Breath / exhale onset detection ────────────────────────────────────────
  EXHALE_ONSET_THRESHOLD: 0.40,
  EXHALE_DEBOUNCE_MS: 400,

  // ── Background clouds (parallax) ───────────────────────────────────────────
  CLOUD_COUNT: 6,
  CLOUD_SPEED_RATIO: 0.35, // fraction of SCROLL_SPEED_PX_S
  CLOUD_MIN_SIZE: 40,
  CLOUD_MAX_SIZE: 90,
};

export const STATE = {
  IDLE:      'idle',
  COUNTDOWN: 'countdown',
  PLAYING:   'playing',
  GAME_OVER: 'game_over',
};
