'use strict';

// ── Fixed channel color palette (index → color, always consistent) ────────────
const PALETTE = [
  '#4a9eff', // 0  blue
  '#7ec880', // 1  green
  '#e06c75', // 2  red
  '#c678dd', // 3  purple
  '#e5c07b', // 4  yellow
  '#56b6c2', // 5  cyan
  '#ff8c69', // 6  salmon
  '#d19a66', // 7  orange
  '#be5046', // 8  dark red
  '#61afef', // 9  sky blue
  '#98c379', // 10 lime
  '#e5c07b', // 11 gold
  '#c678dd', // 12 violet
  '#56b6c2', // 13 teal
  '#ff6b9d', // 14 pink
  '#abb2bf', // 15 grey
];

function chColor(idx) {
  return PALETTE[idx % PALETTE.length];
}

// ── Downsample helpers ────────────────────────────────────────────────────────
function downsample(arr, target) {
  if (arr.length <= target) return arr;
  const out = new Float32Array(target);
  const step = arr.length / target;
  for (let i = 0; i < target; i++) {
    out[i] = arr[Math.floor(i * step)];
  }
  return out;
}

function arrMinMax(arr) {
  let min = arr[0], max = arr[0];
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] < min) min = arr[i];
    if (arr[i] > max) max = arr[i];
  }
  return { min, max };
}

// ── CSV parsers ───────────────────────────────────────────────────────────────
function parseCSV(text) {
  const lines = text.replace(/\r/g, '').trim().split('\n');
  if (lines.length < 2) throw new Error('File has fewer than 2 rows.');
  const headers = lines[0].split(',').map(s => s.trim());
  const timeIdx = headers.findIndex(h => h.toLowerCase() === 'time');
  if (timeIdx === -1) throw new Error('No "time" column found.');
  const chanNames = headers.filter((h, i) => {
    if (i === timeIdx) return false;
    // Drop pandas auto-index columns (empty header or "Unnamed: 0", "Unnamed: 0.1", …)
    if (h === '' || /^unnamed:\s*\d+$/i.test(h)) return false;
    return true;
  });
  if (chanNames.length === 0) throw new Error('No channel columns found.');
  const chanIdxs = chanNames.map(ch => headers.indexOf(ch));
  const n = lines.length - 1;

  const time = new Float64Array(n);
  const channels = {};
  chanNames.forEach(ch => { channels[ch] = new Float32Array(n); });

  for (let i = 0; i < n; i++) {
    const vals = lines[i + 1].split(',');
    time[i] = parseFloat(vals[timeIdx]);
    chanIdxs.forEach((ci, j) => {
      channels[chanNames[j]][i] = parseFloat(vals[ci]);
    });
  }

  return { time, channels, channelNames: chanNames };
}

function parseMarkerCSV(text) {
  const lines = text.replace(/\r/g, '').trim().split('\n');
  if (lines.length < 2) throw new Error('File has fewer than 2 rows.');
  const headers = lines[0].split(',').map(s => s.trim().toLowerCase());
  const timeIdx = headers.indexOf('time');
  const valIdx  = headers.indexOf('value');
  if (timeIdx === -1 || valIdx === -1)
    throw new Error('Required columns "time" and "value" not found.');

  const markers = [];
  for (let i = 1; i < lines.length; i++) {
    const row = lines[i].trim();
    if (!row) continue;
    const vals = row.split(',');
    const t = parseFloat(vals[timeIdx]);
    if (!isFinite(t)) throw new Error(`Non-numeric time on row ${i + 1}.`);
    markers.push({ time: t, value: vals[valIdx]?.trim() ?? '' });
  }
  if (markers.length === 0) throw new Error('No valid data rows found.');
  return markers;
}

// ── State ─────────────────────────────────────────────────────────────────────
const state = {
  data: null,           // { time, channels, channelNames }
  dsCache: {},          // ch → Float32Array (butterfly downsampled)
  visible: new Set(),   // visible channel names
  selection: null,      // { t0, t1 } normalized [0,1] over full time range
  channelHeights: {},   // ch → px
  defaultHeight: 90,
  markers: [],          // [{ time, value }, ...]
};

const BUTTERFLY_PTS = 8000;
const VIEW_PTS      = 20000;

