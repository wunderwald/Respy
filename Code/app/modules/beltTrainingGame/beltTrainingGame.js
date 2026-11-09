/**
 * beltTrainingGame.js — Belt Training Game
 * ==========================================
 * Gets children used to controlling the on-screen fish with a respiration
 * belt before they play the main BioGame.
 *
 * State machine (one trial; CONFIG.TRAINING_PASSES = 2 training phases):
 *   IDLE → INSTRUCTIONS_CAL → CALIBRATING → INSTRUCTIONS_TASK →
 *          READY → COUNTDOWN → TRAINING (1) → COUNTDOWN → TRAINING (2)
 *                          ↑      → COUNTDOWN → TEST → PHOTO → READY → … → DONE
 *                          |_____________________________________|
 *                        (one READY per trial, waits for Space/Next — the fish is
 *                         live breath-driven here too, so the child can see the
 *                         connection before the trial starts; skipped entirely if
 *                         "auto-proceed" is on. A 3-2-1-GO COUNTDOWN precedes each
 *                         phase automatically. PHOTO is a polaroid of the fish's
 *                         best target-crossing moment that trial's test phase —
 *                         auto-advances if "auto-proceed" is on, otherwise also
 *                         waits for Space/Next.)
 *
 * Each trial reuses the same random target y-position for all its phases.
 * In every phase the fish travels left→right through three segments, timed
 * by APPROACH/TARGET_AREA/EXIT_DURATION_MS: approach the target zone, cross
 * it slowly, then exit quickly. In the training phases the red/yellow/green
 * target bands and the fish are visible; in the test phase the target zone
 * is covered by a bubble overlay and the fish disappears while crossing it —
 * the child must reproduce the same breath level blind.
 *
 * Phases are labelled 'training1', 'training2', …, 'test' in the CSVs and
 * markers (see #phaseLabel), so the training passes can be told apart.
 *
 * No scoring/feedback UI during gameplay (by design) — the only feedback is
 * the post-test photo, which is purely celebratory (best moment, not a
 * score). Full data output is via CSV only.
 *
 * Implements the standard frontend interface:
 *   pushSample(value: number) → void
 *   setStatus({ type, text })  → void
 */

