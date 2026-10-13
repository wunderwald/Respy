// CSV output for the Belt Training Game.
//
// Two file types written to CONFIG.DATA_DIR/<subjectCode>/:
//   eventData.csv          — one row per event (session info, phase transitions, target enter/leave)
//   frameData_trial0.csv    — 20-fps frame rows for trial 0
//   frameData_trial1.csv    — 20-fps frame rows for trial 1, etc.
//
// Frame rows are buffered in memory and flushed every FRAME_FLUSH_COUNT rows
// (and at each phase end) to avoid high-frequency IPC.

import { CONFIG } from './beltTrainingGame_config.js';

export class BeltTrainingGameCSV {
  #subjectCode;
  #scene;
  #onWarn;

  #frameBuffer       = [];
  #currentTrialIndex = 0;

  #frameHeader = 'timestamp,trialIndex,phase,segment,breathRaw,breathSmoothed,breathNorm,' +
                 'normMin,normMax,fishX,fishY,targetY\n';
  #eventHeader = 'timestamp,trialIndex,phase,event,value1,value2\n';

  constructor(subjectCode, scene, onWarn) {
    this.#subjectCode = subjectCode;
    this.#scene       = scene;
    this.#onWarn      = onWarn;
  }

  async init() {
    if (!window.api) {
      console.warn('[CSV] window.api unavailable — file I/O disabled');
      return;
    }
    const dir = `${CONFIG.DATA_DIR}/${this.#subjectCode}`;
    const dirResult = await window.api.ensureDir(dir);
    if (!dirResult.ok) { this.#warn(`Could not create data dir: ${dirResult.error}`); return; }

    const evtPath = `${dir}/eventData.csv`;
    const res = await window.api.writeCSV(evtPath, this.#eventHeader);
    if (!res.ok) { this.#warn(`Could not init eventData.csv: ${res.error}`); return; }

    // Write session metadata as the first event row
    const meta = `${new Date().toISOString()},,,session_start,${this.#scene},\n`;
    const res2 = await window.api.appendCSV(evtPath, meta);
    if (!res2.ok) this.#warn(`Could not write session_start: ${res2.error}`);
    else console.log(`[CSV] initialised ${evtPath}`);
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
    if (!window.api || this.#frameBuffer.length === 0) return;
    const buf = this.#frameBuffer;
    this.#frameBuffer = [];

    const csv = buf.map(r =>
      `${r.t},${r.trialIndex},${r.phase},${r.segment},${r.raw.toFixed(4)},${r.smoothed.toFixed(4)},` +
      `${r.norm.toFixed(4)},${r.normMin.toFixed(6)},${r.normMax.toFixed(6)},` +
      `${r.fishX.toFixed(4)},${r.fishY.toFixed(4)},${r.targetY.toFixed(4)}`
    ).join('\n') + '\n';

    const res = await window.api.appendCSV(this.#framePath(trialIndex), csv);
    if (!res.ok) this.#warn(`Could not write frame data: ${res.error}`);
  }

  async appendEvent(trialIndex, phase, event, value1 = '', value2 = '') {
    if (!window.api) return;
    const row = `${new Date().toISOString()},${trialIndex},${phase ?? ''},${event},${value1},${value2}\n`;
    const res = await window.api.appendCSV(
      `${CONFIG.DATA_DIR}/${this.#subjectCode}/eventData.csv`, row
    );
    if (!res.ok) this.#warn(`Could not write event '${event}': ${res.error}`);
  }

  #framePath(trialIndex) {
    return `${CONFIG.DATA_DIR}/${this.#subjectCode}/frameData_trial${trialIndex}.csv`;
  }

  #warn(msg) {
    console.error('[CSV]', msg);
    this.#onWarn?.(msg);
  }
}
