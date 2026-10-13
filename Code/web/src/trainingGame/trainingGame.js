import { GaussianSmoother }     from '../shared/signal/GaussianSmoother.js';
import { CONFIG, STATE }        from './trainingGame_config.js';
import { TrainingGameRenderer } from './trainingGame_renderer.js';

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
    this.#renderer = new TrainingGameRenderer(sceneContainer);
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

  /** Feed one normalized [0, 1] breath sample (from useMicBreathSignal). */
  pushSample(value) {
    this.#smoother.push(value);
  }

  // ── State machine ──────────────────────────────────────────────────────────

  #beginCountdown() {
    this.#state = STATE.COUNTDOWN;
    this.#countdownStart = performance.now();
    this.#onStateChange?.(this.#state);
  }

  #beginPlaying() {
    this.#state = STATE.PLAYING;
    this.#score = 0;
    this.#boatPos = 0;
    this.#boatVel = 0;
    this.#hasSheep = true;
    this.#blowing = false;
    this.#sailAnim = 0;
    this.#smoother.reset();
    this.#playStartTime = performance.now();
    this.#onStateChange?.(this.#state);
  }

  #endGame() {
    this.#state = STATE.GAME_OVER;
    this.#onStateChange?.(this.#state);
  }

  // ── Tick — state transitions (driven from the RAF loop) ────────────────────

  #tick(now) {
    if (this.#state === STATE.COUNTDOWN && now - this.#countdownStart >= 3500) {
      this.#beginPlaying();
    } else if (this.#state === STATE.PLAYING &&
               now - this.#playStartTime >= CONFIG.GAME_DURATION_SECS * 1000) {
      this.#endGame();
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
      this.#tickBoat(dt);
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

  #tickBoat(dt) {
    const v = this.#smoother.value;
    if (this.#blowing) {
      if (v < CONFIG.BLOW_THRESHOLD - CONFIG.BLOW_HYSTERESIS) this.#blowing = false;
    } else {
      if (v >= CONFIG.BLOW_THRESHOLD) this.#blowing = true;
    }

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
    } else if (this.#boatPos <= 0 && !this.#hasSheep) {
      this.#hasSheep = true;
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
    };
  }
}

export default TrainingGame;