import { GaussianSmoother, validSmoothWindow } from '../signal/signalUtils.js';
import { RespCalibration, AdaptiveRange } from '../calibration/calibration.js';
import { MarkerStream } from '../stream/markerStream.js';
import { CONFIG, STATE } from './beltTrainingGame_config.js';
import { BeltTrainingGameRenderer } from './beltTrainingGame_renderer.js';
import { BeltTrainingGameCSV } from './beltTrainingGame_csv.js';
import { SCENE } from '../bioGame/bioGame_scene.js';
import { BioGameSound } from '../bioGame/bioGame_sound.js';
import { INSTRUCTIONS } from '../instructions/instructionTexts.js';
import { TEXTS } from './beltTrainingGame_texts.js';

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
  #stateText    = 'waiting for stream…';   // last status line sent to the experimenter

  // ── Experiment settings (overridden by experimenter on start) ─────────────
  #subjectCode     = CONFIG.SUBJECT_CODE;
  #calibrationSecs = CONFIG.CALIBRATION_SECS;
  #smoothWindow    = CONFIG.SMOOTH_WINDOW;   // samples; experimenter's "smoothing" control
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
  #targetNormY     = 0.5;   // random per trial, reused for all its phases
  #phaseStep       = null;  // 0 … TRAINING_PASSES-1 = training passes, TRAINING_PASSES = test
  #phase           = null;  // 'training' | 'test' | null — the kind of #phaseStep
  #segment         = null;  // 'approach' | 'target' | 'exit' | null
  #phaseStartTime  = null;
  #fishXRatio      = CONFIG.SPAWN_X_RATIO;
  #segGreenTime    = 0;     // time spent inside the green band during the 'target' segment
  #segTotalTime    = 0;     // total time spent in the 'target' segment

  // ── Best-moment tracking (test phase only) — feeds the post-test photo ────
  #bestTargetDistance = Infinity;
  #bestFishXRatio     = 0;
  #bestFishNormY      = 0.5;

  // ── Post-test photo review ────────────────────────────────────────────────
  #photoStartTime = null;
  #photoSeq       = 0;  // increments every photo review — cache key for the renderer
                         // (trialIndex alone would collide across separate sessions,
                         // since it resets to 0 each time calibration restarts)

  // ── Countdown (3-2-1-GO before each phase) ────────────────────────────────
  #countdownStartTime = null;
  #pendingStep        = null;  // phase step the countdown is leading into

  // ── Data / frame recording ───────────────────────────────────────────────
  #csv             = null;

  // ── Timing ────────────────────────────────────────────────────────────────
  #lastRafTime = null;

  // ── Sub-modules ───────────────────────────────────────────────────────────
  #markers  = null;
  #renderer = null;
  #sound    = null;

  constructor({ sceneContainer }) {
    this.#renderer = new BeltTrainingGameRenderer(sceneContainer, SCENE);

    // Reuses bioGame's ocean soundscape as-is: a steady ambience loop plus a
    // noise layer whose volume tracks the live breath signal in real time
    // (see #rafLoop's setNoiseLevel call). The buffers are loaded once up
    // front.
    this.#sound = new BioGameSound();
    this.#sound.init()
      .then(() => this.#sound.loadScene(SCENE.sounds))
      .catch(e => console.warn('[BeltTrainingGame] sound init failed:', e));

    this.#markers = CONFIG.SEND_MARKERS
      ? new MarkerStream(CONFIG.MARKER_STREAM_URL)
      : { send() {} };

    window.api.frontend.onAction((action) => this.#onAction(action));
    window.addEventListener('pagehide', () => this.#onWindowClose());

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

  #onAction({ type, subjectCode, calibrationSecs, smoothWindow, autoProceed }) {
    switch (type) {
      case 'start':
        // Settings only count for a session that actually starts now, so the
        // recorded values (e.g. smoothWindow) always match what's in use.
        if (this.#state !== STATE.IDLE || !this.#streamReady) break;
        if (subjectCode     !== undefined) this.#subjectCode     = subjectCode;
        if (calibrationSecs !== undefined) this.#calibrationSecs = calibrationSecs;
        if (smoothWindow    !== undefined) this.#smoothWindow    = validSmoothWindow(smoothWindow, CONFIG.SMOOTH_WINDOW);
        if (autoProceed     !== undefined) this.#autoProceed     = autoProceed;
        this.#beginSession();
        break;

      case 'setAutoProceed':
        this.#autoProceed = !!autoProceed;
        // Changed during a session → record it (initial value is in the settings rows).
        if (this.#csv && this.#state !== STATE.DONE) {
          this.#csv.appendEvent('', '', 'setting', 'auto_proceed', this.#autoProceed);
        }
        this.#pushState();   // Next's visibility on the photo screen depends on it
        break;

      case 'next':
        if (this.#state === STATE.INSTRUCTIONS_CAL) this.#startCalibration();
        else if (this.#state === STATE.INSTRUCTIONS_TASK) this.#beginReadyForTrial();
        else if (this.#state === STATE.READY) this.#beginCountdown(0);
        else if (this.#state === STATE.PHOTO) this.#finishPhotoReview();
        break;

      case 'abort':
        // Only a running trial (its countdowns included) can be aborted.
        if (this.#state === STATE.COUNTDOWN ||
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

  // Start pressed: set the session up, then explain the calibration to the
  // child. The calibration itself starts on Space/Next (#startCalibration).
  // Both explanation screens always wait for Space/Next, even with
  // auto-proceed on.
  #beginSession() {
    this.#smoother = new GaussianSmoother(this.#smoothWindow);   // fresh, with the chosen window
    this.#inputsLocked = true;
    this.#trialIndex   = 0;

    this.#csv = new BeltTrainingGameCSV(
      this.#subjectCode, SCENE.id,
      {
        calibration_secs: this.#calibrationSecs,
        smooth_window:    this.#smoothWindow,
        auto_proceed:     this.#autoProceed,   // can change mid-session → later `setting` rows
        num_trials:       CONFIG.NUM_TRIALS,
        training_passes:  CONFIG.TRAINING_PASSES,
      },
      (msg) => this.#csvWarn(msg)
    );
    this.#csv.init();

    this.#state = STATE.INSTRUCTIONS_CAL;
    this.#markers.send('instructions_cal_start');
    this.#pushState({ stateText: 'explaining calibration — press Space or Next', inputsLocked: true });
  }

  #startCalibration() {
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

    this.#state = STATE.CALIBRATING;
    this.#markers.send('calibration_start');
    this.#pushState({ stateText: 'calibrating…' });
  }

  #finishCalibration() {
    this.#markers.send('calibration_end');
    const result = this.#calibration.finish();

    if (!result) {
      console.warn('[BeltTrainingGame] calibration produced no usable range (no samples, or flat signal)');
      this.#markers.send('calibration_failed');
      this.#csv.appendEvent('', '', 'calibration_failed');
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
    // Calibration outcome in eventData.csv (the markers alone are lost if the
    // marker stream was down).
    this.#csv.appendEvent('', '', fromData ? 'calibration_complete' : 'calibration_default_used',
      range[0].toFixed(6), range[1].toFixed(6));
    console.log(`[BeltTrainingGame] norm range: [${range[0].toFixed(3)}, ${range[1].toFixed(3)}]`);

    // Explain the game; Space/Next then leads into trial 1.
    this.#state = STATE.INSTRUCTIONS_TASK;
    this.#markers.send('instructions_task_start');
    this.#pushState({ stateText: 'explaining the game — press Space or Next', calFailed: false });
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

  // `afterAbort`: always wait in READY, even with auto-proceed on, so the
  // experimenter can sort out whatever made them abort before going on.
  #beginReadyForTrial({ afterAbort = false } = {}) {
    this.#targetNormY = randBetween(CONFIG.TARGET_Y_MIN, CONFIG.TARGET_Y_MAX);
    this.#phaseStep   = null;
    this.#phase       = null;
    this.#segment     = null;

    if (this.#autoProceed && !afterAbort) {
      this.#beginCountdown(0);
      return;
    }

    const prefix = afterAbort ? `trial ${this.#trialIndex} aborted — ` : '';
    this.#state = STATE.READY;
    this.#pushState({
      stateText:    `${prefix}ready — trial ${this.#trialIndex + 1} / ${CONFIG.NUM_TRIALS} — press Space or Start`,
      nextVisible:  true,
      abortVisible: false,
      calFailed:    false,
    });
  }

  // 1-based trial number — used for everything written to markers and CSVs
  // (#trialIndex itself stays 0-based for logic and the renderer).
  get #trialNo() {
    return this.#trialIndex + 1;
  }

  // ── Phase steps ───────────────────────────────────────────────────────────
  //
  // A trial is TRAINING_PASSES training phases followed by one test phase,
  // numbered as steps 0 … TRAINING_PASSES (the last step is the test).

  static #kindOf(step) {
    return step < CONFIG.TRAINING_PASSES ? 'training' : 'test';
  }

  // 'training1', 'training2', … or 'test' — used in CSVs, markers and status.
  static #labelOf(step) {
    if (step == null) return '';
    return step < CONFIG.TRAINING_PASSES ? `training${step + 1}` : 'test';
  }

  get #phaseLabel() {
    return BeltTrainingGame.#labelOf(this.#phaseStep);
  }

  #beginCountdown(step) {
    this.#pendingStep        = step;
    this.#countdownStartTime = performance.now();
    this.#state              = STATE.COUNTDOWN;
    this.#pushState({
      stateText:    `trial ${this.#trialIndex + 1} / ${CONFIG.NUM_TRIALS} — starting ${BeltTrainingGame.#labelOf(step)}…`,
      nextVisible:  false,
      abortVisible: true,
    });
  }

  #beginTrialPhase(step) {
    this.#phaseStep      = step;
    this.#phase          = BeltTrainingGame.#kindOf(step);
    this.#segment        = 'approach';
    this.#phaseStartTime = performance.now();
    this.#fishXRatio     = CONFIG.SPAWN_X_RATIO;
    this.#segGreenTime   = 0;
    this.#segTotalTime   = 0;

    if (step === 0) {
      this.#markers.send(`trial_start_t${this.#trialNo}`);
      this.#csv.initTrialCSV(this.#trialNo);
      this.#sound.startBlock();  // spans the whole trial — first training through test
    }
    this.#markers.send(`${this.#phaseLabel}_start_t${this.#trialNo}`);
    this.#state = this.#phase === 'training' ? STATE.TRAINING : STATE.TEST;

    this.#pushState({
      stateText:    `trial ${this.#trialIndex + 1} / ${CONFIG.NUM_TRIALS} — ${this.#phaseLabel}`,
      nextVisible:  false,
      abortVisible: true,
    });
  }

  #endPhase() {
    this.#csv.flushFrames(this.#trialNo);
    this.#markers.send(`${this.#phaseLabel}_end_t${this.#trialNo}`);

    if (this.#phase === 'training') {
      this.#beginCountdown(this.#phaseStep + 1);   // next training pass, or the test
      return;
    }

    this.#markers.send(`trial_end_t${this.#trialNo}`);
    this.#csv.appendEvent(this.#trialNo, this.#phaseLabel, 'trial_end');
    this.#sound.stopBlock();

    this.#beginPhotoReview();
  }

  // Shows the post-test polaroid (see beltTrainingGame_renderer.js's
  // #capturePhoto/#drawPhotoReview) of the fish at its best (closest-to-
  // target) moment during the test phase's target crossing. With
  // auto-proceed on, it auto-advances itself (see #tick) once developed plus
  // a short hold; otherwise it waits for Space/Next trial, like READY.
  #beginPhotoReview() {
    this.#state = STATE.PHOTO;
    this.#photoStartTime = performance.now();
    this.#photoSeq++;
    this.#pushState({
      stateText:    `trial ${this.#trialIndex + 1} / ${CONFIG.NUM_TRIALS} — here's how you did`,
      nextVisible:  !this.#autoProceed,
      abortVisible: false,
    });
  }

  #finishPhotoReview() {
    this.#photoStartTime = null;
    this.#trialIndex++;
    if (this.#trialIndex >= CONFIG.NUM_TRIALS) {
      this.#endExperiment();
      return;
    }
    this.#beginReadyForTrial();
  }

  // Ends only the running trial; the session moves on to the next trial
  // (or ends, if this was the last one). No photo for an aborted trial.
  #abortTrial() {
    this.#csv?.flushFrames(this.#trialNo);
    this.#markers.send(`trial_abort_t${this.#trialNo}`);
    // value1 = state aborted in ('countdown' | 'training' | 'test'): during the
    // countdown before training 2, the phase column still says 'training1'.
    this.#csv?.appendEvent(this.#trialNo, this.#phaseLabel, 'trial_abort', this.#state);
    this.#sound?.stopBlock();  // no-op if the soundscape wasn't playing
    this.#pendingStep = null;

    this.#trialIndex++;
    if (this.#trialIndex >= CONFIG.NUM_TRIALS) {
      this.#endExperiment();
      return;
    }
    this.#beginReadyForTrial({ afterAbort: true });
  }

  // Closing the window is how a session is ended early: write the buffered
  // frame rows and a 'session_closed' event (value1 = state it was closed
  // in) synchronously — an async write might never arrive.
  #onWindowClose() {
    if (!this.#csv || this.#state === STATE.DONE) return;   // no session running
    this.#csv.flushFramesSync(this.#trialNo);
    this.#csv.appendEventSync(this.#trialNo, this.#phaseLabel, 'session_closed', this.#state);
    this.#markers.send('session_closed');   // best effort — the socket may already be gone
  }

  #endExperiment() {
    this.#state = STATE.DONE;
    this.#markers.send('experiment_done');
    this.#pushState({ stateText: 'done', nextVisible: false, abortVisible: false });
    // All final writes were dispatched at phase end / abort → experimenter may go back to the menu.
    window.api.session.ended();
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
        const step = this.#pendingStep;
        this.#pendingStep = null;
        this.#beginTrialPhase(step);
      }
    }

    if (this.#state === STATE.PHOTO && this.#autoProceed) {
      if (performance.now() - this.#photoStartTime >= CONFIG.PHOTO_DEVELOP_MS + CONFIG.PHOTO_HOLD_MS) {
        this.#finishPhotoReview();
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
      // #updatePhase may just have ended the phase (and flushed its rows):
      // only record while still in a phase, or a row would leak into the
      // next flush — after the test, into the next trial's file.
      if (this.#state === STATE.TRAINING || this.#state === STATE.TEST) {
        this.#recordFrame();
        this.#sound.setNoiseLevel(this.#avatarNormY);
      }
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
      // Compare positions in the segment order, so a stalled frame that
      // jumps straight from 'approach' to 'exit' (or past the end) still
      // produces target_enter + target_leave and the phase's event row.
      const ORDER = ['approach', 'target', 'exit', null];
      const from = ORDER.indexOf(this.#segment), to = ORDER.indexOf(newSegment);
      if (from < 1 && to >= 1) {
        this.#markers.send(`target_enter_t${this.#trialNo}`);
        this.#segGreenTime = 0;
        this.#segTotalTime = 0;
        if (this.#phase === 'test') this.#bestTargetDistance = Infinity;
      }
      if (from <= 1 && to >= 2) {
        // Empty if no frame was drawn inside the target zone at all.
        const greenFraction = this.#segTotalTime > 0 ? (this.#segGreenTime / this.#segTotalTime).toFixed(3) : '';
        this.#markers.send(`target_leave_t${this.#trialNo}`);
        this.#csv.appendEvent(this.#trialNo, this.#phaseLabel, 'target_leave', greenFraction);
      }
      this.#segment = newSegment;
    }

    if (this.#segment === 'target') {
      this.#segTotalTime += dt;
      const distance = Math.abs(this.#avatarNormY - this.#targetNormY);
      if (distance <= CONFIG.TARGET_HEIGHT) {
        this.#segGreenTime += dt;
      }
      if (this.#phase === 'test' && distance < this.#bestTargetDistance) {
        this.#bestTargetDistance = distance;
        this.#bestFishXRatio     = this.#fishXRatio;
        this.#bestFishNormY      = this.#avatarNormY;
      }
    }

    if (this.#segment === null) {
      this.#endPhase();
    }
  }

  // ── Frame data recording ──────────────────────────────────────────────────

  // One row per drawn animation frame, with the state that frame is drawn with.
  #recordFrame() {
    this.#csv.bufferFrame({
      t:        new Date().toISOString(),
      trialIndex: this.#trialNo,
      phase:    this.#phaseLabel,   // 'training1' | 'training2' | 'test'
      segment:  this.#segment ?? '',
      raw:      this.#lastRaw,
      smoothed: this.#smoother.value,
      norm:     this.#avatarNormY,
      normMin:  this.#normRange[0],
      normMax:  this.#normRange[1],
      fishX:    this.#fishXRatio,
      fishY:    this.#avatarNormY,
      targetY:  this.#targetNormY,
      smoothWindow: this.#smoothWindow,
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
      promptText:        this.#phase === 'training' ? TEXTS.promptTraining
                        : this.#phase === 'test'     ? TEXTS.promptTest
                        : null,
      countdownValue,
      countdownProgress: clamp(countdownProgress, 0, 1),
      instructions:      this.#state === STATE.INSTRUCTIONS_CAL  ? INSTRUCTIONS.calibration()
                       : this.#state === STATE.INSTRUCTIONS_TASK ? INSTRUCTIONS.beltTrainingGame({ trainingPasses: CONFIG.TRAINING_PASSES })
                       : null,
      trialIndex:        this.#trialIndex,
      photoKey:          this.#photoSeq,
      bestFishXRatio:    this.#bestFishXRatio,
      bestFishNormY:     this.#bestFishNormY,
      photoElapsedMs:    this.#photoStartTime != null ? now - this.#photoStartTime : 0,
    };
  }

  // ── Experimenter state push ───────────────────────────────────────────────

  // Every push is a full snapshot. Button visibility is derived from the
  // state, so a partial update (e.g. a CSV warning) can't hide them; the
  // status line repeats the last one sent unless overridden.
  #pushState(overrides = {}) {
    if (overrides.stateText !== undefined) this.#stateText = overrides.stateText;
    const s = this.#state;
    window.api.frontend.sendState({
      startEnabled: this.#streamReady && s === STATE.IDLE,
      startText:    'Start',
      nextVisible:  s === STATE.INSTRUCTIONS_CAL || s === STATE.INSTRUCTIONS_TASK ||
                    s === STATE.READY || (s === STATE.PHOTO && !this.#autoProceed),
      abortVisible: s === STATE.COUNTDOWN || s === STATE.TRAINING || s === STATE.TEST,
      calFailed:    s === STATE.CALIBRATING && this.#calFailed,
      inputsLocked: this.#inputsLocked,
      ...overrides,
      stateText:    this.#stateText,
    });
  }

  // ── CSV error display ─────────────────────────────────────────────────────

  #csvWarn(msg) {
    console.error('[BeltTrainingGame CSV]', msg);
    this.#pushState({ stateText: `⚠ CSV: ${msg}` });
  }
}
