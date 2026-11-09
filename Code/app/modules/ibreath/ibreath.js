/**
 * iBreath experiment frontend
 * ============================
 * Port of ibreath_main_v2.m to the RespFish Electron frontend architecture.
 *
 * Implements the standard frontend interface:
 *   pushSample(value: number) → void
 *   setStatus({ type, text })  → void
 *
 * State machine:  IDLE → INSTRUCTIONS_CAL → CALIBRATING → INSTRUCTIONS_TASK →
 *                 [DISPLAY →] TRIAL → [RESPONSE →] ITI → … → DONE
 *
 * Sub-modules:
 *   config.js      — CONFIG and STATE constants
 *   trialParams.js — makeTrialParams()
 *   hud.js         — LocalHud (embedded experimenter bar)
 *   remoteHud.js   — RemoteHud (IPC-backed, for experimenter window)
 *   renderer.js    — canvas drawing
 *   csv.js         — file output
 */

import { GaussianSmoother, SignalDelayLine, PeakEnvelopeFollower, mapRange, validSmoothWindow } from '../signal/signalUtils.js';
import { RespCalibration, AdaptiveRange } from '../calibration/calibration.js';
import { IBreathSound } from './ibreath_sound.js';
import { CONFIG, CONFIG_DEFAULTS, STATE } from './config.js';
import { makeTrialParams } from './trialParams.js';
import { LocalHud } from './hud.js';
import { IBreathRenderer } from './ibreath_renderer.js';
import { IBreathCSV } from './csv.js';
import { MarkerStream } from '../stream/markerStream.js';
import { INSTRUCTIONS } from '../instructions/instructionTexts.js';
import {
  EyeLinkControl, EYELINK_OFFLINE,
  EYELINK_UNAVAILABLE_STATES, EYELINK_SETUP_STATES, EYELINK_CALIBRATED_STATES,
} from '../stream/eyelinkControl.js';

export { CONFIG };

export default class IBreath {
  // ── state ──────────────────────────────────────────────────────────────
  #state = STATE.IDLE;
  #streamReady = false;
  #respStatusText = 'waiting for stream…';
  #eyelinkReady = false;
  #eyelinkState = EYELINK_OFFLINE;
  #eyelinkCalSeen = false;   // EYETRACK_CAL: has the bridge reported 'calibrating' yet?
  #eyeCalReturn = null;      // { state, stateText } when an eye calibration was started from IDLE/DONE
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
  // Exactly one of #smoother / #peakEnvelope feeds #smoothedValue, chosen by
  // #inputSignalType; everything downstream of that getter is identical for
  // both signal types. All three objects are (re)built by
  // #buildSignalPipeline() from the *current* CONFIG — in the constructor,
  // and again at every session start after a preset's configOverrides have
  // been applied.
  #smoother = null;
  #peakEnvelope = null;
  #delayLine = null;   // async's real-time delay buffer
  #delayIndex = 0;     // index into DELAY_VALUES_MS — adaptive staircase, see #onResponse
  #stimulusRange = [0.3, 0.4];   // raw native-scale window — used to rescale the live signal into [0,1]; fixed per trial

