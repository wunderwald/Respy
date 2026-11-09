// Explanation screens shown to the child before calibration and before the
// task, in every experiment. All wording lives here (one place to translate).
// Language: German (being translated experiment by experiment).
// Each function returns { title, lines } for drawInstructions().
//
// Keep it simple: short sentences, everyday words.

/** "about 30 seconds" / "about 7 minutes" */
function about(secs) {
  if (!(secs > 0)) return '';
  if (secs < 90) return `about ${Math.round(secs)} seconds`;
  return `about ${Math.round(secs / 60)} minutes`;
}

export const INSTRUCTIONS = {
  // Before the breathing calibration (iBreath, bioGame, beltTrainingGame).
  // `signal`: 'physiological' (breath) or 'peaksOnly' (heartbeat, iBeat).
  calibration({ signal = 'physiological' } = {}) {
    const lines = signal === 'peaksOnly'
      ? ['Sitz ruhig und entspann dich.']
      : ['Sitz ruhig und atme ganz entspannt.', 'Atme einfach so wie immer.'];
    return { title: 'Mach dich bereit!', lines };
  },

  bioGame() {
    return {
      title: 'Fang die Sterne!',
      lines: [
        'Dein Atem steuert den Fisch.',
        'Einatmen → der Fisch schwimmt nach oben.',
        'Ausatmen → der Fisch schwimmt nach unten.',
        'Sammel so viele Sterne, wie du kannst!',
      ],
    };
  },

  beltTrainingGame({ trainingPasses = 2 } = {}) {
    return {
      title: 'Halte den Fisch im grünen Bereich!',
      lines: [
        'Dein Atem steuert den Fisch nach oben und unten.',
        'Der Fisch schwimmt durch einen grünen Streifen.',
        'Atme, bis der Fisch im grünen Bereich ist. Dann halte die Luft an, damit er dort bleibt!',
        `Zuerst übst du ${trainingPasses}-mal.`,
        'Dann ist der Streifen hinter Luftblasen versteckt. Mach es genauso wie vorher!',
        'Danach bekommst du ein Foto von deinem Fisch.',
      ],
    };
  },

  // Deliberately says nothing about which questions come (fish type, side,
  // pink fish) — those should catch the child unprepared.
  ibreath({ signal = 'physiological' } = {}) {
    const lines = signal === 'peaksOnly'
      ? ['Der Fisch pocht mit deinem Herzschlag.',
         'Manchmal passt er genau zu deinem Herzschlag, manchmal nicht.']
      : ['Der Fisch wird mit deinem Atem größer und kleiner.',
         'Manchmal passt er genau zu deinem Atem. Manchmal ist er ein bisschen zu spät.'];
    lines.push('Nach jedem Fisch beantwortest du eine Frage.', 'Drück eine Pfeiltaste: ← oder →.');
    return { title: 'Schau genau auf den Fisch!', lines };
  },

  baseline({ durationSecs } = {}) {
    const lines = [
      'You will watch a calm video.',
      'Sit back and breathe normally.',
      'Try to sit still until the video ends.',
    ];
    if (durationSecs) lines.push(`It takes ${about(durationSecs)}.`);
    return { title: 'Time to relax', lines };
  },
};
