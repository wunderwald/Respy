import { CONFIG, STATE }         from './trainingGameControl_config.js';
import { RiverCrossingRenderer } from '../shared/riverCrossing/RiverCrossingRenderer.js';

// ── TrainingGameControl — River Crossing (Tap) ──────────────────────────────
// The tap-controlled counterpart to trainingGame (River Crossing): identical
// scene and boat physics, but there's no mic/breath input at all — tapping
// the screen fast enough pushes the boat left, pausing lets the (gentler)
// current drift it back right. "Pushing" is driven by a rolling tap-rate
// instead of a thresholded breath signal; everything downstream (momentum,
// sheep delivery, scoring) is the same mechanic as the breath version.
//
// Implements a plain start()/registerTap() interface and an
// onStateChange(state) callback — see shared/ui/TapGamePage.jsx.

export class TrainingGameControl {
  // state
  #state = STATE.IDLE;
  #score = 0;

  // countdown / timer
  #countdownStart = null;
  #playStartTime = null;

  // tap-rate detection
  #tapTimes = [];
  #pushing = false;

  // boat
  #boatPos = 0;   // 0 = docked right, 1 = docked left
  #boatVel = 0;   // current eased velocity (pos/sec) — see #tickBoat's momentum
  #hasSheep = true;
  #sailAnim = 0;  // 0..1, eased toward #pushing for smooth sail motion

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

    requestAnimationFrame((t) => this.#rafLoop(t));
  }

  // ── Public interface ──────────────────────────────────────────────────────

  /** Call on a tap/click while IDLE or GAME_OVER — begins the 3-2-1-GO countdown. */
  start() {
    if (this.#state === STATE.IDLE || this.#state === STATE.GAME_OVER) {
      this.#beginCountdown();
    }
  }

  /** Call once per tap while COUNTDOWN/PLAYING — feeds the tap-rate detector. */
  registerTap() {
    this.#tapTimes.push(performance.now());
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
    this.#pushing = false;
    this.#sailAnim = 0;
    this.#tapTimes = [];
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
      this.#tickBoat(dt, timestamp);
    }
    this.#sailAnim += ((this.#pushing ? 1 : 0) - this.#sailAnim) * Math.min(1, dt * 6);

    try {
      this.#renderer.draw(this.#buildRenderData(timestamp));
    } catch (e) {
      console.error('[TrainingGameControl] draw error:', e);
    }

    requestAnimationFrame((t) => this.#rafLoop(t));
  }

  // ── Boat physics ─────────────────────────────────────────────────────────

  #tickBoat(dt, now) {
    // Prune taps outside the rolling window, then check the sustained rate.
    const cutoff = now - CONFIG.TAP_WINDOW_MS;
    while (this.#tapTimes.length && this.#tapTimes[0] < cutoff) this.#tapTimes.shift();
    this.#pushing = this.#tapTimes.length >= CONFIG.TAP_COUNT_THRESHOLD;

    // Momentum: velocity eases toward its target rather than snapping
    // instantly, so a brief gap between tap bursts doesn't immediately
    // reverse the boat — it coasts forward for a moment first. Ramping up
    // when tapping engages stays snappy (small tau); decaying away when it
    // stops is deliberately slow (large tau) — same forgiving feel as the
    // breath version's momentum.
    const targetVel = this.#pushing ? CONFIG.FORWARD_SPEED_POS_PER_SEC
                                     : -CONFIG.FORWARD_SPEED_POS_PER_SEC * CONFIG.CURRENT_SPEED_FACTOR;
    const tau = this.#pushing ? CONFIG.BOAT_ACCEL_TAU_SECS : CONFIG.BOAT_COAST_TAU_SECS;
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

export default TrainingGameControl;
