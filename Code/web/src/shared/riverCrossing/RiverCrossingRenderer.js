import { VISUAL_CONFIG as CONFIG, STATE } from './riverCrossingVisuals.js';

// ── RiverCrossingRenderer ────────────────────────────────────────────────────
// Bright pastel line-art rendering, sized for young kids: soft pink sky,
// cheerful blue water, pastel green banks. Pure drawing, given render data
// built by the game class. Static camera — the boat moves across a fixed
// river. Shared by every River Crossing variant (breath, tap, ...) — they
// all look identical, only the input mechanic driving the boat differs.

function lerp(a, b, t) { return a + (b - a) * t; }

const COLORS = {
  bg:       '#ffe4ef',
  ink:      '#4a3350',
  inkSoft:  'rgba(74,51,80,0.55)',
  inkFaint: 'rgba(74,51,80,0.25)',
  river:    '#7fd8f7',
  bank:     '#c8f2c4',
};

export class RiverCrossingRenderer {
  #canvas;
  #ctx;

  // Stable per-sheep/per-tree scatter offsets (normalized [0,1] within their
  // plot), generated once so positions don't jitter between frames — only
  // mapped to actual screen coordinates at draw time, so they still adapt
  // to canvas resizes.
  #rightSheepScatter;
  #leftSheepScatter;
  #leftTrees;
  #rightTrees;

  constructor(container) {
    container.innerHTML = '<canvas id="game-canvas"></canvas>';
    this.#canvas = container.querySelector('#game-canvas');
    this.#ctx = this.#canvas.getContext('2d');

    this.#rightSheepScatter = RiverCrossingRenderer.#makeScatter(CONFIG.SHEEP_COUNT_RIGHT);
    this.#leftSheepScatter  = RiverCrossingRenderer.#makeScatter(CONFIG.SHEEP_MAX_SHOWN_LEFT);
    this.#leftTrees  = RiverCrossingRenderer.#makeTrees(CONFIG.TREE_COUNT_PER_BANK);
    this.#rightTrees = RiverCrossingRenderer.#makeTrees(CONFIG.TREE_COUNT_PER_BANK);
  }

