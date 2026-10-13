/**
 * baselineGame.js — Baseline Game
 * ================================
 * Placeholder frontend — scaffolding only, no game design yet. Implements
 * the standard frontend interface and a minimal IDLE -> PLAYING -> DONE
 * state machine (Start / Abort) so it's launchable and wired into the app;
 * fill in the actual game here.
 *
 * State machine: IDLE -> PLAYING -> DONE
 */

import { MarkerStream } from '../stream/markerStream.js';
import { CONFIG, STATE } from './baselineGame_config.js';

export default class BaselineGame {
  #state       = STATE.IDLE;
  #streamReady = false;
  #startTime   = null;

  #canvas  = null;
  #ctx     = null;
  #markers = null;

  constructor({ sceneContainer }) {
    sceneContainer.innerHTML = '<canvas id="bgg-canvas"></canvas>';
    this.#canvas = sceneContainer.querySelector('#bgg-canvas');
    this.#ctx    = this.#canvas.getContext('2d');

    this.#markers = CONFIG.SEND_MARKERS
      ? new MarkerStream(CONFIG.MARKER_STREAM_URL)
      : { send() {} };

    window.api.frontend.onAction((action) => this.#onAction(action));

    requestAnimationFrame((t) => this.#rafLoop(t));
  }

  // ── Frontend interface ─────────────────────────────────────────────────────

  pushSample(_value) {
    // TODO: wire the live signal into the game once designed.
  }

  setStatus({ type, text }) {
    if (this.#state !== STATE.IDLE) return;
    this.#streamReady = type === 'connected';
    this.#pushState({
      stateText:    this.#streamReady ? 'stream ready' : (text ?? 'no stream'),
      startEnabled: this.#streamReady,
    });
  }

  // ── Action handler ────────────────────────────────────────────────────────

  #onAction({ type }) {
    switch (type) {
      case 'start':
        if (this.#state === STATE.IDLE && this.#streamReady) this.#begin();
        break;
      case 'abort':
        if (this.#state === STATE.PLAYING) this.#finish(true);
        break;
      case 'ready':
        this.#pushState();
        break;
    }
  }

  // ── State transitions ─────────────────────────────────────────────────────

  #begin() {
    this.#startTime = performance.now();
    this.#state     = STATE.PLAYING;
    this.#markers.send('baselineGame_start');
    this.#pushState({
      stateText:    'playing',
      startEnabled: false,
      abortVisible: true,
    });
  }

  #finish(aborted = false) {
    this.#state = STATE.DONE;
    this.#markers.send(aborted ? 'baselineGame_abort' : 'baselineGame_end');
    this.#pushState({ stateText: aborted ? 'aborted' : 'done', abortVisible: false });
  }

  // ── Render loop ───────────────────────────────────────────────────────────

  #rafLoop(now) {
    try { this.#draw(now); } catch (e) { console.error('[BaselineGame] draw error:', e); }
    requestAnimationFrame((t) => this.#rafLoop(t));
  }

  #draw(now) {
    const canvas  = this.#canvas;
    canvas.width  = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    const ctx = this.#ctx;
    const w = canvas.width, h = canvas.height;

    ctx.fillStyle = '#0f0f0f';
    ctx.fillRect(0, 0, w, h);
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.font         = '200 24px Nunito, sans-serif';
    ctx.fillStyle    = 'rgba(255,255,255,0.3)';

    if (this.#state === STATE.IDLE) {
      ctx.fillText('Baseline Game — coming soon', w / 2, h / 2);
    } else if (this.#state === STATE.PLAYING) {
      const elapsed = ((now - this.#startTime) / 1000).toFixed(0);
      ctx.fillText(`Playing… ${elapsed}s`, w / 2, h / 2);
    } else if (this.#state === STATE.DONE) {
      ctx.fillText('Done', w / 2, h / 2);
    }
  }

  // ── Experimenter state push ───────────────────────────────────────────────

  #pushState(overrides = {}) {
    window.api.frontend.sendState({
      stateText:    this.#state,
      startEnabled: this.#state === STATE.IDLE && this.#streamReady,
      abortVisible: false,
      ...overrides,
    });
  }
}
