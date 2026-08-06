import { CONFIG, STATE } from './trainingGame_config.js';

// ── TrainingGameRenderer — River Crossing ───────────────────────────────────
// Minimal black/white line-art rendering: pure drawing, given state built by
// trainingGame.js. Static camera — the boat moves across a fixed river.

function lerp(a, b, t) { return a + (b - a) * t; }

const COLORS = {
  bg:       '#f7f4ec',
  ink:      '#1c1c1c',
  inkSoft:  'rgba(28,28,28,0.55)',
  inkFaint: 'rgba(28,28,28,0.25)',
  river:    '#dce8ea',
  bank:     '#eef0e2',
};

export class TrainingGameRenderer {
  #canvas;
  #ctx;

  constructor(container) {
    container.innerHTML = '<canvas id="game-canvas"></canvas>';
    this.#canvas = container.querySelector('#game-canvas');
    this.#ctx = this.#canvas.getContext('2d');
  }

  get canvas() { return this.#canvas; }

  draw({ state, countdownElapsed, score, timeLeftSecs, boatPos, hasSheep, sailAnim, clouds, now }) {
    const ctx = this.#ctx;
    const w = this.#canvas.width;
    const h = this.#canvas.height;
    if (!w || !h) return;

    const layout = this.#layout(w, h);

    this.#drawBackground(ctx, w, h);
    this.#drawClouds(ctx, clouds);
    this.#drawRiver(ctx, layout, now);
    this.#drawBank(ctx, layout, 'left');
    this.#drawBank(ctx, layout, 'right');
    this.#drawSheepFlock(ctx, layout, score, now);
    this.#drawBoat(ctx, layout, { boatPos, hasSheep, sailAnim, now });
    this.#drawCounters(ctx, w, score, timeLeftSecs);

    switch (state) {
      case STATE.IDLE:      return this.#drawIdle(ctx, w, h);
      case STATE.COUNTDOWN: return this.#drawCountdown(ctx, w, h, countdownElapsed);
      case STATE.GAME_OVER: return this.#drawGameOver(ctx, w, h, score);
    }
  }

  #layout(w, h) {
    const riverTop    = h * CONFIG.RIVER_TOP_RATIO;
    const riverBottom = h * CONFIG.RIVER_BOTTOM_RATIO;
    const leftBankW   = w * CONFIG.RIVER_LEFT_BANK_RATIO;
    const rightBankW  = w * CONFIG.RIVER_RIGHT_BANK_RATIO;
    return {
      w, h,
      riverTop, riverBottom,
      riverY: (riverTop + riverBottom) / 2,
      riverLeftX:  leftBankW,
      riverRightX: w - rightBankW,
      groundBottom: h,
    };
  }

  // ── Background ──────────────────────────────────────────────────────────────

