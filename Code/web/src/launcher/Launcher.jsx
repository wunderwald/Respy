import './launcher.css';

// Direct navigation to each game's own standalone HTML entry — the web
// equivalent of the Electron app's launcher spawning a separate frontend.
const GAMES = [
  { href: 'trainingGame.html', label: 'River Crossing' },
  { href: 'chromeDinoGame.html', label: 'Breath Runner' },
];

export function Launcher() {
  return (
    <>
      <h1>Respy games</h1>
      <main>
        {GAMES.map((g) => (
          <a key={g.href} className="card" href={g.href}>{g.label}</a>
        ))}
      </main>
    </>
  );
}

export default Launcher;
