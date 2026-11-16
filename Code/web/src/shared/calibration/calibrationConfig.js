export const CALIBRATION_CONFIG = {
  // Breathe-with-the-sun flow: a short intro, then CYCLES of
  // "breathe in through your nose" (sun grows — measures the quiet level,
  // since nasal breathing barely registers on the mic) followed by
  // "breathe out through your mouth" (sun shrinks — measures the blow level).
  // No hold phases between them.
  INTRO_MS: 4000,     // "Breathe with the sun" instructions before the first breath
  // 10 breaths/min (6 s per cycle)
  INHALE_MS: 3000,
  EXHALE_MS: 3000,
  CYCLES: 3,          // ~22 s total including the intro
  // Samples from the first part of each phase are discarded: children react
  // late to the prompt, and the tail of the previous exhale would otherwise
  // leak into the next inhale's "quiet" measurement.
  SETTLE_MS: 700,

  // Sun size, as fractions of the sun canvas's side: fully breathed out
  // (small) vs. fully breathed in (big). Rays reach ~1.95 r at full mic level,
  // so SUN_MAX_R must stay below ~0.25 to keep them inside the canvas.
  SUN_MIN_R: 0.12,
  SUN_MAX_R: 0.24,

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
