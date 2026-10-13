export const CALIBRATION_CONFIG = {
  COUNTDOWN_MS: 3750, // 3-2-1-GO!, same convention used throughout the games
  HOLD_MS: 3000,      // each blow/quiet recording window
  BREAK_MS: 1500,     // short rest between windows
  REPS: 2,            // repeat each prompt (blow, then quiet) this many times

  // The binary blow/quiet detection only works if "quiet" is actually quiet
  // relative to a blow. Warn (rather than silently produce a useless range)
  // if the quiet ceiling gets too close to the blow level.
  MAX_QUIET_RATIO: 0.6,
};

export default CALIBRATION_CONFIG;
