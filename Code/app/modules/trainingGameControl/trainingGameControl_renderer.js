import { STATE } from './trainingGameControl_config.js';

// ── TrainingGameControlRenderer ─────────────────────────────────────────────
// Minimal 2D canvas renderer: dark scrolling world, parallax clouds, a
// stick-figure character, and white box obstacles. Pure rendering — all
// game state/physics live in trainingGameControl.js.

export class TrainingGameControlRenderer {
  #canvas;
  #ctx;

  constructor(container) {
    container.innerHTML = '<canvas id="game-canvas"></canvas>';
    this.#canvas = container.querySelector('#game-canvas');
    this.#ctx = this.#canvas.getContext('2d');
  }

  get canvas() { return this.#canvas; }

  draw({ state, countdownElapsed, score, clouds, obstacles,
         groundY, charX, charWidth, charHeight, jumpOffset, running, now }) {
    const ctx = this.#ctx;
    const w = this.#canvas.width;
    const h = this.#canvas.height;

    this.#drawBackground(ctx, w, h);
    this.#drawClouds(ctx, clouds);
    this.#drawGround(ctx, w, groundY);

    if (state === STATE.PLAYING || state === STATE.GAME_OVER) {
      this.#drawObstacles(ctx, obstacles, groundY);
    }
    this.#drawCharacter(ctx, charX, groundY, charWidth, charHeight, jumpOffset, running, now);

    switch (state) {
      case STATE.IDLE:      return this.#drawIdle(ctx, w, h);
      case STATE.COUNTDOWN:  return this.#drawCountdown(ctx, w, h, countdownElapsed);
      case STATE.PLAYING:    return this.#drawScoreOverlay(ctx, score);
      case STATE.GAME_OVER:  return this.#drawGameOver(ctx, w, h, score);
    }
  }

  #drawBackground(ctx, w, h) {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#1a1a1e');
    g.addColorStop(1, '#3a3a40');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  #drawClouds(ctx, clouds) {
    if (!clouds) return;
    for (const c of clouds) {
      ctx.globalAlpha = c.alpha;
      ctx.fillStyle = '#c9c9d0';
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, c.size, c.size * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(c.x + c.size * 0.6, c.y + c.size * 0.12, c.size * 0.65, c.size * 0.4, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  #drawGround(ctx, w, groundY) {
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, groundY);
    ctx.lineTo(w, groundY);
    ctx.stroke();
  }

  #drawObstacles(ctx, obstacles, groundY) {
    if (!obstacles) return;
    ctx.fillStyle = '#f2f2f2';
    for (const o of obstacles) {
      ctx.fillRect(o.x, groundY - o.height, o.width, o.height);
    }
  }

  #drawCharacter(ctx, x, groundY, width, height, jumpOffset, running, now) {
    const cx = x + width / 2;
    const bottomY = groundY - jumpOffset;
    const headR = width * 0.42;
    const headCy = bottomY - height + headR;
    const hipY = bottomY - height * 0.42;

    ctx.strokeStyle = '#eaeaea';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';

    // head
    ctx.beginPath();
    ctx.arc(cx, headCy, headR, 0, Math.PI * 2);
    ctx.stroke();

    // torso
    ctx.beginPath();
    ctx.moveTo(cx, headCy + headR);
    ctx.lineTo(cx, hipY);
    ctx.stroke();

    // arms
    const armSwing = running ? Math.sin(now / 60) * 0.5 : 0.2;
    ctx.beginPath();
    ctx.moveTo(cx, headCy + headR + 6);
    ctx.lineTo(cx - width * 0.5, headCy + headR + 6 + armSwing * width * 0.5);
    ctx.moveTo(cx, headCy + headR + 6);
    ctx.lineTo(cx + width * 0.5, headCy + headR + 6 - armSwing * width * 0.5);
    ctx.stroke();

    // legs — tucked up while airborne, swinging while grounded
    ctx.beginPath();
    if (jumpOffset > 2) {
      ctx.moveTo(cx, hipY);
      ctx.lineTo(cx - width * 0.3, bottomY - 4);
      ctx.moveTo(cx, hipY);
      ctx.lineTo(cx + width * 0.3, bottomY - 4);
    } else {
      const legSwing = running ? Math.sin(now / 60) : 0;
      ctx.moveTo(cx, hipY);
      ctx.lineTo(cx - width * 0.35 * (1 + legSwing), bottomY);
      ctx.moveTo(cx, hipY);
      ctx.lineTo(cx + width * 0.35 * (1 - legSwing), bottomY);
    }
    ctx.stroke();
  }

  #drawIdle(ctx, w, h) {
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '300 20px Nunito, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Select a stream and press Start', w / 2, h / 2 - 60);
  }

  #drawCountdown(ctx, w, h, elapsed) {
    const cx = w / 2, cy = h / 2 - 60;
    let label;
    if (elapsed < 1000)      label = '3';
    else if (elapsed < 2000) label = '2';
    else if (elapsed < 3000) label = '1';
    else                     label = 'GO!';

    ctx.save();
    ctx.shadowColor  = 'rgba(0,0,0,0.4)';
    ctx.shadowBlur   = 16;
    ctx.fillStyle    = label === 'GO!' ? 'rgba(255,220,80,0.95)' : 'rgba(255,255,255,0.92)';
    ctx.font         = '300 80px Nunito, sans-serif';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, cx, cy);
    ctx.restore();
  }

  #drawGameOver(ctx, w, h, score) {
    const cx = w / 2, cy = h / 2 - 60;
    ctx.save();
    ctx.shadowColor  = 'rgba(0,0,0,0.25)';
    ctx.shadowBlur   = 8;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';

    ctx.fillStyle = 'rgba(255,255,255,0.50)';
    ctx.font      = '200 16px Nunito, sans-serif';
    ctx.fillText('OBSTACLES CLEARED', cx, cy - 52);

    ctx.fillStyle = 'rgba(255,255,255,0.90)';
    ctx.font      = '300 72px Nunito, sans-serif';
    ctx.fillText(score, cx, cy);

    ctx.fillStyle = 'rgba(255,255,255,0.42)';
    ctx.font      = '200 14px Nunito, sans-serif';
    ctx.fillText('Press Play again to retry', cx, cy + 52);
    ctx.restore();
  }

  #drawScoreOverlay(ctx, score) {
    ctx.save();
    ctx.shadowColor  = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur   = 10;
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle    = 'rgba(255,255,255,0.88)';
    ctx.font         = '300 48px Nunito, sans-serif';
    ctx.fillText(score, 22, 14);
    ctx.fillStyle    = 'rgba(255,255,255,0.45)';
    ctx.font         = '200 13px Nunito, sans-serif';
    ctx.fillText('score', 24, 64);
    ctx.restore();
  }
}

export default TrainingGameControlRenderer;
