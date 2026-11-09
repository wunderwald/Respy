// Explanation screens shown to the child before calibration and before the
// task, in every experiment. All wording lives here (one place to translate).
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
      ? ['Sit still and relax.']
      : ['Sit still and breathe calmly.', 'Just breathe like you always do.'];
    return { title: "Let's get ready!", lines };
  },

  bioGame() {
    return {
      title: 'Catch the stars!',
      lines: [
        'You are the fish. Your breathing makes it swim.',
        'Breathe in → the fish swims up.',
        'Breathe out → the fish swims down.',
        'Catch as many stars as you can!',
      ],
    };
  },

  beltTrainingGame({ trainingPasses = 2 } = {}) {
    return {
      title: 'Keep the fish in the green!',
      lines: [
        'Your breathing moves the fish up and down.',
        'The fish swims through a green stripe.',
        'Breathe until the fish is in the green. Then hold your breath to keep it there!',
        `First you practise ${trainingPasses} times.`,
        'Then the stripe hides under bubbles. Do it just like before!',
        'After that, you get a photo of your fish.',
      ],
    };
  },

  // `questionIds`: ids of the session's question set — 'img' / 'lr' / 'flash'
  // add a "look carefully" line naming what to watch for.
  ibreath({ signal = 'physiological', questionIds = [] } = {}) {
    const lines = signal === 'peaksOnly'
      ? ['The fish pulses with your heartbeat.',
         'Sometimes it beats together with your heart. Sometimes it is a little late.']
      : ['The fish grows and shrinks with your breathing.',
         'Sometimes it follows your breathing exactly. Sometimes it is a little late.'];
    lines.push('After each fish, you answer a question.', 'Use the arrows: ← or →.');

    const watch = [
      questionIds.includes('img')   && 'which fish is it',
      questionIds.includes('lr')    && 'where is it',
      questionIds.includes('flash') && 'does a pink fish flash',
    ].filter(Boolean);
    if (watch.length) {
      const list = watch.length > 1
        ? `${watch.slice(0, -1).join(', ')}, and ${watch.at(-1)}`
        : watch[0];
      lines.push(`Look carefully: ${list}?`);
    }
    return { title: 'Watch the fish!', lines };
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
