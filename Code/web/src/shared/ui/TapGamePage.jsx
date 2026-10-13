// TapGamePage — the page shell for tap-controlled games: no mic, no
// calibration, just a tap target. A tap while idle/game-over (re)starts the
// game; every other tap is forwarded to the game as a registerTap() call.
import { useCallback, useEffect, useRef, useState } from 'react';
import './gamePage.css';

export function TapGamePage({ GameClass }) {
  const containerRef = useRef(null);
  const gameRef = useRef(null);

  const [state, setState] = useState('idle');

  useEffect(() => {
    gameRef.current = new GameClass({
      sceneContainer: containerRef.current,
      onStateChange: setState,
    });
  }, [GameClass]);

  const handlePointerDown = useCallback(() => {
    if (state === 'idle' || state === 'game_over') {
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
