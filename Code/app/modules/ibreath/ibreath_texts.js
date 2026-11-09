// Everything iBreath shows to the child on the scene screen (German, simple
// words) — except the explanation screens (modules/instructions/
// instructionTexts.js) and the post-trial questions, whose text and answer
// labels come from CONFIG.QUESTIONS / the loaded preset.

export const TEXTS = {
  waiting: "Gleich geht's los …",          // before Start
  ready:   "Gleich geht's weiter!",        // READY between trials (only with AUTO_ADVANCE off)
  paused:  'Kurze Pause',
  eyeCal:  'Einen Moment bitte …',         // eye-tracker calibration (scene usually minimized)
  done:    'Geschafft! Super gemacht!',    // end screen
};