  #drawBackground(ctx, w, h) {
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, w, h);
  }

  #drawClouds(ctx, clouds) {
    if (!clouds) return;
    ctx.strokeStyle = COLORS.inkFaint;
    ctx.lineWidth = 2;
    for (const c of clouds) {
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, c.size, c.size * 0.5, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(c.x + c.size * 0.6, c.y + c.size * 0.1, c.size * 0.6, c.size * 0.38, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // ── River ───────────────────────────────────────────────────────────────────

  #drawRiver(ctx, layout, now) {
    const { riverTop, riverBottom, riverLeftX, riverRightX } = layout;

    ctx.fillStyle = COLORS.river;
    ctx.fillRect(riverLeftX, riverTop, riverRightX - riverLeftX, riverBottom - riverTop);

    // waves travel left → right, matching the current direction
    ctx.strokeStyle = COLORS.inkSoft;
    ctx.lineWidth = 1.5;
    const t = now / 1000;
    const rows = 4;
    for (let r = 0; r < rows; r++) {
      const y = lerp(riverTop + 10, riverBottom - 8, (r + 0.5) / rows);
      ctx.beginPath();
      for (let x = riverLeftX; x <= riverRightX; x += 5) {
        const py = y + Math.sin(x * 0.05 - t * CONFIG.WAVE_SPEED + r * 1.7) * 3;
        if (x === riverLeftX) ctx.moveTo(x, py); else ctx.lineTo(x, py);
      }
      ctx.stroke();
    }

    ctx.strokeStyle = COLORS.ink;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(riverLeftX, riverTop);  ctx.lineTo(riverLeftX, riverBottom);
    ctx.moveTo(riverRightX, riverTop); ctx.lineTo(riverRightX, riverBottom);
    ctx.stroke();
  }

  // ── Banks ───────────────────────────────────────────────────────────────────

  #drawBank(ctx, layout, side) {
    const { w, riverTop, riverRightX, riverLeftX, groundBottom } = layout;
    const x0 = side === 'left' ? 0 : riverRightX;
    const x1 = side === 'left' ? riverLeftX : w;

    ctx.fillStyle = COLORS.bank;
    ctx.fillRect(x0, riverTop, x1 - x0, groundBottom - riverTop);

    ctx.strokeStyle = COLORS.ink;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x0, riverTop);
    ctx.lineTo(x1, riverTop);
    ctx.stroke();

    const treeCount = 3;
    for (let i = 0; i < treeCount; i++) {
      const tx = lerp(
        x0 + (x1 - x0) * 0.14,
        x1 - (x1 - x0) * 0.14,
        treeCount === 1 ? 0.5 : i / (treeCount - 1)
      );
      this.#drawTree(ctx, tx, riverTop - 4);
    }
  }

  #drawTree(ctx, x, groundY) {
    ctx.strokeStyle = COLORS.ink;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(x, groundY);
    ctx.lineTo(x, groundY - 26);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(x, groundY - 38, 16, 0, Math.PI * 2);
    ctx.stroke();
  }

  // ── Sheep ───────────────────────────────────────────────────────────────────

  #drawSheepFlock(ctx, layout, score, now) {
    const { riverRightX, riverLeftX, w, groundBottom } = layout;

    // right bank — a small flock always available, doesn't deplete
    const rightCount = CONFIG.SHEEP_COUNT_RIGHT;
    for (let i = 0; i < rightCount; i++) {
      const sx = lerp(riverRightX + 16, w - 16, i / (rightCount - 1 || 1));
      const sy = groundBottom - 22 + Math.sin(now / 900 + i) * 2;
      this.#drawSheep(ctx, sx, sy, 0.8);
    }

    // left bank — grows with delivered score
    const leftCount = Math.min(score, CONFIG.SHEEP_MAX_SHOWN_LEFT);
    const cols = 6;
    for (let i = 0; i < leftCount; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const sx = lerp(16, riverLeftX - 16, col / (cols - 1 || 1));
      const sy = groundBottom - 22 - row * 22;
      this.#drawSheep(ctx, sx, sy, 0.8);
    }
  }

  #drawSheep(ctx, x, y, scale = 1) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.strokeStyle = COLORS.ink;
    ctx.fillStyle = COLORS.bg;
    ctx.lineWidth = 1.6;

    ctx.beginPath();
    ctx.ellipse(0, 0, 12, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(-13, -2, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(-6, 7); ctx.lineTo(-6, 13);
    ctx.moveTo(6, 7);  ctx.lineTo(6, 13);
    ctx.stroke();

    ctx.restore();
  }

  // ── Boat ────────────────────────────────────────────────────────────────────

  #drawBoat(ctx, layout, { boatPos, hasSheep, sailAnim, now }) {
    const { riverLeftX, riverRightX, riverY } = layout;
    const margin = 26;
    const x = lerp(riverRightX - margin, riverLeftX + margin, boatPos);
    const y = riverY + Math.sin(now / 500) * 2;

    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = COLORS.ink;
    ctx.fillStyle = COLORS.bg;
    ctx.lineWidth = 2;

    // hull
    ctx.beginPath();
    ctx.moveTo(-26, 6);
    ctx.quadraticCurveTo(0, 20, 26, 6);
    ctx.quadraticCurveTo(20, -4, -20, -4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // mast
    ctx.beginPath();
    ctx.moveTo(-4, -4);
    ctx.lineTo(-4, -46);
    ctx.stroke();

    // sail — flat/limp when not blowing, billowed when blowing
    const bulge = lerp(2, 20, sailAnim);
    ctx.beginPath();
    ctx.moveTo(-4, -44);
    ctx.quadraticCurveTo(-4 + bulge, -28, -4, -8);
    ctx.closePath();
    ctx.fillStyle = `rgba(28,28,28,${lerp(0.02, 0.08, sailAnim)})`;
    ctx.fill();
    ctx.stroke();

    // sailor (simple stick figure)
    ctx.beginPath();
    ctx.arc(8, -12, 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(8, -8);  ctx.lineTo(8, 0);
    ctx.moveTo(8, -5);  ctx.lineTo(2, -2);
    ctx.moveTo(8, -5);  ctx.lineTo(14, -2);
    ctx.moveTo(8, 0);   ctx.lineTo(4, 5);
    ctx.moveTo(8, 0);   ctx.lineTo(12, 5);
    ctx.stroke();

    // cargo sheep
    if (hasSheep) this.#drawSheep(ctx, -10, 1, 0.55);

    ctx.restore();
  }

  // ── HUD overlay ─────────────────────────────────────────────────────────────

  #drawCounters(ctx, w, score, timeLeftSecs) {
    const mm = Math.floor(timeLeftSecs / 60);
    const ss = Math.floor(timeLeftSecs % 60).toString().padStart(2, '0');

    ctx.save();
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';

    ctx.fillStyle = COLORS.inkSoft;
    ctx.font = '200 13px Nunito, sans-serif';
    ctx.fillText('time', w - 24, 14);
    ctx.fillStyle = COLORS.ink;
    ctx.font = '300 26px Nunito, sans-serif';
    ctx.fillText(`${mm}:${ss}`, w - 24, 30);

    ctx.fillStyle = COLORS.inkSoft;
    ctx.font = '200 13px Nunito, sans-serif';
    ctx.fillText('score', w - 24, 70);
    ctx.fillStyle = COLORS.ink;
    ctx.font = '300 40px Nunito, sans-serif';
    ctx.fillText(score, w - 24, 86);
    ctx.restore();
  }

  // ── State overlays ──────────────────────────────────────────────────────────

  #drawIdle(ctx, w, h) {
    ctx.fillStyle = COLORS.inkSoft;
    ctx.font = '300 20px Nunito, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Select a stream and press Start', w / 2, h * 0.28);
  }

  #drawCountdown(ctx, w, h, elapsed) {
    const cx = w / 2, cy = h * 0.28;
    let label;
    if (elapsed < 1000)      label = '3';
    else if (elapsed < 2000) label = '2';
    else if (elapsed < 3000) label = '1';
    else                     label = 'GO!';

    ctx.save();
    ctx.fillStyle    = COLORS.ink;
    ctx.font         = '300 80px Nunito, sans-serif';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, cx, cy);
    ctx.restore();
  }

  #drawGameOver(ctx, w, h, score) {
    const cx = w / 2, cy = h * 0.28;
    ctx.save();
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle    = COLORS.ink;
    ctx.font         = '300 42px Nunito, sans-serif';
    ctx.fillText(`Sheep delivered: ${score}`, cx, cy);
    ctx.fillStyle    = COLORS.inkSoft;
    ctx.font         = '200 14px Nunito, sans-serif';
    ctx.fillText('Press Play again to retry', cx, cy + 40);
    ctx.restore();
  }
}

export default TrainingGameRenderer;
