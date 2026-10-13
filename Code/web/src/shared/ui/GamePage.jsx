// GamePage — the shared page shell for every game: mounts the ported game
// class into a canvas container, runs the mic-calibration flow once, then
// wires the live mic signal into the game via pushSample(). Both games'
// STATE enums use the same string values ('idle', 'game_over', ...), so this
// stays game-agnostic and just takes the class to mount.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useMicBreathSignal } from '../mic/useMicBreathSignal.js';
import { MicCalibration } from '../calibration/MicCalibration.jsx';
import './gamePage.css';

export function GamePage({ GameClass }) {
  const containerRef = useRef(null);
  const gameRef = useRef(null);
  const rangeRef = useRef(null);       // calibrated {min, max}, reused across replays
  const wiredRef = useRef(false);      // whether mic.subscribe() -> pushSample is hooked up yet
  const mic = useMicBreathSignal();

  const [state, setState] = useState('idle');
  const [calibrating, setCalibrating] = useState(false);

  useEffect(() => {
    gameRef.current = new GameClass({
      sceneContainer: containerRef.current,
      onStateChange: setState,
    });
  }, [GameClass]);

  const wireMicToGame = useCallback(() => {
    if (wiredRef.current) return;
    wiredRef.current = true;
    mic.subscribe((raw) => {
      const { min, max } = rangeRef.current;
      const span = max - min || 1e-6;
      const norm = Math.max(0, Math.min(1, (raw - min) / span));
      gameRef.current.pushSample(norm);
    });
  }, [mic]);

  const handleTap = useCallback(() => {
    if (state !== 'idle' && state !== 'game_over') return;
    if (!rangeRef.current) {
      setCalibrating(true);
      return;
    }
    gameRef.current.start();
  }, [state]);

  const handleCalibrationDone = useCallback((range) => {
    rangeRef.current = range;
    setCalibrating(false);
    wireMicToGame();
    gameRef.current.start();
  }, [wireMicToGame]);

  const tappable = !calibrating && (state === 'idle' || state === 'game_over');

  return (
    <div className="game-page">
      <div
        className="game-canvas-mount"
        ref={containerRef}
        onPointerDown={tappable ? handleTap : undefined}
      />
      {calibrating && <MicCalibration mic={mic} onDone={handleCalibrationDone} />}
    </div>
  );
}

export default GamePage;
