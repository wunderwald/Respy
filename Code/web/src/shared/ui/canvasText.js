// Shared sizing for canvas HUD/overlay text. The renderers' font sizes and
// HUD offsets are authored for a tablet (≈768px on the short side); on a
// phone those fixed pixel sizes dominate the screen. uiScale() shrinks them
// proportionally on smaller canvases, but never enlarges past the tablet
// design so tablets look exactly as authored.

const REF_W = 768;  // tablet portrait width / landscape height
const REF_H = 600;
const MIN_SCALE = 0.5;

/** Text/HUD scale factor in [MIN_SCALE, 1] for a canvas of w×h CSS px. */
export function uiScale(w, h) {
  return Math.max(MIN_SCALE, Math.min(1, w / REF_W, h / REF_H));
}

/** Canvas font string with the pixel size scaled by `s`. */
export function font(weight, px, s) {
  return `${weight} ${Math.round(px * s)}px Nunito, sans-serif`;
}
