/**
 * bioGame.js — Biofeedback breath-control game
 * =============================================
 * State machine:  IDLE → CALIBRATING → READY → COUNTDOWN → PLAYING
 *                                                 ↑              ↓
 *                                          INTERMISSION ← (block end / abort,
 *                                                 ↓        unless last block)
 *                                           COUNTDOWN → PLAYING → DONE
 *
 * Abort only ends the running block; the session continues with the next
 * one (or ends, if it was the last block).
 *
 * Gameplay runs on a fixed-step simulation clock (CONFIG.SIM_FPS): block
 * time is frameIndex / SIM_FPS, items, curve, markers and block end all use
 * it, and every step writes one frame-data row. Steps are caught up to the
 * wall clock from both the rAF loop and the 100 ms tick, so the game stays
 * in sync with real time even if rendering stalls or drops frames.
 *
 * Implements the standard frontend interface:
 *   pushSample(value: number) → void
 *   setStatus({ type, text })  → void
 */

import { GaussianSmoother } from '../signal/signalUtils.js';
import { RespCalibration, AdaptiveRange } from '../calibration/calibration.js';
import { MarkerStream }     from '../stream/markerStream.js';
import { CONFIG, STATE }    from './bioGame_config.js';
import { BioGameRenderer }  from './bioGame_renderer.js';
import { BioGameCSV }       from './bioGame_csv.js';
import { BioGameSound }     from './bioGame_sound.js';
import { resolveScene }     from './bioGame_scene.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function lerp(a, b, t)    { return a + (b - a) * t; }
function randBetween(lo, hi) { return lo + Math.random() * (hi - lo); }

function targetCurveY(t, bpm) {
  return 0.5 + 0.45 * Math.sin(2 * Math.PI * (t / (60 / bpm)));
}

// ── BioGame ───────────────────────────────────────────────────────────────────

export default class BioGame {
  // ── Scene ─────────────────────────────────────────────────────────────────
  #scene = null;

  // ── State ─────────────────────────────────────────────────────────────────
  #state        = STATE.IDLE;
  #streamReady  = false;
  #inputsLocked = false;
  #stateText    = 'waiting for stream…';   // last status line sent to the experimenter
  #warning      = null;                    // persistent experimenter warning (frame drops)

  // ── Particles + avatar bump ───────────────────────────────────────────────
  #particles    = [];
  #avatarBumpT  = null;

  // ── Experiment settings (overridden by experimenter on start) ─────────────
  #subjectCode      = CONFIG.SUBJECT_CODE;
  #group            = CONFIG.GROUP;
  #sceneId          = CONFIG.SCENE;
  #naturalBpm       = CONFIG.NATURAL_BPM;
  #showCurve        = CONFIG.SHOW_CURVE;
  #calibrationSecs  = CONFIG.CALIBRATION_SECS;

  // ── Block management ──────────────────────────────────────────────────────
  #blockIndex       = 0;
  #blockStartTime   = null;   // performance.now() at block start — anchors the sim clock
  #scoreBlock       = new Array(CONFIG.NUM_BLOCKS).fill(0);

  // ── Fixed-step simulation ─────────────────────────────────────────────────
  #simFrame = 0;   // steps simulated in the current block
  static #STEP = 1 / CONFIG.SIM_FPS;   // seconds per step

  // Previous step's values, for render interpolation (items and particles
  // carry their own px/py). See #buildRenderData.
  #prevAvatarTilt = 0;
  #prevBgScrollX  = 0;

  // ── Dropped-frame detection ───────────────────────────────────────────────
  #lastFrameRow    = null;   // newest frame row — marked `drawn` when rendered
  #dropWinStart    = 0;      // start (performance.now) of the current 1 s window
  #dropWinFrame    = 0;      // #simFrame at window start
  #dropWinRendered = 0;      // frames rendered in this window
  #dropLowWindows  = 0;      // consecutive windows below FRAME_DROP_WARN_RATIO

  // ── Trial markers ─────────────────────────────────────────────────────────
  #trialIndex    = 0;
  #nextTrialTime = null;

  // ── Curve cues (sound at each target curve peak / minimum) ────────────────
  #nextCueTime = null;

