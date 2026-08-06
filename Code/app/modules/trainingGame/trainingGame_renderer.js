import { STATE } from './trainingGame_config.js';

// ── TrainingGameRenderer ────────────────────────────────────────────────────
// Bare scaffolding — pure rendering, given state built by trainingGame.js.
// TODO: implement the new game's visuals.

export class TrainingGameRenderer {
  #canvas;
  #ctx;

  constructor(container) {
    container.innerHTML = '<canvas id="game-canvas"></canvas>';
    this.#canvas = container.querySelector('#game-canvas');
    this.#ctx = this.#canvas.getContext('2d');
  }

  get canvas() { return this.#canvas; }

  draw({ state, countdownElapsed, score, now }) {
    const ctx = this.#ctx;
    const w = this.#canvas.width;
    const h = this.#canvas.height;

    this.#drawBackground(ctx, w, h);

    switch (state) {
      case STATE.IDLE:      return this.#drawIdle(ctx, w, h);
      case STATE.COUNTDOWN: return this.#drawCountdown(ctx, w, h, countdownElapsed);
      case STATE.PLAYING:   return this.#drawPlaying(ctx, w, h, { score, now });
      case STATE.GAME_OVER: return this.#drawGameOver(ctx, w, h, score);
    }
  }

  #drawBackground(ctx, w, h) {
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, w, h);
  }

  #drawIdle(ctx, w, h) {
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.font = '300 20px Nunito, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Select a stream and press Start', w / 2, h / 2);
  }

  #drawCountdown(ctx, w, h, elapsed) {
    const cx = w / 2, cy = h / 2;
    let label;
    if (elapsed < 1000)      label = '3';
    else if (elapsed < 2000) label = '2';
    else if (elapsed < 3000) label = '1';
    else                     label = 'GO!';

    ctx.save();
    ctx.fillStyle    = 'rgba(255,255,255,0.92)';
    ctx.font         = '300 80px Nunito, sans-serif';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, cx, cy);
    ctx.restore();
  }

  #drawPlaying(ctx, w, h, { score }) {
    // TODO: render the new game
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    ctx.font = '300 32px Nunito, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(String(score), 22, 14);
  }

  #drawGameOver(ctx, w, h, score) {
    const cx = w / 2, cy = h / 2;
    ctx.save();
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle    = 'rgba(255,255,255,0.90)';
    ctx.font         = '300 48px Nunito, sans-serif';
    ctx.fillText(`Score: ${score}`, cx, cy);
    ctx.fillStyle    = 'rgba(255,255,255,0.42)';
    ctx.font         = '200 14px Nunito, sans-serif';
    ctx.fillText('Press Play again to retry', cx, cy + 52);
    ctx.restore();
  }
}

export default TrainingGameRenderer;
