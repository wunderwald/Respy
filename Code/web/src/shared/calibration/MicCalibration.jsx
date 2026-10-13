// MicCalibration — a child-facing "blow into the mic" calibration flow used
// by every game before play. Binary calibration (not a continuous-depth
// recording like the lab's RespCalibration): the games here only care about
// loud-while-blowing vs. quiet-while-not, so we directly measure both ends
// by prompting for each, twice, with short breaks — then warn if "quiet"
// isn't actually quiet enough to tell the two apart.
import { useEffect, useRef, useState, useCallback } from 'react';
import { CALIBRATION_CONFIG as C } from './calibrationConfig.js';
import './calibration.css';

function buildSegments() {
  const segments = [];
  const kinds = ['blow', 'quiet'];
  for (const kind of kinds) {
    for (let rep = 0; rep < C.REPS; rep++) {
      segments.push({ type: 'countdown', kind, rep });
      segments.push({ type: 'hold', kind, rep });
      const isLast = kind === kinds[kinds.length - 1] && rep === C.REPS - 1;
      if (!isLast) segments.push({ type: 'break', kind, rep });
    }
  }
  return segments;
}

const DURATION_MS = { countdown: C.COUNTDOWN_MS, hold: C.HOLD_MS, break: C.BREAK_MS };

function mean(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }
function max(arr) { return arr.length ? Math.max(...arr) : 0; }

function countdownLabel(segElapsed) {
  if (segElapsed < 1000) return '3';
  if (segElapsed < 2000) return '2';
  if (segElapsed < 3000) return '1';
  return 'GO!';
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
  const [display, setDisplay] = useState(null);
  const [level, setLevel] = useState(0);

  const segmentsRef = useRef(buildSegments());
  const startRef = useRef(null);
  const samplesRef = useRef({ blow: [[], []], quiet: [[], []] });
  const rafRef = useRef(null);

  const finish = useCallback(() => {
    const { blow, quiet } = samplesRef.current;
    const loud = mean(blow.map(mean));
    const quietLevel = mean(quiet.map(max));

    if (quietLevel >= loud * C.MAX_QUIET_RATIO) {
      setWarning({ quiet: quietLevel, loud });
      return;
    }
    onDone({ min: quietLevel, max: loud });
  }, [onDone]);

  useEffect(() => {
    let cancelled = false;

    const tick = () => {
      const now = performance.now();
      const elapsed = now - startRef.current;
      const segments = segmentsRef.current;

      let acc = 0, current = null, segStart = 0;
      for (const seg of segments) {
        const dur = DURATION_MS[seg.type];
        if (elapsed < acc + dur) { current = seg; segStart = acc; break; }
        acc += dur;
      }

      if (!current) {
        finish();
        return;
      }

      const segElapsed = elapsed - segStart;
      const raw = mic.getRaw();
      setLevel(Math.max(0, Math.min(1, raw / 0.05)));

      if (current.type === 'hold') {
        samplesRef.current[current.kind][current.rep].push(raw);
      }

      setDisplay({ ...current, segElapsed });
      rafRef.current = requestAnimationFrame(tick);
    };

    (async () => {
      try {
        await mic.start();
        if (cancelled) return;
        samplesRef.current = { blow: [[], []], quiet: [[], []] };
        startRef.current = performance.now();
        rafRef.current = requestAnimationFrame(tick);
      } catch (e) {
        if (!cancelled) setMicError(e?.message ?? 'Microphone access failed');
      }
    })();

    return () => { cancelled = true; cancelAnimationFrame(rafRef.current); };
  }, [attempt, mic, finish]);

  const retry = () => { setWarning(null); setAttempt((a) => a + 1); };
  const continueAnyway = () => {
    const { blow, quiet } = samplesRef.current;
    onDone({ min: mean(quiet.map(max)), max: mean(blow.map(mean)) });
  };

  if (micError) {
    return (
      <div className="calibration-screen">
        <p className="calibration-title">Couldn't access the microphone</p>
        <p className="calibration-sub">{micError}</p>
        <button className="calibration-btn" onClick={() => { setMicError(null); setAttempt((a) => a + 1); }}>
          Try again
        </button>
      </div>
    );
  }

  if (warning) {
    return (
      <div className="calibration-screen">
        <p className="calibration-title">It's pretty noisy here!</p>
        <p className="calibration-sub">
          The "quiet" part was almost as loud as blowing. Try moving somewhere
          quieter, or make sure you're close to the microphone when you blow.
        </p>
        <div className="calibration-buttons">
          <button className="calibration-btn" onClick={retry}>Try again</button>
          <button className="calibration-btn calibration-btn-secondary" onClick={continueAnyway}>
            Continue anyway
          </button>
        </div>
      </div>
    );
  }

  if (!display) {
    return (
      <div className="calibration-screen">
        <p className="calibration-title">Getting the microphone ready…</p>
      </div>
    );
  }

  return (
    <div className="calibration-screen">
      {display.type === 'countdown' && (
        <>
          <p className="calibration-title">
            {display.kind === 'blow' ? 'Get ready to blow!' : 'Now get ready to stay quiet!'}
          </p>
          <p className="calibration-countdown">{countdownLabel(display.segElapsed)}</p>
        </>
      )}
      {display.type === 'hold' && (
        <>
          <p className="calibration-title">
            {display.kind === 'blow' ? 'Blow into the microphone! 💨' : 'Shhh… stay as quiet as you can'}
          </p>
          <div className="calibration-level-track">
            <div className="calibration-level-fill" style={{ height: `${level * 100}%` }} />
          </div>
        </>
      )}
      {display.type === 'break' && (
        <p className="calibration-title">Great job! Relax for a second…</p>
      )}
    </div>
  );
}

export default MicCalibration;