  // ── Signal processing ─────────────────────────────────────────────────────
  #smoother         = new GaussianSmoother(CONFIG.SMOOTH_WINDOW);
  #lastRaw          = 0;
  #calibration      = null;
  #calFailed        = false;
  #normRange        = [0, 1];
  #rangeTracker     = null;   // AdaptiveRange — follows drift after calibration (RANGE_ADAPT)

  // ── Avatar state ──────────────────────────────────────────────────────────
  #avatarNormY     = 0.5;
  #prevAvatarNormY = 0.5;
  #avatarTilt      = 0;

  // ── Stress mechanic ───────────────────────────────────────────────────────
  #avatarStressNorm = CONFIG.AVATAR_STRESS_INIT;
  #speedNorm        = CONFIG.SCROLL_SPEED_INIT;

  // ── Items ─────────────────────────────────────────────────────────────────
  #items         = [];
  #nextSpawnTime = 0;   // block time (s) of the next spawn

  // ── Countdown ────────────────────────────────────────────────────────────
  #countdownStartTime = null;

  // ── Background scroll ────────────────────────────────────────────────────
  #bgScrollX = 0;

  // ── Data / frame recording ───────────────────────────────────────────────
  #csv             = null;

  // ── Timing ────────────────────────────────────────────────────────────────
  #lastRafTime = null;

  // ── Sub-modules ───────────────────────────────────────────────────────────
  #markers  = null;
  #renderer = null;
  #sound    = null;

  // ── Derived ───────────────────────────────────────────────────────────────

