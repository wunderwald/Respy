import { CONFIG } from './config.js';

export function makeTrialParams(numTrials) {
  // Balanced pseudo-random boolean sequence.
  // Each block of `blockSize` contains exactly `trueCount` true values (default 50%).
  function balancedSeq(length, blockSize, trueCount = Math.floor(blockSize / 2)) {
    const out = [];
    while (out.length < length) {
      const block = Array.from({ length: blockSize }, (_, i) => i < trueCount);
      for (let i = block.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [block[i], block[j]] = [block[j], block[i]];
      }
      out.push(...block);
    }
    return out.slice(0, length);
  }

  // Question sequence — built from CONFIG.QUESTIONS (a preset's `questions` list, or the
  // built-in 100%-'sync' default), separately for the sync and the async trials (see call
  // site below) so both see the same question mix. Each sequence of n trials gets the
  // whole-number counts closest to the probabilities (largest-remainder method: everyone
  // gets floor(p × n), the leftover trials go to the largest remainders, ties drawn at
  // random), then is shuffled. E.g. 80/6/6/8 % over 15 trials → 12 sync + 1 of each other
  // question (exact shares 12 / 0.9 / 0.9 / 1.2).
  function questionCounts(n, questions) {
    const total  = questions.reduce((sum, q) => sum + q.probability, 0) || 1;
    // Tolerates sums ≠ 1; rounded so float noise (0.8+0.06+0.06+0.08 = 1.0000000000000002)
    // can't turn an exact 12 into 11.999….
    const exact  = questions.map((q) => Math.round(q.probability / total * n * 1e9) / 1e9);
    const counts = exact.map(Math.floor);
    let left = n - counts.reduce((a, b) => a + b, 0);
    const order = exact
      .map((x, i) => ({ i, rem: x - Math.floor(x), tie: Math.random() }))
      .sort((a, b) => (b.rem - a.rem) || (a.tie - b.tie));
    for (let k = 0; left > 0; k = (k + 1) % order.length, left--) counts[order[k].i]++;
    return counts;
  }

  function makeQuestionSeq(n, questions) {
    const counts = questionCounts(n, questions);
    const out = [];
    questions.forEach((q, i) => {
      for (let k = 0; k < counts[i]; k++) out.push(q.id);
    });
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  const lrSeq       = balancedSeq(numTrials, 4);     // left / right
  const saSeq       = balancedSeq(numTrials, 2);     // sync / async alternating
  const fish1Seq    = balancedSeq(numTrials, 4, 1);  // 25% fish1, 75% fish0
  const flashSeq    = CONFIG.FLASHING_IMAGE
    ? balancedSeq(numTrials, 2)                      // 50% of trials get a flash
    : null;

  const numSyncTrials  = saSeq.filter(Boolean).length;
  const numAsyncTrials = numTrials - numSyncTrials;
  const syncQuestionSeq  = makeQuestionSeq(numSyncTrials,  CONFIG.QUESTIONS);
  const asyncQuestionSeq = makeQuestionSeq(numAsyncTrials, CONFIG.QUESTIONS);
  let syncQIdx = 0, asyncQIdx = 0;

  const trials = [];

  for (let i = 0; i < numTrials; i++) {
    const sync = saSeq[i];
    const iti = CONFIG.ITI_MIN +
      Math.round(Math.random() * (CONFIG.ITI_MAX - CONFIG.ITI_MIN));

    const trial = {
      trialIndex:   i + 1,
      synchronous:  sync,
      img:          fish1Seq[i] ? 'fish1' : 'fish0',   // images/fish<N>.png
      lr:           lrSeq[i],          // true = left, false = right
      stimX0:       lrSeq[i] ? 0 : 0.5,
      stimY0:       0,
      stimX1:       lrSeq[i] ? 0.5 : 1,
      stimY1:       1,
      ITI:          iti,               // ms
      questionType: sync ? syncQuestionSeq[syncQIdx++] : asyncQuestionSeq[asyncQIdx++],
      delayMs:      null,              // async trials only — set at trial start from the adaptive staircase
      rangeMin:     null,              // signal range mapped to stimulus [0,1] — set at trial start
      rangeMax:     null,
      flashImage:   null,              // image name, or null if no flash this trial
      flashTime:    null,              // seconds into trial when flash fires
      flashX:       null,              // normalised [0,1] horizontal position
      flashY:       null,              // normalised [0,1] vertical position
      startTime:    null,
      endTime:      null,
    };

    if (CONFIG.FLASHING_IMAGE && flashSeq[i]) {
      trial.flashImage = CONFIG.FLASH_IMAGE;
      // Within [FLASH_TIME_MIN, FLASH_TIME_MAX], and always fully inside the
      // trial (a trial shorter than FLASH_TIME_MIN moves the window earlier).
      const flashMax = Math.max(0, Math.min(
        CONFIG.FLASH_TIME_MAX,
        CONFIG.TRIAL_DURATION_SECS - CONFIG.FLASH_DURATION / 1000
      ));
      const flashMin = Math.min(CONFIG.FLASH_TIME_MIN, flashMax);
      trial.flashTime = +(flashMin + Math.random() * (flashMax - flashMin)).toFixed(2);
      trial.flashX = +Math.random().toFixed(4);
      trial.flashY = +Math.random().toFixed(4);
    }

    trials.push(trial);
  }
  return trials;
}
