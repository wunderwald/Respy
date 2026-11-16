// MicCalibration — a child-facing "breathe with the sun" calibration flow
// used by every mic game before play. The River Crossing sun grows while the
// child breathes in through the nose and shrinks while they breathe out
// through the mouth, a few cycles in a row with no holds in between.
//
// Binary calibration (not a continuous-depth recording like the lab's
// RespCalibration): the games only care about loud-while-blowing vs.
// quiet-while-not. Nasal inhales are near-silent at the mic, so the inhale
// phases give the quiet level and the mouth exhales the blow level — then we
// warn (in either direction) if there isn't a clear enough gap between them.
import { useEffect, useRef, useState, useCallback } from 'react';
import { CALIBRATION_CONFIG as C } from './calibrationConfig.js';
import { drawSun } from '../riverCrossing/sun.js';
import './calibration.css';

const SEGMENTS = [
  { type: 'intro', dur: C.INTRO_MS },
  ...Array.from({ length: C.CYCLES }, (_, cycle) => [
    { type: 'in',  cycle, dur: C.INHALE_MS },
    { type: 'out', cycle, dur: C.EXHALE_MS },
  ]).flat(),
];

const TEXT = {
  intro: { title: 'Lass uns mit der Sonne atmen!',
           sub: 'Atme durch die Nase ein und durch den Mund aus' },
  in:    { title: 'Atme ein…',
           sub: 'langsam durch die Nase' },
  out:   { title: '…und atme aus',
           sub: 'durch den Mund, in Richtung Mikrofon' },
};

// Raw envelope → rough 0..1 level for the sun's rays. Uncalibrated by
// definition (we're calibrating), so just a fixed visual scale.
const LEVEL_FULL_SCALE = 0.05;

function mean(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }
function max(arr) { return arr.length ? Math.max(...arr) : 0; }
function stddev(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(mean(arr.map((v) => (v - m) ** 2)));
}
function lerp(a, b, t) { return a + (b - a) * t; }
function easeInOut(t) { return 0.5 - 0.5 * Math.cos(Math.PI * t); }

// Checks both calibration failure directions and returns the reasons that
// triggered (empty array = all good). Self-relative to this session's own
// measurements throughout — no fixed absolute levels — since mic
// gain/distance varies per device.
function checkSeparation(blowSamples, quietSamples) {
  const reasons = [];
  const blowMean = mean(blowSamples);
  const quietMean = mean(quietSamples);
  const quietCeiling = max(quietSamples);
  const quietSpread = stddev(quietSamples);

  if (quietCeiling >= blowMean * C.MAX_QUIET_RATIO) {
    reasons.push('quietTooLoud');
  }
  if (blowMean < quietMean + C.MIN_BLOW_ABOVE_QUIET_STD * quietSpread) {
    reasons.push('blowTooQuiet');
  }
  return reasons;
}

function rangeFrom({ blow, quiet }) {
  return { min: max(quiet), max: mean(blow) };
}

/** Sun radius as a fraction of the canvas side, for segment `seg` at progress p∈[0,1]. */
function sunRadiusFrac(seg, p, now) {
  if (seg.type === 'in')  return lerp(C.SUN_MIN_R, C.SUN_MAX_R, easeInOut(p));
  if (seg.type === 'out') return lerp(C.SUN_MAX_R, C.SUN_MIN_R, easeInOut(p));
  // intro: resting small, with a gentle "alive" pulse
  return C.SUN_MIN_R * (1 + 0.04 * Math.sin(now / 400));
}

function drawFrame(canvas, seg, p, level, now) {
  const size = canvas.clientWidth;
  if (!size) return;
  const dpr = window.devicePixelRatio || 1;
  const px = Math.round(size * dpr);
  if (canvas.width !== px) { canvas.width = px; canvas.height = px; }

  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);

  // Same soft bobbing as the River Crossing sun.
  const t = now / 1000;
  const r = sunRadiusFrac(seg, p, now) * size;
  const cx = size / 2 + Math.sin(t * 0.35) * r * 0.06;
  const cy = size / 2 + Math.sin(t * 0.5 + 1.3) * r * 0.08;

  drawSun(ctx, cx, cy, r, {
    lineScale: Math.max(1, r / 40), // keep strokes proportional on the big sun
    mouth: seg.type === 'out' ? 'blow' : 'smile',
    rayBoost: level,
  });
}

/**
 * @param {object} props
 * @param {ReturnType<import('../mic/useMicBreathSignal.js').useMicBreathSignal>} props.mic
 * @param {(range: {min: number, max: number}) => void} props.onDone
 */
