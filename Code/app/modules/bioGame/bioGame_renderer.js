// Pure drawing layer for the bioGame.
// Receives pre-computed render data — no game logic here.

import { STATE, CONFIG } from './bioGame_config.js';
import { SceneRenderer } from './sceneRenderer.js';
import { drawInstructions } from '../instructions/instructionScreen.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function lerp(a, b, t) { return a + (b - a) * t; }
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function easeOut(t) { return 1 - (1 - t) * (1 - t); }

// ── BioGameRenderer ───────────────────────────────────────────────────────────

export class BioGameRenderer {
  #canvas = null;
  #ctx    = null;
  #scene  = null;   // still needed directly for item shape/colors (#drawItems)

  #sceneRenderer = null;   // shared bg + avatar drawing (see sceneRenderer.js)

  // Flip-counter digit animation state (4 digits)
  #digits    = [];
  #lastScore = -1;
  #lastNow   = null;

  constructor(container, scene) {
    this.#scene = scene;

    container.innerHTML = '<canvas id="bg-canvas"></canvas>';
    this.#canvas = container.querySelector('#bg-canvas');
    this.#ctx    = this.#canvas.getContext('2d');

    this.#sceneRenderer = new SceneRenderer(scene);
    this.#initDigits();
    this.#sceneRenderer.warmUpShadow(this.#ctx);
  }

  // ── Public ────────────────────────────────────────────────────────────────

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
    this.#drawBg(ctx, w, h, renderData.bgScrollX ?? 0);

