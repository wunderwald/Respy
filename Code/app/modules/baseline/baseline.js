/**
 * baseline.js — Resting-state baseline recording
 * ================================================
 * Plays a resting-state video full-screen while recording the resp signal in
 * the background. Falls back to a plain countdown display if the video file
 * isn't present. Sends LSL markers at start and end.
 *
 * Experimenter settings (sent with Start):
 *   - name:       one of CONFIG.NAMES — written to the CSVs and file names
 *   - fullVideo:  true  → the recording ends when the video ends
 *                 false → it ends after `durationSecs` (the video is paused
 *                         then; if it's shorter, its last frame stays up)
 *   Without a playable video, "full video" means CONFIG.DURATION_SECS.
 *
 * The raw signal is written to CSV *while* recording (header at Start, new
 * rows appended every CONFIG.FLUSH_INTERVAL_MS), so an abort, crash or
 * closed window loses at most the last flush interval. If the window is
 * closed mid-recording, the pending rows are flushed synchronously from a
 * 'pagehide' handler. The breathing-rate estimates are computed once at the
 * end (normal end or Abort) from the full recording.
 *
 * State machine:  IDLE → INSTRUCTIONS → PLAYING → DONE
 */

import { MarkerStream }        from '../stream/markerStream.js';
import { CONFIG, STATE }       from './baseline_config.js';
import { estimateBreathRate }  from '../signal/breathRateEstimators.js';
import { baselineFileStem, estimatesPath } from './baselineFiles.js';
import { INSTRUCTIONS }       from '../instructions/instructionTexts.js';
import { drawInstructions }   from '../instructions/instructionScreen.js';

export default class Baseline {
  #state        = STATE.IDLE;
  #stateText    = 'waiting for stream…';   // last status line sent to the experimenter
  #streamReady  = false;
  #startTime    = null;
  #lastRafTime  = null;

  // Experimenter-supplied params (overridden on 'start' action)
  #subjectCode = CONFIG.SUBJECT_CODE;
  #name        = CONFIG.NAMES[0];       // { label, slug }
  #fullVideo   = true;
  #customSecs  = CONFIG.DURATION_SECS;

  // Resolved at Start: end on the video's 'ended' event, or after #targetSecs.
  #endsWithVideo = false;
  #targetSecs    = null;   // null = until the video ends (its length unknown)
  #videoDurationSecs = null;   // from the video's metadata, once loaded

  // Recording: every value (for the end-of-recording estimates) plus the CSV
  // rows not yet written to disk.
  #values        = [];
  #firstSampleMs = null;
  #lastSampleMs  = null;
  #pendingRows   = [];
  #lastFlush     = 0;
  #csvPath       = null;

