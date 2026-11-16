import { GaussianSmoother }     from '../shared/signal/GaussianSmoother.js';
import { CONFIG, STATE }        from './trainingGame_config.js';
import { RiverCrossingRenderer } from '../shared/riverCrossing/RiverCrossingRenderer.js';
import { RunRecorder, round, sig, mean, sum } from '../shared/recording/RunRecorder.js';

// ── TrainingGame — River Crossing ───────────────────────────────────────────
// A ship ferries sheep from the right bank to the left bank against a river
// current. Blowing into the mic pushes the boat left; pausing lets the
// (gentler) current drift it back right. Delivering a sheep scores a point,
// then the boat drifts back on its own to pick up the next one. Forward and
// current speeds are derived from TARGET_BPM so a well-paced slow exhale
// crosses the river in one sustained breath — entraining slow breathing
// without a hard success/fail gate.
//
// Ported from the Electron app: identical game logic/rendering, with the
// experimenter-window IPC (pushState/onAction/setStatus) replaced by a plain
// start() method and an onStateChange(state) callback the host page uses to
// know when tapping the screen should (re)start the game.

export class TrainingGame {
  // state
  #state = STATE.IDLE;
  #score = 0;

  // countdown / timer
  #countdownStart = null;
  #playStartTime = null;

  // signal
  #smoother = new GaussianSmoother(CONFIG.SMOOTH_WINDOW);
  #blowing = false;
  #exhaleStart = null; // performance.now() of the current exhale's onset

  // data export — one mic sample per row while PLAYING
  #rec = new RunRecorder(['raw', 'norm', 'smoothed', 'is_exhale', 'boat_pos']);

  // boat
  #boatPos = 0;   // 0 = docked right, 1 = docked left
  #boatVel = 0;   // current eased velocity (pos/sec) — see #tickBoat's momentum
  #hasSheep = true;
  #sailAnim = 0;  // 0..1, eased toward #blowing for smooth sail motion
  #forwardSpeed;  // pos/sec while blowing
  #currentSpeed;  // pos/sec while not blowing (gentler than forward)

  // background
  #clouds = [];

  // animation
  #lastFrameTime = null;

  // host callback
  #onStateChange;

  // renderer
  #renderer;