  // ── per-trial state ────────────────────────────────────────────────────
  #trialStartTime = null;
  #stimulusLevel = 0;
  #lastRawSample = 0;
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
      // Start only from IDLE: settings sent later must not restart or alter a session.
      onStart:           (settings) => { if (this.#state === STATE.IDLE) this.#beginCalibration(settings); },
      // Space / Next in the experimenter window arrive here in any state;
      // only READY may advance (mid-trial it would discard the trial's data).
      onNext:            () => this.#onNext(),
      onAbort:           () => this.#abortTrial(),
      onResponse:        (v) => { if (this.#state === STATE.RESPONSE) this.#onResponse(v); },
      onPause:           () => this.#onPause(),
      onPlay:            () => this.#onPlay(),
      onRecalibrateGaze: () => this.#beginEyeCalibration(),
      onRetryCalibration:      () => this.#retryCalibration(),
      onUseDefaultCalibration: () => this.#useDefaultCalibration(),
      onSetUseEyeTracking:     (v) => this.#setUseEyeTracking(v),
      onEyelinkStartRecording: () => this.#setEyelinkRecording(true),
      onEyelinkStopRecording:  () => this.#setEyelinkRecording(false),
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
      onError:  (message) => { this.#hud.eyelinkError = message; },
    });
    this.#buildSignalPipeline();
    this.#delayIndex = this.#initialDelayIndex();
    this.#sound = new IBreathSound();
    this.#sound.init().catch((e) => console.warn('[IBreath] sound init failed:', e));
    this.#bindKeys();
    window.addEventListener('pagehide', () => this.#onWindowClose());
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

  // Current adaptive-delay value in ms, looked up from CONFIG.DELAY_VALUES_MS.
  get #currentDelayMs() {
    return CONFIG.DELAY_VALUES_MS[this.#delayIndex];
  }

  // Builds the smoothing / peak-envelope / delay-line objects from the
  // current CONFIG, so preset overrides of SMOOTH_WINDOW, PEAK_* and
  // DELAY_VALUES_MS actually take effect. Starts every buffer empty.
  #buildSignalPipeline() {
    this.#smoother = new GaussianSmoother(CONFIG.SMOOTH_WINDOW);
    this.#peakEnvelope = new PeakEnvelopeFollower({
      swellMs: CONFIG.PEAK_SWELL_MS,
      fadeMs: CONFIG.PEAK_FADE_MS,
      crossFraction: CONFIG.PEAK_CROSS_FRACTION,
    });
    // +500 ms headroom so the largest delay never reads past the buffer.
    this.#delayLine = new SignalDelayLine({ maxAgeMs: Math.max(...CONFIG.DELAY_VALUES_MS) + 500 });
  }

  // Staircase start: DEFAULT_DELAY_MS's position in DELAY_VALUES_MS. If a
  // preset's default isn't one of its values, start at the closest one
  // instead of at index -1 (which made every async delay undefined).
  #initialDelayIndex() {
    const values = CONFIG.DELAY_VALUES_MS;
    const idx = values.indexOf(CONFIG.DEFAULT_DELAY_MS);
    if (idx !== -1) return idx;
    let best = 0;
    values.forEach((v, i) => {
      if (Math.abs(v - CONFIG.DEFAULT_DELAY_MS) < Math.abs(values[best] - CONFIG.DEFAULT_DELAY_MS)) best = i;
    });
    this.#showWarning(`DEFAULT_DELAY_MS ${CONFIG.DEFAULT_DELAY_MS} is not in DELAY_VALUES_MS — starting at ${values[best]} ms`);
    return best;
  }

  // ── Public interface ───────────────────────────────────────────────────

