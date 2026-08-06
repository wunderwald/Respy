import { CONFIG, STATE }        from './trainingGame_config.js';
import { TrainingGameRenderer } from './trainingGame_renderer.js';

// ── TrainingGame ─────────────────────────────────────────────────────────
// Bare scaffolding for a new game — implements the frontend interface
// (pushSample/setStatus), the IDLE → COUNTDOWN → PLAYING → GAME_OVER state
// machine, HUD state push, and the render loop. TODO: implement the game.

export class TrainingGame {
  // state
  #state = STATE.IDLE;
  #score = 0;

  // countdown
  #countdownStart = null;

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
    // TODO: breath handling
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

    try {
      this.#renderer.draw(this.#buildRenderData(timestamp));
    } catch (e) {
      console.error('[TrainingGame] draw error:', e);
    }

    requestAnimationFrame((t) => this.#rafLoop(t));
  }

  #buildRenderData(now) {
    return {
      state:            this.#state,
      countdownElapsed: this.#countdownStart != null ? now - this.#countdownStart : 0,
      score:            this.#score,
      now,
    };
  }
}

export default TrainingGame;