  constructor({ sceneContainer, onStateChange }) {
    this.#renderer = new RiverCrossingRenderer(sceneContainer);
    this.#onStateChange = onStateChange;
    this.#initClouds();

    const halfPeriodSec = 30 / CONFIG.TARGET_BPM; // (60 / BPM) / 2
    this.#forwardSpeed = 1 / halfPeriodSec;
    this.#currentSpeed = this.#forwardSpeed * CONFIG.CURRENT_SPEED_FACTOR;

    requestAnimationFrame((t) => this.#rafLoop(t));
  }

  // ── Public interface ──────────────────────────────────────────────────────

  /** Call on a tap/click while IDLE or GAME_OVER — begins the 3-2-1-GO countdown. */
  start() {
    if (this.#state === STATE.IDLE || this.#state === STATE.GAME_OVER) {
      this.#beginCountdown();
    }
  }

  /**
   * Feed one breath sample (from useMicBreathSignal, ~100 Hz).
   * @param {number} value  calibration-normalized level in [0, 1]
   * @param {number} [raw]  the un-normalized mic envelope, for the export only
   */
  pushSample(value, raw = null) {
    this.#smoother.push(value);
    if (this.#state !== STATE.PLAYING) return;

    // Exhale detection: hysteresis threshold on the smoothed signal,
    // evaluated per mic sample (not per frame) so the recorded is_exhale is
    // exactly the decision the game acted on.
    const now = performance.now();
    const v = this.#smoother.value;
    const was = this.#blowing;
    if (was) {
      if (v < CONFIG.BLOW_THRESHOLD - CONFIG.BLOW_HYSTERESIS) this.#blowing = false;
    } else if (v >= CONFIG.BLOW_THRESHOLD) {
      this.#blowing = true;
    }
    if (this.#blowing && !was) {
      this.#exhaleStart = now;
      this.#rec.event(now, 'exhale_start');
    } else if (!this.#blowing && was) {
      this.#endExhale(now);
    }

    this.#rec.sample(now, {
      raw: sig(raw),
      norm: round(value, 4),
      smoothed: round(v, 4),
      is_exhale: this.#blowing ? 1 : 0,
      boat_pos: round(this.#boatPos, 4),
    });
  }

  /**
   * The finished run's data for export (see shared/recording/runExport.js),
   * or null if no run has finished yet.
   */
  getRunData() {
    const base = this.#rec.data();
    if (!base) return null;
    const exhales = this.#rec.intervals('exhale_start', 'exhale_end');
    const crossings = this.#rec.intervals('sheep_picked_up', 'sheep_delivered');
    const exhaleTotal = sum(exhales);
    return {
      game: 'trainingGame',
      variant: 'breath',
      ...base,
      config: {
        ...CONFIG,
        derived: {
          target_exhale_s: 30 / CONFIG.TARGET_BPM,
          forward_speed_pos_per_s: round(this.#forwardSpeed, 6),
          current_speed_pos_per_s: round(this.#currentSpeed, 6),
        },
      },
      detection: {
        method: 'hysteresis threshold on Gaussian-smoothed, calibration-normalized mic envelope',
        input: 'norm = clamp((raw - calibration.range.min) / (calibration.range.max - calibration.range.min), 0, 1)',
        smoothing: { type: 'gaussian', window_samples: CONFIG.SMOOTH_WINDOW },
        threshold_on: CONFIG.BLOW_THRESHOLD,
        threshold_off: round(CONFIG.BLOW_THRESHOLD - CONFIG.BLOW_HYSTERESIS, 4),
        evaluated: 'per mic sample',
      },
      summary: {
        sheep_delivered: this.#score,
        crossing_count: crossings.length,
        crossing_mean_s: round(mean(crossings), 3),
        exhale_count: exhales.length,
        exhale_mean_s: round(mean(exhales), 3),
        exhale_total_s: round(exhaleTotal, 3),
        exhale_fraction: round(exhaleTotal / base.time.duration_s, 4),
        exhales_per_min: round(exhales.length / (base.time.duration_s / 60), 3),
      },
    };
  }

  #endExhale(now, extra = {}) {
    this.#rec.event(now, 'exhale_end', {
      duration_ms: round(now - this.#exhaleStart, 1), ...extra,
    });
    this.#exhaleStart = null;
  }

  // ── State machine ──────────────────────────────────────────────────────────

  #beginCountdown() {
    this.#state = STATE.COUNTDOWN;
    this.#countdownStart = performance.now();
    this.#onStateChange?.(this.#state);
  }

