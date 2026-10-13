// Game-logic-only config — shared visuals (river/bank layout, sheep, boat
// size, trees) live in shared/riverCrossing/riverCrossingVisuals.js.
export { STATE } from '../shared/riverCrossing/riverCrossingVisuals.js';

export const CONFIG = {
  // ── Timing ──────────────────────────────────────────────────────────────────
  TARGET_BPM: 10,            // sets the boat's forward speed via half the breath period (10bpm = 6s cycle = 3s exhale)
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
  // The boat's velocity eases toward its target rather than snapping
  // instantly — ramping up to full forward speed stays snappy (small tau),
  // but decaying away once blowing stops is slow (large tau), so the boat
  // keeps coasting forward for a moment instead of immediately reversing on
  // every brief dip below BLOW_THRESHOLD.
  BOAT_ACCEL_TAU_SECS: 0.15,
  BOAT_COAST_TAU_SECS: 0.9,

  // ── Background ──────────────────────────────────────────────────────────────
  CLOUD_COUNT: 5,
  CLOUD_SPEED_PX_S: 16,
};
