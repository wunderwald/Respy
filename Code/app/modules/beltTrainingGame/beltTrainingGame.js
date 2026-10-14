/**
 * beltTrainingGame.js — Belt Training Game
 * ==========================================
 * Gets children used to controlling the on-screen fish with a respiration
 * belt before they play the main BioGame.
 *
 * State machine:
 *   IDLE → CALIBRATING → READY → COUNTDOWN → TRAINING → COUNTDOWN → TEST → READY → … → DONE
 *                           ↑__________________________________________________|
 *                        (one READY per trial, waits for Space/Next — the fish is
 *                         live breath-driven here too, so the child can see the
 *                         connection before the trial starts; skipped entirely if
 *                         "auto-proceed" is on. A 3-2-1-GO COUNTDOWN precedes each
 *                         phase automatically.)
 *
 * Each trial reuses the same random target y-position for both its training
 * and test phases. In both phases the fish travels left→right through three
 * segments, timed by APPROACH/TARGET_AREA/EXIT_DURATION_MS: approach the
 * target zone, cross it slowly, then exit quickly. In the training phase the
 * red/yellow/green target bands and the fish are visible; in the test phase
 * the target zone is covered by a bubble overlay and the fish disappears
 * while crossing it — the child must reproduce the same breath level blind.
 *
 * No scoring/feedback UI (by design) — only CSV data output.
 *
 * Implements the standard frontend interface:
 *   pushSample(value: number) → void
 *   setStatus({ type, text })  → void
 */

import { GaussianSmoother } from '../signal/signalUtils.js';
import { RespCalibration, AdaptiveRange } from '../calibration/calibration.js';
import { MarkerStream } from '../stream/markerStream.js';
import { CONFIG, STATE } from './beltTrainingGame_config.js';
import { BeltTrainingGameRenderer } from './beltTrainingGame_renderer.js';
import { BeltTrainingGameCSV } from './beltTrainingGame_csv.js';
import { resolveScene } from '../bioGame/bioGame_scene.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function lerp(a, b, t)    { return a + (b - a) * t; }
function randBetween(lo, hi) { return lo + Math.random() * (hi - lo); }

// ── BeltTrainingGame ────────────────────────────────────────────────────────

export default class BeltTrainingGame {
  // ── State ─────────────────────────────────────────────────────────────────
  #state        = STATE.IDLE;
  #streamReady  = false;
  #inputsLocked = false;

  // ── Experiment settings (overridden by experimenter on start) ─────────────
  #subjectCode     = CONFIG.SUBJECT_CODE;
  #calibrationSecs = CONFIG.CALIBRATION_SECS;
  #autoProceed     = false;  // when true, READY screens are skipped — trials chain automatically

  // ── Signal processing ─────────────────────────────────────────────────────
  #smoother     = new GaussianSmoother(CONFIG.SMOOTH_WINDOW);
  #lastRaw      = 0;
  #calibration  = null;
  #calFailed    = false;
  #normRange    = [0, 1];
  #rangeTracker = null;   // AdaptiveRange — follows drift after calibration (RANGE_ADAPT)

  // ── Avatar state (breath-driven y) ────────────────────────────────────────
  #avatarNormY     = 0.5;
  #prevAvatarNormY = 0.5;
  #avatarTilt      = 0;

  // ── Trial / phase state ───────────────────────────────────────────────────
  #trialIndex      = 0;
  #targetNormY     = 0.5;   // random per trial, reused for both phases
  #phase           = null;  // 'training' | 'test' | null
  #segment         = null;  // 'approach' | 'target' | 'exit' | null
  #phaseStartTime  = null;
  #fishXRatio      = CONFIG.SPAWN_X_RATIO;
  #segGreenTime    = 0;     // time spent inside the green band during the 'target' segment
  #segTotalTime    = 0;     // total time spent in the 'target' segment

