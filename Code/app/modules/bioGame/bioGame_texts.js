// Everything bioGame shows to the child on the scene screen (German, simple
// words). The explanation screens are in modules/instructions/instructionTexts.js.

export const TEXTS = {
  go:                'LOS!',                                 // end of the 3-2-1 countdown
  scoreLabel:        'Sterne',                               // under the score counter (slow group)
  intermissionTitle: (game) => `Spiel ${game} geschafft. Super gemacht!`,
  starsCollected:    (n) => (n === 1 ? '1 Stern gesammelt' : `${n} Sterne gesammelt`),
  doneTitle:         'Geschafft! Super gemacht!',            // end screen
  perGame:           (game, stars) => `Spiel ${game}: ${stars}`,
};
