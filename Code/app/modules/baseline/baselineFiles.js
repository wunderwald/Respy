// Baseline output file naming + the natural-BPM read-back used by bioGame.
//
// Kept in one place so the writer (baseline.js) and the reader (bioGame's
// natural-BPM auto-load in experimenter.js) can't drift apart.

import { CONFIG } from './baseline_config.js';

// The baseline whose breathing rate is the participant's natural rate.
export const RESTING = CONFIG.NAMES.find((n) => n.slug === 'resting') ?? CONFIG.NAMES[0];

// Physiologic range for a usable estimate (breaths per minute).
const BPM_MIN = 4;
const BPM_MAX = 25;

/** `<DATA_DIR>/<subject>_baseline_<slug>` — add `.csv` or `_estimates.csv`. */
export function baselineFileStem(subjectCode, slug) {
  return `${CONFIG.DATA_DIR}/${subjectCode}_baseline_${slug}`;
}

export function estimatesPath(subjectCode, slug) {
  return `${baselineFileStem(subjectCode, slug)}_estimates.csv`;
}

// Files written before baselines had names.
function legacyEstimatesPath(subjectCode) {
  return `${CONFIG.DATA_DIR}/${subjectCode}_baseline_estimates.csv`;
}

/**
 * Natural breathing rate from the subject's Resting baseline estimates
 * (falling back to the pre-name file). Averages every method's estimate
 * within the physiologic range.
 *
 * @param {string} subjectCode
 * @param {(path: string) => Promise<{ok: boolean, content?: string}>} readFile
 * @returns {Promise<
 *   | { status: 'ok', bpm: number, count: number, path: string }
 *   | { status: 'missing' }
 *   | { status: 'invalid', path: string }>}
 */
export async function loadNaturalBpm(subjectCode, readFile) {
  for (const path of [estimatesPath(subjectCode, RESTING.slug), legacyEstimatesPath(subjectCode)]) {
    const result = await readFile(path);
    if (!result.ok) continue;
    const values = parseBpmValues(result.content);
    return values.length
      ? { status: 'ok', bpm: values.reduce((a, b) => a + b, 0) / values.length, count: values.length, path }
      : { status: 'invalid', path };
  }
  return { status: 'missing' };
}

// The `bpm` column, located by its header name (works for the legacy
// `method,hz,bpm` and the current `method,hz,bpm,name` layouts alike).
function parseBpmValues(content) {
  const lines = content.trim().split(/\r?\n/);
  const col   = lines[0]?.split(',').indexOf('bpm') ?? -1;
  if (col === -1) return [];
  const values = [];
  for (const line of lines.slice(1)) {
    const bpm = parseFloat(line.split(',')[col]);
    if (Number.isFinite(bpm) && bpm >= BPM_MIN && bpm <= BPM_MAX) values.push(bpm);
  }
  return values;
}