  // ── Countdown (3-2-1-GO before each phase) ────────────────────────────────
  #countdownStartTime = null;
  #pendingPhase       = null;  // phase the countdown is leading into: 'training' | 'test'

  // ── Data / frame recording ───────────────────────────────────────────────
  #csv             = null;
  #lastFrameRecord = 0;

  // ── Timing ────────────────────────────────────────────────────────────────
  #lastRafTime = null;

  // ── Sub-modules ───────────────────────────────────────────────────────────
  #markers  = null;
  #renderer = null;

  constructor({ sceneContainer }) {
    this.#renderer = new BeltTrainingGameRenderer(sceneContainer, resolveScene(CONFIG.SCENE));

    this.#markers = CONFIG.SEND_MARKERS
      ? new MarkerStream(CONFIG.MARKER_STREAM_URL)
      : { send() {} };

    window.api.frontend.onAction((action) => this.#onAction(action));

    setInterval(() => this.#tick(), 100);
    requestAnimationFrame((t) => this.#rafLoop(t));
  }

  // ── Public interface ──────────────────────────────────────────────────────

  pushSample(rawValue) {
    this.#lastRaw = rawValue;
    this.#smoother.push(rawValue);
    this.#rangeTracker?.push(performance.now(), this.#smoother.value);

    if (this.#state === STATE.CALIBRATING) {
      this.#calibration.push(this.#smoother.value);
    }
  }

  setStatus({ type, text }) {
    this.#streamReady = (type === 'connected');
    if (this.#state === STATE.IDLE) {
      this.#pushState({
        stateText:    this.#streamReady ? 'stream ready' : (text ?? 'no stream'),
        startEnabled: this.#streamReady,
      });
    }
  }

  // ── Action handler ────────────────────────────────────────────────────────

  #onAction({ type, subjectCode, calibrationSecs, autoProceed }) {
    switch (type) {
      case 'start':
        if (subjectCode     !== undefined) this.#subjectCode     = subjectCode;
        if (calibrationSecs !== undefined) this.#calibrationSecs = calibrationSecs;
        if (autoProceed     !== undefined) this.#autoProceed     = autoProceed;
        if (this.#state === STATE.IDLE && this.#streamReady) this.#beginCalibration();
        break;

      case 'setAutoProceed':
        this.#autoProceed = !!autoProceed;
        break;

      case 'next':
        if (this.#state === STATE.READY) this.#beginCountdown('training');
        break;

      case 'abort':
        if (this.#state === STATE.READY || this.#state === STATE.COUNTDOWN ||
            this.#state === STATE.TRAINING || this.#state === STATE.TEST) {
          this.#abortTrial();
        }
        break;

      case 'retryCalibration':
        if (this.#state === STATE.CALIBRATING && this.#calFailed) this.#retryCalibration();
        break;

      case 'useDefaultCalibration':
        if (this.#state === STATE.CALIBRATING && this.#calFailed) this.#useDefaultCalibration();
        break;

      case 'ready':
        this.#pushState();
        break;
    }
  }

  // ── State machine ─────────────────────────────────────────────────────────

  #beginCalibration() {
    this.#calibration = new RespCalibration({ durationSecs: this.#calibrationSecs });
    this.#calibration.start();
    this.#calFailed = false;
    // Collects from calibration on, so its window is already full once seeded.
    this.#rangeTracker = CONFIG.RANGE_ADAPT
      ? new AdaptiveRange({
          windowSecs:       CONFIG.RANGE_WINDOW_SECS,
          timeConstantSecs: CONFIG.RANGE_TIME_CONSTANT_SECS,
          minSpanFraction:  CONFIG.RANGE_MIN_SPAN_FRACTION,
        })
      : null;
    this.#smoother.reset();
    this.#inputsLocked = true;
    this.#trialIndex   = 0;

    this.#csv = new BeltTrainingGameCSV(
      this.#subjectCode, CONFIG.SCENE,
      (msg) => this.#csvWarn(msg)
    );
    this.#csv.init();

    this.#state = STATE.CALIBRATING;
    this.#markers.send('calibration_start');
    this.#pushState({ stateText: 'calibrating…', abortVisible: false, inputsLocked: true });
  }

  #finishCalibration() {
    this.#markers.send('calibration_end');
    const result = this.#calibration.finish();

    if (!result) {
      console.warn('[BeltTrainingGame] calibration produced no usable range (no samples, or flat signal)');
      this.#markers.send('calibration_failed');
      this.#calFailed = true;
      this.#pushState({
        stateText: '⚠ calibration failed — no signal or flat signal',
        calFailed: true,
      });
      return;
    }