  get #activeBpm() {
    return this.#group === 'slow' ? CONFIG.SLOW_BPM : this.#naturalBpm;
  }

  get #scrollSpeed() {
    return lerp(CONFIG.SCROLL_SPEED_MIN, CONFIG.SCROLL_SPEED_MAX, this.#speedNorm);
  }

  // Avatar's current height, as a fraction of canvas height (matches the
  // renderer's baseH calculation) — the hitbox scales with this so it tracks
  // the avatar's on-screen size as it grows/shrinks via the stress mechanic.
  get #avatarHeightNorm() {
    return lerp(CONFIG.AVATAR_STRESS_SIZE_MIN, CONFIG.AVATAR_STRESS_SIZE_MAX, this.#avatarStressNorm);
  }

  get #hitRadius() {
    return this.#avatarHeightNorm * CONFIG.HITBOX_SCALE;
  }

  constructor({ sceneContainer }) {
    // Placeholder scene shown before the experimenter picks one at Start;
    // #beginCalibration() re-resolves it from #sceneId and applies it for real.
    this.#scene   = resolveScene(this.#sceneId);
    this.#renderer = new BioGameRenderer(sceneContainer, this.#scene);

    this.#sound = new BioGameSound();
    this.#sound.init().catch(e => console.warn('[BioGame] sound init failed:', e));

    this.#markers = CONFIG.SEND_MARKERS
      ? new MarkerStream(CONFIG.MARKER_STREAM_URL)
      : { send() {} };

    window.api.frontend.onAction((action) => this.#onAction(action));
    window.addEventListener('pagehide', () => this.#onWindowClose());

    setInterval(() => this.#tick(), 100);
    requestAnimationFrame((t) => this.#rafLoop(t));
  }

  // ── Public interface ──────────────────────────────────────────────────────

  pushSample(rawValue) {
    this.#lastRaw = rawValue;
    this.#smoother.push(rawValue);
    this.#rangeTracker?.push(performance.now(), this.#smoother.value);

    if (this.#state === STATE.CALIBRATING) {
      this.#calibration.push(this.#smoother.value);
    }
  }

  setStatus({ type, text }) {
    this.#streamReady = (type === 'connected');
    if (this.#state === STATE.IDLE) {
      this.#pushState({
        stateText:    this.#streamReady ? 'stream ready' : (text ?? 'no stream'),
        startEnabled: this.#streamReady,
      });
    }
  }

  // ── Action handler ────────────────────────────────────────────────────────

  #onAction({ type, subjectCode, group, scene, naturalBpm, showCurve, calibrationSecs }) {
    switch (type) {
      case 'start':
        if (subjectCode     !== undefined) this.#subjectCode     = subjectCode;
        if (group           !== undefined) this.#group           = group;
        if (scene           !== undefined) this.#sceneId         = scene;
        if (naturalBpm      !== undefined) this.#naturalBpm      = naturalBpm;
        if (showCurve       !== undefined) this.#showCurve       = showCurve;
        if (calibrationSecs !== undefined) this.#calibrationSecs = calibrationSecs;
        if (this.#state === STATE.IDLE && this.#streamReady) this.#beginCalibration();
        break;

      case 'next':
        if (this.#state === STATE.INTERMISSION || this.#state === STATE.READY)
          this.#startCountdown();
        break;

      case 'abort':
        if (this.#state === STATE.PLAYING) this.#endBlock(true);
        break;

      case 'retryCalibration':
        if (this.#state === STATE.CALIBRATING && this.#calFailed) this.#retryCalibration();
        break;

      case 'useDefaultCalibration':
        if (this.#state === STATE.CALIBRATING && this.#calFailed) this.#useDefaultCalibration();
        break;

      case 'ready':
        this.#pushState();
        break;
    }
  }

  // ── State machine ─────────────────────────────────────────────────────────

  #beginCalibration() {
    this.#scene = resolveScene(this.#sceneId);
    this.#renderer.setScene(this.#scene);
    this.#sound.loadScene(this.#scene.sounds)
      .catch(e => console.warn('[BioGame] scene sound load failed:', e));

    this.#calibration = new RespCalibration({ durationSecs: this.#calibrationSecs });
    this.#calibration.start();
    this.#calFailed = false;
    // Collects from calibration on, so its window is already full once seeded.
    this.#rangeTracker = CONFIG.RANGE_ADAPT
      ? new AdaptiveRange({
          windowSecs:       CONFIG.RANGE_WINDOW_SECS,
          timeConstantSecs: CONFIG.RANGE_TIME_CONSTANT_SECS,
          minSpanFraction:  CONFIG.RANGE_MIN_SPAN_FRACTION,
        })
      : null;
    this.#smoother.reset();
    this.#inputsLocked = true;
    this.#blockIndex   = 0;
    this.#scoreBlock   = new Array(CONFIG.NUM_BLOCKS).fill(0);
    this.#trialIndex   = 0;

    this.#csv = new BioGameCSV(
      this.#subjectCode, this.#group, this.#scene.id,
      (msg) => this.#csvWarn(msg)
    );
    this.#csv.init();

    this.#state = STATE.CALIBRATING;
    this.#markers.send('calibration_start');
    this.#pushState({ stateText: 'calibrating…', abortVisible: false, inputsLocked: true });
  }

  #finishCalibration() {
    this.#markers.send('calibration_end');
    const result = this.#calibration.finish();

    if (!result) {
      console.warn('[BioGame] calibration produced no usable range (no samples, or flat signal)');
      this.#markers.send('calibration_failed');
      this.#calFailed = true;
      this.#pushState({
        stateText: '⚠ calibration failed — no signal or flat signal',
        calFailed: true,
      });
      return;
    }

    this.#completeCalibration([result.min, result.max]);
  }

  #completeCalibration(range, { fromData = true } = {}) {
    this.#normRange = [...range];
    this.#rangeTracker?.seed(range, { fromData });
    console.log(`[BioGame] norm range: [${range[0].toFixed(3)}, ${range[1].toFixed(3)}]`);

    this.#state = STATE.READY;
    this.#pushState({ stateText: 'ready — press Space or Start', nextVisible: true, calFailed: false });
  }

  #retryCalibration() {
    this.#calibration.start();
    this.#calFailed = false;
    this.#markers.send('calibration_start');
    this.#pushState({ stateText: 'calibrating…', calFailed: false });
  }

  #useDefaultCalibration() {
    this.#markers.send('calibration_default_used');
    this.#completeCalibration(CONFIG.DEFAULT_CAL_RANGE, { fromData: false });
  }

  #startCountdown() {
    this.#countdownStartTime = performance.now();
    this.#state = STATE.COUNTDOWN;
    this.#markers.send(`countdown_start_block${this.#blockIndex}`);
    this.#pushState({ stateText: 'starting…', nextVisible: false });
  }

  #startBlock() {
    this.#blockStartTime  = performance.now();
    this.#simFrame        = 0;
    this.#items           = [];
    this.#particles       = [];
    this.#nextSpawnTime   = randBetween(CONFIG.ITEM_SPAWN_MIN_MS, CONFIG.ITEM_SPAWN_MAX_MS) / 1000;
    this.#avatarStressNorm = CONFIG.AVATAR_STRESS_INIT;
    this.#speedNorm        = CONFIG.SCROLL_SPEED_INIT;
    this.#prevAvatarTilt   = this.#avatarTilt;
    this.#prevBgScrollX    = this.#bgScrollX;

    this.#lastFrameRow   = null;
    this.#dropWinStart   = this.#blockStartTime;
    this.#dropWinFrame   = 0;
    this.#dropWinRendered = 0;
    this.#dropLowWindows = 0;
    this.#warning        = null;   // a previous game's frame-drop warning

    this.#csv.initBlockCSV(this.#blockIndex);
    this.#nextTrialTime = (60 / this.#activeBpm) * 0.75;
    this.#nextCueTime   = (60 / this.#activeBpm) * 0.25;   // first peak

    this.#sound.startBlock();
    this.#state = STATE.PLAYING;
    this.#markers.send(`block_start_${this.#blockIndex}`);
    this.#pushState({
      stateText:   `game ${this.#blockIndex + 1} / ${CONFIG.NUM_BLOCKS}`,
      abortVisible: true,
    });
  }

  #endBlock(aborted = false) {
    this.#sound.stopBlock();
    this.#csv.flushFrames(this.#blockIndex);
    this.#markers.send(aborted
      ? `block_abort_${this.#blockIndex}`
      : `block_end_${this.#blockIndex}`);
    this.#csv.appendEvent(this.#blockIndex, aborted ? 'block_abort' : 'block_end',
      this.#scoreBlock[this.#blockIndex]);

    // An aborted block only ends that block — the session goes on.
    if (this.#blockIndex >= CONFIG.NUM_BLOCKS - 1) {
      this.#endExperiment();
      return;
    }

    const finished = this.#blockIndex;
    this.#blockIndex++;
    this.#state = STATE.INTERMISSION;
    this.#pushState({
      stateText:    `intermission${aborted ? ` — game ${finished + 1} aborted` : ''}`,
      score:        this.#scoreBlock[finished],
      abortVisible: false,
      nextVisible:  true,
    });
  }

  // Closing the window is how a session is ended early: write the buffered
  // frame rows and a 'session_closed' event (value1 = state it was closed
  // in, value2 = game time if playing) synchronously — an async write might
  // never arrive.
  #onWindowClose() {
    if (!this.#csv || this.#state === STATE.DONE) return;   // no session running
    const playing = this.#state === STATE.PLAYING;
    this.#csv.flushFramesSync(this.#blockIndex);
    this.#csv.appendEventSync(this.#blockIndex, 'session_closed', this.#state,
      playing ? this.#blockTime.toFixed(2) : '');
    this.#markers.send('session_closed');   // best effort — the socket may already be gone
  }

  #endExperiment() {
    this.#state = STATE.DONE;
    this.#markers.send('experiment_done');
    const total = this.#scoreBlock.reduce((a, b) => a + b, 0);
    this.#pushState({ stateText: 'done', abortVisible: false, nextVisible: false, score: total });
    // All final writes were dispatched by #endBlock → experimenter may go back to the menu.
    window.api.session.ended();
  }

  // ── Update loop ───────────────────────────────────────────────────────────

  #tick() {
    const now = performance.now();

    if (this.#state === STATE.CALIBRATING && !this.#calFailed) {
      if (this.#calibration.isDone) {
        this.#finishCalibration();
      }
    }

    if (this.#state === STATE.COUNTDOWN) {
      if ((now - this.#countdownStartTime) / 1000 >= CONFIG.COUNTDOWN_SECS) {
        this.#startBlock();
      }
    }

    // Keeps the simulation (and block end) on time even while rAF stalls.
    this.#advanceSim(now);
    this.#checkFrameDrops(now);
  }

  // ── Dropped-frame detection ───────────────────────────────────────────────
  //
  // Every second, compares the frames rendered with the steps simulated
  // (capped at 1 — a faster display is fine). If it stays below
  // FRAME_DROP_WARN_RATIO for FRAME_DROP_WARN_SECS seconds in a row, the
  // experimenter gets a warning and eventData.csv a 'frame_drop_warning'
  // event; recovery logs 'frame_drop_recovered'. The warning stays visible
  // until the next game starts. (Frame counts rather than the per-step
  // `drawn` flags: with display rate ≈ SIM_FPS, timing jitter near a step
  // boundary occasionally skips a step without rendering being slow.)

  #checkFrameDrops(now) {
    if (this.#state !== STATE.PLAYING || now - this.#dropWinStart < 1000) return;
    const steps = this.#simFrame - this.#dropWinFrame;
    const ratio = steps > 0 ? Math.min(1, this.#dropWinRendered / steps) : 1;
    this.#dropWinStart    = now;
    this.#dropWinFrame    = this.#simFrame;
    this.#dropWinRendered = 0;

    const wasLow = this.#dropLowWindows >= CONFIG.FRAME_DROP_WARN_SECS;
    this.#dropLowWindows = ratio < CONFIG.FRAME_DROP_WARN_RATIO ? this.#dropLowWindows + 1 : 0;
    const isLow = this.#dropLowWindows >= CONFIG.FRAME_DROP_WARN_SECS;
    const pct = Math.round(ratio * 100);

    if (isLow) {
      if (!wasLow) {
        this.#csv.appendEvent(this.#blockIndex, 'frame_drop_warning', ratio.toFixed(2), this.#blockTime.toFixed(2));
        console.warn(`[BioGame] display dropping frames: rendering at ${pct}% of ${CONFIG.SIM_FPS} fps`);
      }
      this.#warning = `⚠ display dropping frames — rendering at ${pct}% of ${CONFIG.SIM_FPS} fps (game ${this.#blockIndex + 1})`;
      this.#pushState();
    } else if (wasLow) {
      this.#csv.appendEvent(this.#blockIndex, 'frame_drop_recovered', ratio.toFixed(2), this.#blockTime.toFixed(2));
      this.#warning = `⚠ display dropped frames earlier in game ${this.#blockIndex + 1} (see eventData.csv)`;
      this.#pushState();
    }
  }

  // ── Fixed-step simulation ─────────────────────────────────────────────────

  get #blockTime() {
    return this.#simFrame * BioGame.#STEP;
  }

  // Runs every step that is due by `now`, so sim time never lags real time
  // by more than one step. Steps are cheap, so even a long stall is fully
  // caught up in one go (those rows share a timestamp in the frame CSV).
  #advanceSim(now) {
    if (this.#state !== STATE.PLAYING) return;
    const due = Math.floor((now - this.#blockStartTime) / 1000 / BioGame.#STEP);
    if (this.#simFrame >= due) return;
    while (this.#simFrame < due && this.#state === STATE.PLAYING) {
      this.#simFrame++;
      this.#stepSim();
    }
    this.#sound.setNoiseLevel(this.#avatarNormY);
  }

  #stepSim() {
    const dt = BioGame.#STEP;
    const t  = this.#blockTime;
    // Keep this step's starting values for render interpolation.
    // (#updateSignal keeps #prevAvatarNormY itself.)
    this.#prevAvatarTilt = this.#avatarTilt;
    this.#prevBgScrollX  = this.#bgScrollX;
    for (const it of this.#items)     { it.px = it.xRatio; it.py = it.normY; }
    for (const p  of this.#particles) { p.px  = p.x;       p.py  = p.y; }

    this.#updateSignal(dt);
    this.#bgScrollX += this.#scrollSpeed * CONFIG.BG_SCROLL_FACTOR * dt;
    this.#updateItems(t, dt);
    this.#updateParticles(dt);
    this.#updateAvatarBump(dt);
    this.#checkTrialMarker(t);
    this.#checkCurveCue(t);
    this.#recordFrame(t);
    // Compare frame counts, not float seconds, so a block is exactly
    // BLOCK_DURATION_SECS × SIM_FPS steps long.
    if (this.#simFrame >= Math.round(CONFIG.BLOCK_DURATION_SECS * CONFIG.SIM_FPS)) this.#endBlock(false);
  }

  // ── RAF loop ──────────────────────────────────────────────────────────────

  #rafLoop(now) {
    const dt = this.#lastRafTime != null ? clamp((now - this.#lastRafTime) / 1000, 0, 0.05) : 0;
    this.#lastRafTime = now;

    // Calibration preview: no sim, the avatar just follows the signal.
    if (this.#state === STATE.CALIBRATING) this.#updateSignal(dt);
    this.#advanceSim(now);

    if (this.#state === STATE.PLAYING) {
      this.#dropWinRendered++;
      // The newest step is (the target of) what this frame shows.
      if (this.#lastFrameRow) this.#lastFrameRow.drawn = true;
    }

    try {
      this.#renderer.draw(this.#buildRenderData(now));
    } catch (e) {
      console.error('[BioGame] draw error:', e);
    }

    requestAnimationFrame((t) => this.#rafLoop(t));
  }

  // ── Signal normalization ──────────────────────────────────────────────────

  #updateSignal(dt) {
    if (this.#state === STATE.PLAYING) {
      this.#normRange = this.#rangeTracker?.range ?? this.#normRange;
    }
    const [rMin, rMax] = this.#normRange;
    const range = rMax - rMin || 1e-6;
    const norm  = clamp((this.#smoother.value - rMin) / range, 0, 1);

    this.#prevAvatarNormY = this.#avatarNormY;
    this.#avatarNormY     = norm;

    const vel = dt > 0 ? (norm - this.#prevAvatarNormY) / dt : 0;
    const tgt = clamp(-vel * 1.8, -Math.PI / 6, Math.PI / 6);
    this.#avatarTilt = lerp(this.#avatarTilt, tgt, 1 - Math.exp(-dt / 0.18));
  }

  // ── Item spawning and movement ────────────────────────────────────────────

  #updateItems(blockTime, dt) {
    const bpm   = this.#activeBpm;
    const speed = this.#scrollSpeed;

    if (blockTime >= this.#nextSpawnTime) {
      const tOffAtRightEdge = (1.0 - CONFIG.AVATAR_X_RATIO) / speed;
      this.#items.push({
        xRatio:    1.0,
        normY:     targetCurveY(blockTime + tOffAtRightEdge, bpm),
        checked:   false,
        collected: false,
        missed:    false,
        collectT:  null,
        missT:     null,
      });
      this.#nextSpawnTime = blockTime + randBetween(CONFIG.ITEM_SPAWN_MIN_MS, CONFIG.ITEM_SPAWN_MAX_MS) / 1000;
    }

    for (const item of this.#items) {
      item.xRatio -= speed * dt;

      if (!item.checked) {
        const tOff = (item.xRatio - CONFIG.AVATAR_X_RATIO) / speed;
        item.normY = targetCurveY(blockTime + tOff, bpm);

        if (item.xRatio <= CONFIG.AVATAR_X_RATIO) {
          item.checked = true;
          if (Math.abs(item.normY - this.#avatarNormY) < this.#hitRadius) {
            this.#collectItem(item, blockTime);
          } else {
            this.#missItem(item, blockTime);
          }
        }
      }

      if (item.collected) item.collectT += dt;
      if (item.missed)    item.missT    += dt;
    }

    this.#items = this.#items.filter(s =>
      s.xRatio > -0.15 &&
      ((!s.collected && !s.missed) || (s.collectT ?? s.missT) < 0.65)
    );
  }

  #collectItem(item, blockTime) {
    item.collected = true;
    item.collectT  = 0;
    this.#scoreBlock[this.#blockIndex]++;
    this.#avatarStressNorm = clamp(this.#avatarStressNorm + CONFIG.STRESS_GROW_STEP,  0, 1);
    this.#speedNorm        = clamp(this.#speedNorm        + CONFIG.SPEED_GROW_STEP,   0, 1);
    this.#markers.send(`item_collect_b${this.#blockIndex}_s${this.#scoreBlock[this.#blockIndex]}`);
    this.#csv.appendEvent(this.#blockIndex, 'item_collect',
      this.#scoreBlock[this.#blockIndex], blockTime.toFixed(2));
    this.#burstParticles(item.xRatio, item.normY);
    this.#avatarBumpT = 0;
    this.#pushState({ score: this.#scoreBlock[this.#blockIndex] });
  }

  #missItem(item, blockTime) {
    item.missed = true;
    item.missT  = 0;
    this.#avatarStressNorm = clamp(this.#avatarStressNorm - CONFIG.STRESS_SHRINK_STEP, 0, 1);
    this.#speedNorm        = clamp(this.#speedNorm        - CONFIG.SPEED_SHRINK_STEP,  0, 1);
    this.#markers.send(`item_miss_b${this.#blockIndex}`);
    this.#csv.appendEvent(this.#blockIndex, 'item_miss', '', blockTime.toFixed(2));
  }

  // ── Particles ─────────────────────────────────────────────────────────────

  static #BURST_COLORS = ['#ffe066', '#ffb347', '#fffbe6', '#ffd700', '#ff9f43'];

  #burstParticles(xRatio, normY) {
    for (let i = 0; i < 18; i++) {
      const angle = (i / 18) * Math.PI * 2 + randBetween(-0.2, 0.2);
      const speed = randBetween(0.08, 0.22);
      this.#particles.push({
        x:     xRatio,
        y:     normY,
        vx:    Math.cos(angle) * speed,
        vy:    Math.sin(angle) * speed,
        life:  1,
        color: BioGame.#BURST_COLORS[Math.floor(Math.random() * BioGame.#BURST_COLORS.length)],
        r:     randBetween(0.003, 0.007),
      });
    }
  }

  #updateParticles(dt) {
    for (const p of this.#particles) {
      p.x    += p.vx * dt;
      p.y    += p.vy * dt;
      p.vy   -= 0.25 * dt;
      p.life -= dt * 2.2;
    }
    this.#particles = this.#particles.filter(p => p.life > 0);
  }

  #updateAvatarBump(dt) {
    if (this.#avatarBumpT === null) return;
    this.#avatarBumpT += dt;
    if (this.#avatarBumpT > 0.3) this.#avatarBumpT = null;
  }

  // ── Frame data recording ──────────────────────────────────────────────────

  // One row per simulation step (= game frame) at a fixed SIM_FPS. `drawn`
  // is set later by #rafLoop if a rendered frame showed this step as its
  // newest state.
  #recordFrame(blockTime) {
    this.#lastFrameRow = {
      t:         new Date().toISOString(),
      block:     this.#blockIndex,
      frame:     this.#simFrame,
      blockTime,
      drawn:     false,
      raw:       this.#lastRaw,
      smoothed:  this.#smoother.value,
      norm:      this.#avatarNormY,
      normMin:   this.#normRange[0],
      normMax:   this.#normRange[1],
      avatarY:   this.#avatarNormY,
      targetY:   targetCurveY(blockTime, this.#activeBpm),
      itemCount: this.#items.filter(s => !s.checked).length,
    };
    this.#csv.bufferFrame(this.#lastFrameRow);
  }

  // ── Render data builder ───────────────────────────────────────────────────
  //
  // Render interpolation: while playing, a drawn frame falls somewhere
  // between the last two simulation steps. Moving things are drawn blended
  // between those two steps by that fraction (`alpha`), and timers are
  // drawn `lag` seconds behind the newest step — so motion is smooth on any
  // refresh rate, at the cost of showing the game at most one step late.

  #interpolation(now) {
    if (this.#state !== STATE.PLAYING) return { alpha: 1, lag: 0 };
    const step  = BioGame.#STEP;
    const alpha = clamp(((now - this.#blockStartTime) / 1000 - this.#blockTime) / step, 0, 1);
    return { alpha, lag: (1 - alpha) * step };
  }

  #buildRenderData(now) {
    const { alpha, lag } = this.#interpolation(now);
    const blockTime = this.#blockStartTime != null ? Math.max(0, this.#blockTime - lag) : 0;
    const back = (timer) => timer != null ? Math.max(0, timer - lag) : timer;

    const items = alpha === 1 ? this.#items : this.#items.map(it => ({
      ...it,
      xRatio:   lerp(it.px ?? it.xRatio, it.xRatio, alpha),
      normY:    lerp(it.py ?? it.normY,  it.normY,  alpha),
      collectT: back(it.collectT),
      missT:    back(it.missT),
    }));
    const particles = alpha === 1 ? this.#particles : this.#particles.map(p => ({
      ...p,
      x: lerp(p.px ?? p.x, p.x, alpha),
      y: lerp(p.py ?? p.y, p.y, alpha),
    }));

    let countdownValue = 3, countdownProgress = 0;
    if (this.#countdownStartTime != null) {
      const cdE = (now - this.#countdownStartTime) / 1000;
      if      (cdE < 1) { countdownValue = 3; countdownProgress = cdE; }
      else if (cdE < 2) { countdownValue = 2; countdownProgress = cdE - 1; }
      else if (cdE < 3) { countdownValue = 1; countdownProgress = cdE - 2; }
      else              { countdownValue = 0; countdownProgress = (cdE - 3) / 0.75; }
    }

    return {
      state:             this.#state,
      now,
      bgScrollX:         lerp(this.#prevBgScrollX, this.#bgScrollX, alpha),
      blockTime,
      bpm:               this.#activeBpm,
      avatarNormY:       lerp(this.#prevAvatarNormY, this.#avatarNormY, alpha),
      avatarStressNorm:  this.#avatarStressNorm,
      avatarTilt:        lerp(this.#prevAvatarTilt, this.#avatarTilt, alpha),
      avatarBumpT:       back(this.#avatarBumpT),
      items,
      particles,
      score:             this.#scoreBlock[this.#blockIndex],
      blockIndex:        this.#blockIndex,
      scoreBlocks:       this.#scoreBlock,
      group:             this.#group,
      showCurve:         this.#showCurve,
      scrollSpeed:       this.#scrollSpeed,
      calProgress:       this.#calibration?.progress ?? 0,
      calRemaining:      Math.ceil(this.#calibration?.remainingSecs ?? this.#calibrationSecs),
      countdownValue,
      countdownProgress: clamp(countdownProgress, 0, 1),
    };
  }

  // ── Experimenter state push ───────────────────────────────────────────────

  // Every push is a full snapshot. Button visibility is derived from the
  // state, so a partial update (e.g. just the score) can't hide them; the
  // status line repeats the last one sent unless overridden.
  #pushState(overrides = {}) {
    if (overrides.stateText !== undefined) this.#stateText = overrides.stateText;
    window.api.frontend.sendState({
      score:        this.#scoreBlock[this.#blockIndex] ?? 0,
      startEnabled: this.#streamReady && this.#state === STATE.IDLE,
      startText:    'Start',
      nextText:     `Start game ${this.#blockIndex + 1}`,
      nextVisible:  this.#state === STATE.READY || this.#state === STATE.INTERMISSION,
      abortVisible: this.#state === STATE.PLAYING,
      calFailed:    this.#state === STATE.CALIBRATING && this.#calFailed,
      inputsLocked: this.#inputsLocked,
      warning:      this.#warning,
      ...overrides,
      stateText:    this.#stateText,
    });
  }

  // ── Trial marker ─────────────────────────────────────────────────────────

  #checkTrialMarker(blockTimeSecs) {
    if (this.#nextTrialTime === null) return;
    const period = 60 / this.#activeBpm;
    while (blockTimeSecs >= this.#nextTrialTime) {
      this.#markers.send(`trial_${++this.#trialIndex}`);
      this.#nextTrialTime += period;
    }
  }

  // ── Curve cue ────────────────────────────────────────────────────────────
  // Sound at every extremum of the target curve as it passes the avatar:
  // peaks at P/4 + kP, minima at 3P/4 + kP — i.e. every half period from P/4.

  #checkCurveCue(blockTimeSecs) {
    if (this.#nextCueTime === null) return;
    const halfPeriod = 60 / this.#activeBpm / 2;
    if (blockTimeSecs < this.#nextCueTime) return;
    // Skip any extrema missed while the window was throttled — one cue, not a burst.
    while (blockTimeSecs >= this.#nextCueTime) this.#nextCueTime += halfPeriod;
    this.#sound.playCurveCue();
  }

  // ── CSV error display ─────────────────────────────────────────────────────

  #csvWarn(msg) {
    console.error('[BioGame CSV]', msg);
    this.#pushState({ stateText: `⚠ CSV: ${msg}` });
  }
}