  static #makeScatter(count) {
    return Array.from({ length: count }, () => ({ tx: Math.random(), ty: Math.random() }));
  }

  static #makeTrees(count) {
    return Array.from({ length: count }, (_, i) => ({
      t: count === 1 ? 0.5 : i / (count - 1),
      jitter: (Math.random() - 0.5) * 0.7,     // x jitter, as a fraction of tree spacing
      scale: 1.0 + Math.random() * 1.1,        // varied sizes
    }));
  }

  get canvas() { return this.#canvas; }

  draw({ state, countdownElapsed, score, timeLeftSecs, boatPos, hasSheep, sailAnim, clouds, now, hint }) {
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

    // Optional per-game caption shown only while actually playing — e.g. the
    // tap game's "Tap as fast as you can!" reminder. The breath game simply
    // doesn't pass one, so nothing is drawn here for it.
    if (state === STATE.PLAYING && hint) {
      this.#drawHint(ctx, w, h, hint);
    }

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
    const { riverTop, riverBottom, riverLeftX, riverRightX, groundBottom } = layout;

    // The water fills all the way to the bottom of the screen (deeper than
    // the visible wave band, where the boat actually sails).
    ctx.fillStyle = COLORS.river;
    ctx.fillRect(riverLeftX, riverTop, riverRightX - riverLeftX, groundBottom - riverTop);

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
    ctx.moveTo(riverLeftX, riverTop);  ctx.lineTo(riverLeftX, groundBottom);
    ctx.moveTo(riverRightX, riverTop); ctx.lineTo(riverRightX, groundBottom);
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

    const trees = side === 'left' ? this.#leftTrees : this.#rightTrees;
    const plotW = x1 - x0;
    const step = plotW / trees.length;
    for (const tree of trees) {
      const tx = x0 + plotW * 0.08 + tree.t * plotW * 0.84 + tree.jitter * step;
      this.#drawTree(ctx, tx, riverTop - 2, tree.scale);
    }
  }

  // Brown trunk, green canopy — a deliberate spot of color against the
  // otherwise monochrome-ink line art.
  #drawTree(ctx, x, groundY, scale = 1) {
    const trunkH  = 24 * scale;
    const canopyR = 15 * scale;

    ctx.strokeStyle = '#7a5233';
    ctx.lineWidth = Math.max(1.5, 3 * scale);
    ctx.beginPath();
    ctx.moveTo(x, groundY);
    ctx.lineTo(x, groundY - trunkH);
    ctx.stroke();

    ctx.fillStyle = '#7fcf6e';
    ctx.strokeStyle = '#4a9a46';
    ctx.lineWidth = Math.max(1.2, 2 * scale);
    ctx.beginPath();
    ctx.arc(x, groundY - trunkH - canopyR * 0.55, canopyR, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // ── Sheep ───────────────────────────────────────────────────────────────────

  #drawSheepFlock(ctx, layout, score, now) {
    const { riverRightX, riverLeftX, w, riverTop, groundBottom } = layout;

    const scale  = CONFIG.SHEEP_SCALE;
    const marginX  = 30 * scale;
    const yTop     = riverTop + 36;          // stay clear of the treeline
    const yBottom  = groundBottom - 26 * scale;

    // right bank — a small flock always available, doesn't deplete,
    // scattered across the whole plot rather than gridded by the river edge
    for (let i = 0; i < CONFIG.SHEEP_COUNT_RIGHT; i++) {
      const { tx, ty } = this.#rightSheepScatter[i];
      const sx = lerp(riverRightX + marginX, w - marginX, tx);
      const sy = lerp(yTop, yBottom, ty) + Math.sin(now / 900 + i) * 2;
      this.#drawSheep(ctx, sx, sy, scale);
    }

    // left bank — grows with delivered score, scattered the same way
    const leftCount = Math.min(score, CONFIG.SHEEP_MAX_SHOWN_LEFT);
    for (let i = 0; i < leftCount; i++) {
      const { tx, ty } = this.#leftSheepScatter[i];
      const sx = lerp(marginX, riverLeftX - marginX, tx);
      const sy = lerp(yTop, yBottom, ty);
      this.#drawSheep(ctx, sx, sy, scale);
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
    const margin = 26 * CONFIG.BOAT_SCALE;
    const x = lerp(riverRightX - margin, riverLeftX + margin, boatPos);
    const y = riverY + Math.sin(now / 500) * 2;

    ctx.save();
    ctx.translate(x, y);
    // Mirrored horizontally — the hull/sail/sailor are drawn facing right,
    // but the boat travels left (toward the left bank), so flip it to face
    // the direction of travel.
    ctx.scale(-CONFIG.BOAT_SCALE, CONFIG.BOAT_SCALE);
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

    // sail — flat/limp when not pushing, billowed when pushing
    const bulge = lerp(2, 20, sailAnim);
    ctx.beginPath();
    ctx.moveTo(-4, -44);
    ctx.quadraticCurveTo(-4 + bulge, -28, -4, -8);
    ctx.closePath();
    ctx.fillStyle = `rgba(74,51,80,${lerp(0.02, 0.08, sailAnim)})`;
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

  #drawHint(ctx, w, h, text) {
    ctx.save();
    ctx.fillStyle = COLORS.inkSoft;
    ctx.font = '300 18px Nunito, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(text, w / 2, h * 0.04);
    ctx.restore();
  }

  // ── State overlays ──────────────────────────────────────────────────────────

  #drawIdle(ctx, w, h) {
    ctx.fillStyle = COLORS.inkSoft;
    ctx.font = '300 20px Nunito, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Tap to start', w / 2, h * 0.28);
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
    ctx.fillText('Tap to play again', cx, cy + 40);
    ctx.restore();
  }
}

export default RiverCrossingRenderer;
