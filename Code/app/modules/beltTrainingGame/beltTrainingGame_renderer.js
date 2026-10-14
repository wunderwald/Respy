// Pure drawing layer for the Belt Training Game.
// Receives pre-computed render data — no game logic here.

import { STATE, CONFIG } from './beltTrainingGame_config.js';
import { SceneRenderer } from '../bioGame/sceneRenderer.js';
import { drawDisplay }  from '../ibreath/animationDisplay.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function easeOut(t) { return 1 - (1 - t) * (1 - t); }

// ── BeltTrainingGameRenderer ───────────────────────────────────────────────────

export class BeltTrainingGameRenderer {
  #canvas = null;
  #ctx    = null;

  #sceneRenderer = null;   // shared bg + avatar drawing (see bioGame/sceneRenderer.js)
  #images = {};            // key → HTMLImageElement — the ibreath "pre-trial" fish, reused for the countdown

  #lastNow = null;

  // Post-test polaroid — captured once per photo review (keyed by the game's
  // monotonic photoKey, not trialIndex, since trialIndex resets across
  // separate sessions) and cached, not re-rendered every frame. See
  // #capturePhoto/#drawPhotoReview.
  #cachedPhotoCanvas = null;
  #cachedPhotoKey    = null;

  constructor(container, scene) {
    container.innerHTML = '<canvas id="btg-canvas"></canvas>';
    this.#canvas = container.querySelector('#btg-canvas');
    this.#ctx    = this.#canvas.getContext('2d');

    this.#sceneRenderer = new SceneRenderer(scene);
    this.#sceneRenderer.warmUpShadow(this.#ctx);

    for (const [key, src] of [['pufferfish', 'images/pufferfish.png'],
                               ['starfish',   'images/starfish.png'],
                               ['pinkfish',   'images/pinkfish.png']]) {
      const img = new Image();
      img.src = src;
      this.#images[key] = img;
    }
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
        this.#drawReady(ctx, w, h, renderData);
        break;

      case STATE.COUNTDOWN:
        this.#drawCountdown(ctx, w, h, now, renderData.countdownValue ?? 3, renderData.countdownProgress ?? 0);
        break;

      case STATE.TRAINING:
        this.#drawGameplay(ctx, w, h, renderData, false);
        break;

      case STATE.TEST:
        this.#drawGameplay(ctx, w, h, renderData, true, now);
        break;

      case STATE.PHOTO:
        this.#drawPhotoReview(ctx, w, h, renderData);
        break;

      case STATE.DONE:
        this.#drawDone(ctx, w, h);
        break;
    }
  }

  // ── Gameplay (training + test phases) ─────────────────────────────────────

  #drawGameplay(ctx, w, h, data, isTest, now) {
    const { fishXRatio, fishNormY, targetNormY, avatarTilt = 0, promptText } = data;

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

    // Continuous opacity fade as the fish enters/leaves the bubble-covered
    // zone (test phase only) — driven by its actual x position, not the
    // discrete segment label, so it fades smoothly instead of blinking.
    const opacity = isTest ? this.#fishOpacity(fishXRatio) : 1;
    if (opacity > 0.001) {
      const fishScreenX = fishXRatio * w;
      const fishScreenY = normToScreenY(fishNormY);
      const avatarH = CONFIG.AVATAR_SIZE_MIN * h +
        (CONFIG.AVATAR_SIZE_MAX - CONFIG.AVATAR_SIZE_MIN) * h * 0.5;
      ctx.save();
      ctx.globalAlpha = opacity;
      this.#sceneRenderer.drawAvatar(ctx, fishScreenX, fishScreenY, avatarH, avatarTilt);
      ctx.restore();
    }

    if (promptText) {
      this.#drawCenter(ctx, w, h * 0.08, promptText, 'rgba(255,255,255,0.80)', 22);
    }
  }

  // 1 outside the target zone, 0 fully inside it, with a linear ramp of
  // width FISH_FADE_WIDTH_RATIO just outside each edge.
  #fishOpacity(fishXRatio) {
    const fadeW = CONFIG.FISH_FADE_WIDTH_RATIO;
    const x1 = CONFIG.TARGET_X_START;
    const x2 = CONFIG.TARGET_X_END;

    if (fishXRatio <= x1 - fadeW) return 1;
    if (fishXRatio < x1)          return (x1 - fishXRatio) / fadeW;
    if (fishXRatio <= x2)         return 0;
    if (fishXRatio < x2 + fadeW)  return (fishXRatio - x2) / fadeW;
    return 1;
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
      const bx = x1 + (((i * 0.6180339887) % 1 + 1) % 1) * (x2 - x1);
      const by = h * (1 - phase);
      const r  = 3 + (i % 4) * 2.2;

      ctx.beginPath();
      ctx.fillStyle = 'rgba(255,255,255,0.20)';
      ctx.arc(bx, by, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // ── Post-test photo review ────────────────────────────────────────────────

  // Renders a zoomed-in snapshot (fish + full target bands + a little
  // surrounding background) into an offscreen canvas, as the scene looked at
  // the single best (closest-to-target) moment of the test phase's target
  // crossing. Reuses the exact same drawing calls as live gameplay, just
  // under a scale+translate that crops/zooms into the target area.
  #capturePhoto(bigW, bigH, fishXRatio, fishNormY, targetNormY) {
    const topPad = bigH * 0.10;
    const playH  = bigH * 0.80;
    const normToScreenY = (ny) => topPad + (1 - ny) * playH;

    const marginX = CONFIG.PHOTO_ZOOM_MARGIN_X * bigW;
    const cropX1  = CONFIG.TARGET_X_START * bigW - marginX;
    const cropX2  = CONFIG.TARGET_X_END   * bigW + marginX;

    const marginY   = CONFIG.PHOTO_ZOOM_MARGIN_Y * playH;
    const redHalfPx = CONFIG.TARGET_HEIGHT_RED * playH;
    const centerYpx = normToScreenY(targetNormY);
    const fishYpx   = normToScreenY(fishNormY);

    // Normally just the red band + margin, but if the fish's best moment
    // still landed well outside the target (a missed trial), zoom out
    // further so the shot still includes both the full target and the fish.
    const cropY1 = Math.min(centerYpx - redHalfPx, fishYpx) - marginY;
    const cropY2 = Math.max(centerYpx + redHalfPx, fishYpx) + marginY;

    const cropW = cropX2 - cropX1;
    const cropH = cropY2 - cropY1;

    const photo = document.createElement('canvas');
    photo.width  = 360;
    photo.height = Math.max(1, Math.round(360 * cropH / cropW));
    const pctx = photo.getContext('2d');

    const zoom = photo.width / cropW;
    pctx.save();
    pctx.scale(zoom, zoom);
    pctx.translate(-cropX1, -cropY1);

    this.#sceneRenderer.drawBg(pctx, bigW, bigH, 0);
    this.#drawTargetBands(pctx, CONFIG.TARGET_X_START * bigW, CONFIG.TARGET_X_END * bigW, centerYpx, playH);

    const avatarH = CONFIG.AVATAR_SIZE_MIN * bigH +
      (CONFIG.AVATAR_SIZE_MAX - CONFIG.AVATAR_SIZE_MIN) * bigH * 0.5;
    this.#sceneRenderer.drawAvatar(pctx, fishXRatio * bigW, normToScreenY(fishNormY), avatarH, 0);

    pctx.restore();
    return photo;
  }

  // A playful polaroid: blank, then "develops" into the captured photo over
  // PHOTO_DEVELOP_MS. The photo itself is captured once per photo review and
  // cached (keyed by photoKey) rather than re-rendered every frame.
  #drawPhotoReview(ctx, w, h, data) {
    const { photoKey, bestFishXRatio, bestFishNormY, targetNormY, photoElapsedMs = 0 } = data;

    if (this.#cachedPhotoKey !== photoKey) {
      this.#cachedPhotoCanvas = this.#capturePhoto(w, h, bestFishXRatio, bestFishNormY, targetNormY);
      this.#cachedPhotoKey = photoKey;
    }
    const photo = this.#cachedPhotoCanvas;

    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, w, h);

    this.#drawCenter(ctx, w, h * 0.13, "Here's how you did!", 'rgba(255,255,255,0.92)', 28, '400');

    const frameW   = Math.min(w * 0.46, 420);
    const border   = 14;
    const captionH = 46;
    const innerW   = frameW - border * 2;
    const innerH   = innerW * (photo.height / photo.width);
    const frameH   = innerH + border * 2 + captionH;

    const fx = w / 2 - frameW / 2;
    const fy = h / 2 - frameH / 2 + h * 0.03;

    ctx.save();
    ctx.translate(w / 2, fy + frameH / 2);
    ctx.rotate(-0.035);
    ctx.translate(-w / 2, -(fy + frameH / 2));

    // card
    ctx.save();
    ctx.shadowColor   = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur    = 18;
    ctx.shadowOffsetY = 8;
    ctx.fillStyle = '#fbfbf6';
    ctx.beginPath();
    ctx.roundRect(fx, fy, frameW, frameH, 6);
    ctx.fill();
    ctx.restore();

    // photo area — blank, then develops in
    const px = fx + border, py = fy + border;
    const developT = clamp(photoElapsedMs / CONFIG.PHOTO_DEVELOP_MS, 0, 1);
    const reveal = easeOut(developT);

    ctx.save();
    ctx.beginPath();
    ctx.rect(px, py, innerW, innerH);
    ctx.clip();

    ctx.fillStyle = '#cfcac0';
    ctx.fillRect(px, py, innerW, innerH);

    if (reveal > 0) {
      ctx.globalAlpha = reveal;
      ctx.drawImage(photo, px, py, innerW, innerH);
      ctx.globalAlpha = 1;
      // a fading chemical-development wash for a photo-booth feel
      ctx.fillStyle = `rgba(90,70,40,${0.35 * (1 - reveal)})`;
      ctx.fillRect(px, py, innerW, innerH);
    }
    ctx.restore();

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

  // Driven by the live breath signal (fishNormY/avatarTilt), exactly like
  // gameplay — lets the child see the fish respond to their own breathing
  // before the trial actually starts.
  #drawReady(ctx, w, h, { fishNormY = 0.5, avatarTilt = 0 }) {
    const topPad        = h * 0.10;
    const playH         = h * 0.80;
    const avatarScreenX = w / 2;
    const avatarScreenY = topPad + (1 - fishNormY) * playH;
    const avatarH = CONFIG.AVATAR_SIZE_MIN * h + (CONFIG.AVATAR_SIZE_MAX - CONFIG.AVATAR_SIZE_MIN) * h * 0.5;
    this.#sceneRenderer.drawAvatar(ctx, avatarScreenX, avatarScreenY, avatarH * 1.3, avatarTilt);
    this.#drawCenter(ctx, w, h * 0.85, 'See how your breath moves the fish!', 'rgba(255,255,255,0.75)', 20);
  }

  // The same "three fish bopping happily" animation ibreath shows before each
  // trial (see ibreath/animationDisplay.js), plus a simple 3-2-1-GO overlay.
  #drawCountdown(ctx, w, h, now, value, progress) {
    drawDisplay(ctx, w, h, now / 1000, this.#images);

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