// ── DOM refs ─────────────────────────────────────────────────────────────────
const fileBtn          = document.getElementById('file-btn');
const fileNameEl       = document.getElementById('file-name');
const markerBtn        = document.getElementById('marker-btn');
const markerInfoEl     = document.getElementById('marker-info');
const channelListEl    = document.getElementById('channel-list');
const viewPane         = document.getElementById('view-pane');
const butterflyCanvas  = document.getElementById('butterfly-canvas');
const allBtn           = document.getElementById('all-btn');
const noneBtn          = document.getElementById('none-btn');

// ── Butterfly brush (draw / move / resize) ────────────────────────────────────
// mode: 'idle' | 'drawing' | 'moving' | 'resize_l' | 'resize_r'
const brush = {
  mode: 'idle',
  startX: 0,
  // snapshot of selection at drag-start (used for move)
  snapT0: 0,
  snapT1: 0,
  // live preview while dragging (null = committed selection)
  liveT0: null,
  liveT1: null,
};

const HANDLE_PX = 6; // px either side of an edge that counts as a resize hit

function brushHitTest(cx) {
  // Returns 'handle_l' | 'handle_r' | 'inside' | 'outside'
  if (!state.selection) return 'outside';
  const w  = butterflyCanvas.width;
  const x0 = state.selection.t0 * w;
  const x1 = state.selection.t1 * w;
  if (Math.abs(cx - x0) <= HANDLE_PX) return 'handle_l';
  if (Math.abs(cx - x1) <= HANDLE_PX) return 'handle_r';
  if (cx > x0 && cx < x1)             return 'inside';
  return 'outside';
}

function brushCursor(hit) {
  switch (hit) {
    case 'handle_l':
    case 'handle_r': return 'col-resize';
    case 'inside':   return 'grab';
    default:         return 'crosshair';
  }
}

