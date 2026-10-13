// SceneRenderer — the scene-definition-driven drawing primitives shared by
// bioGame and any other frontend that reuses its "ocean"/"jungle" visuals:
// the tiling procedural background texture and the avatar sprite. Nothing
// here depends on any particular game's state (score, items, stress, etc.)
// — callers compute their own screen position/size/rotation and pass them in.
//
// Used by BioGameRenderer (modules/bioGame/bioGame_renderer.js) and
// BeltTrainingGameRenderer (modules/beltTrainingGame/beltTrainingGame_renderer.js)
// so changes to the shared visuals apply to both.

// Offscreen tiling-texture size — a pure rendering-implementation detail of
// this shared renderer, not a per-consumer game setting, so it's kept local
// here rather than pulled from any one consumer's CONFIG.
const BG_TEX_WIDTH  = 2048;
const BG_TEX_HEIGHT = 512;

export class SceneRenderer {
  #scene = null;

  // Avatar image
  #avatarImg       = null;
  #avatarImgLoaded = false;
  #avatarAspect    = 1;

  // Seamless background texture (pre-rendered offscreen canvas)
  #bgTex = null;

  constructor(scene) {
    this.#scene = scene;
    this.#loadAvatarImg();
    this.#buildBgTex();
  }

  // Switches the active scene (avatar sprite + background texture).
  // Safe to call repeatedly.
  setScene(scene) {
    this.#scene = scene;
    this.#loadAvatarImg();
    this.#buildBgTex();
  }

  // Primes the canvas's shadow-rendering path so the first real frame that
  // uses shadowBlur (e.g. collectible glow) doesn't stutter. Call once,
  // right after construction, with the real drawing context.
  warmUpShadow(ctx) {
    ctx.save();
    ctx.fillStyle = '#fff';
    for (const blur of [6, 8]) {
      ctx.shadowBlur  = blur;
      ctx.shadowColor = '#fff';
      ctx.beginPath();
      ctx.arc(-1000, -1000, 1, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // ── Background ────────────────────────────────────────────────────────────

  drawBg(ctx, w, h, scrollX) {
    if (!this.#bgTex) {
      ctx.fillStyle = '#0a2a4a';
      ctx.fillRect(0, 0, w, h);
      return;
    }
    const tex = this.#bgTex;
    const scaleH = h / tex.height;
    const tw = tex.width * scaleH;
    const ox = -(scrollX * w) % tw;
    ctx.drawImage(tex, ox,      0, tw, h);
    ctx.drawImage(tex, ox + tw, 0, tw, h);
  }

  #buildBgTex() {
    const tw  = BG_TEX_WIDTH;
    const th  = BG_TEX_HEIGHT;
    const c   = document.createElement('canvas');
    c.width   = tw;
    c.height  = th;
    const ctx = c.getContext('2d');
    const bg  = this.#scene.bg;

    // Base gradient
    const grad = ctx.createLinearGradient(0, 0, 0, th);
    grad.addColorStop(0,    bg.gradTop);
    grad.addColorStop(0.45, bg.gradMid);
    grad.addColorStop(1,    bg.gradBot);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, tw, th);

    const rng = (() => {
      let s = 42;
      return () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 0xffffffff; };
    })();

    if (this.#scene.id === 'jungle') {
      this.#buildJungleTex(ctx, tw, th, bg, rng);
    } else {
      this.#buildOceanTex(ctx, tw, th, bg, rng);
    }

    this.#bgTex = c;
  }

  #buildOceanTex(ctx, tw, th, bg, rng) {
    for (let i = 0; i < 70; i++) {
      const bx    = rng() * tw;
      const by    = rng() * th;
      const rx    = 25 + rng() * 130;
      const ry    = 15 + rng() * 70;
      const alpha = 0.025 + rng() * 0.055;

      for (const mx of [bx, bx - tw]) {
        const g = ctx.createRadialGradient(mx, by, 0, mx, by, Math.max(rx, ry));
        g.addColorStop(0, `rgba(${bg.blobR},${bg.blobG},${bg.blobB},${alpha})`);
        g.addColorStop(1, `rgba(${bg.blobR},${bg.blobG},${bg.blobB},0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(mx, by, rx, ry, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  #buildJungleTex(ctx, tw, th, bg, rng) {
    // Ground strip
    const grd = ctx.createLinearGradient(0, th * 0.72, 0, th);
    grd.addColorStop(0, 'rgba(0,0,0,0)');
    grd.addColorStop(1, 'rgba(0,12,0,0.55)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, tw, th);

    // Subtle light patches (filtered sunlight through canopy)
    for (let i = 0; i < 18; i++) {
      const bx = rng() * tw;
      const by = rng() * th * 0.85;
      const r  = 22 + rng() * 55;
      const alpha = 0.03 + rng() * 0.035;
      for (const mx of [bx, bx - tw]) {
        const g = ctx.createRadialGradient(mx, by, 0, mx, by, r);
        g.addColorStop(0, `rgba(150,230,70,${alpha})`);
        g.addColorStop(1, 'rgba(150,230,70,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(mx, by, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Tree silhouettes
    for (let i = 0; i < 12; i++) {
      const bx      = rng() * tw;
      const groundY = th * (0.72 + rng() * 0.22);
      const trunkW  = 10 + rng() * 14;
      const trunkH  = 70 + rng() * 110;
      const canopyR = 42 + rng() * 55;

      for (const mx of [bx, bx - tw]) {
        // Trunk
        ctx.fillStyle = 'rgba(6,14,5,0.92)';
        ctx.fillRect(mx - trunkW / 2, groundY - trunkH, trunkW, trunkH);

        // Canopy — 3 overlapping circles
        for (let ci = 0; ci < 3; ci++) {
          const cx2 = mx + (rng() - 0.5) * canopyR * 0.7;
          const cy2 = groundY - trunkH + (rng() - 0.6) * canopyR * 0.5;
          const cr  = canopyR * (0.65 + rng() * 0.55);
          ctx.fillStyle = `rgba(8,20,7,${0.82 + rng() * 0.14})`;
          ctx.beginPath();
          ctx.arc(cx2, cy2, cr, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  // ── Avatar ────────────────────────────────────────────────────────────────

  #loadAvatarImg() {
    const img = new Image();
    img.onload = () => {
      this.#avatarImg       = img;
      this.#avatarImgLoaded = true;
      this.#avatarAspect    = img.naturalWidth / img.naturalHeight;
    };
    img.src = this.#scene.avatarSrc;
  }

  drawAvatar(ctx, screenX, screenY, heightPx, tilt = 0) {
    const w = heightPx * this.#avatarAspect;
    const h = heightPx;
    ctx.save();
    ctx.translate(screenX, screenY);
    ctx.rotate(tilt);
    if (this.#avatarImgLoaded) {
      ctx.drawImage(this.#avatarImg, -w / 2, -h / 2, w, h);
    } else {
      ctx.fillStyle = 'rgba(255,220,120,0.85)';
      ctx.beginPath();
      ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