export function MicCalibration({ mic, onDone }) {
  const [attempt, setAttempt] = useState(0);
  const [micError, setMicError] = useState(null);
  const [warning, setWarning] = useState(null);
  const [segIndex, setSegIndex] = useState(null); // null until the mic is running

  const canvasRef = useRef(null);
  const startRef = useRef(null);
  const samplesRef = useRef({ blow: [], quiet: [] });
  const levelRef = useRef(0);
  const rafRef = useRef(null);

  const finish = useCallback(() => {
    const { blow, quiet } = samplesRef.current;
    const reasons = checkSeparation(blow, quiet);
    if (reasons.length) {
      setWarning(reasons);
      return;
    }
    onDone(rangeFrom(samplesRef.current));
  }, [onDone]);

  useEffect(() => {
    let cancelled = false;
    let lastIndex = -1;

    const tick = () => {
      const now = performance.now();
      const elapsed = now - startRef.current;

      let acc = 0, index = -1;
      for (let i = 0; i < SEGMENTS.length; i++) {
        if (elapsed < acc + SEGMENTS[i].dur) { index = i; break; }
        acc += SEGMENTS[i].dur;
      }
      if (index < 0) {
        finish();
        return;
      }

      const seg = SEGMENTS[index];
      const segElapsed = elapsed - acc;
      const raw = mic.getRaw();

      if (segElapsed >= C.SETTLE_MS) {
        if (seg.type === 'in')  samplesRef.current.quiet.push(raw);
        if (seg.type === 'out') samplesRef.current.blow.push(raw);
      }

      const target = Math.max(0, Math.min(1, raw / LEVEL_FULL_SCALE));
      levelRef.current += (target - levelRef.current) * 0.25;

      if (index !== lastIndex) { lastIndex = index; setSegIndex(index); }
      if (canvasRef.current) {
        drawFrame(canvasRef.current, seg, segElapsed / seg.dur, levelRef.current, now);
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    (async () => {
      try {
        await mic.start();
        if (cancelled) return;
        samplesRef.current = { blow: [], quiet: [] };
        levelRef.current = 0;
        startRef.current = performance.now();
        rafRef.current = requestAnimationFrame(tick);
      } catch (e) {
        if (!cancelled) setMicError(e?.message ?? 'Mikrofonzugriff fehlgeschlagen');
      }
    })();

    return () => { cancelled = true; cancelAnimationFrame(rafRef.current); };
  }, [attempt, mic, finish]);

  const retry = () => { setWarning(null); setSegIndex(null); setAttempt((a) => a + 1); };
  const continueAnyway = () => onDone(rangeFrom(samplesRef.current));

  if (micError) {
    return (
      <div className="calibration-screen">
        <p className="calibration-title">Kein Zugriff auf das Mikrofon</p>
        <p className="calibration-sub">{micError}</p>
        <button className="calibration-btn" onClick={() => { setMicError(null); setAttempt((a) => a + 1); }}>
          Nochmal versuchen
        </button>
      </div>
    );
  }

  if (warning) {
    return (
      <div className="calibration-screen">
        <p className="calibration-title">Lass es uns nochmal versuchen!</p>
        {warning.includes('blowTooQuiet') && (
          <p className="calibration-sub">
            Atme etwas kräftiger durch den Mund aus, nah am Mikrofon
          </p>
        )}
        {warning.includes('quietTooLoud') && (
          <p className="calibration-sub">
            Such dir einen leiseren Platz und atme sanft durch die Nase ein
          </p>
        )}
        <div className="calibration-buttons">
          <button className="calibration-btn" onClick={retry}>Nochmal versuchen</button>
          <button className="calibration-btn calibration-btn-secondary" onClick={continueAnyway}>
            Trotzdem weiter
          </button>
        </div>
      </div>
    );
  }

  if (segIndex == null) {
    return (
      <div className="calibration-screen">
        <p className="calibration-title">Das Mikrofon wird vorbereitet…</p>
      </div>
    );
  }

  const seg = SEGMENTS[segIndex];
  const text = TEXT[seg.type];

  return (
    <div className="calibration-screen">
      {/* key: re-mount on phase change so the fade-in animation replays */}
      <div className="calibration-text" key={segIndex}>
        <p className="calibration-title">{text.title}</p>
        <p className="calibration-sub">{text.sub}</p>
      </div>
      <canvas className="calibration-sun" ref={canvasRef} />
      <div className="calibration-dots" aria-label={`Atemzug ${(seg.cycle ?? -1) + 1} von ${C.CYCLES}`}>
        {Array.from({ length: C.CYCLES }, (_, i) => {
          const cls = seg.cycle == null || i > seg.cycle ? ''
            : i < seg.cycle ? ' done' : ' active';
          return <span key={i} className={`calibration-dot${cls}`} />;
        })}
      </div>
    </div>
  );
}

export default MicCalibration;