  // `now` is the RAF frame timestamp, so the run's t=0 shares the clock of
  // every later frame (performance.now() here would be slightly later).
  #beginPlaying(now) {
    this.#state = STATE.PLAYING;
    this.#score = 0;
    this.#boatPos = 0;
    this.#boatVel = 0;
    this.#hasSheep = true;
    this.#blowing = false;
    this.#exhaleStart = null;
    this.#sailAnim = 0;
    this.#smoother.reset();
    this.#playStartTime = now;
    this.#rec.start(this.#playStartTime);
    this.#rec.event(this.#playStartTime, 'run_start');
    this.#rec.event(this.#playStartTime, 'sheep_picked_up', { initial: true });
    this.#onStateChange?.(this.#state);
  }

  #endGame(now) {
    if (this.#blowing) this.#endExhale(now, { at_run_end: true });
    this.#blowing = false;
    this.#rec.event(now, 'run_end', { reason: 'time_up', sheep_delivered: this.#score });
    this.#rec.finish(now);
    this.#state = STATE.GAME_OVER;
    this.#onStateChange?.(this.#state);
  }

  // ── Tick — state transitions (driven from the RAF loop) ────────────────────

  #tick(now) {
    if (this.#state === STATE.COUNTDOWN && now - this.#countdownStart >= 3500) {
      this.#beginPlaying(now);
    } else if (this.#state === STATE.PLAYING &&
               now - this.#playStartTime >= CONFIG.GAME_DURATION_SECS * 1000) {
      this.#endGame(now);
    }
  }

  // ── RAF loop ─────────────────────────────────────────────────────────────

  #rafLoop(timestamp) {
    const dt = this.#lastFrameTime != null ? (timestamp - this.#lastFrameTime) / 1000 : 0.016;
    this.#lastFrameTime = timestamp;

    this.#tick(timestamp);

    const c = this.#renderer.canvas;
    c.width  = c.offsetWidth;
    c.height = c.offsetHeight;

    this.#tickClouds(dt);

    if (this.#state === STATE.PLAYING) {
      this.#tickBoat(dt, timestamp);
    }
    this.#sailAnim += ((this.#blowing ? 1 : 0) - this.#sailAnim) * Math.min(1, dt * 6);

    try {
      this.#renderer.draw(this.#buildRenderData(timestamp));
    } catch (e) {
      console.error('[TrainingGame] draw error:', e);
    }

    requestAnimationFrame((t) => this.#rafLoop(t));
  }

  // ── Boat physics ─────────────────────────────────────────────────────────

  #tickBoat(dt, now) {
    // #blowing itself is updated per mic sample in pushSample().

    // Momentum: velocity eases toward its target rather than snapping
    // instantly, so a brief dip below threshold (a micro-pause, mic noise)
    // doesn't immediately reverse the boat — it coasts forward for a moment
    // first. Ramping up when blowing starts stays snappy (small tau);
    // decaying away when it stops is deliberately slow (large tau) — that's
    // the "a little more momentum" forgiveness.
    const targetVel = this.#blowing ? this.#forwardSpeed : -this.#currentSpeed;
    const tau = this.#blowing ? CONFIG.BOAT_ACCEL_TAU_SECS : CONFIG.BOAT_COAST_TAU_SECS;
    const alpha = 1 - Math.exp(-dt / tau);
    this.#boatVel += (targetVel - this.#boatVel) * alpha;

    this.#boatPos = Math.max(0, Math.min(1, this.#boatPos + this.#boatVel * dt));

    if (this.#boatPos >= 1 && this.#hasSheep) {
      this.#hasSheep = false;
      this.#score++;
      this.#rec.event(now, 'sheep_delivered', { sheep_delivered: this.#score });
    } else if (this.#boatPos <= 0 && !this.#hasSheep) {
      this.#hasSheep = true;
      this.#rec.event(now, 'sheep_picked_up');
    }
  }

  // ── Background clouds (parallax, drift left→right with the current) ───────

  #initClouds() {
    const w = this.#renderer.canvas.width  || 1200;
    const h = this.#renderer.canvas.height || 820;
    this.#clouds = Array.from({ length: CONFIG.CLOUD_COUNT }, () => this.#makeCloud(w, h, true));
  }

  #makeCloud(w, h, randomX = false) {
    const size = 34 + Math.random() * 40;
    return {
      x: randomX ? Math.random() * w : -size,
      y: h * (0.06 + Math.random() * 0.28),
      size,
      speed: CONFIG.CLOUD_SPEED_PX_S * (0.7 + Math.random() * 0.6),
    };
  }

  #tickClouds(dt) {
    const w = this.#renderer.canvas.width;
    const h = this.#renderer.canvas.height;
    for (const c of this.#clouds) {
      c.x += c.speed * dt;
      if (c.x - c.size > w) Object.assign(c, this.#makeCloud(w, h, false));
    }
  }

  // ── Render data ──────────────────────────────────────────────────────────

  #buildRenderData(now) {
    const timeLeftSecs = this.#playStartTime != null
      ? Math.max(0, CONFIG.GAME_DURATION_SECS - (now - this.#playStartTime) / 1000)
      : CONFIG.GAME_DURATION_SECS;

    return {
      state:            this.#state,
      countdownElapsed: this.#countdownStart != null ? now - this.#countdownStart : 0,
      score:            this.#score,
      timeLeftSecs,
      boatPos:          this.#boatPos,
      hasSheep:         this.#hasSheep,
      sailAnim:         this.#sailAnim,
      clouds:           this.#clouds,
      now,
      // Only during actual gameplay — coaches the paced breathing: exhale to
      // carry the sheep across, inhale while the current drifts the boat back.
      // Tied to the trip (sheep on board or not), not to the live blowing
      // state: a pause mid-crossing keeps the exhale prompt until the sheep
      // is delivered, and the inhale prompt stays until the boat is back.
      hint: this.#state === STATE.PLAYING
        ? (this.#hasSheep ? 'Puste in das Segel!' : 'Atme ein')
        : null,
    };
  }
}

export default TrainingGame;
