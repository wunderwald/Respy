// The smiling sun — drawn in the River Crossing sky and, large and animated,
// as the breathing guide in MicCalibration. With default options it draws
// exactly the River Crossing sun.

const RAY_COLOR  = '#ffcf4d';
const FACE_COLOR = '#ffe17a';
const RAY_COUNT  = 8;

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cx, cy  centre
 * @param {number} r       face radius (rays extend to ~1.55 r, more with rayBoost)
 * @param {object} [opts]
 * @param {string}  [opts.ink='#4a3350']  outline/face colour
 * @param {number}  [opts.lineScale=1]    multiplies stroke widths (for a big sun)
 * @param {'smile'|'blow'} [opts.mouth='smile']  'blow' = round "o" mouth
 * @param {number}  [opts.rayBoost=0]     0..1, lengthens the rays (live mic level)
 */
export function drawSun(ctx, cx, cy, r, {
  ink = '#4a3350', lineScale = 1, mouth = 'smile', rayBoost = 0,
} = {}) {
  ctx.save();
  ctx.translate(cx, cy);

  ctx.strokeStyle = RAY_COLOR;
  ctx.lineWidth = 3 * lineScale;
  ctx.lineCap = rayBoost > 0 ? 'round' : 'butt';
  const rayEnd = 1.55 + rayBoost * 0.4;
  for (let i = 0; i < RAY_COUNT; i++) {
    const a = (i / RAY_COUNT) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r * 1.25, Math.sin(a) * r * 1.25);
    ctx.lineTo(Math.cos(a) * r * rayEnd, Math.sin(a) * r * rayEnd);
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = FACE_COLOR;
  ctx.fill();
  ctx.strokeStyle = ink;
  ctx.lineWidth = 2 * lineScale;
  ctx.stroke();

  ctx.fillStyle = ink;
  ctx.beginPath();
  ctx.arc(-r * 0.32, -r * 0.1, r * 0.09, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(r * 0.32, -r * 0.1, r * 0.09, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = ink;
  ctx.lineWidth = 2 * lineScale;
  ctx.beginPath();
  if (mouth === 'blow') {
    ctx.ellipse(0, r * 0.32, r * 0.13, r * 0.17, 0, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.arc(0, r * 0.05, r * 0.42, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
  }

  ctx.restore();
}
