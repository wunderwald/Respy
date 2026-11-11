// Pure drawing layer for the iBreath experiment.
// Receives pre-computed state and data — no experiment logic here.

import { STATE, CONFIG } from './config.js';
import { drawDisplay } from './animationDisplay.js';
import { Caustics }    from './caustics.js';
import { drawInstructions } from '../instructions/instructionScreen.js';
import { TEXTS } from './ibreath_texts.js';

export class IBreathRenderer {
  #canvas   = null;
  #ctx      = null;
  #images   = {};        // key → HTMLImageElement
  #caustics = null;

  constructor(container) {
    container.innerHTML = '<canvas id="ib-canvas"></canvas>';
    this.#canvas = container.querySelector('#ib-canvas');
    this.#ctx = this.#canvas.getContext('2d');
    for (const [key, src] of [['pufferfish', 'images/pufferfish.png'],
                               ['starfish',   'images/starfish.png'],
                               ['pinkfish',   'images/pinkfish.png']]) {
      const img = new Image();
      img.src = src;
      this.#images[key] = img;
    }
    this.#caustics = new Caustics();
  }

  // ── Public draw entry point ────────────────────────────────────────────

  draw(state, now, data = {}) {
    const canvas = this.#canvas;
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;

    const ctx = this.#ctx;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    // Keep the display screen quiet while the EyeLink calibration window
    // (a separate process) may be sharing this monitor.
    if (state !== STATE.EYETRACK_CAL) this.#caustics.draw(ctx, w, h, now / 1000);

    switch (state) {
      case STATE.IDLE:        break;   // before Start: background only
      case STATE.INSTRUCTIONS_CAL:
      case STATE.INSTRUCTIONS_TASK: drawInstructions(ctx, w, h, data.instructions); break;
      case STATE.CALIBRATING: this.#drawCalibrating(ctx, w, h, data.calProgress, data.calRemaining); break;
      case STATE.READY:       break;   // between trials (AUTO_ADVANCE off): background only
      case STATE.DISPLAY:     this.#drawDisplayState(ctx, w, h, data.displayElapsed); break;
      case STATE.TRIAL:       this.#drawTrial(ctx, w, h, data.trial, data.stimLevel, data.flashActive); break;
      case STATE.RESPONSE:    this.#drawResponse(ctx, w, h, now, data.responseStartTime, data.questionType); break;
      case STATE.ITI:         break;   // background only — no text between trials
      case STATE.PAUSED:      this.#drawPaused(ctx, w, h, now); break;
      case STATE.EYETRACK_CAL: this.#drawEyeCal(ctx, w, h); break;
      case STATE.DONE:        this.#drawDone(ctx, w, h); break;
    }

    if (CONFIG.DEBUG_GAZE && data.gazeX != null && data.gazeY != null) {
      this.#drawGazeDot(ctx, w, h, data.gazeX, data.gazeY);
    }
  }

