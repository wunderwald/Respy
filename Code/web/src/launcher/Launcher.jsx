import { useCallback, useEffect, useRef, useState } from 'react';
import {
  micSupport, micSupportMessage, queryMicPermission, requestMicPermission,
} from '../shared/mic/micPermission.js';
import './launcher.css';

// Direct navigation to each game's own standalone HTML entry — the web
// equivalent of the Electron app's launcher spawning a separate frontend.
// `needsMic` games stay locked until microphone permission is granted here,
// so the permission prompt never appears mid-game (or fails silently there).
const GAMES = [
  { href: 'trainingGame.html', label: 'River Crossing', needsMic: true },
  { href: 'trainingGameControl.html', label: 'River Crossing (Tap)', needsMic: false },
  { href: 'chromeDinoGame.html', label: 'Breath Runner', needsMic: true },
];

// mic: 'checking' | 'requesting' | 'granted' | 'denied' | 'error'
//      | 'insecure' | 'unsupported'
function useMicPermissionGate() {
  const [mic, setMic] = useState(() => {
    const support = micSupport();
    return support === 'ok' ? 'checking' : support;
  });
  const [errorMsg, setErrorMsg] = useState(null);
  const requestingRef = useRef(false); // dedupes StrictMode's double effect run

  const request = useCallback(async () => {
    if (requestingRef.current) return;
    requestingRef.current = true;
    setMic('requesting');
    const result = await requestMicPermission();
    requestingRef.current = false;
    setErrorMsg(result.message ?? null);
    setMic(result.state);
  }, []);

  useEffect(() => {
    if (micSupport() !== 'ok') return; // already reflected in initial state

    let cancelled = false;
    let status = null;
    const onChange = () => {
      if (status.state === 'granted') setMic('granted');
      else if (status.state === 'denied') setMic('denied');
    };

    (async () => {
      const q = await queryMicPermission();
      if (cancelled) return;
      status = q.status;
      status?.addEventListener('change', onChange);
      // 'prompt' (or unknown) — ask right away rather than waiting for a game.
      if (q.state === 'granted') setMic('granted');
      else request();
    })();

    return () => {
      cancelled = true;
      status?.removeEventListener('change', onChange);
    };
  }, [request]);

  return { mic, errorMsg, request };
}

function MicStatus({ mic, errorMsg, onRequest }) {
  switch (mic) {
    case 'granted':
      return <p className="mic-status mic-ok">Mikrofon bereit</p>;
    case 'checking':
    case 'requesting':
      return <p className="mic-status">Mikrofonzugriff wird angefragt…</p>;
    case 'insecure':
    case 'unsupported':
      return <p className="mic-status mic-bad">{micSupportMessage(mic)}</p>;
    case 'denied':
      return (
        <div className="mic-status mic-bad">
          <p>Der Mikrofonzugriff wurde blockiert. Bitte in den Website-Einstellungen
            des Browsers erlauben und dann erneut versuchen.</p>
          <button className="mic-btn" onClick={onRequest}>Erneut versuchen</button>
        </div>
      );
    default: // 'error'
      return (
        <div className="mic-status mic-bad">
          <p>Kein Zugriff auf das Mikrofon{errorMsg ? `: ${errorMsg}` : '.'}</p>
          <button className="mic-btn" onClick={onRequest}>Erneut versuchen</button>
        </div>
      );
  }
}

export function Launcher() {
  const { mic, errorMsg, request } = useMicPermissionGate();
  const micReady = mic === 'granted';

  return (
    <div className="launcher-page">
      <div className="launcher-box">
        <h1>Respy-Spiele</h1>
        <MicStatus mic={mic} errorMsg={errorMsg} onRequest={request} />
        <main>
          {GAMES.map((g) => (g.needsMic && !micReady ? (
            <span key={g.href} className="card card-disabled" aria-disabled="true">
              {g.label}
            </span>
          ) : (
            <a key={g.href} className="card" href={g.href}>{g.label}</a>
          )))}
        </main>
      </div>
    </div>
  );
}

export default Launcher;
