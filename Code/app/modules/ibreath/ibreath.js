/**
 * iBreath experiment frontend
 * ============================
 * Port of ibreath_main_v2.m to the RespFish Electron frontend architecture.
 *
 * Implements the standard frontend interface:
 *   pushSample(value: number) → void
 *   setStatus({ type, text })  → void
 *
 * State machine:  IDLE → CALIBRATING → READY → TRIAL → [RESPONSE →] ITI → DONE
 *
 * Sub-modules:
 *   config.js      — CONFIG and STATE constants
 *   trialParams.js — makeTrialParams()
 *   hud.js         — LocalHud (embedded experimenter bar)
 *   remoteHud.js   — RemoteHud (IPC-backed, for experimenter window)
 *   renderer.js    — canvas drawing
 *   csv.js         — file output
 */

import { GaussianSmoother, SignalDelayLine, PeakEnvelopeFollower, mapRange } from '../signal/signalUtils.js';
import { RespCalibration, AdaptiveRange } from '../calibration/calibration.js';
import { IBreathSound } from './ibreath_sound.js';
import { CONFIG, CONFIG_DEFAULTS, STATE } from './config.js';
import { makeTrialParams } from './trialParams.js';
import { LocalHud } from './hud.js';
import { IBreathRenderer } from './ibreath_renderer.js';
import { IBreathCSV } from './csv.js';
import { MarkerStream } from '../stream/markerStream.js';
import { EyeLinkControl } from '../stream/eyelinkControl.js';

export { CONFIG };

export default class IBreath {
  // ── state ──────────────────────────────────────────────────────────────
  #state = STATE.IDLE;
  #streamReady = false;
  #respStatusText = 'waiting for stream…';
  #eyelinkReady = false;
  #useEyeTracking = false;   // off by default; toggled via the experimenter's "use eye tracking" checkbox

  // ── experiment data ────────────────────────────────────────────────────
  #subjectCode = CONFIG.SUBJECT_CODE;
  #inputSignalType = CONFIG.INPUT_SIGNAL_TYPE;   // 'physiological' | 'peaksOnly'
  #trials = [];
  #trialIndex = 0;
  #trialData = [];

  // ── calibration ────────────────────────────────────────────────────────
  #calibration = null;   // RespCalibration — derives the initial stimulus range
  #calFailed = false;
  #rangeTracker = null;  // AdaptiveRange — follows drift after calibration (RANGE_ADAPT)