  #drawGazeDot(ctx, w, h, gx, gy) {
    const rect = this.#canvas.getBoundingClientRect();
    const x = gx * window.innerWidth  - rect.left;
    const y = gy * window.innerHeight - rect.top;
    const r = 10;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 80, 80, 0.75)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.fill();
    ctx.restore();
  }

  // ── State draw methods ─────────────────────────────────────────────────


  #drawCalibrating(ctx, w, h, progress, remaining) {
    const cx = w / 2, cy = h / 2;
    const r = 60;


    // Track ring
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 5;
    ctx.stroke();

    // Progress arc
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.stroke();

    this.#centerText(ctx, cx, cy, String(remaining), 'rgba(255,255,255,0.7)', 52, '200');
  }

  #drawDisplayState(ctx, w, h, elapsed) {
    drawDisplay(ctx, w, h, elapsed, this.#images);
  }


  #drawTrial(ctx, w, h, trial, stimLevel, flashActive) {
    const halfW = w / 2;
    const centreX = trial.lr
      ? halfW / 2            // centre of left half
      : halfW + halfW / 2;   // centre of right half
    const centreY = h / 2;

    const minSize = Math.min(halfW, h) * CONFIG.CLOUD_SIZE_MIN;
    const maxSize = Math.min(halfW, h) * CONFIG.CLOUD_SIZE_MAX;
    const size = minSize + stimLevel * (maxSize - minSize);

    this.#drawStimImage(ctx, trial.img, centreX, centreY, size);

    if (flashActive) {
      const margin = 0.1;
      const fx = (margin + trial.flashX * (1 - 2 * margin)) * w;
      const fy = (margin + trial.flashY * (1 - 2 * margin)) * h;
      this.#drawFlash(ctx, fx, fy, trial.flashImage);
    }

    // Subtle dividing line between the two halves
    ctx.beginPath();
    ctx.moveTo(halfW, 0);
    ctx.lineTo(halfW, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Post-trial question, made for children: a big question line and two
  // big answer cards (← left / right →), each with a fat drawn arrow and
  // the answer in large bold text — or, for the 'img' question, the picture.
  // Both cards look identical (same colours) so neither answer is visually
  // favoured. Everything scales with the screen via `u` (1 u = 1 % of the
  // height on a 16:9 screen; narrower windows scale down by width).
  #drawResponse(ctx, w, h, now, responseStartTime, questionType) {
    const elapsed   = now - responseStartTime;
    const timeout   = CONFIG.RESPONSE_TIMEOUT_SECS * 1000;
    const progress  = Math.min(elapsed / timeout, 1);
    const remaining = Math.max(0, Math.ceil(CONFIG.RESPONSE_TIMEOUT_SECS - elapsed / 1000));
    const u  = Math.min(h, w * 9 / 16) / 100;
    const cx = w / 2;

    const questionDef = CONFIG.QUESTIONS.find(q => q.id === questionType) ?? CONFIG.QUESTIONS[0];

    // ── Question ──
    this.#fitText(ctx, cx, 15 * u, questionDef.text, '#ffffff', 7 * u, w * 0.92, '700');

    // ── Answer cards ──
    const cardW  = Math.min(62 * u, w * 0.38);
    const cardH  = 54 * u;
    const cardY  = 61 * u;                         // card centre
    const cardDx = Math.min(46 * u, w * 0.27);     // card centre offset from screen centre
    // Gentle, symmetric "come press me" nudge of both arrows outward.
    const nudge  = (0.5 + 0.5 * Math.sin(now / 1000 * Math.PI * 1.6)) * 1.6 * u;
    // `labels` = what's shown (German); `answers` = what's recorded (unchanged).
    const [leftLabel, rightLabel] = questionDef.labels ?? questionDef.answers ?? ['ja', 'nein'];

    for (const side of [-1, 1]) {
      const x = cx + side * cardDx;
      this.#roundRect(ctx, x - cardW / 2, cardY - cardH / 2, cardW, cardH, 5 * u,
                      'rgba(255,255,255,0.09)', 'rgba(255,255,255,0.55)', 0.5 * u);

      if (questionType === 'img') {
        // Arrow on top, the picture as the "label"
        this.#drawArrow(ctx, x + side * nudge, cardY - 15 * u, 26 * u, side, '#ffd166');
        const img = this.#images[side < 0 ? 'pufferfish' : 'starfish'];
        const s   = Math.min(30 * u, cardW * 0.62);
        if (img?.complete && img.naturalWidth > 0) {
          const ar = img.naturalWidth / img.naturalHeight;
          const iw = ar >= 1 ? s : s * ar, ih = ar >= 1 ? s / ar : s;
          ctx.drawImage(img, x - iw / 2, cardY + 10 * u - ih / 2, iw, ih);
        }
      } else {
        this.#drawArrow(ctx, x + side * nudge, cardY - 9 * u, 32 * u, side, '#ffd166');
        this.#fitText(ctx, x, cardY + 15 * u, side < 0 ? leftLabel : rightLabel,
                      '#ffffff', 12 * u, cardW * 0.86, '800');
      }
    }

    // ── Centre column: pinkfish reminder ('flash') + countdown ──
    if (questionType === 'flash') {
      const img = this.#images['pinkfish'];
      if (img?.complete && img.naturalWidth > 0) {
        const s = 7 * u;
        ctx.drawImage(img, cx - s, cardY - 17 * u - s, s * 2, s * 2);
      }
    }

    const r = 6.5 * u;
    ctx.beginPath();
    ctx.arc(cx, cardY + 4 * u, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth   = 1.2 * u;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cardY + 4 * u, r, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth   = 1.2 * u;
    ctx.lineCap     = 'round';
    ctx.stroke();

    this.#centerText(ctx, cx, cardY + 4 * u, String(remaining), 'rgba(255,255,255,0.85)', 5.5 * u, '700');
  }

  // Fat block arrow centred at (x, y), `len` long, pointing left (dir -1) or
  // right (dir 1). Filled and stroked in the same colour with round joins,
  // so the corners come out soft.
  #drawArrow(ctx, x, y, len, dir, color) {
    const half  = len / 2;
    const shaft = len * 0.15;   // half-thickness of the shaft
    const head  = len * 0.36;   // half-height of the head
    const neck  = half - len * 0.42;
    const pts = [
      [-half, -shaft], [neck, -shaft], [neck, -head], [half, 0],
      [neck,  head],   [neck,  shaft], [-half, shaft],
    ];
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(dir, 1);
    ctx.beginPath();
    pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
    ctx.closePath();
    ctx.fillStyle   = color;
    ctx.strokeStyle = color;
    ctx.lineWidth   = len * 0.07;
    ctx.lineJoin    = 'round';
    // Shadow only on the (outer) stroke; the fill on top then covers the
    // stroke's inner shadow, so no dark outline shows inside the arrow.
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur  = len * 0.08;
    ctx.stroke();
    ctx.shadowColor = 'transparent';
    ctx.fill();
    ctx.restore();
  }

  #roundRect(ctx, x, y, w, h, r, fill, stroke, lineWidth) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth   = lineWidth;
    ctx.stroke();
  }

  // Like #centerText, but shrinks the font until `text` fits `maxWidth`.
  #fitText(ctx, x, y, text, color, size, maxWidth, weight = '300') {
    ctx.font = `${weight} ${size}px Nunito, sans-serif`;
    const width = ctx.measureText(text).width;
    if (width > maxWidth) size *= maxWidth / width;
    this.#centerText(ctx, x, y, text, color, size, weight);
  }


  #drawPaused(ctx, w, h, now) {
    const t    = now / 1000;
    const cx   = w / 2, cy = h / 2;
    const unit = Math.min(w, h);

    const swimHz  = 0.28;
    const phase   = t * swimHz * Math.PI * 2;

    // Lazy figure-8: x sweeps slowly, y wobbles at 2× frequency
    const x = cx + Math.sin(phase) * w * 0.28;
    const y = cy + Math.sin(phase * 2) * unit * 0.035;

    const facingLeft = Math.cos(phase) < 0;
    const wag        = Math.sin(phase * 2) * 0.10;
    const fishSize   = unit * 0.11;

    const img = this.#images['pinkfish'];
    ctx.save();
    ctx.translate(x, y);
    if (facingLeft) ctx.scale(-1, 1);
    ctx.rotate(wag);
    if (img?.complete && img.naturalWidth > 0) {
      ctx.drawImage(img, -fishSize, -fishSize, fishSize * 2, fishSize * 2);
    }
    ctx.restore();

    this.#centerText(ctx, cx, cy + unit * 0.22, TEXTS.paused, 'rgba(255,255,255,0.28)', 16);
  }

  #drawEyeCal(ctx, w, h) {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, w, h);
    this.#centerText(ctx, w / 2, h / 2,
      TEXTS.eyeCal,
      'rgba(255,255,255,0.4)', 18);
  }

  // Child-facing end screen only — trial count and subject code are
  // experimenter information (shown in the experimenter window).
  #drawDone(ctx, w, h) {
    this.#centerText(ctx, w / 2, h / 2, TEXTS.done, 'rgba(255,255,255,0.6)', 24);
  }

  // ── Canvas helpers ─────────────────────────────────────────────────────

  // Draw a stimulus image centred at (cx, cy) with half-size `size`.
  // Falls back silently if the image hasn't loaded yet.
  #drawStimImage(ctx, key, cx, cy, size) {
    const img = this.#images[key];
    if (!img?.complete || img.naturalWidth === 0) return;
    ctx.drawImage(img, cx - size, cy - size, size * 2, size * 2);
  }

  // Draw a flash image centred at (x, y). Add cases here for new flash images.
  #drawFlash(ctx, x, y, image) {
    const img = this.#images[image];
    if (!img?.complete || img.naturalWidth === 0) return;
    const s = 72;
    ctx.drawImage(img, x - s, y - s, s * 2, s * 2);
  }

  // Procedural cloud — five overlapping circles with a white-to-light-blue
  // radial gradient. Ported from trainingGame.js #drawCloud.
  #drawCloud(ctx, x, y, size, alpha) {
    ctx.globalAlpha = alpha;

    const blobs = [
      { dx: 0, dy: 0, r: size * 0.55 },
      { dx: -size * 0.42, dy: size * 0.12, r: size * 0.42 },
      { dx: size * 0.42, dy: size * 0.12, r: size * 0.40 },
      { dx: -size * 0.20, dy: -size * 0.28, r: size * 0.34 },
      { dx: size * 0.22, dy: -size * 0.24, r: size * 0.32 },
    ];

    const grd = ctx.createRadialGradient(
      x, y - size * 0.15, 0,
      x, y, size * 0.8
    );
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(1, 'rgba(210,230,248,0.88)');

    ctx.beginPath();
    for (const b of blobs) {
      ctx.moveTo(x + b.dx + b.r, y + b.dy);
      ctx.arc(x + b.dx, y + b.dy, b.r, 0, Math.PI * 2);
    }
    ctx.fillStyle = grd;
    ctx.fill();

    ctx.globalAlpha = 1;
  }

  #centerText(ctx, x, y, text, color, size, weight = '300') {
    ctx.fillStyle = color;
    ctx.font = `${weight} ${size}px Nunito, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y);
  }
}
