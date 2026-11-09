// CSV output for the bioGame experiment.
//
// Two file types written to CONFIG.DATA_DIR/<subjectCode>/:
//   eventData.csv          — one row per event (session info, state changes, collects, misses)
//   frameData_block<N>.csv — one row per simulation frame (CONFIG.SIM_FPS) of block N
//
// Frame rows are buffered in memory and flushed every FRAME_FLUSH_COUNT rows
// to avoid high-frequency IPC.

import { CONFIG } from './bioGame_config.js';

export class BioGameCSV {
  #subjectCode;
  #group;
  #scene;
  #onWarn;

  #frameBuffer       = [];
  #currentBlockIndex = 0;

  #frameHeader = 'timestamp,blockIndex,frame,blockTime,drawn,breathRaw,breathSmoothed,breathNorm,' +
                 'normMin,normMax,avatarY,targetY,itemCount,smoothWindow\n';
  #eventHeader = 'timestamp,blockIndex,event,value1,value2\n';

  constructor(subjectCode, group, scene, onWarn) {
    this.#subjectCode = subjectCode;
    this.#group       = group;
    this.#scene       = scene;
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
    const meta = this.#eventRow(0, 'session_start', this.#group, this.#scene);
    const [res, res2] = await Promise.all([
      window.api.writeCSV(this.#eventPath, this.#eventHeader),
      window.api.appendCSV(this.#eventPath, meta),
    ]);
    if (!res.ok)       this.#warn(`Could not init eventData.csv: ${res.error}`);
    else if (!res2.ok) this.#warn(`Could not write session_start: ${res2.error}`);
    else console.log(`[CSV] initialised ${this.#eventPath}`);
  }

  async initBlockCSV(blockIndex) {
    if (!window.api) return;
    this.#currentBlockIndex = blockIndex;
    const path = this.#framePath(blockIndex);
    const res  = await window.api.writeCSV(path, this.#frameHeader);
    if (!res.ok) this.#warn(`Could not init ${path}: ${res.error}`);
    else console.log(`[CSV] initialised ${path}`);
  }

  // Buffer a frame row. The newest row is never flushed from here: the game
  // may still mark it as drawn when the next frame is rendered. Call
  // flushFrames() at block end to drain everything.
  bufferFrame(row) {
    this.#frameBuffer.push(row);
    if (this.#frameBuffer.length > CONFIG.FRAME_FLUSH_COUNT) {
      const newest = this.#frameBuffer.pop();
      this.flushFrames(this.#currentBlockIndex);
      this.#frameBuffer.push(newest);
    }
  }

  async flushFrames(blockIndex) {
    const csv = this.#takeFrames();
    if (!csv || !window.api) return;
    const res = await window.api.appendCSV(this.#framePath(blockIndex), csv);
    if (!res.ok) this.#warn(`Could not write frame data: ${res.error}`);
  }

  async appendEvent(blockIndex, event, value1 = '', value2 = '') {
    if (!window.api) return;
    const res = await window.api.appendCSV(this.#eventPath, this.#eventRow(blockIndex, event, value1, value2));
    if (!res.ok) this.#warn(`Could not write event '${event}': ${res.error}`);
  }

  // ── Synchronous variants — only for the 'pagehide' handler (window
  //    closing), where an async write might never arrive. ────────────────

  flushFramesSync(blockIndex) {
    const csv = this.#takeFrames();
    if (!csv || !window.api) return;
    const res = window.api.appendCSVSync(this.#framePath(blockIndex), csv);
    if (!res.ok) console.error('[CSV] final frame flush failed:', res.error);
  }

  appendEventSync(blockIndex, event, value1 = '', value2 = '') {
    if (!window.api) return;
    const res = window.api.appendCSVSync(this.#eventPath, this.#eventRow(blockIndex, event, value1, value2));
    if (!res.ok) console.error(`[CSV] could not write event '${event}':`, res.error);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  // Empties the buffer and returns its rows as CSV text (null if empty).
  #takeFrames() {
    if (this.#frameBuffer.length === 0) return null;
    const buf = this.#frameBuffer;
    this.#frameBuffer = [];
    return buf.map(r =>
      `${r.t},${r.block},${r.frame},${r.blockTime.toFixed(4)},${r.drawn ? 1 : 0},` +
      `${r.raw.toFixed(4)},${r.smoothed.toFixed(4)},` +
      `${r.norm.toFixed(4)},${r.normMin.toFixed(6)},${r.normMax.toFixed(6)},${r.avatarY.toFixed(4)},${r.targetY.toFixed(4)},${r.itemCount},${r.smoothWindow}`
    ).join('\n') + '\n';
  }

  #eventRow(blockIndex, event, value1, value2) {
    return `${new Date().toISOString()},${blockIndex},${event},${value1},${value2}\n`;
  }

  get #eventPath() {
    return `${CONFIG.DATA_DIR}/${this.#subjectCode}/eventData.csv`;
  }

  #framePath(blockIndex) {
    return `${CONFIG.DATA_DIR}/${this.#subjectCode}/frameData_block${blockIndex}.csv`;
  }

  #warn(msg) {
    console.error('[CSV]', msg);
    this.#onWarn?.(msg);
  }
}
