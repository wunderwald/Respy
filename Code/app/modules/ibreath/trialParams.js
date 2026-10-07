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
  // built-in 100%-'sync' default). Balanced into the smallest shuffled block that reproduces
  // each question's probability exactly (e.g. 50/16.7/16.7/16.7 -> a 6-trial block of
  // [sync x3, flash, lr, img]; 80/20 -> a 5-trial block of [sync x4, placeholder]), repeated and
  // reshuffled to fill the requested length. Built separately for sync and async trials (see
  // call site below) so both see the same question mix, not just the combined pool overall.
  function questionBlockCounts(questions) {
    const probs = questions.map(q => q.probability);
    const MAX_B = 120;
    const EPS = 1e-3;   // tight on purpose — only accept a B that reconstructs the given
                        // probabilities almost exactly, not merely "close given B's own rounding"
    for (let B = questions.length; B <= MAX_B; B++) {
      const counts = probs.map(p => Math.round(p * B));
      if (counts.reduce((a, b) => a + b, 0) !== B) continue;
      const exact = counts.every((c, i) =>
        (probs[i] <= 0 || c > 0) && Math.abs(c / B - probs[i]) <= EPS
      );
      if (exact) return counts;
    }
    // Fallback for probabilities that don't reduce to a small clean block
    // (shouldn't happen for any preset we ship, but don't hang if it does).
    return probs.map(p => Math.max(0, Math.round(p * MAX_B)));
  }

  function makeQuestionSeq(n, questions) {
    const counts = questionBlockCounts(questions);
    const block = [];
    questions.forEach((q, i) => {
      for (let k = 0; k < counts[i]; k++) block.push(q.id);
    });

    const out = [];
    while (out.length < n) {
      const b = [...block];
      for (let i = b.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [b[i], b[j]] = [b[j], b[i]];
      }
      out.push(...b);
    }
    return out.slice(0, n);
  }

  const lrSeq       = balancedSeq(numTrials, 4);     // left / right
  const saSeq       = balancedSeq(numTrials, 2);     // sync / async alternating
  const starfishSeq = balancedSeq(numTrials, 4, 1);  // 25% starfish, 75% pufferfish
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
      img:          starfishSeq[i] ? 'starfish' : 'pufferfish',
      lr:           lrSeq[i],          // true = left, false = right
      stimX0:       lrSeq[i] ? 0 : 0.5,
      stimY0:       0,
      stimX1:       lrSeq[i] ? 0.5 : 1,
      stimY1:       1,
      ITI:          iti,               // ms
      questionType: sync ? syncQuestionSeq[syncQIdx++] : asyncQuestionSeq[asyncQIdx++],
      delayMs:      null,              // async trials only — set at trial start from the adaptive staircase
      flashImage:   null,              // image name, or null if no flash this trial
      flashTime:    null,              // seconds into trial when flash fires
      flashX:       null,              // normalised [0,1] horizontal position
      flashY:       null,              // normalised [0,1] vertical position
      startTime:    null,
      endTime:      null,
    };

    if (CONFIG.FLASHING_IMAGE && flashSeq[i]) {
      trial.flashImage = CONFIG.FLASH_IMAGE;
      const flashMax = Math.min(
        CONFIG.FLASH_TIME_MAX,
        CONFIG.MAX_TRIAL_TIME - CONFIG.FLASH_DURATION / 1000
      );
      trial.flashTime = +(CONFIG.FLASH_TIME_MIN +
        Math.random() * (flashMax - CONFIG.FLASH_TIME_MIN)).toFixed(2);
      trial.flashX = +Math.random().toFixed(4);
      trial.flashY = +Math.random().toFixed(4);
    }

    trials.push(trial);
  }
  return trials;
}