  pushGazeSample(channels) {
    if (!this.#useEyeTracking) return;
    const wasEnabled = this.#gazeEnabled;
    if (!channels) {
      this.#gazeEnabled = false;
    } else {
      // eyelink_to_lsl sends normalised [0,1] coords, and [-1, -1] for
      // blinks / lost tracking — store those as "no gaze" (empty CSV cell,
      // no debug dot) rather than as a bogus off-screen position.
      const [x, y] = channels;
      const valid = Number.isFinite(x) && Number.isFinite(y) && x >= 0 && y >= 0;
      this.#gazeX = valid ? x : null;
      this.#gazeY = valid ? y : null;
      this.#gazeEnabled = true;
    }
    if (this.#gazeEnabled !== wasEnabled) this.#hud.gazeActive = this.#gazeEnabled;
  }

  pushSample(rawValue) {
    this.#lastRawSample = rawValue;
    const now = performance.now();
    if (this.#inputSignalType === 'peaksOnly') {
      this.#peakEnvelope.push(now, rawValue);
    } else {
      this.#smoother.push(rawValue);
    }
    // Computed once per sample — this runs at the stream's full rate.
    const smoothed = this.#smoothedValue;
    // Always-on, regardless of state, so a trial's delay buffer already has
    // up to the largest DELAY_VALUES_MS entry's worth of history available
    // the moment it starts.
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
          this.#onNext();
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

  #beginCalibration({ debugGaze, inputSignalType, calibrationSecs, numTrials, smoothWindow, presetName, questions, configOverrides } = {}) {
    // Reset to the hardcoded defaults first so a previous session's preset
    // (configOverrides) never silently lingers into a session that loads no
    // preset, or a different one that doesn't mention the same keys.
    Object.assign(CONFIG, CONFIG_DEFAULTS);
    if (configOverrides) Object.assign(CONFIG, configOverrides);
    CONFIG.QUESTIONS = questions?.length ? questions : CONFIG_DEFAULTS.QUESTIONS;

    if (debugGaze       !== undefined) CONFIG.DEBUG_GAZE        = debugGaze;
    if (inputSignalType !== undefined) this.#inputSignalType    = inputSignalType;
    if (calibrationSecs !== undefined) CONFIG.CALIBRATION_SECS = calibrationSecs;
    // Trial count from the experimenter's "trials" field (a preset's
    // numTrials, or the experimenter's own value). Takes precedence over a
    // configOverrides MAX_NUM_TRIALS; invalid values keep the default.
    if (Number.isInteger(numTrials) && numTrials >= 1) CONFIG.MAX_NUM_TRIALS = numTrials;
    // Smoothing window from the experimenter's "smoothing" control — set
    // before #buildSignalPipeline() below, which builds the smoother with it.
    // (Physiological signal only; peaksOnly uses the peak envelope instead.)
    if (smoothWindow !== undefined) CONFIG.SMOOTH_WINDOW = validSmoothWindow(smoothWindow, CONFIG.SMOOTH_WINDOW);

    this.#subjectCode = this.#hud.subjectCode;
    this.#trials = makeTrialParams(CONFIG.MAX_NUM_TRIALS);
    this.#trialIndex = 0;
    this.#trialData = [];
    this.#buildSignalPipeline();
    this.#hud.trialType = null;
    this.#calibration = null;
    this.#rangeTracker = null;

    // Explain the calibration to the child first; Space/Next starts it
    // (#startCalibration).
    this.#state = STATE.INSTRUCTIONS_CAL;
    this.#hud.experimentStartedAt = Date.now();
    this.#hud.stateTimer   = { startedAt: Date.now(), duration: null };
    this.#hud.startEnabled = false;
    this.#hud.inputsLocked = true;
    this.#hud.pauseVisible = false;
    this.#hud.nextVisible  = true;
    this.#hud.stateText    = 'explaining calibration — press Space or Next';
    // After the state text: a preset warning from here must not be
    // overwritten (and must restore to the text above, not a stale one).
    this.#delayIndex = this.#initialDelayIndex();
    this.#updateDelayHud();

    // Gaze columns follow the "use eye tracking" setting, not whether a gaze
    // sample happened to have arrived by the time Start was pressed.
    this.#csv = new IBreathCSV(this.#subjectCode, this.#useEyeTracking || this.#gazeEnabled,
      { signalType: this.#inputSignalType, preset: presetName ?? '' },
      (msg) => this.#showWarning(`CSV: ${msg}`));
    this.#csv.init();
    this.#markers.send('instructions_cal_start');
  }

  #startCalibration() {
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

    this.#state = STATE.CALIBRATING;
    this.#hud.stateTimer  = { startedAt: Date.now(), duration: CONFIG.CALIBRATION_SECS };
    this.#hud.nextVisible = false;
    this.#hud.stateText   = 'calibrating…';
    this.#markers.send('calibration_start');
  }

  // Space (scene window) and Space / Next (experimenter window) all land
  // here, in any state — only these states move on.
  #onNext() {
    switch (this.#state) {
      case STATE.INSTRUCTIONS_CAL:  this.#startCalibration(); break;
      case STATE.INSTRUCTIONS_TASK:   // the explanation replaces the first READY screen
      case STATE.READY:             this.#advanceTrial(); break;
    }
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
    this.#csv.setCalibrationSource(fromData ? 'measured' : 'default');   // trialData `calibration` column
    this.#rangeTracker?.seed(range, { fromData });

    this.#hud.trialText = `0 / ${this.#trials.length}`;
    this.#calFailed = false;
    this.#hud.calFailed = false;

    // Explain the task; Space/Next then starts trial 1.
    this.#state = STATE.INSTRUCTIONS_TASK;
    this.#hud.stateTimer   = { startedAt: Date.now(), duration: null };
    this.#hud.pauseVisible = false;
    this.#hud.stateText    = 'explaining the task — press Space or Next';
    this.#hud.nextVisible  = true;
    this.#markers.send('instructions_task_start');
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
      // Pre-fill the smoother window (matching the MATLAB pre-buffer)
      for (let i = 0; i < CONFIG.SMOOTH_WINDOW; i++) {
        this.#smoother.push(this.#lastRawSample);
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
    this.#hud.trialType = trial.synchronous ? 'sync' : 'async';
    this.#updateDelayHud(trial);
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
        // Correctly identified as out-of-sync — step to a smaller (harder) delay.
        this.#delayIndex = Math.max(0, this.#delayIndex - 1);
      } else if (response === 'yes') {
        // Mistaken for in-sync — step to a larger (easier) delay.
        this.#delayIndex = Math.min(CONFIG.DELAY_VALUES_MS.length - 1, this.#delayIndex + 1);
      }
      // 'timeout' leaves the current delay unchanged.
      // (HUD shows the new value once the ITI starts — see #startITIorEnd.)
    }

    this.#markers.send(`response_${response}_t${trial.trialIndex}`);
    this.#csv.appendTrialData(trial);
    this.#trialData.push({ ...trial });
    this.#startITIorEnd(trial);
  }

