// Explanation screens shown to the child before calibration and before the
// task, in every experiment. All wording lives here (one place to translate).
// Language: German.
// Each function returns { title, lines } for drawInstructions().
//
// Keep it simple: short sentences, everyday words.

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

  baseline() {
    return {
      title: '',   // no title — just the two lines
      lines: [
        'Wir zeigen dir jetzt ein Video.',
        'Lehn dich zurück, entspann dich und genieß es!',
      ],
    };
  },
};