function renderButterfly() {
  const canvas = butterflyCanvas;
  const w = Math.floor(canvas.offsetWidth);
  const h = Math.floor(canvas.offsetHeight);
  canvas.width  = w;
  canvas.height = h;
  if (w === 0 || h === 0) return;

  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#1c1c1c';
  ctx.fillRect(0, 0, w, h);

  if (!state.data) {
    ctx.fillStyle = '#444';
    ctx.font = '11px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('butterfly plot — open a CSV to begin', w / 2, h / 2);
    return;
  }

  const { channelNames } = state.data;
  const visNames = channelNames.filter(ch => state.visible.has(ch));
  if (visNames.length === 0) return;

  // Global min/max across all visible channels for common scale
  let gMin = Infinity, gMax = -Infinity;
  visNames.forEach(ch => {
    const { min, max } = arrMinMax(state.dsCache[ch]);
    if (min < gMin) gMin = min;
    if (max > gMax) gMax = max;
  });
  const gRange = gMax - gMin || 1;

  const pad  = 0.08;
  const yBot  = h * (1 - pad);
  const ySpan = h * (1 - 2 * pad);

  visNames.forEach(ch => {
    const ds = state.dsCache[ch];
    const n  = ds.length;
    const colorIdx = channelNames.indexOf(ch);

    ctx.beginPath();
    ctx.strokeStyle = chColor(colorIdx);
    ctx.lineWidth   = 0.8;
    ctx.globalAlpha = 0.65;

    for (let i = 0; i < n; i++) {
      const x    = (i / (n - 1)) * w;
      const norm = (ds[i] - gMin) / gRange;
      const y    = yBot - norm * ySpan;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
  });
  ctx.globalAlpha = 1;

  // Marker lines in butterfly
  if (state.markers.length > 0) {
    const tMin  = state.data.time[0];
    const tMax  = state.data.time[state.data.time.length - 1];
    const tSpan = tMax - tMin || 1;
    ctx.strokeStyle = 'rgba(255, 195, 50, 0.5)';
    ctx.lineWidth   = 1;
    state.markers.forEach(m => {
      if (m.time < tMin || m.time > tMax) return;
      const x = Math.round((m.time - tMin) / tSpan * w) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    });
  }

  // Draw selection (live preview while dragging, committed otherwise)
  const t0 = brush.liveT0 !== null ? brush.liveT0 : state.selection?.t0;
  const t1 = brush.liveT1 !== null ? brush.liveT1 : state.selection?.t1;

  if (t0 != null && t1 != null && t1 > t0) {
    const sx = t0 * w;
    const ex = t1 * w;
    const sw = ex - sx;

    // Shaded interior
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.fillRect(sx, 0, sw, h);

    // Border
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth   = 1;
    ctx.strokeRect(sx + 0.5, 0.5, sw - 1, h - 1);

    // Resize handle bars
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillRect(sx,     0, 3, h);
    ctx.fillRect(ex - 3, 0, 3, h);
  }
}

butterflyCanvas.addEventListener('mousedown', e => {
  const cx  = e.offsetX;
  const hit = brushHitTest(cx);

  brush.startX = cx;
  brush.liveT0 = null;
  brush.liveT1 = null;

  if (hit === 'handle_l') {
    brush.mode = 'resize_l';
  } else if (hit === 'handle_r') {
    brush.mode = 'resize_r';
  } else if (hit === 'inside') {
    brush.mode   = 'moving';
    brush.snapT0 = state.selection.t0;
    brush.snapT1 = state.selection.t1;
    butterflyCanvas.style.cursor = 'grabbing';
  } else {
    brush.mode = 'drawing';
    const t = cx / butterflyCanvas.width;
    brush.liveT0 = t;
    brush.liveT1 = t;
  }
  e.preventDefault();
});

butterflyCanvas.addEventListener('mousemove', e => {
  const cx = e.offsetX;
  const w  = butterflyCanvas.width;

  if (brush.mode === 'idle') {
    butterflyCanvas.style.cursor = brushCursor(brushHitTest(cx));
    return;
  }

  const dt = (cx - brush.startX) / w;

  if (brush.mode === 'drawing') {
    const anchor = brush.startX / w;
    const cur    = Math.max(0, Math.min(1, cx / w));
    brush.liveT0 = Math.min(anchor, cur);
    brush.liveT1 = Math.max(anchor, cur);

  } else if (brush.mode === 'moving') {
    const span = brush.snapT1 - brush.snapT0;
    let t0 = brush.snapT0 + dt;
    let t1 = brush.snapT1 + dt;
    if (t0 < 0) { t0 = 0; t1 = span; }
    if (t1 > 1) { t1 = 1; t0 = 1 - span; }
    brush.liveT0 = t0;
    brush.liveT1 = t1;

  } else if (brush.mode === 'resize_l') {
    const clamp = Math.max(0, Math.min(cx / w, state.selection.t1 - 0.005));
    brush.liveT0 = clamp;
    brush.liveT1 = state.selection.t1;

  } else if (brush.mode === 'resize_r') {
    const clamp = Math.min(1, Math.max(cx / w, state.selection.t0 + 0.005));
    brush.liveT0 = state.selection.t0;
    brush.liveT1 = clamp;
  }

  renderButterfly();
});

function commitBrush(cancelX) {
  if (brush.mode === 'idle') return;

  if (brush.mode === 'drawing') {
    const w  = butterflyCanvas.width;
    const x0 = Math.min(brush.startX, cancelX ?? brush.startX);
    const x1 = Math.max(brush.startX, cancelX ?? brush.startX);
    state.selection = (x1 - x0 < 4) ? null : { t0: x0 / w, t1: x1 / w };
  } else if (brush.liveT0 !== null) {
    state.selection = { t0: brush.liveT0, t1: brush.liveT1 };
  }

  brush.mode  = 'idle';
  brush.liveT0 = null;
  brush.liveT1 = null;
  butterflyCanvas.style.cursor = brushCursor(brushHitTest(cancelX ?? 0));
  renderAll();
}

butterflyCanvas.addEventListener('mouseup',    e => commitBrush(e.offsetX));
butterflyCanvas.addEventListener('mouseleave', () => commitBrush());

// ── Channel view pane ─────────────────────────────────────────────────────────
function timeSliceIndices() {
  if (!state.data) return { s: 0, e: 0 };
  const n = state.data.time.length;
  if (!state.selection) return { s: 0, e: n };
  return {
    s: Math.max(0, Math.floor(state.selection.t0 * n)),
    e: Math.min(n,  Math.ceil(state.selection.t1 * n))
  };
}

function renderChannelViews() {
  if (!state.data) {
    viewPane.innerHTML = '<div id="empty-state">Open a CSV file to begin</div>';
    return;
  }

  const { channels, channelNames } = state.data;
  const visNames = channelNames.filter(ch => state.visible.has(ch));

  if (visNames.length === 0) {
    viewPane.innerHTML = '<div id="empty-state">No channels selected</div>';
    return;
  }

  // Only rebuild DOM when visible channel set / order changed
  const existingTracks = [...viewPane.querySelectorAll('.ch-track')];
  const existingNames  = existingTracks.map(el => el.dataset.channel);
  const needsRebuild   = existingNames.length !== visNames.length ||
                         visNames.some((ch, i) => ch !== existingNames[i]);

  const paneW = viewPane.clientWidth || 800;

  if (needsRebuild) {
    viewPane.innerHTML = '';
    visNames.forEach(ch => {
      const colorIdx = channelNames.indexOf(ch);
      const color    = chColor(colorIdx);
      const trackH   = state.channelHeights[ch] || state.defaultHeight;

      const track = document.createElement('div');
      track.className       = 'ch-track';
      track.dataset.channel = ch;

      const label = document.createElement('div');
      label.className   = 'track-label';
      label.textContent = ch;
      label.style.color = color;

      const minLabel = document.createElement('div');
      minLabel.className = 'track-minmax bot';

      const maxLabel = document.createElement('div');
      maxLabel.className = 'track-minmax top';

      const canvas = document.createElement('canvas');
      canvas.width       = paneW;
      canvas.height      = trackH;
      canvas.style.height = trackH + 'px';

      const handle = document.createElement('div');
      handle.className = 'resize-handle';
      handle.addEventListener('mousedown', startResize(ch));

      track.appendChild(label);
      track.appendChild(maxLabel);
      track.appendChild(canvas);
      track.appendChild(minLabel);
      track.appendChild(handle);
      viewPane.appendChild(track);
    });
  }

  // Redraw every canvas (fast path on scroll: no DOM changes above)
  const { s, e } = timeSliceIndices();
  const tStart = state.data.time[s];
  const tEnd   = state.data.time[Math.max(s, e - 1)];

  viewPane.querySelectorAll('.ch-track').forEach(track => {
    const ch       = track.dataset.channel;
    const colorIdx = channelNames.indexOf(ch);
    const color    = chColor(colorIdx);
    const trackH   = state.channelHeights[ch] || state.defaultHeight;
    const canvas   = track.querySelector('canvas');
    const maxLabel = track.querySelector('.track-minmax.top');
    const minLabel = track.querySelector('.track-minmax.bot');

    canvas.width = paneW;
    if (canvas.height !== trackH) {
      canvas.height       = trackH;
      canvas.style.height = trackH + 'px';
    }

    const raw = channels[ch].subarray(s, e);
    const ds  = downsample(raw, Math.min(raw.length, VIEW_PTS));
    const { min, max } = arrMinMax(ds);

    if (maxLabel) maxLabel.textContent = formatAmp(max);
    if (minLabel) minLabel.textContent = formatAmp(min);
    drawTrace(canvas, ds, color, min, max, tStart, tEnd);
  });
}

function formatAmp(v) {
  const abs = Math.abs(v);
  if (abs >= 1000) return (v / 1000).toFixed(1) + 'k';
  if (abs >= 1)    return v.toFixed(2);
  return v.toFixed(4);
}

function drawTrace(canvas, data, color, min, max, tStart, tEnd) {
  const w   = canvas.width;
  const h   = canvas.height;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#141414';
  ctx.fillRect(0, 0, w, h);

  if (data.length < 2) return;

  const range = max - min || 1;
  const pad   = 0.08;
  const yBot  = h * (1 - pad);
  const ySpan = h * (1 - 2 * pad);

  // Zero line (only if zero is within range)
  if (min <= 0 && max >= 0) {
    const zNorm = (0 - min) / range;
    const zY    = yBot - zNorm * ySpan;
    ctx.setLineDash([3, 5]);
    ctx.strokeStyle = '#2e2e2e';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(0, zY);
    ctx.lineTo(w, zY);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Markers
  if (state.markers.length > 0 && tStart != null && tEnd != null && tEnd > tStart) {
    const tSpan = tEnd - tStart;
    ctx.font         = '8px monospace';
    ctx.textBaseline = 'top';

    state.markers.forEach(m => {
      if (m.time < tStart || m.time > tEnd) return;
      const x = Math.round((m.time - tStart) / tSpan * w) + 0.5;

      ctx.strokeStyle = 'rgba(255, 195, 50, 0.65)';
      ctx.lineWidth   = 1;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();

      ctx.fillStyle = 'rgba(255, 195, 50, 0.85)';
      ctx.textAlign = x < w - 24 ? 'left' : 'right';
      ctx.fillText(String(m.value), x + (x < w - 24 ? 2 : -2), 2);
    });
  }

  // Waveform (drawn on top of markers)
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth   = 1;

  for (let i = 0; i < data.length; i++) {
    const x    = (i / (data.length - 1)) * w;
    const norm = (data[i] - min) / range;
    const y    = yBot - norm * ySpan;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.stroke();
}

// ── Channel track resize ──────────────────────────────────────────────────────
const resizeOp = { active: false, ch: null, startY: 0, startH: 0 };

function startResize(ch) {
  return e => {
    resizeOp.active = true;
    resizeOp.ch     = ch;
    resizeOp.startY = e.clientY;
    resizeOp.startH = state.channelHeights[ch] || state.defaultHeight;
    e.preventDefault();
  };
}

document.addEventListener('mousemove', e => {
  if (!resizeOp.active) return;
  const newH = Math.max(30, resizeOp.startH + (e.clientY - resizeOp.startY));
  state.channelHeights[resizeOp.ch] = newH;

  const track = viewPane.querySelector(`.ch-track[data-channel="${resizeOp.ch}"]`);
  if (!track) return;

  const canvas = track.querySelector('canvas');
  const paneW  = viewPane.clientWidth || 800;
  canvas.width       = paneW;
  canvas.height      = newH;
  canvas.style.height = newH + 'px';

  const { s, e: eIdx } = timeSliceIndices();
  const tStart = state.data.time[s];
  const tEnd   = state.data.time[Math.max(s, eIdx - 1)];
  const raw  = state.data.channels[resizeOp.ch].subarray(s, eIdx);
  const ds   = downsample(raw, Math.min(raw.length, VIEW_PTS));
  const { min, max } = arrMinMax(ds);
  const colorIdx = state.data.channelNames.indexOf(resizeOp.ch);
  drawTrace(canvas, ds, chColor(colorIdx), min, max, tStart, tEnd);
});

document.addEventListener('mouseup', () => { resizeOp.active = false; });

// ── Sidebar ───────────────────────────────────────────────────────────────────
function populateSidebar() {
  channelListEl.innerHTML = '';
  state.data.channelNames.forEach((ch, i) => {
    const color = chColor(i);

    const row = document.createElement('label');
    row.className = 'ch-row';

    const cb = document.createElement('input');
    cb.type    = 'checkbox';
    cb.checked = state.visible.has(ch);
    cb.addEventListener('change', () => {
      if (cb.checked) state.visible.add(ch);
      else            state.visible.delete(ch);
      renderAll();
    });

    const swatch = document.createElement('div');
    swatch.className      = 'ch-swatch';
    swatch.style.background = color;

    const lbl = document.createElement('span');
    lbl.className   = 'ch-label';
    lbl.textContent = ch;

    row.appendChild(cb);
    row.appendChild(swatch);
    row.appendChild(lbl);
    channelListEl.appendChild(row);
  });
}

allBtn.addEventListener('click', () => {
  if (!state.data) return;
  state.data.channelNames.forEach(ch => state.visible.add(ch));
  channelListEl.querySelectorAll('input[type="checkbox"]')
    .forEach(cb => { cb.checked = true; });
  renderAll();
});

noneBtn.addEventListener('click', () => {
  if (!state.data) return;
  state.visible.clear();
  channelListEl.querySelectorAll('input[type="checkbox"]')
    .forEach(cb => { cb.checked = false; });
  renderAll();
});

// ── File loading ──────────────────────────────────────────────────────────────
fileBtn.addEventListener('click', async () => {
  const result = await window.eeg.openFile();
  if (!result) return;

  if (result.error) {
    alert(`Could not read file:\n${result.error}`);
    return;
  }

  let data;
  try {
    data = parseCSV(result.content);
  } catch (err) {
    alert(`Invalid EEG CSV — ${err.message}`);
    return;
  }

  state.data           = data;
  state.visible        = new Set(data.channelNames);
  state.selection      = null;
  state.channelHeights = {};
  state.markers        = [];

  state.dsCache = {};
  data.channelNames.forEach(ch => {
    state.dsCache[ch] = downsample(data.channels[ch], BUTTERFLY_PTS);
  });

  const fname = result.path.split(/[\\/]/).pop();
  fileNameEl.textContent = `${fname}  ·  ${data.time.length.toLocaleString()} pts`;
  markerInfoEl.textContent = '';
  markerBtn.disabled = false;

  populateSidebar();
  renderAll();
});

markerBtn.addEventListener('click', async () => {
  const files = await window.eeg.openMarkers();
  if (!files) return;

  const loaded  = [];
  const errors  = [];

  files.forEach(f => {
    const fname = f.path.split(/[\\/]/).pop();
    if (f.error) { errors.push(`${fname}: ${f.error}`); return; }
    try {
      loaded.push(...parseMarkerCSV(f.content));
    } catch (err) {
      errors.push(`${fname}: ${err.message}`);
    }
  });

  if (errors.length) alert(`Could not load some marker files:\n\n${errors.join('\n')}`);

  state.markers = loaded;
  const n = loaded.length;
  markerInfoEl.textContent = n > 0 ? `${n} marker${n !== 1 ? 's' : ''} loaded` : '';
  renderAll();
});

// ── Horizontal scroll in view pane ────────────────────────────────────────────
let scrollRAF = null;

viewPane.addEventListener('wheel', e => {
  if (!state.data) return;

  // ── Pinch-to-zoom (macOS trackpad fires wheel + ctrlKey for pinch) ──────────
  if (e.ctrlKey) {
    e.preventDefault();

    // If no selection yet, start from the full range
    if (!state.selection) state.selection = { t0: 0, t1: 1 };

    const { t0, t1 } = state.selection;
    const center  = (t0 + t1) / 2;
    const span    = t1 - t0;

    // deltaY < 0 = spread fingers = zoom in = shrink selection
    // Cap per-event delta to avoid jumpy behaviour on fast gestures
    const delta   = Math.max(-30, Math.min(30, e.deltaY));
    const scale   = Math.exp(delta * 0.012);
    const newSpan = Math.min(1, Math.max(0.001, span * scale));

    let newT0 = center - newSpan / 2;
    let newT1 = center + newSpan / 2;
    if (newT0 < 0) { newT0 = 0; newT1 = Math.min(1, newSpan); }
    if (newT1 > 1) { newT1 = 1; newT0 = Math.max(0, 1 - newSpan); }

    state.selection = { t0: newT0, t1: newT1 };

    if (scrollRAF) cancelAnimationFrame(scrollRAF);
    scrollRAF = requestAnimationFrame(() => { scrollRAF = null; renderAll(); });
    return;
  }

  // ── Horizontal pan ───────────────────────────────────────────────────────────
  if (!state.selection) return;
  if (Math.abs(e.deltaX) < Math.abs(e.deltaY) * 0.4) return;

  e.preventDefault();

  const span = state.selection.t1 - state.selection.t0;
  const dt   = (e.deltaX / (viewPane.clientWidth || 800)) * span;
  let t0 = state.selection.t0 + dt;
  let t1 = state.selection.t1 + dt;
  if (t0 < 0) { t0 = 0; t1 = span; }
  if (t1 > 1) { t1 = 1; t0 = 1 - span; }
  state.selection = { t0, t1 };

  if (scrollRAF) cancelAnimationFrame(scrollRAF);
  scrollRAF = requestAnimationFrame(() => { scrollRAF = null; renderAll(); });
}, { passive: false });

// ── Full render ───────────────────────────────────────────────────────────────
function renderAll() {
  renderButterfly();
  renderChannelViews();
}

// ── Window resize ─────────────────────────────────────────────────────────────
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(renderAll, 80);
});

// Init
renderButterfly();
