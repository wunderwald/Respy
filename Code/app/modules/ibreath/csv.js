// CSV output for the iBreath experiment.
//
// Two files per subject, written to CONFIG.DATA_DIR/<subjectCode>/:
//   trialData.csv   — one row per trial (appended after each trial ends)
//   frameData_N.csv — one row per drawn animation frame for trial N, with
//                     the values that frame was drawn with
//
// Columns follow the MATLAB ibreath_main_v2.m output, minus its
// breathLevel_scaled column (the JS pipeline has no separate scaling step,
// so it only ever duplicated breathLevel_input).
//
// Strategy:
//   • Subject directory + trialData.csv header are created at calibration
//     start (init()), before any trial runs.
//   • frameData_N.csv header is written when a trial starts (initFrameCSV()),
//     so even a crash mid-trial leaves a valid (partial) file.
//   • Frame rows are buffered during the trial, then flushed as a single
//     write at trial end (flushFrameCSV()). This avoids hundreds of IPC
//     calls per trial while keeping memory bounded.

import { CONFIG } from './config.js';

export class IBreathCSV {
  #subjectCode;
  #gazeEnabled;
  #onWarn;
  #frameHeader;
  #trialHeader;
  #breathFilter;
  #signalType;
  #preset;
  #calibration = '';   // 'measured' | 'default' — set once calibration completes

  // session: { signalType, preset, breathFilter } — repeated on every trial row.
  constructor(subjectCode, gazeEnabled, session, onWarn) {
    this.#subjectCode = subjectCode;
    this.#gazeEnabled = gazeEnabled;
    this.#onWarn      = onWarn;
    this.#breathFilter = session.breathFilter ?? '';   // filter label, e.g. butterworth2_1.5Hz_fs100
    this.#signalType   = session.signalType;
    this.#preset       = session.preset;

    this.#frameHeader =
      'trialIndex,timestamp,breathLevel_input,stimulusLevel' +
      (CONFIG.FLASHING_IMAGE ? ',flashActive' : '') +
      (gazeEnabled ? ',gazeX,gazeY' : '') + '\n';

    this.#trialHeader =
      'trialIndex,subject,questionType,synchronous,img,lr,stimX0,stimY0,stimX1,stimY1,delayMs,' +
      'rangeMin,rangeMax,breathFilter,signalType,preset,calibration,ITI,startTime,endTime,aborted' +
      (CONFIG.SHOW_QUESTIONS ? ',response' : '') +
      (CONFIG.FLASHING_IMAGE ? ',flashImage,flashScheduledTime,flashX,flashY,flashShown' : '') + '\n';
  }

  async init() {
    if (!window.api) {
      console.warn('[CSV] window.api not available — file I/O disabled');
      return;
    }
    // Issued right away (no ensureDir round trip first — writeCSV creates the
    // folder), so the header always lands before any trial row.
    const result = await window.api.writeCSV(this.#trialPath, this.#trialHeader);
    if (!result.ok) {
      this.#warn(`Could not init trialData.csv: ${result.error}`);
    } else {
      console.log(`[CSV] initialised ${this.#trialPath}`);
    }
  }

  async initFrameCSV(trialIndex) {
    if (!window.api) return;
    const result = await window.api.writeCSV(
      this.#framePath(trialIndex),
      this.#frameHeader
    );
    if (!result.ok) {
      this.#warn(`Could not init frameData_${trialIndex}.csv: ${result.error}`);
    }
  }

  async flushFrameCSV(trial, frameRows) {
    if (!window.api || frameRows.length === 0) return;
    const result = await window.api.appendCSV(this.#framePath(trial.trialIndex), this.#frameRowsCSV(trial, frameRows));
    if (!result.ok) {
      this.#warn(`Could not write frameData_${trial.trialIndex}.csv: ${result.error}`);
    } else {
      console.log(`[CSV] wrote ${frameRows.length} frame rows for trial ${trial.trialIndex}`);
    }
  }

  async appendTrialData(trial) {
    if (!window.api) return;
    const result = await window.api.appendCSV(this.#trialPath, this.#trialRow(trial));
    if (!result.ok) {
      this.#warn(`Could not append to trialData.csv: ${result.error}`);
    }
  }

  // ── Synchronous variants — only for the 'pagehide' handler (window
  //    closing), where an async write might never arrive. ─────────────────

  flushFrameCSVSync(trial, frameRows) {
    if (!window.api || frameRows.length === 0) return;
    const result = window.api.appendCSVSync(this.#framePath(trial.trialIndex), this.#frameRowsCSV(trial, frameRows));
    if (!result.ok) console.error('[CSV] final frame flush failed:', result.error);
  }

  appendTrialDataSync(trial) {
    if (!window.api) return;
    const result = window.api.appendCSVSync(this.#trialPath, this.#trialRow(trial));
    if (!result.ok) console.error('[CSV] could not append final trial row:', result.error);
  }

  /** 'measured' (from the calibration recording) or 'default' (DEFAULT_CAL_RANGE). */
  setCalibrationSource(source) {
    this.#calibration = source;
  }

  // ── Row formatting ──────────────────────────────────────────────────────

  #frameRowsCSV(trial, frameRows) {
    return frameRows.map(r =>
      `${trial.trialIndex},${r.t},` +
      `${r.raw.toFixed(6)},${r.stim.toFixed(6)}` +
      (CONFIG.FLASHING_IMAGE ? `,${r.flash}` : '') +
      (this.#gazeEnabled ? `,${r.gazeX ?? ''},${r.gazeY ?? ''}` : '')
    ).join('\n') + '\n';
  }

  #trialRow(trial) {
    return (
      `${trial.trialIndex},` +
      `${this.#subjectCode},` +
      `${trial.questionType ?? ''},` +
      `${trial.synchronous},` +
      `${trial.img},` +
      `${trial.lr},` +
      `${trial.stimX0},${trial.stimY0},${trial.stimX1},${trial.stimY1},` +
      `${trial.delayMs ?? ''},` +
      `${trial.rangeMin ?? ''},${trial.rangeMax ?? ''},` +
      `${this.#breathFilter},` +
      `${this.#signalType},${this.#preset},${this.#calibration},` +
      `${trial.ITI},` +
      `${trial.startTime ?? ''},` +
      `${trial.endTime ?? ''},` +
      `${trial.aborted}` +
      (CONFIG.SHOW_QUESTIONS ? `,${trial.response ?? ''}` : '') +
      (CONFIG.FLASHING_IMAGE
        ? `,${trial.flashImage ?? ''},${trial.flashTime ?? ''},` +
        `${trial.flashX ?? ''},${trial.flashY ?? ''},${trial.flashShown}`
        : '') + '\n'
    );
  }

  get #trialPath() {
    return `${CONFIG.DATA_DIR}/${this.#subjectCode}/trialData.csv`;
  }

  #framePath(trialIndex) {
    return `${CONFIG.DATA_DIR}/${this.#subjectCode}/frameData_${trialIndex}.csv`;
  }

  #warn(msg) {
    console.error('[CSV]', msg);
    this.#onWarn(msg);
  }
}
