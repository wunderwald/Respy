import { CONFIG, STATE }              from './trainingGameControl_config.js';
import { TrainingGameControlRenderer } from './trainingGameControl_renderer.js';
import { ExhaleOnsetDetector }         from '../signal/exhaleOnsetDetector.js';

export class TrainingGameControl {
  // state
  #state = STATE.IDLE;
  #score = 0;

  // countdown
  #countdownStart = null;

  // breath
  #detector = new ExhaleOnsetDetector({
    threshold:  CONFIG.EXHALE_ONSET_THRESHOLD,
    debounceMs: CONFIG.EXHALE_DEBOUNCE_MS,
  });

  // world
  #obstacles = [];
  #clouds = [];
  #nextObstacleAt = null;

  // character
  #jumping = false;
  #jumpStartTime = null;
  #jumpOffset = 0;

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
    this.#renderer = new TrainingGameControlRenderer(sceneContainer);
    this.#initClouds();

    window.api.frontend.onAction(({ type }) => {
      if (type === 'start') this.#beginCountdown();
    });

    this.#pushState();
    setInterval(() => this.#tick(), 100);
    requestAnimationFrame((t) => this.#rafLoop(t));
  }

  // ── Frontend interface ─────────────────────────────────────────────────────

  pushSample(value) {
    if (this.#state !== STATE.PLAYING) return;
    const now = performance.now();
    if (this.#detector.feed(value, now) && !this.#jumping) {
      this.#jumping = true;
      this.#jumpStartTime = now;
    }
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
    this.#obstacles = [];
    this.#jumping = false;
    this.#jumpOffset = 0;
    this.#detector = new ExhaleOnsetDetector({
      threshold:  CONFIG.EXHALE_ONSET_THRESHOLD,
      debounceMs: CONFIG.EXHALE_DEBOUNCE_MS,
    });

    this.#nextObstacleAt = performance.now() + CONFIG.FIRST_OBSTACLE_DELAY_MS;

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
    }
  }

  // ── RAF loop ─────────────────────────────────────────────────────────────

  #rafLoop(timestamp) {
    const dt = this.#lastFrameTime != null ? timestamp - this.#lastFrameTime : 16;
    this.#lastFrameTime = timestamp;

    const c = this.#renderer.canvas;
    c.width  = c.offsetWidth;
    c.height = c.offsetHeight;

    this.#tickClouds(dt);

    if (this.#state === STATE.PLAYING) {
      this.#tickJump(timestamp);
      this.#tickObstacles(dt, timestamp);
    }

    try {
      this.#renderer.draw(this.#buildRenderData(timestamp));
    } catch (e) {
      console.error('[TrainingGameControl] draw error:', e);
    }

    requestAnimationFrame((t) => this.#rafLoop(t));
  }

  #groundY() { return this.#renderer.canvas.height * CONFIG.GROUND_Y_RATIO; }
  #charX()   { return this.#renderer.canvas.width  * CONFIG.CHAR_X_RATIO; }

  // ── Jump physics ─────────────────────────────────────────────────────────

  #tickJump(now) {
    if (!this.#jumping) {
      this.#jumpOffset = 0;
      return;
    }
    const t = now - this.#jumpStartTime;
    if (t >= CONFIG.JUMP_DURATION_MS) {
      this.#jumping = false;
      this.#jumpOffset = 0;
      return;
    }
    // Simple parabolic arc: 0 at takeoff/landing, JUMP_HEIGHT_PX at apex.
    const p = t / CONFIG.JUMP_DURATION_MS;
    this.#jumpOffset = 4 * CONFIG.JUMP_HEIGHT_PX * p * (1 - p);
  }

  // ── Obstacles ────────────────────────────────────────────────────────────

  #tickObstacles(dt, now) {
    const dx = CONFIG.SCROLL_SPEED_PX_S * dt / 1000;
    const groundY = this.#groundY();
    const charLeft  = this.#charX();
    const charRight = charLeft + CONFIG.CHAR_WIDTH;
    const charBottom = groundY - this.#jumpOffset;
    const charTop    = charBottom - CONFIG.CHAR_HEIGHT;

    for (const o of this.#obstacles) {
      o.x -= dx;

      if (!o.passed && o.x + o.width < charLeft) {
        o.passed = true;
        this.#score++;
        this.#hudScore = this.#score;
        this.#pushState();
      }

      const obsLeft = o.x, obsRight = o.x + o.width;
      const obsTop  = groundY - o.height, obsBottom = groundY;
      const overlapX = charLeft < obsRight && charRight > obsLeft;
      const overlapY = charTop < obsBottom && charBottom > obsTop;
      if (overlapX && overlapY) {
        this.#endGame();
        return;
      }
    }

    this.#obstacles = this.#obstacles.filter(o => o.x + o.width > -10);

    if (now >= this.#nextObstacleAt) {
      this.#spawnObstacle();
      this.#nextObstacleAt = now + CONFIG.MIN_OBSTACLE_INTERVAL_MS +
        Math.random() * (CONFIG.MAX_OBSTACLE_INTERVAL_MS - CONFIG.MIN_OBSTACLE_INTERVAL_MS);
    }
  }

  #spawnObstacle() {
    const height = CONFIG.OBSTACLE_HEIGHT_MIN +
      Math.random() * (CONFIG.OBSTACLE_HEIGHT_MAX - CONFIG.OBSTACLE_HEIGHT_MIN);
    this.#obstacles.push({
      x: this.#renderer.canvas.width,
      width: CONFIG.OBSTACLE_WIDTH,
      height,
      passed: false,
    });
  }

  // ── Background clouds (parallax) ────────────────────────────────────────

  #initClouds() {
    const w = this.#renderer.canvas.width  || 1200;
    const h = this.#renderer.canvas.height || 820;
    this.#clouds = Array.from({ length: CONFIG.CLOUD_COUNT }, () => this.#makeCloud(w, h, true));
  }

  #makeCloud(w, h, randomX = false) {
    const size = CONFIG.CLOUD_MIN_SIZE + Math.random() * (CONFIG.CLOUD_MAX_SIZE - CONFIG.CLOUD_MIN_SIZE);
    return {
      x: randomX ? Math.random() * w : w + size,
      y: h * (0.1 + Math.random() * 0.35),
      size,
      speed: CONFIG.SCROLL_SPEED_PX_S * CONFIG.CLOUD_SPEED_RATIO * (0.7 + Math.random() * 0.6),
      alpha: 0.08 + Math.random() * 0.1,
    };
  }

  #tickClouds(dt) {
    const w = this.#renderer.canvas.width;
    const h = this.#renderer.canvas.height;
    for (const c of this.#clouds) {
      c.x -= c.speed * dt / 1000;
      if (c.x + c.size < 0) Object.assign(c, this.#makeCloud(w, h, false));
    }
  }

  // ── Render data ──────────────────────────────────────────────────────────

  #buildRenderData(now) {
    return {
      state:            this.#state,
      countdownElapsed: this.#countdownStart != null ? now - this.#countdownStart : 0,
      score:            this.#score,
      clouds:           this.#clouds,
      obstacles:        this.#obstacles,
      groundY:          this.#groundY(),
      charX:            this.#charX(),
      charWidth:        CONFIG.CHAR_WIDTH,
      charHeight:       CONFIG.CHAR_HEIGHT,
      jumpOffset:       this.#jumpOffset,
      running:          this.#state === STATE.PLAYING,
      now,
    };
  }
}

export default TrainingGameControl;
