import { CONFIG, STATE }          from './chromeDinoGame_config.js';
import { ChromeDinoGameRenderer } from './chromeDinoGame_renderer.js';
import { ExhaleOnsetDetector }    from '../shared/signal/exhaleOnsetDetector.js';

// Ported from the Electron app: identical game logic/rendering, with the
// experimenter-window IPC (pushState/onAction/setStatus) replaced by a plain
// start() method and an onStateChange(state) callback the host page uses to
// know when tapping the screen should (re)start the game.
//
// Difficulty ramps smoothly over the first DIFFICULTY_RAMP_SECS of each run
// (scroll speed and obstacle spacing both ease from the easy START values up
// to the base CONFIG values) rather than starting at full difficulty.

function lerp(a, b, t) { return a + (b - a) * t; }
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

export class ChromeDinoGame {
  // state
  #state = STATE.IDLE;
  #score = 0;
  #highScore = 0; // session-only — resets on page reload

  // countdown
  #countdownStart = null;

  // difficulty ramp
  #playStartTime = null;

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

  // host callback
  #onStateChange;

  // renderer
  #renderer;

  constructor({ sceneContainer, onStateChange }) {
    this.#renderer = new ChromeDinoGameRenderer(sceneContainer);
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

  /** Feed one normalized [0, 1] breath sample (from useMicBreathSignal). */
  pushSample(value) {
    if (this.#state !== STATE.PLAYING) return;
    const now = performance.now();
    if (this.#detector.feed(value, now) && !this.#jumping) {
      this.#jumping = true;
      this.#jumpStartTime = now;
    }
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
    this.#obstacles = [];
    this.#jumping = false;
    this.#jumpOffset = 0;
    this.#detector = new ExhaleOnsetDetector({
      threshold:  CONFIG.EXHALE_ONSET_THRESHOLD,
      debounceMs: CONFIG.EXHALE_DEBOUNCE_MS,
    });

    this.#playStartTime = performance.now();
    this.#nextObstacleAt = performance.now() + CONFIG.FIRST_OBSTACLE_DELAY_MS;
    this.#onStateChange?.(this.#state);
  }

  // ── Difficulty ramp ────────────────────────────────────────────────────────
  // 0 at the start of a run, 1 once DIFFICULTY_RAMP_SECS has elapsed.

  #difficultyT(now) {
    if (this.#playStartTime == null) return 0;
    return clamp((now - this.#playStartTime) / 1000 / CONFIG.DIFFICULTY_RAMP_SECS, 0, 1);
  }

  #currentScrollSpeed(now) {
    return lerp(CONFIG.SCROLL_SPEED_START_PX_S, CONFIG.SCROLL_SPEED_PX_S, this.#difficultyT(now));
  }

  #endGame() {
    this.#state = STATE.GAME_OVER;
    this.#onStateChange?.(this.#state);
  }

  // ── Tick — state transitions (driven from the RAF loop) ────────────────────

  #tick(now) {
    if (this.#state === STATE.COUNTDOWN && now - this.#countdownStart >= 3500) {
      this.#beginPlaying();
    }
  }

  // ── RAF loop ─────────────────────────────────────────────────────────────

  #rafLoop(timestamp) {
    const dt = this.#lastFrameTime != null ? timestamp - this.#lastFrameTime : 16;
    this.#lastFrameTime = timestamp;

    this.#tick(timestamp);

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
      console.error('[ChromeDinoGame] draw error:', e);
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
    const dx = this.#currentScrollSpeed(now) * dt / 1000;
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
        if (this.#score > this.#highScore) {
          this.#highScore = this.#score;
        }
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
      const t = this.#difficultyT(now);
      const minGap = lerp(CONFIG.MIN_OBSTACLE_INTERVAL_START_MS, CONFIG.MIN_OBSTACLE_INTERVAL_MS, t);
      const maxGap = lerp(CONFIG.MAX_OBSTACLE_INTERVAL_START_MS, CONFIG.MAX_OBSTACLE_INTERVAL_MS, t);
      this.#nextObstacleAt = now + minGap + Math.random() * (maxGap - minGap);
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
      alpha: 0.55 + Math.random() * 0.3, // light-mode sky — clouds need to read as solid white, not a faint tint
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
      highScore:        this.#highScore,
      clouds:           this.#clouds,
      obstacles:        this.#obstacles,
      groundY:          this.#groundY(),
      charX:            this.#charX(),
      charWidth:        CONFIG.CHAR_WIDTH,
      charHeight:       CONFIG.CHAR_HEIGHT,
      jumpOffset:       this.#jumpOffset,
      running:          this.#state !== STATE.GAME_OVER,
      now,
    };
  }
}

export default ChromeDinoGame;
