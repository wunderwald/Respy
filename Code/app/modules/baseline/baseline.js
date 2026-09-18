/**
 * baseline.js — Resting-state baseline recording
 * ================================================
 * Plays a resting-state video full-screen for a fixed duration (default
 * 7 min) while recording the resp signal in the background. Falls back to a
 * plain countdown display if the video file isn't present.
 * Writes the recording to CSV and sends LSL markers at start and end.
 *
 * State machine:  IDLE → PLAYING → DONE
 */

import { MarkerStream }        from '../stream/markerStream.js';
import { CONFIG, STATE }       from './baseline_config.js';
import { estimateBreathRate }  from '../signal/breathRateEstimators.js';

export default class Baseline {
  #state        = STATE.IDLE;
  #streamReady  = false;
  #startTime    = null;
  #lastRafTime  = null;

  // Experimenter-supplied params (overridden on 'start' action)
  #subjectCode = CONFIG.SUBJECT_CODE;

  // Recorded samples: [isoTimestamp, value]
  #sampleBuffer = [];

  #canvas  = null;
  #ctx     = null;
  #video   = null;
  #videoAvailable = false;
  #videoWarning   = null;   // persisted so it survives the experimenter window's 'ready' resync
  #markers = null;

  constructor({ sceneContainer }) {
    sceneContainer.innerHTML =
      '<canvas id="bl-canvas"></canvas>' +
      '<video id="bl-video" preload="auto" playsinline></video>';
    this.#canvas = sceneContainer.querySelector('#bl-canvas');
    this.#ctx    = this.#canvas.getContext('2d');
    this.#video  = sceneContainer.querySelector('#bl-video');

    this.#markers = CONFIG.SEND_MARKERS
      ? new MarkerStream(CONFIG.MARKER_STREAM_URL)
      : { send() {} };

    window.api.frontend.onAction((action) => this.#onAction(action));

    this.#checkVideo();
    setInterval(() => this.#tick(), 100);
    requestAnimationFrame((t) => this.#rafLoop(t));
  }

  // ── Video availability ────────────────────────────────────────────────────
  //
  // Checked once at startup so the file can start buffering (preload="auto"
  // + load()) well before Start is pressed, and so the experimenter sees the
  // missing-video warning immediately rather than only once recording begins.

  async #checkVideo() {
    try {
      const result = await window.api.fileExists(CONFIG.VIDEO_PATH);
      this.#videoAvailable = result.ok && result.exists;
    } catch {
      this.#videoAvailable = false;
    }

    if (this.#videoAvailable) {
      this.#video.src = CONFIG.VIDEO_PATH;
      this.#video.load();
    } else {
      console.warn('[Baseline]', CONFIG.VIDEO_MISSING_WARNING);
      this.#videoWarning = CONFIG.VIDEO_MISSING_WARNING;
      this.#pushState();
    }
  }

  // ── Frontend interface ─────────────────────────────────────────────────────

  pushSample(value) {
    if (this.#state !== STATE.PLAYING) return;
    this.#sampleBuffer.push([new Date().toISOString(), value]);
  }

  setStatus({ type, text }) {
    if (this.#state !== STATE.IDLE) return;
    this.#streamReady = type === 'connected';
    this.#pushState({
      stateText:    this.#streamReady ? 'stream ready' : (text ?? 'no stream'),
      startEnabled: this.#streamReady,
    });
  }

  // ── Action handler ────────────────────────────────────────────────────────

  #onAction({ type, subjectCode }) {
    switch (type) {
      case 'start':
        if (subjectCode !== undefined) this.#subjectCode = subjectCode;
        if (this.#state === STATE.IDLE && this.#streamReady) this.#begin();
        break;
      case 'abort':
        if (this.#state === STATE.PLAYING) this.#finish(true);
        break;
      case 'ready':
        this.#pushState();
        break;
    }
  }

  // ── State transitions ─────────────────────────────────────────────────────

  #begin() {
    this.#startTime    = performance.now();
    this.#sampleBuffer = [];
    this.#state        = STATE.PLAYING;
    this.#markers.send('baseline_start');

    if (this.#videoAvailable) {
      // Swap to the video and stop the canvas draw loop from doing any work
      // (see #draw) so it isn't competing with video decode/composite.
      this.#canvas.style.display = 'none';
      this.#video.style.display  = 'block';
      this.#video.currentTime = 0;
      this.#video.play().catch((err) =>
        console.error('[Baseline] video playback failed:', err)
      );
    }

    this.#pushState({
      stateText:           'recording',
      startEnabled:        false,
      abortVisible:        true,
      inputsLocked:        true,
      recordingStartedAt:  Date.now(),
      duration:            CONFIG.DURATION_SECS,
    });
  }

  #finish(aborted = false) {
    this.#state = STATE.DONE;
    this.#markers.send(aborted ? 'baseline_abort' : 'baseline_end');

    if (this.#videoAvailable) {
      this.#video.pause();
      this.#video.style.display  = 'none';
      this.#canvas.style.display = 'block';
    }

    this.#pushState({ stateText: aborted ? 'aborted' : 'done', abortVisible: false });
    this.#writeCSV();
  }

  // ── Tick (duration check) ─────────────────────────────────────────────────

  #tick() {
    if (this.#state !== STATE.PLAYING) return;
    const elapsed = (performance.now() - this.#startTime) / 1000;
    if (elapsed >= CONFIG.DURATION_SECS) this.#finish(false);
  }

  // ── CSV output ────────────────────────────────────────────────────────────

  async #writeCSV() {
    if (!window.api || this.#sampleBuffer.length === 0) return;
    const dir    = CONFIG.DATA_DIR;
    const result = await window.api.ensureDir(dir);
    if (!result.ok) {
      console.error('[Baseline] could not create data dir:', result.error);
      return;
    }

    const path   = `${dir}/${this.#subjectCode}_baseline.csv`;
    const header = 'timestamp,value\n';
    const rows   = this.#sampleBuffer
      .map(([t, v]) => `${t},${v.toFixed(6)}`)
      .join('\n') + '\n';
    const write = await window.api.writeCSV(path, header + rows);
    if (write.ok) {
      console.log(`[Baseline] saved ${this.#sampleBuffer.length} samples → ${path}`);
    } else {
      console.error('[Baseline] CSV write failed:', write.error);
    }

    await this.#writeEstimates(dir);
  }

  async #writeEstimates(dir) {
    const buf = this.#sampleBuffer;
    const n   = buf.length;
    if (n < 2) return;

    // Extract signal values and derive sample rate from wall-clock timestamps
    const values = new Float64Array(n);
    for (let i = 0; i < n; i++) values[i] = buf[i][1];

    const durationSecs = (new Date(buf[n - 1][0]) - new Date(buf[0][0])) / 1000;
    const sampleRate   = durationSecs > 0 ? (n - 1) / durationSecs : n;

    const estimates = estimateBreathRate(values, sampleRate, { windowed: true });

    const path   = `${dir}/${this.#subjectCode}_baseline_estimates.csv`;
    const header = 'method,hz,bpm\n';
    const rows   = Object.entries(estimates)
      .map(([method, hz]) => {
        const hzStr  = hz !== null ? hz.toFixed(4)        : '';
        const bpmStr = hz !== null ? (hz * 60).toFixed(2) : '';
        return `${method},${hzStr},${bpmStr}`;
      })
      .join('\n') + '\n';

    const write = await window.api.writeCSV(path, header + rows);
    if (write.ok) {
      console.log(`[Baseline] saved estimates → ${path}`);
    } else {
      console.error('[Baseline] estimates write failed:', write.error);
    }
  }

  // ── Render loop ───────────────────────────────────────────────────────────

  #rafLoop(now) {
    this.#lastRafTime = now;
    try { this.#draw(now); } catch (e) { console.error('[Baseline] draw error:', e); }
    requestAnimationFrame((t) => this.#rafLoop(t));
  }

  #draw(now) {
    // The video is the visual while it's playing — skip all canvas work
    // (including the per-frame resize below) so it never competes with
    // video decode/composite for the main thread.
    if (this.#state === STATE.PLAYING && this.#videoAvailable) return;

    const canvas  = this.#canvas;
    canvas.width  = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    const ctx = this.#ctx;
    const w = canvas.width, h = canvas.height;

    ctx.fillStyle = '#0f0f0f';
    ctx.fillRect(0, 0, w, h);
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';

    if (this.#state === STATE.IDLE) {
      ctx.font      = '200 28px Nunito, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.fillText('Standby', w / 2, h / 2);

    } else if (this.#state === STATE.PLAYING) {
      const remaining = Math.max(0, CONFIG.DURATION_SECS - (now - this.#startTime) / 1000);
      const mm = String(Math.floor(remaining / 60)).padStart(1, '0');
      const ss = String(Math.floor(remaining % 60)).padStart(2, '0');
      ctx.font      = '200 80px Nunito, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillText(`${mm}:${ss}`, w / 2, h / 2);

    } else if (this.#state === STATE.DONE) {
      ctx.font      = '200 28px Nunito, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillText('Done', w / 2, h / 2);
    }
  }

  // ── Experimenter state push ───────────────────────────────────────────────

  #pushState(overrides = {}) {
    window.api.frontend.sendState({
      stateText:    this.#state,
      startEnabled: this.#state === STATE.IDLE && this.#streamReady,
      abortVisible: false,
      warning:      this.#videoWarning,   // included every push so it survives the 'ready' resync
      ...overrides,
    });
  }
}
