import { GaussianSmoother }     from '../signal/signalUtils.js';
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
  #hasSheep = true;
  #sailAnim = 0;  // 0..1, eased toward #blowing for smooth sail motion
  #forwardSpeed;  // pos/sec while blowing
  #currentSpeed;  // pos/sec while not blowing (gentler than forward)

  // background
  #clouds = [];

  // animation
  #lastFrameTime = null;

  // HUD state
  #hudStateText  = 'waiting for stream…';
  #hudScore      = null;
  #hudBtnEnabled = false;
  #hudBtnText    = 'Start';

  // renderer
  #renderer;

  constructor({ statsContainer, sceneContainer }) {
    this.#renderer = new TrainingGameRenderer(sceneContainer);
    this.#initClouds();

    const halfPeriodSec = 30 / CONFIG.TARGET_BPM; // (60 / BPM) / 2
    this.#forwardSpeed = 1 / halfPeriodSec;
    this.#currentSpeed = this.#forwardSpeed * CONFIG.CURRENT_SPEED_FACTOR;

    window.api.frontend.onAction(({ type }) => {
      if (type === 'start') this.#beginCountdown();
    });

    this.#pushState();
    setInterval(() => this.#tick(), 100);
    requestAnimationFrame((t) => this.#rafLoop(t));
  }

  // ── Frontend interface ─────────────────────────────────────────────────────

  pushSample(value) {
    this.#smoother.push(value);
  }

  setStatus({ type, text }) {
    if (this.#state !== STATE.IDLE) return;
    const streamReady = type === 'connected';
    this.#hudStateText  = streamReady ? 'ready — press Start' : text;
    this.#hudBtnEnabled = streamReady;
    this.#pushState();
  }

  // ── HUD state push ─────────────────────────────────────────────────────────

  #pushState() {
    window.api.frontend.sendState({
      stateText:  this.#hudStateText,
      score:      this.#hudScore,
      btnEnabled: this.#hudBtnEnabled,
      btnText:    this.#hudBtnText,
    });
  }

  // ── State machine ──────────────────────────────────────────────────────────

  #beginCountdown() {
    this.#state = STATE.COUNTDOWN;
    this.#countdownStart = performance.now();
    this.#hudStateText  = 'get ready…';
    this.#hudBtnEnabled = false;
    this.#pushState();
  }

  #beginPlaying() {
    this.#state = STATE.PLAYING;
    this.#score = 0;
    this.#boatPos = 0;
    this.#hasSheep = true;
    this.#blowing = false;
    this.#sailAnim = 0;
    this.#smoother.reset();
    this.#playStartTime = performance.now();

    this.#hudStateText  = 'playing';
    this.#hudScore      = 0;
    this.#hudBtnText    = 'Restart';
    this.#hudBtnEnabled = true;
    this.#pushState();
  }

  #endGame() {
    this.#state = STATE.GAME_OVER;
    this.#hudStateText  = 'game over';
    this.#hudBtnText    = 'Play again';
    this.#hudBtnEnabled = true;
    this.#pushState();
  }

  // ── Tick — state transitions (setInterval, 100 ms) ─────────────────────────

  #tick() {
    const now = performance.now();
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

    if (this.#blowing) {
      this.#boatPos = Math.min(1, this.#boatPos + this.#forwardSpeed * dt);
    } else {
      this.#boatPos = Math.max(0, this.#boatPos - this.#currentSpeed * dt);
    }

    if (this.#boatPos >= 1 && this.#hasSheep) {
      this.#hasSheep = false;
      this.#score++;
      this.#hudScore = this.#score;
      this.#pushState();
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
