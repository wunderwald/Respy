// storyScreen.js — draws a story (optional "stories" feature) before a trial.
//
// Adult reading layout: a dark rounded panel with the story as a left-aligned
// paragraph in a moderate font (CONFIG.STORY_FONT_U, much smaller than the
// child-sized explanation screens), word-wrapped. Line breaks in the story
// text start a new line. Very long stories shrink to fit the screen. With
// `hint` (wait-for-Space mode) a small line under the panel says how to go on.
//
// Sizes scale with the screen: 1 u = 1 % of the height on a 16:9 screen
// (narrower windows scale down by width) — as on the explanation screens.

import { CONFIG } from './config.js';

export function drawStory(ctx, w, h, text, { hint = '' } = {}) {
  if (!text) return;
  const u      = Math.min(h, w * 9 / 16) / 100;
  const maxW   = Math.min(w * 0.72, 125 * u);
  const padX   = 6 * u;
  const maxPanelH = h * (hint ? 0.82 : 0.9);

  const layout = (s) => {
    const size  = CONFIG.STORY_FONT_U * u * s;
    const lineH = size * 1.5;
    ctx.font = `600 ${size}px Nunito, sans-serif`;
    const rows = text.split(/\r?\n/).flatMap((para) => (para.trim() ? wrap(ctx, para.trim(), maxW) : ['']));
    const padY = 5 * u * s;
    return { size, lineH, rows, padY, panelH: rows.length * lineH + padY * 2 };
  };
  let L = layout(1);
  for (let i = 0; i < 4 && L.panelH > maxPanelH; i++) L = layout((L.size / (CONFIG.STORY_FONT_U * u)) * maxPanelH / L.panelH);

  const panelW = maxW + padX * 2;
  const px = (w - panelW) / 2;
  const py = (h - L.panelH) / 2 - (hint ? 2.5 * u : 0);

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(px, py, panelW, L.panelH, 3 * u);
  ctx.fillStyle = 'rgba(4, 16, 30, 0.78)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 0.25 * u;
  ctx.stroke();

  ctx.fillStyle    = '#ffffff';
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = `600 ${L.size}px Nunito, sans-serif`;
  let y = py + L.padY + L.lineH / 2;
  for (const row of L.rows) {
    ctx.fillText(row, px + padX, y);
    y += L.lineH;
  }

  if (hint) {
    ctx.textAlign = 'center';
    ctx.font = `400 ${2.6 * u}px Nunito, sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText(hint, w / 2, py + L.panelH + 5 * u);
  }
  ctx.restore();
}

// Greedy word wrap with the current ctx.font.
function wrap(ctx, text, maxW) {
  const rows = [];
  let row = '';
  for (const word of text.split(/\s+/)) {
    const candidate = row ? `${row} ${word}` : word;
    if (row && ctx.measureText(candidate).width > maxW) {
      rows.push(row);
      row = word;
    } else {
      row = candidate;
    }
  }
  if (row) rows.push(row);
  return rows;
}
