import { CONFIG, STATE }         from './trainingGameControl_config.js';
import { RiverCrossingRenderer } from '../shared/riverCrossing/RiverCrossingRenderer.js';
import { RunRecorder, round, mean, sum } from '../shared/recording/RunRecorder.js';

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
  #pushStart = null; // performance.now() of the current push's onset
  #tapCount = 0;

  // data export — one row per animation frame while PLAYING
  #rec = new RunRecorder(['taps_in_window', 'is_pushing', 'boat_pos']);

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
    const now = performance.now();
    this.#tapTimes.push(now);
    if (this.#state === STATE.PLAYING) {
      this.#tapCount++;
      this.#rec.event(now, 'tap');
    }
  }

  /**
   * The finished run's data for export (see shared/recording/runExport.js),
   * or null if no run has finished yet.
   */
  getRunData() {
    const base = this.#rec.data();
    if (!base) return null;
    const pushes = this.#rec.intervals('push_start', 'push_end');
    const crossings = this.#rec.intervals('sheep_picked_up', 'sheep_delivered');
    const pushTotal = sum(pushes);
    return {
      game: 'trainingGameControl',
      variant: 'tap',
      ...base,
      config: { ...CONFIG },
      detection: {
        method: 'pushing while at least count_threshold taps fall within the last window_ms',
        window_ms: CONFIG.TAP_WINDOW_MS,
        count_threshold: CONFIG.TAP_COUNT_THRESHOLD,
        evaluated: 'per animation frame',
      },
      summary: {
        sheep_delivered: this.#score,
        crossing_count: crossings.length,
        crossing_mean_s: round(mean(crossings), 3),
        tap_count: this.#tapCount,
        taps_per_s: round(this.#tapCount / base.time.duration_s, 3),
        push_count: pushes.length,
        push_mean_s: round(mean(pushes), 3),
        push_total_s: round(pushTotal, 3),
        push_fraction: round(pushTotal / base.time.duration_s, 4),
      },
    };
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
    this.#pushing = false;
    this.#pushStart = null;
    this.#tapCount = 0;
    this.#sailAnim = 0;
    this.#tapTimes = [];
    this.#playStartTime = now;
    this.#rec.start(this.#playStartTime);
    this.#rec.event(this.#playStartTime, 'run_start');
    this.#rec.event(this.#playStartTime, 'sheep_picked_up', { initial: true });
    this.#onStateChange?.(this.#state);
  }

  #endGame(now) {
    if (this.#pushing) this.#endPush(now, { at_run_end: true });
    this.#pushing = false;
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
    const was = this.#pushing;
    this.#pushing = this.#tapTimes.length >= CONFIG.TAP_COUNT_THRESHOLD;
    if (this.#pushing && !was) {
      this.#pushStart = now;
      this.#rec.event(now, 'push_start');
    } else if (!this.#pushing && was) {
      this.#endPush(now);
    }

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
      this.#rec.event(now, 'sheep_delivered', { sheep_delivered: this.#score });
    } else if (this.#boatPos <= 0 && !this.#hasSheep) {
      this.#hasSheep = true;
      this.#rec.event(now, 'sheep_picked_up');
    }

    this.#rec.sample(now, {
      taps_in_window: this.#tapTimes.length,
      is_pushing: this.#pushing ? 1 : 0,
      boat_pos: round(this.#boatPos, 4),
    });
  }

  #endPush(now, extra = {}) {
    this.#rec.event(now, 'push_end', { duration_ms: round(now - this.#pushStart, 1), ...extra });
    this.#pushStart = null;
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
      // Only during the tapping phase itself — not on the idle/countdown/
      // game-over screens, which have their own "tap to…" text.
      hint: this.#state === STATE.PLAYING ? 'Tippe so schnell du kannst!' : null,
    };
  }
}

export default TrainingGameControl;