  // The experimenter HUD's "delay" readout. With a trial: the delay actually
  // applied to it (0 ms for sync), from its display phase through its
  // response. Without: the staircase value the next async trial will use.
  #updateDelayHud(trial = null) {
    this.#hud.delayText = trial
      ? `${trial.synchronous ? 0 : trial.delayMs} ms`
      : `next async: ${this.#currentDelayMs} ms`;
  }

  #startITIorEnd(trial) {
    this.#hud.trialType = null;
    this.#updateDelayHud();
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

  // Only a running trial can be aborted. Escape in the experimenter window
  // reaches here in every state, so the guard is needed: otherwise it would
  // "abort" the next, not-yet-run trial (or crash in IDLE / DONE).
  #abortTrial() {
    if (this.#state !== STATE.TRIAL) return;
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
        ? (EYELINK_UNAVAILABLE_STATES.has(this.#eyelinkState)
            ? 'waiting for eye tracker bridge (run_bridge.py)…'
            : 'waiting for eye tracker calibration…')
        : 'stream ready';
  }

  #onEyelinkStatus(status) {
    this.#eyelinkState         = status.state;
    this.#hud.eyelinkState     = status.state;
    this.#hud.eyelinkRecording = !!status.recording;
    // A fresh, working status clears any stale startup error.
    const unavailable = EYELINK_UNAVAILABLE_STATES.has(status.state);
    if (!unavailable) this.#hud.eyelinkError = '';
    this.#eyelinkReady = EYELINK_CALIBRATED_STATES.has(status.state);
    this.#updateIdleReadiness();

    if (this.#state !== STATE.EYETRACK_CAL) return;
    if (EYELINK_SETUP_STATES.has(status.state)) {
      this.#eyelinkCalSeen = true;
    } else if (unavailable) {
      // Bridge went away (or is shutting down) mid-calibration — don't leave
      // the scene minimized forever.
      this.#finishEyeCalibration();
    } else if (this.#eyelinkCalSeen && EYELINK_CALIBRATED_STATES.has(status.state)) {
      // Only finish once *this* calibration has actually run: a status
      // snapshot of the pre-calibration state ('recording') can arrive
      // right after the command was sent.
      this.#finishEyeCalibration();
    }
  }

  #setEyelinkRecording(on) {
    if (!this.#useEyeTracking) return;
    const sent = on ? this.#eyelinkControl.start() : this.#eyelinkControl.stop();
    if (sent) this.#markers.send(on ? 'eyetracker_recording_start' : 'eyetracker_recording_stop');
  }

  // Runs an EyeLink calibration on the participant screen. Allowed before
  // the experiment (IDLE), between/during trials, and after it (DONE) — but
  // not during the breathing calibration, which it would disrupt.
  #beginEyeCalibration() {
    if (!this.#useEyeTracking || !this.#eyelinkControl.connected) return;
    if ([STATE.CALIBRATING, STATE.EYETRACK_CAL].includes(this.#state)) return;

    const standalone = [STATE.IDLE, STATE.DONE, STATE.INSTRUCTIONS_CAL, STATE.INSTRUCTIONS_TASK].includes(this.#state);
    if (standalone) {
      // Nothing running — come back to exactly this state afterwards.
      this.#eyeCalReturn = { state: this.#state, stateText: this.#hud.stateText };
      this.#hud.startEnabled = false;
    } else {
      this.#eyeCalReturn = null;
      // When paused, clean up what the pause interrupted. (A trial paused
      // mid-run was already aborted and flushed by #onPause; a paused
      // display already had its sound stopped.)
      const interrupted = this.#state === STATE.PAUSED ? this.#pausedFromState : this.#state;
      if (interrupted === STATE.TRIAL) {
        this.#abortTrial();               // flushes + marks the running trial aborted
      } else if (interrupted === STATE.DISPLAY && this.#state !== STATE.PAUSED) {
        this.#sound.stopDisplay();
      } else if (interrupted === STATE.RESPONSE) {
        this.#onResponse('timeout');      // records the pending response, flushes trial data
      }
      // ITI / READY: nothing pending to clean up.
      this.#pausedFromState = null;

      // The cleanup may have finished the *last* trial, i.e. #endExperiment
      // already ran (experiment_done sent). Come back to DONE afterwards
      // instead of ending the experiment a second time.
      if (this.#state === STATE.DONE) {
        this.#eyeCalReturn = { state: STATE.DONE, stateText: this.#hud.stateText };
      }
    }

    this.#state = STATE.EYETRACK_CAL;
    this.#hud.stateTimer      = { startedAt: Date.now(), duration: null };
    this.#hud.nextVisible     = false;
    this.#hud.abortVisible    = false;
    this.#hud.pauseVisible    = false;
    this.#hud.playVisible     = false;
    this.#hud.gazeCalibrating = true;
    this.#hud.stateText       = 'calibrating eye tracker — please wait…';

    this.#markers.send('gaze_recalibration_start');
    this.#eyelinkCalSeen = false;
    window.api.window.minimize();
    this.#eyelinkControl.calibrate();
  }

  #finishEyeCalibration() {
    this.#markers.send('gaze_recalibration_end');
    this.#hud.gazeCalibrating = false;
    window.api.window.restore();

    const ret = this.#eyeCalReturn;
    this.#eyeCalReturn = null;
    if (ret) {
      this.#state = ret.state;
      this.#hud.stateTimer = { startedAt: Date.now(), duration: null };
      if (ret.state === STATE.IDLE) {
        this.#updateIdleReadiness();      // re-enables Start, refreshes the status text
      } else {
        this.#hud.stateText = ret.stateText;
        // Back on an explanation screen: it still waits for Space/Next.
        this.#hud.nextVisible = ret.state === STATE.INSTRUCTIONS_CAL || ret.state === STATE.INSTRUCTIONS_TASK;
      }
      return;
    }

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
    // The last trial's rows were dispatched in #endTrial / #onResponse →
    // experimenter may go back to the menu.
    window.api.session.ended();
  }

  // Text of the explanation screen for the current state (null otherwise).
  // Follows the session's signal type (breath vs heartbeat).
  get #instructions() {
    if (this.#state === STATE.INSTRUCTIONS_CAL) {
      return INSTRUCTIONS.calibration({ signal: this.#inputSignalType });
    }
    if (this.#state === STATE.INSTRUCTIONS_TASK) {
      return INSTRUCTIONS.ibreath({ signal: this.#inputSignalType });
    }
    return null;
  }

  // ── Window closing ─────────────────────────────────────────────────────
  //
  // Closing the window is how a session is ended early. Whatever is still
  // only in memory is written synchronously (an async write might never
  // arrive): a running trial's frame rows plus its trial row (aborted,
  // response 'session_closed'), or a trial still waiting for its response.
  // Everything else is already on disk.

  #onWindowClose() {
    if (!this.#csv) return;   // no session started
    const interrupted = this.#state === STATE.PAUSED ? this.#pausedFromState : this.#state;
    if (this.#state === STATE.TRIAL) {
      const trial = this.#trials[this.#trialIndex];
      trial.endTime    = new Date().toISOString();
      trial.aborted    = true;
      trial.flashShown = this.#flashShown;
      trial.response   = 'session_closed';
      this.#csv.flushFrameCSVSync(trial, this.#frameRows);
      this.#frameRows = [];
      this.#csv.appendTrialDataSync(trial);
    } else if (interrupted === STATE.RESPONSE && this.#pendingTrial) {
      this.#pendingTrial.response = 'session_closed';
      this.#csv.appendTrialDataSync(this.#pendingTrial);
      this.#pendingTrial = null;
    }
    // Best effort — the marker socket may already be gone.
    if (this.#state !== STATE.DONE) this.#markers.send('session_closed');
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

      this.#updateAsyncStimulus(now);
      this.#sound.setNoiseLevel(this.#clampedStimulus);

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

      if (tSecs >= CONFIG.MAX_TRIAL_TIME) {
        this.#endTrial(false);
      }
    }
  }

  // Async trials: the stimulus is the delayed signal, read at `now`. (Sync
  // trials update #stimulusLevel per incoming sample in #onTrialSample.)
  #updateAsyncStimulus(now) {
    const trial = this.#trials[this.#trialIndex];
    if (trial.synchronous) return;
    const delayed = this.#delayLine.sample(now, trial.delayMs);
    this.#stimulusLevel = mapRange(delayed, this.#stimulusRange, [0, 1]);
  }

  get #clampedStimulus() {
    return Math.max(0, Math.min(1, this.#stimulusLevel));
  }

  // ── Draw loop (requestAnimationFrame) ─────────────────────────────────
  //
  // During a trial, every drawn frame produces exactly one frame-data row
  // holding the values that frame was drawn with — so frameData_N.csv is a
  // record of what the participant actually saw.

  #drawLoop() {
    const now = performance.now();
    const inTrial = this.#state === STATE.TRIAL;
    if (inTrial) this.#updateAsyncStimulus(now);
    const trialDrawData = inTrial ? {
      trial:       this.#trials[this.#trialIndex],
      stimLevel:   this.#clampedStimulus,
      flashActive: this.#flashActive,
    } : null;

    try {
      this.#renderer.draw(this.#state, now, {
        calProgress:       this.#calibration?.progress ?? 0,
        calRemaining:      Math.ceil(this.#calibration?.remainingSecs ?? CONFIG.CALIBRATION_SECS),
        displayElapsed:    this.#displayStartTime != null ? (now - this.#displayStartTime) / 1000 : 0,
        responseStartTime: this.#responseStartTime,
        questionType:      this.#pendingTrial?.questionType ?? '',
        instructions:      this.#instructions,
        gazeX:             this.#gazeX,
        gazeY:             this.#gazeY,
        ...(trialDrawData ?? {}),
      });
    } catch (e) {
      console.error('[IBreath] draw error:', e);
    }

    if (inTrial) {
      this.#frameRows.push({
        t:     new Date().toISOString(),
        raw:   this.#lastRawSample,
        stim:  trialDrawData.stimLevel,
        flash: trialDrawData.flashActive ? 1 : 0,
        ...(this.#gazeEnabled ? { gazeX: this.#gazeX ?? '', gazeY: this.#gazeY ?? '' } : {}),
      });
    }

    requestAnimationFrame(() => this.#drawLoop());
  }

  // ── Warning display (CSV errors, preset problems) ──────────────────────

  #showWarning(msg) {
    console.warn('[IBreath]', msg);
    if (!this.#hud) return;
    const prev = this.#hud.stateText;
    this.#hud.stateText  = `⚠ ${msg}`;
    this.#hud.stateColor = '#e09898';
    setTimeout(() => {
      this.#hud.stateText  = prev;
      this.#hud.stateColor = '';
    }, 5000);
  }
}
