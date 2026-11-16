import { STATE } from './chromeDinoGame_config.js';
import { uiScale, font } from '../shared/ui/canvasText.js';

// ── ChromeDinoGameRenderer ─────────────────────────────────────────────
// Minimal 2D canvas renderer: light daytime-sky scrolling world, parallax
// clouds, a stick-figure character, and dark box obstacles. Pure rendering —
// all game state/physics live in chromeDinoGame.js.

const COLORS = {
  skyTop:    '#eaf6ff',
  skyBottom: '#cdeaff',
  ground:    'rgba(40,52,66,0.35)',
  obstacle:  '#37474f',
  character: '#2b3640',
  cloud:     '#ffffff',
  ink:       'rgba(30,40,50,0.90)',
  inkSoft:   'rgba(30,40,50,0.55)',
  inkFaint:  'rgba(30,40,50,0.42)',
};

export class ChromeDinoGameRenderer {
  #canvas;
  #ctx;
  #s = 1; // uiScale() of the current frame — shrinks HUD/overlay text on phones

  constructor(container) {
    container.innerHTML = '<canvas id="game-canvas"></canvas>';
    this.#canvas = container.querySelector('#game-canvas');
    this.#ctx = this.#canvas.getContext('2d');
  }

  get canvas() { return this.#canvas; }

  draw({ state, countdownElapsed, score, highScore, clouds, obstacles,
         groundY, charX, charWidth, charHeight, jumpOffset, running, now }) {
    const ctx = this.#ctx;
    const w = this.#canvas.width;
    const h = this.#canvas.height;
    this.#s = uiScale(w, h);

    this.#drawBackground(ctx, w, h);
    this.#drawClouds(ctx, clouds);
    this.#drawGround(ctx, w, groundY);

    if (state === STATE.PLAYING || state === STATE.GAME_OVER) {
      this.#drawObstacles(ctx, obstacles, groundY);
    }
    this.#drawCharacter(ctx, charX, groundY, charWidth, charHeight, jumpOffset, running, now);
    this.#drawCounters(ctx, w, score, highScore);

    switch (state) {
      case STATE.IDLE:      return this.#drawIdle(ctx, w, h);
      case STATE.COUNTDOWN:  return this.#drawCountdown(ctx, w, h, countdownElapsed);
      case STATE.GAME_OVER:  return this.#drawGameOver(ctx, w, h, score, highScore);
    }
  }

  #drawBackground(ctx, w, h) {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, COLORS.skyTop);
    g.addColorStop(1, COLORS.skyBottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  #drawClouds(ctx, clouds) {
    if (!clouds) return;
    for (const c of clouds) {
      ctx.globalAlpha = c.alpha;
      ctx.fillStyle = COLORS.cloud;
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
    ctx.strokeStyle = COLORS.ground;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, groundY);
    ctx.lineTo(w, groundY);
    ctx.stroke();
  }

  #drawObstacles(ctx, obstacles, groundY) {
    if (!obstacles) return;
    ctx.fillStyle = COLORS.obstacle;
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

    ctx.strokeStyle = COLORS.character;
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
    ctx.fillStyle = COLORS.inkSoft;
    ctx.font = font(300, 20, this.#s);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Tippe, um zu starten', w / 2, h / 2 - 60 * this.#s);
  }

  #drawCountdown(ctx, w, h, elapsed) {
    const cx = w / 2, cy = h / 2 - 60 * this.#s;
    let label;
    if (elapsed < 1000)      label = '3';
    else if (elapsed < 2000) label = '2';
    else if (elapsed < 3000) label = '1';
    else                     label = 'LOS!';

    ctx.save();
    ctx.shadowColor  = 'rgba(0,0,0,0.12)';
    ctx.shadowBlur   = 12;
    ctx.fillStyle    = label === 'LOS!' ? '#2e9e62' : COLORS.ink;
    ctx.font         = font(300, 80, this.#s);
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, cx, cy);
    ctx.restore();
  }

  #drawGameOver(ctx, w, h, score, highScore) {
    const s = this.#s;
    const cx = w / 2, cy = h / 2 - 60 * s;
    ctx.save();
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';

    ctx.fillStyle = COLORS.ink;
    ctx.font      = font(300, 42, s);
    ctx.fillText(`Punkte: ${score}`, cx, cy - 10 * s);

    ctx.fillStyle = COLORS.inkSoft;
    ctx.font      = font(300, 22, s);
    ctx.fillText(`Rekord: ${highScore}`, cx, cy + 36 * s);

    ctx.fillStyle = COLORS.inkFaint;
    ctx.font      = font(200, 14, s);
    ctx.fillText('Tippe, um nochmal zu spielen', cx, cy + 78 * s);
    ctx.restore();
  }

  #drawCounters(ctx, w, score, highScore) {
    const s = this.#s;
    const x = w - 24 * s;

    ctx.save();
    ctx.textAlign    = 'right';

    ctx.textBaseline = 'top';
    ctx.fillStyle    = COLORS.inkFaint;
    ctx.font         = font(200, 13, s);
    ctx.fillText('Rekord', x, 14 * s);
    ctx.fillStyle    = COLORS.inkSoft;
    ctx.font         = font(300, 26, s);
    ctx.fillText(highScore, x, 30 * s);

    ctx.fillStyle    = COLORS.inkFaint;
    ctx.font         = font(200, 13, s);
    ctx.fillText('Punkte', x, 70 * s);
    ctx.fillStyle    = COLORS.ink;
    ctx.font         = font(300, 40, s);
    ctx.fillText(score, x, 86 * s);
    ctx.restore();
  }
}

export default ChromeDinoGameRenderer;
