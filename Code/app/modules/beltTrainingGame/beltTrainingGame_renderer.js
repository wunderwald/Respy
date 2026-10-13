// Pure drawing layer for the Belt Training Game.
// Receives pre-computed render data — no game logic here.

import { STATE, CONFIG } from './beltTrainingGame_config.js';
import { SceneRenderer } from '../bioGame/sceneRenderer.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

// ── BeltTrainingGameRenderer ───────────────────────────────────────────────────

export class BeltTrainingGameRenderer {
  #canvas = null;
  #ctx    = null;

  #sceneRenderer = null;   // shared bg + avatar drawing (see bioGame/sceneRenderer.js)

  #lastNow = null;

  constructor(container, scene) {
    container.innerHTML = '<canvas id="btg-canvas"></canvas>';
    this.#canvas = container.querySelector('#btg-canvas');
    this.#ctx    = this.#canvas.getContext('2d');

    this.#sceneRenderer = new SceneRenderer(scene);
    this.#sceneRenderer.warmUpShadow(this.#ctx);
  }

  draw(renderData) {
    const canvas = this.#canvas;
    canvas.width  = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    const ctx = this.#ctx;
    const w   = canvas.width;
    const h   = canvas.height;
    const { state, now } = renderData;

    const dt = this.#lastNow != null ? clamp((now - this.#lastNow) / 1000, 0, 0.05) : 0;
    this.#lastNow = now;

    ctx.clearRect(0, 0, w, h);
    this.#sceneRenderer.drawBg(ctx, w, h, 0);

    switch (state) {
      case STATE.IDLE:
        this.#drawCenter(ctx, w, h / 2, 'waiting for stream…', 'rgba(255,255,255,0.38)', 20);
        break;

      case STATE.CALIBRATING:
        this.#drawCalibrating(ctx, w, h, renderData.calProgress ?? 0, renderData.calRemaining ?? 0);
        break;

      case STATE.READY:
        this.#drawReady(ctx, w, h, now);
        break;

      case STATE.TRAINING:
        this.#drawGameplay(ctx, w, h, renderData, false);
        break;

      case STATE.TEST:
        this.#drawGameplay(ctx, w, h, renderData, true, now);
        break;

      case STATE.DONE:
        this.#drawDone(ctx, w, h);
        break;
    }
  }

  // ── Gameplay (training + test phases) ─────────────────────────────────────

  #drawGameplay(ctx, w, h, data, isTest, now) {
    const { fishXRatio, fishNormY, targetNormY, segment, avatarTilt = 0 } = data;

    const topPad = h * 0.10;
    const playH  = h * 0.80;
    const normToScreenY = (ny) => topPad + (1 - ny) * playH;

    const targetScreenX1 = CONFIG.TARGET_X_START * w;
    const targetScreenX2 = CONFIG.TARGET_X_END   * w;
    const targetScreenY  = normToScreenY(targetNormY);

    if (isTest) {
      this.#drawBubbleCover(ctx, h, targetScreenX1, targetScreenX2, now ?? 0);
    } else {
      this.#drawTargetBands(ctx, targetScreenX1, targetScreenX2, targetScreenY, playH);
    }

