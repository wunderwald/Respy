export const CALIBRATION_CONFIG = {
  COUNTDOWN_MS: 3750, // 3-2-1-GO!, same convention used throughout the games
  HOLD_MS: 3000,      // each blow/quiet recording window
  BREAK_MS: 1500,     // short rest between windows
  REPS: 2,            // repeat each prompt (blow, then quiet) this many times

  // The binary blow/quiet detection only works if there's a clear gap
  // between "quiet" and "blow". Warn (rather than silently produce a
  // useless range) in either failure direction:
  //   - the quiet ceiling gets too close to the blow level ("silence was
  //     too loud" — a noisy room, or a very sensitive mic)
  MAX_QUIET_RATIO: 0.6,
  //   - the blow level isn't comfortably above the quiet phase's own noise
  //     floor ("the blow was too quiet" — measured self-relative to that
  //     phase's mean + N standard deviations, not a fixed absolute number,
  //     since mic gain/distance varies per device)
  MIN_BLOW_ABOVE_QUIET_STD: 3,
};

export default CALIBRATION_CONFIG;