  // ── signal pipeline ────────────────────────────────────────────────────
  // Exactly one of these two feeds #smoothedValue, chosen by #inputSignalType;
  // everything downstream of that getter is identical for both signal types.
  #smoother = new GaussianSmoother(CONFIG.SMOOTH_WINDOW);
  #peakEnvelope = new PeakEnvelopeFollower({
    swellMs: CONFIG.PEAK_SWELL_MS,
    fadeMs: CONFIG.PEAK_FADE_MS,
    crossFraction: CONFIG.PEAK_CROSS_FRACTION,
  });
  #delayLine = new SignalDelayLine({ maxAgeMs: CONFIG.MAX_DELAY_MS + 500 });  // async's real-time delay buffer
  #currentDelayMs = CONFIG.MAX_DELAY_MS;   // adaptive staircase — see #onResponse
  #stimulusRange = [0.3, 0.4];   // raw native-scale window — used to rescale the live signal into [0,1]; fixed per trial

  // ── per-trial state ────────────────────────────────────────────────────
  #trialStartTime = null;
  #stimulusLevel = 0;
  #lastRawSample = 0;
  #lastScaledSample = 0;
  #frameRows = [];

  // ── ITI / display ─────────────────────────────────────────────────────
  #itiStartTime = null;
  #itiDuration = 0;
  #displayStartTime = null;

  // ── pause ──────────────────────────────────────────────────────────────
  #pausedFromState = null;
  #pausedStateText = null;
  #pausedAt = 0;

  // ── response (SHOW_QUESTIONS) ──────────────────────────────────────────
  #pendingTrial      = null;
  #responseStartTime = null;

  // ── flash (FLASHING_IMAGE) ─────────────────────────────────────────────
  #flashShown = false;
  #flashStartTime = null;
  #flashEndSent = false;
  #flashActive = false;

  // ── gaze ───────────────────────────────────────────────────────────────
  #gazeX = null;
  #gazeY = null;
  #gazeEnabled = false;

  // ── sub-modules ────────────────────────────────────────────────────────
  #markers = null;
  #eyelinkControl = null;
  #hud = null;
  #renderer = null;
  #csv = null;
  #sound = null;

  constructor({ statsContainer, sceneContainer, hudFactory }) {
    const callbacks = {
      onStart:           (settings) => this.#beginCalibration(settings),
      onNext:            () => this.#advanceTrial(),
      onAbort:           () => this.#abortTrial(),
      onResponse:        (v) => this.#onResponse(v),
      onPause:           () => this.#onPause(),
      onPlay:            () => this.#onPlay(),
      onRecalibrateGaze: () => this.#beginEyeCalibration(),
      onRetryCalibration:      () => this.#retryCalibration(),
      onUseDefaultCalibration: () => this.#useDefaultCalibration(),
      onSetUseEyeTracking:     (v) => this.#setUseEyeTracking(v),
    };
    this.#hud = hudFactory
      ? hudFactory(callbacks)
      : new LocalHud(statsContainer, CONFIG.SUBJECT_CODE, callbacks);

    this.#renderer = new IBreathRenderer(sceneContainer);

    this.#markers = CONFIG.SEND_MARKERS
      ? new MarkerStream(CONFIG.MARKER_STREAM_URL)
      : { send() {} };
    this.#eyelinkControl = new EyeLinkControl(CONFIG.EYELINK_CONTROL_URL, {
      onStatus: (status) => this.#onEyelinkStatus(status),
    });
    this.#sound = new IBreathSound();
    this.#sound.init().catch((e) => console.warn('[IBreath] sound init failed:', e));
    this.#bindKeys();
    setInterval(() => this.#update(), 16);
    requestAnimationFrame(() => this.#drawLoop());
  }

  // The current real-time signal value, however it was produced — Gaussian-
  // smoothed for a physiological signal, or the swell/fade envelope for a
  // peaks-only one. Everything downstream (calibration, sync display, the
  // async delay line) reads this instead of either engine directly.
  get #smoothedValue() {
    return this.#inputSignalType === 'peaksOnly'
      ? this.#peakEnvelope.value
      : this.#smoother.value;
  }

  // ── Public interface ───────────────────────────────────────────────────

  pushGazeSample(channels) {
    if (!this.#useEyeTracking) return;
    const wasEnabled = this.#gazeEnabled;
    if (!channels) {
      this.#gazeEnabled = false;
    } else {
      this.#gazeX = channels[0] ?? null;
      this.#gazeY = channels[1] ?? null;
      this.#gazeEnabled = true;
    }
    if (this.#gazeEnabled !== wasEnabled) this.#hud.gazeActive = this.#gazeEnabled;
  }

  pushSample(rawValue) {
    this.#lastRawSample = rawValue;
    this.#lastScaledSample = rawValue;
    const now = performance.now();
    if (this.#inputSignalType === 'peaksOnly') {
      this.#peakEnvelope.push(now, rawValue);
    } else {
      this.#smoother.push(rawValue);
    }
    // Computed once per sample — this runs at the stream's full rate.
    const smoothed = this.#smoothedValue;
    // Always-on, regardless of state, so a trial's delay buffer already has
    // up to MAX_DELAY_MS of history available the moment it starts.
    this.#delayLine.push(now, smoothed);
    this.#rangeTracker?.push(now, smoothed);

    if (this.#state === STATE.CALIBRATING) {
      this.#calibration.push(smoothed);
    } else if (this.#state === STATE.TRIAL) {
      this.#onTrialSample(smoothed);
    }
  }

  setStatus({ type, text }) {
    this.#streamReady = (type === 'connected');
    this.#respStatusText = text;
    this.#updateIdleReadiness();
  }

  // ── Keyboard shortcuts ─────────────────────────────────────────────────

  #bindKeys() {
    window.addEventListener('keydown', (e) => {
      switch (e.code) {
        case 'Space':
          e.preventDefault();
          if (this.#state === STATE.READY) this.#advanceTrial();
          break;
        case 'Escape':
          if (this.#state === STATE.TRIAL) this.#abortTrial();
          break;
        case 'ArrowLeft':
          if (this.#state === STATE.RESPONSE) this.#onResponse('left');
          break;
        case 'ArrowRight':
          if (this.#state === STATE.RESPONSE) this.#onResponse('right');
          break;
      }
    });
  }

  // ── State machine ──────────────────────────────────────────────────────

  #beginCalibration({ debugGaze, inputSignalType, calibrationSecs, questions, configOverrides } = {}) {
    // Reset to the hardcoded defaults first so a previous session's preset
    // (configOverrides) never silently lingers into a session that loads no
    // preset, or a different one that doesn't mention the same keys.
    Object.assign(CONFIG, CONFIG_DEFAULTS);
    if (configOverrides) Object.assign(CONFIG, configOverrides);
    CONFIG.QUESTIONS = questions?.length ? questions : CONFIG_DEFAULTS.QUESTIONS;

    if (debugGaze       !== undefined) CONFIG.DEBUG_GAZE        = debugGaze;
    if (inputSignalType !== undefined) this.#inputSignalType    = inputSignalType;
    if (calibrationSecs !== undefined) CONFIG.CALIBRATION_SECS = calibrationSecs;

    this.#subjectCode = this.#hud.subjectCode;
    this.#trials = makeTrialParams(CONFIG.MAX_NUM_TRIALS);
    this.#trialIndex = 0;
    this.#trialData = [];
    this.#currentDelayMs = CONFIG.MAX_DELAY_MS;
    this.#updateDelayHud();
    this.#calibration = new RespCalibration({ durationSecs: CONFIG.CALIBRATION_SECS });
    this.#calibration.start();
    this.#calFailed = false;
    // Created here (not in the constructor) so preset configOverrides apply.
    // Collects from calibration on, so its window is already full once seeded.
    this.#rangeTracker = CONFIG.RANGE_ADAPT
      ? new AdaptiveRange({
          windowSecs:       CONFIG.RANGE_WINDOW_SECS,
          timeConstantSecs: CONFIG.RANGE_TIME_CONSTANT_SECS,
          minSpanFraction:  CONFIG.RANGE_MIN_SPAN_FRACTION,
        })
      : null;
    this.#smoother.reset();
    this.#peakEnvelope.reset();
    this.#delayLine.reset();

    this.#state = STATE.CALIBRATING;
    this.#hud.experimentStartedAt = Date.now();
    this.#hud.stateTimer   = { startedAt: Date.now(), duration: CONFIG.CALIBRATION_SECS };
    this.#hud.startEnabled = false;
    this.#hud.inputsLocked = true;
    this.#hud.pauseVisible = false;
    this.#hud.stateText    = 'calibrating…';

    this.#csv = new IBreathCSV(this.#subjectCode, this.#gazeEnabled, (msg) => this.#csvWarn(msg));
    this.#csv.init();
    this.#markers.send('calibration_start');
  }

  #finishCalibration() {
    this.#markers.send('calibration_end');

    const result = this.#calibration.finish();
    if (!result) {
      console.warn('[IBreath] calibration produced no usable range (no samples, or flat signal)');
      this.#markers.send('calibration_failed');
      this.#calFailed = true;
      this.#hud.stateText = '⚠ calibration failed — no signal or flat signal';
      this.#hud.calFailed = true;
      return;
    }

    this.#completeCalibration([result.min, result.max]);
  }

  #completeCalibration(range, { fromData = true } = {}) {
    this.#stimulusRange = [...range];
    this.#rangeTracker?.seed(range, { fromData });

    this.#hud.trialText = `0 / ${this.#trials.length}`;
    this.#calFailed = false;
    this.#hud.calFailed = false;

    if (CONFIG.AUTO_ADVANCE) {
      this.#advanceTrial();
    } else {
      this.#state = STATE.READY;
      this.#hud.stateTimer   = { startedAt: Date.now(), duration: null };
      this.#hud.pauseVisible = false;
      this.#hud.stateText    = 'ready — press Space or Next trial to begin';
      this.#hud.nextVisible  = true;
    }
  }

  #retryCalibration() {
    if (this.#state !== STATE.CALIBRATING || !this.#calFailed) return;
    this.#calibration.start();
    this.#calFailed = false;
    this.#hud.calFailed = false;
    this.#hud.stateTimer = { startedAt: Date.now(), duration: CONFIG.CALIBRATION_SECS };
    this.#hud.stateText  = 'calibrating…';
    this.#markers.send('calibration_start');
  }

  #useDefaultCalibration() {
    if (this.#state !== STATE.CALIBRATING || !this.#calFailed) return;
    this.#markers.send('calibration_default_used');
    this.#completeCalibration(CONFIG.DEFAULT_CAL_RANGE, { fromData: false });
  }

  #advanceTrial() {
    if (this.#trialIndex >= this.#trials.length) {
      this.#endExperiment();
      return;
    }

    const trial = this.#trials[this.#trialIndex];
    trial.delayMs = trial.synchronous ? null : this.#currentDelayMs;

    this.#frameRows = [];
    this.#stimulusLevel = 0;
    this.#flashShown = false;
    this.#flashStartTime = null;
    this.#flashEndSent = false;

    if (this.#inputSignalType !== 'peaksOnly') {
      this.#smoother.reset();
      // Pre-fill smoother with 64 samples (matching MATLAB pre-buffer)
      for (let i = 0; i < CONFIG.SMOOTH_WINDOW; i++) {
        this.#smoother.push(this.#lastScaledSample);
      }
    }
    // peaksOnly: the envelope carries on continuously across trial
    // boundaries (like the delay line) — there's no windowed average to
    // re-seed, and resetting here would risk clipping a heartbeat pulse
    // right at a trial transition.

    this.#hud.nextVisible  = false;
    this.#hud.abortVisible = false;
    this.#hud.pauseVisible = true;

    if (CONFIG.ANIMATION_DISPLAY) {
      this.#displayStartTime = performance.now();
      this.#state = STATE.DISPLAY;
      this.#sound.startDisplay();
      this.#hud.stateTimer = { startedAt: Date.now(), duration: CONFIG.DISPLAY_SECS };
      this.#markers.send(`display_start_t${trial.trialIndex}`);
    } else {
      this.#beginTrial();
    }
    const flashNote = CONFIG.FLASHING_IMAGE
      ? (trial.flashImage ? `  ·  flash @ ${trial.flashTime}s` : '  ·  no flash')
      : '';
    this.#hud.stateText = (trial.synchronous ? 'sync trial' : 'async trial') + flashNote;
    this.#hud.trialText = `${this.#trialIndex + 1} / ${this.#trials.length}`;
  }

  #beginTrial() {
    const trial = this.#trials[this.#trialIndex];
    this.#trialStartTime = performance.now();
    trial.startTime = new Date().toISOString();
    // Snapshot the drift-tracked range: fixed for the whole trial, and the
    // same mapping for sync (live) and async (delayed) readback.
    this.#stimulusRange = this.#rangeTracker?.range ?? this.#stimulusRange;
    [trial.rangeMin, trial.rangeMax] = this.#stimulusRange;
    this.#csv.initFrameCSV(trial.trialIndex);
    this.#state = STATE.TRIAL;
    this.#sound.stopDisplay();
    this.#sound.startTrial();
    this.#hud.stateTimer   = { startedAt: Date.now(), duration: CONFIG.MAX_TRIAL_TIME };
    this.#hud.abortVisible = true;
    this.#markers.send(`trial_start_t${trial.trialIndex}`);
  }

  #onTrialSample(smoothed) {
    const trial = this.#trials[this.#trialIndex];
    if (trial.synchronous) {
      this.#stimulusLevel = Math.max(0, Math.min(1,
        mapRange(smoothed, this.#stimulusRange, [0, 1])
      ));
    }
  }

  #endTrial(aborted = false) {
    const trial = this.#trials[this.#trialIndex];
    trial.endTime = new Date().toISOString();
    trial.aborted = aborted;

    trial.flashShown = this.#flashShown;
    this.#sound.stopTrial();
    this.#csv.flushFrameCSV(trial, this.#frameRows);
    this.#markers.send(aborted ? `trial_abort_t${trial.trialIndex}` : `trial_end_t${trial.trialIndex}`);
    this.#hud.abortVisible = false;
    this.#trialIndex++;

    if (CONFIG.SHOW_QUESTIONS && !aborted) {
      this.#pendingTrial      = trial;
      this.#responseStartTime = performance.now();
      this.#state             = STATE.RESPONSE;
      this.#hud.stateTimer    = { startedAt: Date.now(), duration: CONFIG.RESPONSE_TIMEOUT_SECS };
      this.#hud.stateText     = 'respond…';
      this.#markers.send(`response_start_t${trial.trialIndex}`);
    } else {
      this.#csv.appendTrialData(trial);
      this.#trialData.push({ ...trial });
      this.#startITIorEnd(trial);
    }
  }

  #onResponse(side) {
    if (!this.#pendingTrial) return;
    const trial = this.#pendingTrial;
    this.#pendingTrial = null;

    let response;
    if (side === 'timeout') {
      response = 'timeout';
    } else {
      const def = CONFIG.QUESTIONS.find(q => q.id === trial.questionType);
      const [leftLabel, rightLabel] = def?.answers ?? ['yes', 'no'];
      response = side === 'left' ? leftLabel : rightLabel;
    }
    trial.response = response;

    // Adaptive delay staircase: only the sync-detection question on an async
    // trial tells us anything about the current delay's detectability.
    if (!trial.synchronous && trial.questionType === 'sync') {
      if (response === 'no') {
        // Correctly identified as out-of-sync — make the next one harder.
        this.#currentDelayMs = Math.max(CONFIG.MIN_DELAY_MS, this.#currentDelayMs - CONFIG.DELAY_STEP_MS);
      } else if (response === 'yes') {
        // Mistaken for in-sync — make the next one easier.
        this.#currentDelayMs = Math.min(CONFIG.MAX_DELAY_MS, this.#currentDelayMs + CONFIG.DELAY_STEP_MS);
      }
      // 'timeout' leaves the current delay unchanged.
      this.#updateDelayHud();
    }

    this.#markers.send(`response_${response}_t${trial.trialIndex}`);
    this.#csv.appendTrialData(trial);
    this.#trialData.push({ ...trial });
    this.#startITIorEnd(trial);
  }

  // Keeps the experimenter HUD's "delay" readout in sync with the adaptive
  // staircase, so the experimenter always sees the delay the next async
  // trial will use.
  #updateDelayHud() {
    this.#hud.delayText = `${this.#currentDelayMs} ms`;
  }

  #startITIorEnd(trial) {
    if (this.#trialIndex >= this.#trials.length) {
      this.#endExperiment();
      return;
    }
    this.#itiStartTime = performance.now();
    this.#itiDuration = trial.ITI;
    this.#state = STATE.ITI;
    this.#hud.stateTimer = { startedAt: Date.now(), duration: trial.ITI / 1000 };
    this.#markers.send(`iti_start_t${trial.trialIndex}`);
    this.#hud.stateText = 'inter-trial interval…';
  }

  #abortTrial() {
    this.#endTrial(true);
  }

  #onPause() {
    const pauseable = [STATE.DISPLAY, STATE.TRIAL, STATE.RESPONSE, STATE.ITI];
    if (!pauseable.includes(this.#state)) return;

    if (this.#state === STATE.TRIAL) {
      // Abort and flush the running trial before pausing
      this.#endTrial(true);
      if (this.#state === STATE.DONE) return;  // last trial just finished — don't pause
      // state is now ITI; resume will skip it and go straight to the next display
      this.#pausedFromState = STATE.ITI;
    } else {
      this.#pausedFromState = this.#state;
    }

    if (this.#pausedFromState === STATE.DISPLAY) this.#sound.stopDisplay();

    this.#pausedStateText = this.#hud.stateText;
    this.#pausedAt        = performance.now();
    this.#state           = STATE.PAUSED;

    this.#markers.send('experiment_pause');

    this.#hud.abortVisible = false;
    this.#hud.pauseVisible = false;
    this.#hud.playVisible  = true;
    this.#hud.stateTimer   = { startedAt: Date.now(), duration: null };
    this.#hud.stateText    = 'paused';
  }

  #onPlay() {
    if (this.#state !== STATE.PAUSED) return;
    const from      = this.#pausedFromState;
    const stateText = this.#pausedStateText;
    this.#pausedFromState = null;
    this.#pausedStateText = null;
    this.#markers.send('experiment_resume');

    switch (from) {
      case STATE.DISPLAY:
        // Rewind animation to the beginning and restart jingle
        this.#displayStartTime = performance.now();
        this.#sound.startDisplay();
        this.#state = STATE.DISPLAY;
        this.#hud.stateTimer   = { startedAt: Date.now(), duration: CONFIG.DISPLAY_SECS };
        this.#hud.pauseVisible = true;
        this.#hud.playVisible  = false;
        this.#hud.stateText    = stateText;
        break;

      case STATE.TRIAL: {
        // Extend the trial clock by however long we were paused
        this.#trialStartTime += performance.now() - this.#pausedAt;
        this.#state = STATE.TRIAL;
        const remaining = CONFIG.MAX_TRIAL_TIME - (performance.now() - this.#trialStartTime) / 1000;
        this.#hud.stateTimer   = { startedAt: Date.now(), duration: Math.max(0, remaining) };
        this.#hud.abortVisible = true;
        this.#hud.pauseVisible = true;
        this.#hud.playVisible  = false;
        this.#hud.stateText    = stateText;
        break;
      }

      case STATE.RESPONSE:
        // Restart the response timeout from zero
        this.#responseStartTime = performance.now();
        this.#state = STATE.RESPONSE;
        this.#hud.stateTimer   = { startedAt: Date.now(), duration: CONFIG.RESPONSE_TIMEOUT_SECS };
        this.#hud.pauseVisible = true;
        this.#hud.playVisible  = false;
        this.#hud.stateText    = stateText;
        break;

      case STATE.ITI:
        // Skip remaining ITI — advance straight to the display animation
        this.#advanceTrial();   // sets pauseVisible, stateText, stateTimer
        this.#hud.playVisible = false;
        break;
    }
  }

  // ── Eye tracker recalibration ──────────────────────────────────────────

  #setUseEyeTracking(enabled) {
    this.#useEyeTracking = enabled;
    if (!enabled) {
      this.#gazeEnabled = false;
      this.#hud.gazeActive = false;
    }
    this.#updateIdleReadiness();
  }

  #updateIdleReadiness() {
    if (this.#state !== STATE.IDLE) return;
    const eyelinkOk = !this.#useEyeTracking || this.#eyelinkReady;
    const ready = this.#streamReady && eyelinkOk;
    this.#hud.startEnabled = ready;
    this.#hud.stateText = !this.#streamReady
      ? this.#respStatusText
      : !eyelinkOk
        ? 'waiting for eye tracker calibration…'
        : 'stream ready';
  }

  #onEyelinkStatus(status) {
    this.#hud.eyelinkState = status.state;
    if (status.state === 'calibrated' || status.state === 'recording') {
      this.#eyelinkReady = true;
    }
    this.#updateIdleReadiness();

    if (this.#state === STATE.EYETRACK_CAL && status.state === 'recording') {
      this.#finishEyeCalibration();
    }
  }

  #beginEyeCalibration() {
    if (!this.#useEyeTracking) return;
    const blocked = [STATE.IDLE, STATE.CALIBRATING, STATE.DONE, STATE.EYETRACK_CAL];
    if (blocked.includes(this.#state)) return;

    if (this.#state === STATE.TRIAL) {
      this.#abortTrial();               // flushes + marks the running trial aborted
    } else if (this.#state === STATE.DISPLAY) {
      this.#sound.stopDisplay();
    } else if (this.#state === STATE.RESPONSE) {
      this.#onResponse('timeout');      // records the pending response, flushes trial data
    }
    // ITI / READY / PAUSED: nothing pending to clean up.
    this.#pausedFromState = null;

    this.#state = STATE.EYETRACK_CAL;
    this.#hud.stateTimer      = { startedAt: Date.now(), duration: null };
    this.#hud.nextVisible     = false;
    this.#hud.abortVisible    = false;
    this.#hud.pauseVisible    = false;
    this.#hud.playVisible     = false;
    this.#hud.gazeCalibrating = true;
    this.#hud.stateText       = 'recalibrating eye tracker — please wait…';

    this.#markers.send('gaze_recalibration_start');
    window.api.window.minimize();
    this.#eyelinkControl.calibrate();
  }

  #finishEyeCalibration() {
    this.#markers.send('gaze_recalibration_end');
    this.#hud.gazeCalibrating = false;
    window.api.window.restore();

    if (this.#trialIndex >= this.#trials.length) {
      this.#endExperiment();
      return;
    }
    this.#state             = STATE.READY;
    this.#hud.stateTimer    = { startedAt: Date.now(), duration: null };
    this.#hud.pauseVisible  = false;
    this.#hud.stateText     = 'ready — press Space or Next trial to begin';
    this.#hud.nextVisible   = true;
  }

  #endExperiment() {
    this.#markers.send('experiment_done');
    this.#state = STATE.DONE;
    this.#hud.stateTimer   = { startedAt: Date.now(), duration: null };
    this.#hud.nextVisible  = false;
    this.#hud.abortVisible = false;
    this.#hud.pauseVisible = false;
    this.#hud.stateText    = 'experiment complete';
    this.#hud.trialText    = `${this.#trials.length} / ${this.#trials.length}`;
  }

  // ── Update loop (setInterval, continues when window loses focus) ──────

  #update() {
    const now = performance.now();

    if (this.#state === STATE.CALIBRATING && !this.#calFailed) {
      if (this.#calibration.isDone) {
        this.#finishCalibration();
      }
    }

    if (this.#state === STATE.DISPLAY) {
      if (now - this.#displayStartTime >= CONFIG.DISPLAY_SECS * 1000) {
        this.#beginTrial();
      }
    }

    if (this.#state === STATE.RESPONSE) {
      if (now - this.#responseStartTime >= CONFIG.RESPONSE_TIMEOUT_SECS * 1000) {
        this.#onResponse('timeout');
      }
    }

    if (this.#state === STATE.ITI) {
      if (now - this.#itiStartTime >= this.#itiDuration) {
        if (CONFIG.AUTO_ADVANCE) {
          this.#advanceTrial();
        } else {
          this.#state = STATE.READY;
          this.#hud.stateTimer  = { startedAt: Date.now(), duration: null };
          this.#hud.nextVisible = true;
          this.#hud.stateText   = 'ready — press Space or Next trial';
        }
      }
    }

    if (this.#state === STATE.TRIAL) {
      const trial = this.#trials[this.#trialIndex];
      const tSecs = (now - this.#trialStartTime) / 1000;

      if (!trial.synchronous) {
        const delayedRaw = this.#delayLine.sample(now, trial.delayMs);
        this.#stimulusLevel = mapRange(delayedRaw, this.#stimulusRange, [0, 1]);
      }
      const stimLevel = Math.max(0, Math.min(1, this.#stimulusLevel));
      this.#sound.setNoiseLevel(stimLevel);

      if (CONFIG.FLASHING_IMAGE && trial.flashImage && !this.#flashShown && tSecs >= trial.flashTime) {
        this.#flashShown = true;
        this.#flashStartTime = now;
        this.#markers.send(`flash_start_t${trial.trialIndex}`);
      }
      this.#flashActive = this.#flashShown && (now - this.#flashStartTime < CONFIG.FLASH_DURATION);
      if (CONFIG.FLASHING_IMAGE && this.#flashShown && !this.#flashActive && !this.#flashEndSent) {
        this.#flashEndSent = true;
        this.#markers.send(`flash_end_t${trial.trialIndex}`);
      }

      this.#frameRows.push({
        t: new Date().toISOString(),
        raw: this.#lastRawSample,
        scaled: this.#lastScaledSample,
        stim: stimLevel,
        flash: this.#flashActive ? 1 : 0,
        ...(this.#gazeEnabled ? { gazeX: this.#gazeX ?? '', gazeY: this.#gazeY ?? '' } : {}),
      });

      if (tSecs >= CONFIG.MAX_TRIAL_TIME) {
        this.#endTrial(false);
      }
    }
  }

  // ── Draw loop (requestAnimationFrame, may pause when window loses focus)

  #drawLoop() {
    const now = performance.now();
    const inTrial = this.#state === STATE.TRIAL;
    const trialDrawData = inTrial ? {
      trial:       this.#trials[this.#trialIndex],
      stimLevel:   Math.max(0, Math.min(1, this.#stimulusLevel)),
      flashActive: this.#flashActive,
    } : null;

    try {
      this.#renderer.draw(this.#state, now, {
        calProgress:       this.#calibration?.progress ?? 0,
        calRemaining:      Math.ceil(this.#calibration?.remainingSecs ?? CONFIG.CALIBRATION_SECS),
        itiStartTime:      this.#itiStartTime,
        itiDuration:       this.#itiDuration,
        displayElapsed:    this.#displayStartTime != null ? (now - this.#displayStartTime) / 1000 : 0,
        responseStartTime: this.#responseStartTime,
        questionType:      this.#pendingTrial?.questionType ?? '',
        trialCount:        this.#trialData.length,
        subjectCode:       this.#subjectCode,
        gazeX:             this.#gazeX,
        gazeY:             this.#gazeY,
        ...(trialDrawData ?? {}),
      });
    } catch (e) {
      console.error('[IBreath] draw error:', e);
    }

    requestAnimationFrame(() => this.#drawLoop());
  }

  // ── CSV error display ──────────────────────────────────────────────────

  #csvWarn(msg) {
    if (!this.#hud) return;
    const prev = this.#hud.stateText;
    this.#hud.stateText  = `⚠ CSV: ${msg}`;
    this.#hud.stateColor = '#e09898';
    setTimeout(() => {
      this.#hud.stateText  = prev;
      this.#hud.stateColor = '';
    }, 5000);
  }
}