  #canvas  = null;
  #ctx     = null;
  #video   = null;
  #videoAvailable = false;
  #warning   = null;   // persisted so it survives the experimenter window's 'ready' resync
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
    // Window closing / app quitting mid-recording: get the last rows onto
    // disk before the renderer goes away (async IPC may never arrive).
    window.addEventListener('pagehide', () => this.#flushRowsSync());

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
      this.#video.addEventListener('loadedmetadata', () => {
        if (!Number.isFinite(this.#video.duration)) return;
        this.#videoDurationSecs = this.#video.duration;
        // Started before the length was known: now the HUD can count down.
        if (this.#state === STATE.PLAYING && this.#endsWithVideo) {
          this.#targetSecs = this.#videoDurationSecs;
          this.#pushState({ duration: this.#targetSecs });
        } else {
          this.#pushState();   // experimenter shows the video length
        }
      });
      this.#video.addEventListener('ended', () => {
        if (this.#state === STATE.PLAYING && this.#endsWithVideo) this.#finish(false);
      });
      this.#video.addEventListener('error', () => {
        if (this.#state === STATE.PLAYING) {
          this.#onVideoFailed('error');
        } else if (this.#state === STATE.IDLE) {
          // Unplayable before Start: behave as if it were missing (countdown).
          this.#videoAvailable = false;
          this.#warning = `video could not be loaded (${CONFIG.VIDEO_PATH}) — a countdown is shown instead`;
          this.#pushState();
        }
      });
      this.#video.src = CONFIG.VIDEO_PATH;
      this.#video.load();
    } else {
      console.warn('[Baseline]', CONFIG.VIDEO_MISSING_WARNING);
      this.#warning = CONFIG.VIDEO_MISSING_WARNING;
      this.#pushState();
    }
  }

  // ── Frontend interface ─────────────────────────────────────────────────────

  pushSample(value) {
    if (this.#state !== STATE.PLAYING) return;
    const nowMs = Date.now();
    this.#firstSampleMs ??= nowMs;
    this.#lastSampleMs = nowMs;
    this.#values.push(value);
    this.#pendingRows.push(`${new Date(nowMs).toISOString()},${value.toFixed(6)},${this.#name.label}`);
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

  #onAction({ type, subjectCode, name, fullVideo, durationSecs }) {
    switch (type) {
      case 'start':
        if (this.#state !== STATE.IDLE || !this.#streamReady) break;
        if (subjectCode !== undefined) this.#subjectCode = subjectCode;
        if (name !== undefined) {
          this.#name = CONFIG.NAMES.find((n) => n.label === name) ?? CONFIG.NAMES[0];
        }
        if (fullVideo !== undefined) this.#fullVideo = !!fullVideo;
        if (durationSecs !== undefined) {
          this.#customSecs = Number.isFinite(durationSecs) && durationSecs > 0
            ? durationSecs : CONFIG.DURATION_SECS;
        }
        this.#showInstructions();
        break;
      case 'next':
        if (this.#state === STATE.INSTRUCTIONS) this.#begin();
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

  // Start pressed: settings are locked in; explain to the child what's going
  // to happen. Space/Next then starts the recording (#begin).
  #showInstructions() {
    this.#state = STATE.INSTRUCTIONS;
    this.#markers.send('instructions_start');
    this.#pushState({ stateText: 'explaining — press Space or Next', inputsLocked: true });
  }

  // Expected length for the explanation text: the video's own length when
  // playing it in full (unknown until its metadata has loaded), else the
  // set duration (or the fallback without a video).
  get #expectedSecs() {
    if (!this.#fullVideo) return this.#customSecs;
    return this.#videoAvailable ? this.#videoDurationSecs : CONFIG.DURATION_SECS;
  }

  #begin() {
    this.#startTime     = performance.now();
    this.#values        = [];
    this.#firstSampleMs = null;
    this.#lastSampleMs  = null;
    this.#pendingRows   = [];
    this.#lastFlush     = performance.now();
    this.#state         = STATE.PLAYING;

    this.#endsWithVideo = this.#fullVideo && this.#videoAvailable;
    this.#targetSecs    = this.#endsWithVideo ? this.#videoDurationSecs   // null if metadata not loaded yet
                        : this.#fullVideo     ? CONFIG.DURATION_SECS      // no video: fallback length
                        :                       this.#customSecs;

    this.#initCSV();
    this.#markers.send('baseline_start');
    this.#markers.send(`baseline_name_${this.#name.slug}`);

    if (this.#videoAvailable) {
      // Swap to the video and stop the canvas draw loop from doing any work
      // (see #draw) so it isn't competing with video decode/composite.
      this.#canvas.style.display = 'none';
      this.#video.style.display  = 'block';
      this.#video.currentTime = 0;
      this.#video.play().catch((err) => this.#onVideoFailed(`playback failed: ${err.message ?? err}`));
    }

    this.#pushState({
      stateText:           `recording — ${this.#name.label}`,
      startEnabled:        false,
      abortVisible:        true,
      inputsLocked:        true,
      recordingStartedAt:  Date.now(),
      duration:            this.#targetSecs,
    });
  }

  // The video can't (or can no longer) play while recording: keep recording
  // on a timer instead, so the recording still ends on its own.
  #onVideoFailed(reason) {
    console.error('[Baseline] video:', reason);
    if (this.#state !== STATE.PLAYING) return;
    // Show the countdown instead of a dead video element.
    this.#videoAvailable       = false;
    this.#video.style.display  = 'none';
    this.#canvas.style.display = 'block';
    if (this.#endsWithVideo) {
      this.#endsWithVideo = false;
      this.#targetSecs    = this.#videoDurationSecs ?? CONFIG.DURATION_SECS;
      this.#warning = `⚠ video ${reason} — recording ends after ${Math.round(this.#targetSecs)} s instead`;
    } else {
      this.#warning = `⚠ video ${reason} — recording continues (countdown shown)`;
    }
    this.#pushState({ duration: this.#targetSecs });
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
    this.#flushRows();
    console.log(`[Baseline] recorded ${this.#values.length} samples → ${this.#csvPath}`);
    // Offer "Back to menu" only once the estimates are on disk too.
    this.#writeEstimates()
      .catch((e) => console.error('[Baseline] estimates failed:', e))
      .finally(() => window.api.session.ended());
  }

  // ── Tick (duration check, periodic flush) ─────────────────────────────────

  #tick() {
    if (this.#state !== STATE.PLAYING) return;
    const now = performance.now();
    if (now - this.#lastFlush >= CONFIG.FLUSH_INTERVAL_MS) this.#flushRows();
    // Ending with the video is driven by its 'ended' event instead.
    if (!this.#endsWithVideo && (now - this.#startTime) / 1000 >= this.#targetSecs) this.#finish(false);
  }

  // ── CSV output ────────────────────────────────────────────────────────────
  //
  // Main processes file IPC in order with synchronous fs calls, so the
  // header written here always lands before the first appended rows.

  #initCSV() {
    this.#csvPath = `${baselineFileStem(this.#subjectCode, this.#name.slug)}.csv`;
    if (!window.api) return;
    window.api.writeCSV(this.#csvPath, 'timestamp,value,name\n').then((res) => {
      if (!res.ok) this.#csvError(`could not create ${this.#csvPath}: ${res.error}`);
    });
  }

  #takePendingRows() {
    if (this.#pendingRows.length === 0) return null;
    const content = this.#pendingRows.join('\n') + '\n';
    this.#pendingRows = [];
    return content;
  }

  #flushRows() {
    this.#lastFlush = performance.now();
    const content = this.#takePendingRows();
    if (!content || !window.api) return;
    window.api.appendCSV(this.#csvPath, content).then((res) => {
      if (!res.ok) this.#csvError(`write failed: ${res.error}`);
    });
  }

  #flushRowsSync() {
    if (this.#state !== STATE.PLAYING) return;
    this.#markers.send('session_closed');   // best effort — the socket may already be gone
    const content = this.#takePendingRows();
    if (!content || !window.api) return;
    const res = window.api.appendCSVSync(this.#csvPath, content);
    if (!res.ok) console.error('[Baseline] final flush failed:', res.error);
  }

  #csvError(msg) {
    console.error('[Baseline] CSV', msg);
    this.#warning = `⚠ CSV ${msg}`;
    this.#pushState();
  }

  async #writeEstimates() {
    const n = this.#values.length;
    if (!window.api || n < 2) return;

    // Sample rate from the wall-clock arrival times of the first/last sample
    const values       = Float64Array.from(this.#values);
    const durationSecs = (this.#lastSampleMs - this.#firstSampleMs) / 1000;
    const sampleRate   = durationSecs > 0 ? (n - 1) / durationSecs : n;

    const estimates = estimateBreathRate(values, sampleRate, { windowed: true });

    const path   = estimatesPath(this.#subjectCode, this.#name.slug);   // read back by bioGame (Resting)
    const header = 'method,hz,bpm,name\n';
    const rows   = Object.entries(estimates)
      .map(([method, hz]) => {
        const hzStr  = hz !== null ? hz.toFixed(4)        : '';
        const bpmStr = hz !== null ? (hz * 60).toFixed(2) : '';
        return `${method},${hzStr},${bpmStr},${this.#name.label}`;
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

    if (this.#state === STATE.INSTRUCTIONS) {
      drawInstructions(ctx, w, h, INSTRUCTIONS.baseline({ durationSecs: this.#expectedSecs }));

    } else if (this.#state === STATE.IDLE) {
      ctx.font      = '200 28px Nunito, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.fillText('Standby', w / 2, h / 2);

    } else if (this.#state === STATE.PLAYING) {
      // Only drawn without a playing video, i.e. always on a timer.
      const remaining = Math.max(0, (this.#targetSecs ?? CONFIG.DURATION_SECS) - (now - this.#startTime) / 1000);
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

  // Every push is a full snapshot. Abort's visibility is derived from the
  // state, so a partial update (warning, video length) can't hide it; the
  // status line repeats the last one sent unless overridden.
  #pushState(overrides = {}) {
    if (overrides.stateText !== undefined) this.#stateText = overrides.stateText;
    window.api.frontend.sendState({
      startEnabled: this.#state === STATE.IDLE && this.#streamReady,
      abortVisible: this.#state === STATE.PLAYING,
      nextVisible:  this.#state === STATE.INSTRUCTIONS,
      warning:      this.#warning,   // included every push so it survives the 'ready' resync
      videoAvailable:    this.#videoAvailable,
      videoDurationSecs: this.#videoDurationSecs,
      ...overrides,
      stateText:    this.#stateText,
    });
  }
}