    const fishHidden = isTest && segment === 'target';
    if (!fishHidden) {
      const fishScreenX = fishXRatio * w;
      const fishScreenY = normToScreenY(fishNormY);
      const avatarH = CONFIG.AVATAR_SIZE_MIN * h +
        (CONFIG.AVATAR_SIZE_MAX - CONFIG.AVATAR_SIZE_MIN) * h * 0.5;
      this.#sceneRenderer.drawAvatar(ctx, fishScreenX, fishScreenY, avatarH, avatarTilt);
    }
  }

  // Nested red/yellow/green/yellow/red bands, drawn as three overlapping
  // rectangles (outermost first) so each layer only shows the ring outside
  // the next one in.
  #drawTargetBands(ctx, x1, x2, centerY, playHPx) {
    const bandW = x2 - x1;
    const draw = (halfHeightNorm, color) => {
      const hPx = halfHeightNorm * 2 * playHPx;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(x1, centerY - hPx / 2, bandW, hPx, 4);
      ctx.fill();
    };
    draw(CONFIG.TARGET_HEIGHT_RED,    'rgba(224,72,72,0.55)');
    draw(CONFIG.TARGET_HEIGHT_YELLOW, 'rgba(230,186,30,0.65)');
    draw(CONFIG.TARGET_HEIGHT,        'rgba(90,200,110,0.80)');
  }

  // Deterministic, state-free drifting-bubble overlay covering the target
  // zone during the test phase — there is no visible target, and the fish
  // disappears into it (see #drawGameplay's fishHidden check).
  #drawBubbleCover(ctx, h, x1, x2, now) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x1, 0, x2 - x1, h);
    ctx.clip();

    ctx.fillStyle = 'rgba(8,30,54,0.55)';
    ctx.fillRect(x1, 0, x2 - x1, h);

    for (let i = 0; i < CONFIG.BUBBLE_COUNT; i++) {
      const seed  = i * 137.508;                         // golden-angle spacing
      const speed = 0.00004 + (i % 5) * 0.000012;
      const phase = ((now * speed + seed) % 1 + 1) % 1;
      const bx = x1 + (((seed * 0.6180339887) % 1 + 1) % 1) * (x2 - x1);
      const by = h * (1 - phase);
      const r  = 3 + (i % 4) * 2.2;

      ctx.beginPath();
      ctx.fillStyle = 'rgba(255,255,255,0.20)';
      ctx.arc(bx, by, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // ── State draw methods ────────────────────────────────────────────────────

  #drawCalibrating(ctx, w, h, progress, remaining) {
    const cx = w / 2, cy = h / 2;
    const r  = 62;

    this.#drawCenter(ctx, w, h * 0.35, 'Breathe normally…', 'rgba(255,255,255,0.82)', 22);

    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth   = 5;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
    ctx.strokeStyle = 'rgba(174,212,237,0.8)';
    ctx.lineWidth   = 5;
    ctx.lineCap     = 'round';
    ctx.stroke();
    ctx.lineCap     = 'butt';

    this.#drawCenter(ctx, w, cy, String(remaining), 'rgba(255,255,255,0.72)', 54, '200');
    this.#drawCenter(ctx, w, cy + r + 28, 'calibrating signal…', 'rgba(255,255,255,0.28)', 14);
  }

  #drawReady(ctx, w, h, now) {
    const bobNormY      = 0.5 + 0.25 * Math.sin(now / 1000 * 1.5);
    const tilt          = -0.2 * Math.cos(now / 1000 * 1.5);
    const topPad        = h * 0.10;
    const playH         = h * 0.80;
    const avatarScreenX = w / 2;
    const avatarScreenY = topPad + (1 - bobNormY) * playH;
    const avatarH = CONFIG.AVATAR_SIZE_MIN * h + (CONFIG.AVATAR_SIZE_MAX - CONFIG.AVATAR_SIZE_MIN) * h * 0.5;
    this.#sceneRenderer.drawAvatar(ctx, avatarScreenX, avatarScreenY, avatarH * 1.3, tilt);
    this.#drawCenter(ctx, w, h * 0.80, 'Press Space or Start to begin', 'rgba(255,255,255,0.30)', 16);
  }

  #drawDone(ctx, w, h) {
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, 0, w, h);
    this.#drawCenter(ctx, w, h / 2, 'All trials complete!', 'rgba(255,255,255,0.85)', 28, '300');
  }

  // ── Canvas helpers ────────────────────────────────────────────────────────

  #drawCenter(ctx, w, y, text, color, size, weight = '300') {
    ctx.fillStyle    = color;
    ctx.font         = `${weight} ${size}px Nunito, sans-serif`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, y);
  }
}