    this.#completeCalibration([result.min, result.max]);
  }

  #completeCalibration(range, { fromData = true } = {}) {
    this.#normRange = [...range];
    this.#rangeTracker?.seed(range, { fromData });
    console.log(`[BeltTrainingGame] norm range: [${range[0].toFixed(3)}, ${range[1].toFixed(3)}]`);

    this.#beginReadyForTrial();
  }

  #retryCalibration() {
    this.#calibration.start();
    this.#calFailed = false;
    this.#markers.send('calibration_start');
    this.#pushState({ stateText: 'calibrating…', calFailed: false });
  }

  #useDefaultCalibration() {
    this.#markers.send('calibration_default_used');
    this.#completeCalibration(CONFIG.DEFAULT_CAL_RANGE, { fromData: false });
  }

  #beginReadyForTrial() {
    this.#targetNormY = randBetween(CONFIG.TARGET_Y_MIN, CONFIG.TARGET_Y_MAX);
    this.#phase       = null;
    this.#segment     = null;

    if (this.#autoProceed) {
      this.#beginCountdown('training');
      return;
    }

    this.#state = STATE.READY;
    this.#pushState({
      stateText:    `ready — trial ${this.#trialIndex + 1} / ${CONFIG.NUM_TRIALS} — press Space or Start`,
      nextVisible:  true,
      abortVisible: true,
      calFailed:    false,
    });
  }

  #beginCountdown(phase) {
    this.#pendingPhase       = phase;
    this.#countdownStartTime = performance.now();
    this.#state              = STATE.COUNTDOWN;
    this.#pushState({
      stateText:    `trial ${this.#trialIndex + 1} / ${CONFIG.NUM_TRIALS} — starting ${phase}…`,
      nextVisible:  false,
      abortVisible: true,
    });
  }

  #beginTrialPhase(phase) {
    this.#phase          = phase;
    this.#segment        = 'approach';
    this.#phaseStartTime = performance.now();
    this.#fishXRatio     = CONFIG.SPAWN_X_RATIO;
    this.#segGreenTime   = 0;
    this.#segTotalTime   = 0;

    if (phase === 'training') {
      this.#markers.send(`trial_start_t${this.#trialIndex}`);
      this.#markers.send(`training_start_t${this.#trialIndex}`);
      this.#csv.initTrialCSV(this.#trialIndex);
      this.#state = STATE.TRAINING;
    } else {
      this.#markers.send(`test_start_t${this.#trialIndex}`);
      this.#state = STATE.TEST;
    }

    this.#pushState({
      stateText:    `trial ${this.#trialIndex + 1} / ${CONFIG.NUM_TRIALS} — ${phase}`,
      nextVisible:  false,
      abortVisible: true,
    });
  }

  #endPhase() {
    this.#csv.flushFrames(this.#trialIndex);

    if (this.#phase === 'training') {
      this.#markers.send(`training_end_t${this.#trialIndex}`);
      this.#beginCountdown('test');
      return;
    }

    this.#markers.send(`test_end_t${this.#trialIndex}`);
    this.#markers.send(`trial_end_t${this.#trialIndex}`);
    this.#csv.appendEvent(this.#trialIndex, 'test', 'trial_end');

    this.#trialIndex++;
    if (this.#trialIndex >= CONFIG.NUM_TRIALS) {
      this.#endExperiment();
      return;
    }
    this.#beginReadyForTrial();
  }

  #abortTrial() {
    this.#csv?.flushFrames(this.#trialIndex);
    this.#markers.send(`trial_abort_t${this.#trialIndex}`);
    this.#csv?.appendEvent(this.#trialIndex, this.#phase, 'trial_abort');
    this.#endExperiment();
  }

  #endExperiment() {
    this.#state = STATE.DONE;
    this.#markers.send('experiment_done');
    this.#pushState({ stateText: 'done', nextVisible: false, abortVisible: false });
  }

  // ── Update loop ───────────────────────────────────────────────────────────

  #tick() {
    if (this.#state === STATE.CALIBRATING && !this.#calFailed) {
      if (this.#calibration.isDone) {
        this.#finishCalibration();
      }
    }

    if (this.#state === STATE.COUNTDOWN) {
      if ((performance.now() - this.#countdownStartTime) / 1000 >= CONFIG.COUNTDOWN_SECS) {
        const phase = this.#pendingPhase;
        this.#pendingPhase = null;
        this.#beginTrialPhase(phase);
      }
    }
  }

  // ── RAF loop ──────────────────────────────────────────────────────────────

  #rafLoop(now) {
    const dt = this.#lastRafTime != null ? clamp((now - this.#lastRafTime) / 1000, 0, 0.05) : 0;
    this.#lastRafTime = now;

    const inGameplay = this.#state === STATE.TRAINING || this.#state === STATE.TEST;

    if (inGameplay || this.#state === STATE.CALIBRATING || this.#state === STATE.READY) {
      this.#updateSignal(dt);
    }

    if (inGameplay) {
      this.#updatePhase(now, dt);
      this.#recordFrame(now);
    }

    try {
      this.#renderer.draw(this.#buildRenderData(now));
    } catch (e) {
      console.error('[BeltTrainingGame] draw error:', e);
    }

    requestAnimationFrame((t) => this.#rafLoop(t));
  }

  // ── Signal normalization ──────────────────────────────────────────────────

  #updateSignal(dt) {
    if (this.#state === STATE.TRAINING || this.#state === STATE.TEST || this.#state === STATE.READY) {
      this.#normRange = this.#rangeTracker?.range ?? this.#normRange;
    }
    const [rMin, rMax] = this.#normRange;
    const range = rMax - rMin || 1e-6;
    const norm  = clamp((this.#smoother.value - rMin) / range, 0, 1);

    this.#prevAvatarNormY = this.#avatarNormY;
    this.#avatarNormY     = norm;

    const vel = dt > 0 ? (norm - this.#prevAvatarNormY) / dt : 0;
    const tgt = clamp(-vel * 1.8, -Math.PI / 6, Math.PI / 6);
    this.#avatarTilt = lerp(this.#avatarTilt, tgt, 1 - Math.exp(-dt / 0.18));
  }

  // ── Phase / segment timing ────────────────────────────────────────────────

  #updatePhase(now, dt) {
    const elapsed = now - this.#phaseStartTime;
    const A = CONFIG.APPROACH_DURATION_MS;
    const T = CONFIG.TARGET_AREA_DURATION_MS;
    const E = CONFIG.EXIT_DURATION_MS;

    let newSegment;
    if (elapsed < A) {
      newSegment = 'approach';
      this.#fishXRatio = lerp(CONFIG.SPAWN_X_RATIO, CONFIG.TARGET_X_START, elapsed / A);
    } else if (elapsed < A + T) {
      newSegment = 'target';
      this.#fishXRatio = lerp(CONFIG.TARGET_X_START, CONFIG.TARGET_X_END, (elapsed - A) / T);
    } else if (elapsed < A + T + E) {
      newSegment = 'exit';
      this.#fishXRatio = lerp(CONFIG.TARGET_X_END, CONFIG.DESPAWN_X_RATIO, (elapsed - A - T) / E);
    } else {
      newSegment = null;
    }

    if (newSegment !== this.#segment) {
      if (this.#segment === 'approach' && newSegment === 'target') {
        this.#markers.send(`target_enter_t${this.#trialIndex}`);
        this.#segGreenTime = 0;
        this.#segTotalTime = 0;
      }
      if (this.#segment === 'target' && newSegment !== 'target') {
        const greenFraction = this.#segTotalTime > 0 ? this.#segGreenTime / this.#segTotalTime : 0;
        this.#markers.send(`target_leave_t${this.#trialIndex}`);
        this.#csv.appendEvent(this.#trialIndex, this.#phase, 'target_leave', greenFraction.toFixed(3));
      }
      this.#segment = newSegment;
    }

    if (this.#segment === 'target') {
      this.#segTotalTime += dt;
      if (Math.abs(this.#avatarNormY - this.#targetNormY) <= CONFIG.TARGET_HEIGHT) {
        this.#segGreenTime += dt;
      }
    }

    if (this.#segment === null) {
      this.#endPhase();
    }
  }

  // ── Frame data recording ──────────────────────────────────────────────────

  #recordFrame(now) {
    if (now - this.#lastFrameRecord < CONFIG.FRAME_INTERVAL_MS) return;
    this.#lastFrameRecord = now;

    this.#csv.bufferFrame({
      t:        new Date().toISOString(),
      trialIndex: this.#trialIndex,
      phase:    this.#phase ?? '',
      segment:  this.#segment ?? '',
      raw:      this.#lastRaw,
      smoothed: this.#smoother.value,
      norm:     this.#avatarNormY,
      normMin:  this.#normRange[0],
      normMax:  this.#normRange[1],
      fishX:    this.#fishXRatio,
      fishY:    this.#avatarNormY,
      targetY:  this.#targetNormY,
    });
  }

  // ── Render data builder ───────────────────────────────────────────────────

  #buildRenderData(now) {
    let countdownValue = 3, countdownProgress = 0;
    if (this.#countdownStartTime != null) {
      const cdE = (now - this.#countdownStartTime) / 1000;
      if      (cdE < 1) { countdownValue = 3; countdownProgress = cdE; }
      else if (cdE < 2) { countdownValue = 2; countdownProgress = cdE - 1; }
      else if (cdE < 3) { countdownValue = 1; countdownProgress = cdE - 2; }
      else              { countdownValue = 0; countdownProgress = (cdE - 3) / 0.75; }
    }

    return {
      state:             this.#state,
      now,
      calProgress:       this.#calibration?.progress ?? 0,
      calRemaining:      Math.ceil(this.#calibration?.remainingSecs ?? this.#calibrationSecs),
      fishXRatio:        this.#fishXRatio,
      fishNormY:         this.#avatarNormY,
      targetNormY:       this.#targetNormY,
      segment:           this.#segment,
      avatarTilt:        this.#avatarTilt,
      promptText:        this.#phase === 'training' ? 'Hold your breath in the green area!'
                        : this.#phase === 'test'     ? 'Hold your breath just like before!'
                        : null,
      countdownValue,
      countdownProgress: clamp(countdownProgress, 0, 1),
    };
  }

  // ── Experimenter state push ───────────────────────────────────────────────

  #pushState(overrides = {}) {
    window.api.frontend.sendState({
      stateText:    this.#state,
      startEnabled: this.#streamReady && this.#state === STATE.IDLE,
      startText:    'Start',
      nextVisible:  false,
      abortVisible: false,
      calFailed:    false,
      inputsLocked: this.#inputsLocked,
      ...overrides,
    });
  }

  // ── CSV error display ─────────────────────────────────────────────────────

  #csvWarn(msg) {
    console.error('[BeltTrainingGame CSV]', msg);
    this.#pushState({ stateText: `⚠ CSV: ${msg}` });
  }
}
