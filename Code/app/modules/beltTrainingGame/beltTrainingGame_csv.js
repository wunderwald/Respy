// CSV output for the Belt Training Game.
//
// Two file types written to CONFIG.DATA_DIR/<subjectCode>/:
//   eventData.csv          — one row per event (session info, phase transitions, target enter/leave)
//   frameData_trial<N>.csv  — one row per drawn animation frame of trial N
//
// Frame rows are buffered in memory and flushed every FRAME_FLUSH_COUNT rows
// (and at each phase end) to avoid high-frequency IPC.
//
// Session settings are written as `setting` rows right after session_start
// (value1 = name, value2 = value); a later `setting` row with the same name
// means it was changed mid-session. Block/trial numbers are 1-based; rows
// that belong to the whole session leave that column empty.

import { CONFIG } from './beltTrainingGame_config.js';

export class BeltTrainingGameCSV {
  #subjectCode;
  #scene;
  #settings;
  #onWarn;

  #frameBuffer       = [];
  #currentTrialIndex = 0;

  #frameHeader = 'timestamp,trialIndex,phase,segment,breathRaw,breathSmoothed,breathNorm,' +
                 'normMin,normMax,fishX,fishY,targetY,breathFilter\n';
  #eventHeader = 'timestamp,trialIndex,phase,event,value1,value2\n';

  // settings: { name: value } — written as `setting` rows by init().
  constructor(subjectCode, scene, settings, onWarn) {
    this.#subjectCode = subjectCode;
    this.#scene       = scene;
    this.#settings    = settings;
    this.#onWarn      = onWarn;
  }

  async init() {
    if (!window.api) {
      console.warn('[CSV] window.api unavailable — file I/O disabled');
      return;
    }
    // Header and first row are issued right away, with no await in between:
    // main handles file IPC in order (synchronous fs calls), so they always
    // land before any later write — even one sent right after Start. (A
    // round trip first, e.g. a separate ensureDir, could let an early event
    // through that the header write would then wipe.) writeCSV creates the
    // folder.
    const meta = this.#eventRow('', '', 'session_start', this.#scene, '') +
      Object.entries(this.#settings).map(([k, v]) => this.#eventRow('', '', 'setting', k, v)).join('');
    const [res, res2] = await Promise.all([
      window.api.writeCSV(this.#eventPath, this.#eventHeader),
      window.api.appendCSV(this.#eventPath, meta),
    ]);
    if (!res.ok)       this.#warn(`Could not init eventData.csv: ${res.error}`);
    else if (!res2.ok) this.#warn(`Could not write session_start: ${res2.error}`);
    else console.log(`[CSV] initialised ${this.#eventPath}`);
  }

  async initTrialCSV(trialIndex) {
    if (!window.api) return;
    this.#currentTrialIndex = trialIndex;
    const path = this.#framePath(trialIndex);
    const res  = await window.api.writeCSV(path, this.#frameHeader);
    if (!res.ok) this.#warn(`Could not init ${path}: ${res.error}`);
    else console.log(`[CSV] initialised ${path}`);
  }

  // Buffer a frame row. Call flushFrames() at phase/trial end to drain the remainder.
  bufferFrame(row) {
    this.#frameBuffer.push(row);
    if (this.#frameBuffer.length >= CONFIG.FRAME_FLUSH_COUNT) {
      this.flushFrames(this.#currentTrialIndex);
    }
  }

  async flushFrames(trialIndex) {
    const csv = this.#takeFrames();
    if (!csv || !window.api) return;
    const res = await window.api.appendCSV(this.#framePath(trialIndex), csv);
    if (!res.ok) this.#warn(`Could not write frame data: ${res.error}`);
  }

  async appendEvent(trialIndex, phase, event, value1 = '', value2 = '') {
    if (!window.api) return;
    const res = await window.api.appendCSV(this.#eventPath, this.#eventRow(trialIndex, phase, event, value1, value2));
    if (!res.ok) this.#warn(`Could not write event '${event}': ${res.error}`);
  }

  // ── Synchronous variants — only for the 'pagehide' handler (window
  //    closing), where an async write might never arrive. ────────────────

  flushFramesSync(trialIndex) {
    const csv = this.#takeFrames();
    if (!csv || !window.api) return;
    const res = window.api.appendCSVSync(this.#framePath(trialIndex), csv);
    if (!res.ok) console.error('[CSV] final frame flush failed:', res.error);
  }

  appendEventSync(trialIndex, phase, event, value1 = '', value2 = '') {
    if (!window.api) return;
    const res = window.api.appendCSVSync(this.#eventPath, this.#eventRow(trialIndex, phase, event, value1, value2));
    if (!res.ok) console.error(`[CSV] could not write event '${event}':`, res.error);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  // Empties the buffer and returns its rows as CSV text (null if empty).
  #takeFrames() {
    if (this.#frameBuffer.length === 0) return null;
    const buf = this.#frameBuffer;
    this.#frameBuffer = [];
    return buf.map(r =>
      `${r.t},${r.trialIndex},${r.phase},${r.segment},${r.raw.toFixed(4)},${r.smoothed.toFixed(4)},` +
      `${r.norm.toFixed(4)},${r.normMin.toFixed(6)},${r.normMax.toFixed(6)},` +
      `${r.fishX.toFixed(4)},${r.fishY.toFixed(4)},${r.targetY.toFixed(4)},${r.breathFilter}`
    ).join('\n') + '\n';
  }

  #eventRow(trialIndex, phase, event, value1, value2) {
    return `${new Date().toISOString()},${trialIndex},${phase ?? ''},${event},${value1},${value2}\n`;
  }

  get #eventPath() {
    return `${CONFIG.DATA_DIR}/${this.#subjectCode}/eventData.csv`;
  }

  #framePath(trialIndex) {
    return `${CONFIG.DATA_DIR}/${this.#subjectCode}/frameData_trial${trialIndex}.csv`;
  }

  #warn(msg) {
    console.error('[CSV]', msg);
    this.#onWarn?.(msg);
  }
}
