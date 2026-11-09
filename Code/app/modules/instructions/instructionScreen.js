// Draws an explanation screen ({ title, lines } from instructionTexts.js) on
// top of whatever background the experiment has already drawn: a dark,
// rounded panel with a large bold title and large, word-wrapped lines.
// Child-sized text that scales with the screen (1 u = 1 % of the height on a
// 16:9 screen; narrower windows scale down by width).

export function drawInstructions(ctx, w, h, instructions) {
  if (!instructions) return;
  const { title, lines = [] } = instructions;
  const u        = Math.min(h, w * 9 / 16) / 100;
  const maxW     = Math.min(w * 0.84, 150 * u);
  // No title (empty / missing) → no title row and no gap: the panel only
  // holds the lines.
  const titleSz  = title ? 8 * u : 0;
  const lineSz   = 5 * u;
  const lineH    = lineSz * 1.35;
  const gapAfterTitle = title ? 4 * u : 0;
  const paraGap  = 1.6 * u;     // extra space between the separate lines

  // Wrap every line to the available width.
  ctx.font = `700 ${lineSz}px Nunito, sans-serif`;
  const wrapped = lines.map((line) => wrap(ctx, line, maxW));

  const bodyH  = wrapped.reduce((sum, rows) => sum + rows.length * lineH, 0) + paraGap * Math.max(0, wrapped.length - 1);
  const totalH = titleSz + gapAfterTitle + bodyH;
  const padY   = 6 * u, padX = 6 * u;

  // Panel
  const panelW = maxW + padX * 2;
  const panelH = totalH + padY * 2;
  const px = (w - panelW) / 2, py = (h - panelH) / 2;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(px, py, panelW, panelH, 4 * u);
  ctx.fillStyle = 'rgba(4, 16, 30, 0.72)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 0.3 * u;
  ctx.stroke();

  // Text
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  let y = py + padY + titleSz / 2;
  if (title) {
    ctx.fillStyle = '#ffd166';
    ctx.font = `800 ${fit(ctx, title, titleSz, maxW, '800')}px Nunito, sans-serif`;
    ctx.fillText(title, w / 2, y);
  }

  y += titleSz / 2 + gapAfterTitle + lineH / 2;
  ctx.fillStyle = '#ffffff';
  ctx.font = `700 ${lineSz}px Nunito, sans-serif`;
  for (const rows of wrapped) {
    for (const row of rows) {
      ctx.fillText(row, w / 2, y);
      y += lineH;
    }
    y += paraGap;
  }
  ctx.restore();
}

// Word wrap using the current ctx.font, balanced: once a line needs N rows,
// use the narrowest width that still gives N rows, so the rows come out
// about equally long (no single word dangling on its own row).
function wrap(ctx, text, maxW) {
  const rows = greedyWrap(ctx, text, maxW);
  if (rows.length < 2) return rows;
  let lo = maxW / 2, hi = maxW;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (greedyWrap(ctx, text, mid).length > rows.length) lo = mid; else hi = mid;
  }
  return greedyWrap(ctx, text, hi);
}

function greedyWrap(ctx, text, maxW) {
  const words = text.split(' ');
  const rows = [];
  let row = '';
  for (const word of words) {
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

// Font size that keeps a single line (the title) within maxW.
function fit(ctx, text, size, maxW, weight) {
  ctx.font = `${weight} ${size}px Nunito, sans-serif`;
  const width = ctx.measureText(text).width;
  return width > maxW ? size * maxW / width : size;
}