    switch (state) {
      case STATE.IDLE:
        this.#drawCenter(ctx, w, h, 'waiting for stream…', 'rgba(255,255,255,0.38)', 20);
        break;

      case STATE.CALIBRATING:
        this.#drawCalibrating(ctx, w, h, renderData.calProgress ?? 0, renderData.calRemaining ?? 0);
        break;

      case STATE.INSTRUCTIONS_CAL:
      case STATE.INSTRUCTIONS_TASK:
        drawInstructions(ctx, w, h, renderData.instructions);
        break;

      case STATE.COUNTDOWN:
        this.#drawCountdown(ctx, w, h, renderData.countdownValue ?? 3, renderData.countdownProgress ?? 0);
        break;

      case STATE.PLAYING:
        this.#drawPlaying(ctx, w, h, renderData, dt);
        break;

      case STATE.INTERMISSION: {
        // blockIndex already points at the upcoming block.
        const finished = (renderData.blockIndex ?? 1) - 1;
        this.#drawIntermission(ctx, w, h, finished, renderData.scoreBlocks?.[finished] ?? 0);
        break;
      }

      case STATE.DONE:
        this.#drawDone(ctx, w, h, renderData.scoreBlocks ?? []);
        break;
    }
  }

  // ── Background ────────────────────────────────────────────────────────────

  #drawBg(ctx, w, h, scrollX) {
    this.#sceneRenderer.drawBg(ctx, w, h, scrollX);
  }

  // ── Avatar ────────────────────────────────────────────────────────────────

  #drawAvatar(ctx, screenX, screenY, heightPx, tilt = 0) {
    this.#sceneRenderer.drawAvatar(ctx, screenX, screenY, heightPx, tilt);
  }

  // ── Items ─────────────────────────────────────────────────────────────────

  #drawItems(ctx, w, h, topPad, playH, items) {
    const si   = this.#scene.item;
    const size = CONFIG.ITEM_SIZE_RATIO * h;

    for (const item of items) {
      if (item.xRatio < -0.15 || item.xRatio > 1.15) continue;
      const sx = item.xRatio * w;
      const sy = topPad + (1 - item.normY) * playH;

      if (item.collectT != null) {
        const t     = clamp(item.collectT / 0.45, 0, 1);
        const alpha = 1 - t;
        const scale = 1 + 0.6 * easeOut(t);
        this.#drawStar(ctx, sx, sy, size * scale, alpha, si.collectColor);
      } else if (item.missT != null) {
        const alpha = clamp(1 - item.missT / 0.5, 0, 1);
        this.#drawStar(ctx, sx, sy, size, alpha, si.missColor);
      } else {
        this.#drawStar(ctx, sx, sy, size, 1, si.color);
      }
    }
  }

  // 5-pointed star
  #drawStar(ctx, cx, cy, r, alpha, color) {
    const ri   = r * 0.42;
    const pts  = 5;
    const base = -Math.PI / 2;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle   = color;
    ctx.shadowColor = color;
    ctx.shadowBlur  = 8;

    ctx.beginPath();
    for (let i = 0; i < pts * 2; i++) {
      const rad = i % 2 === 0 ? r : ri;
      const ang = base + (i * Math.PI) / pts;
      i === 0
        ? ctx.moveTo(cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad)
        : ctx.lineTo(cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // ── Target curve ──────────────────────────────────────────────────────────

  #drawCurve(ctx, w, h, topPad, playH, blockTime, bpm, scrollSpeed) {
    const period = 60 / bpm;
    ctx.save();
    ctx.beginPath();
    for (let px = 0; px <= w; px += 4) {
      const tOff  = (px / w - CONFIG.AVATAR_X_RATIO) / scrollSpeed;
      const normY = 0.5 + 0.45 * Math.sin(2 * Math.PI * (blockTime + tOff) / period);
      const sy    = topPad + (1 - normY) * playH;
      px === 0 ? ctx.moveTo(px, sy) : ctx.lineTo(px, sy);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth   = 2;
    ctx.setLineDash([12, 10]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  // ── Timer bar ─────────────────────────────────────────────────────────────

  #drawTimerBar(ctx, w, h, blockElapsed, now) {
    const total    = CONFIG.BLOCK_DURATION_SECS;
    const timeLeft = Math.max(0, total - blockElapsed);
    const ratio    = clamp(timeLeft / total, 0, 1);

    const barMaxW  = Math.min(240, w * 0.25);
    const barH     = 9;
    const padRight = 20;
    const padTop   = 18;
    const barRight = w - padRight;
    const barY     = padTop;

    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.beginPath();
    ctx.roundRect(barRight - barMaxW, barY, barMaxW, barH, 4);
    ctx.fill();

    const filledW = barMaxW * ratio;
    if (filledW > 2) {
      let barColor;
      if (timeLeft > 60) {
        barColor = 'rgba(255,255,255,0.88)';
      } else if (timeLeft > 15) {
        const t = (60 - timeLeft) / 45;
        barColor = `rgba(255,${Math.round(lerp(255, 160, t))},${Math.round(lerp(255, 30, t))},0.92)`;
      } else {
        const flash = 0.55 + 0.45 * Math.sin(now * 0.008);
        barColor = `rgba(255,70,70,${flash})`;
      }
      ctx.fillStyle = barColor;
      ctx.beginPath();
      ctx.roundRect(barRight - filledW, barY, filledW, barH, 4);
      ctx.fill();
    }

    const secs = Math.ceil(timeLeft);
    const mm   = String(Math.floor(secs / 60)).padStart(1, '0');
    const ss   = String(secs % 60).padStart(2, '0');
    ctx.fillStyle    = 'rgba(255,255,255,0.45)';
    ctx.font         = '300 12px Nunito, sans-serif';
    ctx.textAlign    = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText(`${mm}:${ss}`, barRight, barY + barH + 5);
  }

  // ── Score / flip counter ──────────────────────────────────────────────────

  #initDigits() {
    for (let i = 0; i < 4; i++) {
      this.#digits.push({ shown: 0, from: 0, to: 0, animT: 1 });
    }
  }

  #updateDigits(score, dt) {
    for (const d of this.#digits) {
      if (d.animT < 1) d.animT = Math.min(1, d.animT + dt / 0.32);
    }
    if (score === this.#lastScore) return;
    this.#lastScore = score;

    const str = String(score).padStart(4, '0');
    for (let i = 0; i < 4; i++) {
      const n = parseInt(str[i]);
      const d = this.#digits[i];
      if (n !== d.shown) {
        d.from  = d.shown;
        d.to    = n;
        d.shown = n;
        d.animT = 0;
      }
    }
  }

  #drawScoreDisplay(ctx, x, y, score, dt) {
    this.#updateDigits(score, dt);

    const cardW = 30;
    const cardH = 44;
    const gap   = 5;

    for (let i = 0; i < 4; i++) {
      const cx = x + i * (cardW + gap);
      const cy = y;
      const d  = this.#digits[i];

      ctx.fillStyle = 'rgba(0,0,0,0.48)';
      ctx.beginPath();
      ctx.roundRect(cx, cy, cardW, cardH, 6);
      ctx.fill();

      ctx.save();
      ctx.beginPath();
      ctx.roundRect(cx, cy, cardW, cardH, 6);
      ctx.clip();

      const t = easeOut(clamp(d.animT, 0, 1));
      if (d.animT < 1) {
        const oldY = cy - t * cardH;
        this.#drawDigitChar(ctx, String(d.from), cx, oldY, cardW, cardH, 1 - t);
        const newY = cy + (1 - t) * cardH;
        this.#drawDigitChar(ctx, String(d.to), cx, newY, cardW, cardH, t);
      } else {
        this.#drawDigitChar(ctx, String(d.shown), cx, cy, cardW, cardH, 1);
      }

      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth   = 1;
      ctx.beginPath();
      ctx.moveTo(cx,         cy + cardH / 2);
      ctx.lineTo(cx + cardW, cy + cardH / 2);
      ctx.stroke();

      ctx.restore();
    }

    ctx.fillStyle    = 'rgba(255,255,255,0.35)';
    ctx.font         = '300 11px Nunito, sans-serif';
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('score', x, y + cardH + 5);
  }

  #drawDigitChar(ctx, char, x, y, w, h, alpha) {
    ctx.fillStyle    = `rgba(255,255,255,${alpha * 0.92})`;
    ctx.font         = `400 ${Math.round(h * 0.62)}px Nunito, sans-serif`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(char, x + w / 2, y + h / 2);
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

  #drawCountdown(ctx, w, h, value, progress) {
    const text  = value === 0 ? 'GO!' : String(value);
    const color = value === 0 ? 'rgba(126,232,162,0.95)' : 'rgba(255,255,255,0.92)';
    const size  = value === 0 ? 84 : 108;
    const scale = 1 + 0.35 * (1 - easeOut(clamp(progress, 0, 1)));

    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(scale, scale);
    ctx.fillStyle    = color;
    ctx.font         = `200 ${size}px Nunito, sans-serif`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }

  #drawPlaying(ctx, w, h, data, dt) {
    const {
      avatarNormY, avatarStressNorm = 0.5, avatarTilt = 0, avatarBumpT,
      items, particles, score, blockTime, bpm, showCurve, group, now,
      scrollSpeed,
    } = data;

    const topPad = h * 0.10;
    const playH  = h * 0.80;
    const normToScreenY = (ny) => topPad + (1 - ny) * playH;

    if (showCurve) {
      this.#drawCurve(ctx, w, h, topPad, playH, blockTime, bpm, scrollSpeed);
    }

    this.#drawItems(ctx, w, h, topPad, playH, items);

    if (particles?.length) {
      this.#drawParticles(ctx, w, h, topPad, playH, particles);
    }

    const avatarScreenX = CONFIG.AVATAR_X_RATIO * w;
    const avatarScreenY = normToScreenY(avatarNormY);
    const baseH = lerp(CONFIG.AVATAR_STRESS_SIZE_MIN, CONFIG.AVATAR_STRESS_SIZE_MAX, avatarStressNorm) * h;
    const bumpScale = avatarBumpT != null
      ? 1 + 0.28 * Math.sin(Math.PI * avatarBumpT / 0.3)
      : 1;
    this.#drawAvatar(ctx, avatarScreenX, avatarScreenY, baseH * bumpScale, avatarTilt);

    // Time-left bar: every game, both groups. The score counter is slow-group only.
    this.#drawTimerBar(ctx, w, h, blockTime, now);
    if (group === 'slow') {
      this.#drawScoreDisplay(ctx, 18, 16, score, dt);
    }
  }

  #drawParticles(ctx, w, h, topPad, playH, particles) {
    ctx.save();
    ctx.shadowBlur = 6;
    for (const p of particles) {
      const sx = p.x * w;
      const sy = topPad + (1 - p.y) * playH;
      const r  = p.r * h;
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle   = p.color;
      ctx.shadowColor = p.color;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  #drawIntermission(ctx, w, h, finishedIndex, score) {
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, 0, w, h);

    const cy = h / 2;

    this.#drawCenter(ctx, w, cy - 80, `Game ${finishedIndex + 1} complete  ·  Good job!`, 'rgba(255,255,255,0.85)', 30, '300');

    const scoreStr = `★  ${score}  ★`;
    ctx.fillStyle    = '#ffd060';
    ctx.font         = '300 60px Nunito, sans-serif';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor  = 'rgba(255,200,50,0.6)';
    ctx.shadowBlur   = 20;
    ctx.fillText(scoreStr, w / 2, cy);
    ctx.shadowBlur   = 0;

    const label = score === 1 ? '1 item caught' : `${score} items caught`;
    this.#drawCenter(ctx, w, cy + 60, label, 'rgba(255,255,255,0.55)', 18);
    this.#drawCenter(ctx, w, cy + 110, 'Press Space', 'rgba(255,255,255,0.28)', 15);
  }

  #drawDone(ctx, w, h, scores) {
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, 0, w, h);

    const cy    = h / 2;
    const total = scores.reduce((a, b) => a + b, 0);

    this.#drawCenter(ctx, w, cy - 90, 'Experiment complete!', 'rgba(255,255,255,0.85)', 28, '300');

    ctx.fillStyle    = '#ffd060';
    ctx.font         = '200 72px Nunito, sans-serif';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor  = 'rgba(255,200,50,0.55)';
    ctx.shadowBlur   = 22;
    ctx.fillText(`★  ${total}  ★`, w / 2, cy);
    ctx.shadowBlur   = 0;

    const perGame = scores.map((s, i) => `Game ${i + 1}: ${s}`).join('  ·  ');
    this.#drawCenter(ctx, w, cy + 65, perGame, 'rgba(255,255,255,0.42)', 16);
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
