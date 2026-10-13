// Game-logic-only config — shared visuals (river/bank layout, sheep, boat
// size, trees) live in shared/riverCrossing/riverCrossingVisuals.js. Same
// scene and boat physics as trainingGame (River Crossing), but the boat is
// pushed by rapid tapping instead of blowing into the mic.
export { STATE } from '../shared/riverCrossing/riverCrossingVisuals.js';

export const CONFIG = {
  // ── Timing ──────────────────────────────────────────────────────────────────
  GAME_DURATION_SECS: 180,   // 3 minutes

  // ── Tap detection ────────────────────────────────────────────────────────────
  // "Pushing" is true whenever at least TAP_COUNT_THRESHOLD taps have landed
  // within the last TAP_WINDOW_MS — i.e. a sustained fast-tap rate, not just
  // any single tap. No separate on/off hysteresis is needed here (unlike the
  // breath version's BLOW_HYSTERESIS) — the boat's own coast momentum below
  // already smooths out the transition when tapping lets up.
  TAP_WINDOW_MS: 450,
  TAP_COUNT_THRESHOLD: 3,    // ~6.7 taps/sec sustained to stay "pushing"

  // ── Boat physics ────────────────────────────────────────────────────────────
  // Forward speed is a flat constant here (no breath-rate concept) — tuned so
  // sustained max-rate tapping crosses the river in about the same time as a
  // well-paced breath crossing, for comparable pacing between the two games.
  FORWARD_SPEED_POS_PER_SEC: 1 / 3, // full crossing in 3s of sustained tapping
  CURRENT_SPEED_FACTOR: 0.8,
  BOAT_ACCEL_TAU_SECS: 0.15,
  BOAT_COAST_TAU_SECS: 0.9,

  // ── Background ──────────────────────────────────────────────────────────────
  CLOUD_COUNT: 5,
  CLOUD_SPEED_PX_S: 16,
};
