// TapGamePage — the page shell for tap-controlled games: no mic, no
// calibration, just a tap target. A tap while idle/game-over (re)starts the
// game; every other tap is forwarded to the game as a registerTap() call.
import { useCallback, useEffect, useRef, useState } from 'react';
import { enterFullscreen } from './fullscreen.js';
import { exportRun } from '../recording/runExport.js';
import { startAutoFlush } from '../recording/dataApi.js';
import './gamePage.css';

export function TapGamePage({ GameClass }) {
  const containerRef = useRef(null);
  const gameRef = useRef(null);

  const [state, setState] = useState('idle');

  // Upload any runs still queued on this device (also retries periodically).
  useEffect(() => { startAutoFlush(); }, []);

  useEffect(() => {
    const game = new GameClass({
      sceneContainer: containerRef.current,
      onStateChange: (s) => {
        setState(s);
        // JSON download as soon as a run finishes (games with getRunData).
        if (s === 'game_over' && game.getRunData) exportRun(game.getRunData());
      },
    });
    gameRef.current = game;
  }, [GameClass]);

  const handlePointerDown = useCallback(() => {
    if (state === 'idle' || state === 'game_over') {
      enterFullscreen();
      gameRef.current.start();
    } else {
      gameRef.current.registerTap();
    }
  }, [state]);

  return (
    <div className="game-page">
      <div className="game-canvas-mount" ref={containerRef} onPointerDown={handlePointerDown} />
    </div>
  );
}

export default TapGamePage;
