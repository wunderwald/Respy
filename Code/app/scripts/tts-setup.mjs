// tts-setup.mjs — installs the optional local TTS (iBreath question read-out).
//
//   npm run tts:setup          (from app/)
//
// Creates app/tts/ (git-ignored, ~100 MB):
//   tts/venv/     Python environment with piper-tts + praat-parselmouth
//                 (versions pinned in modules/tts/requirements.txt)
//   tts/voices/   the German Piper voice (TTS.VOICE in modules/tts/ttsMain.js)
//   tts/cache/    rendered questions (filled by the app)
// …then renders a test question. Same steps on Windows and macOS. Needs
// Python ≥ 3.9 (set TTS_PYTHON to pick a specific one) and internet access.
// Safe to re-run: existing parts are kept. Uninstall: delete app/tts/.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const APP = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const tts = require(path.join(APP, 'modules', 'tts', 'ttsMain.js'));
const { TTS } = tts;
const WIN = process.platform === 'win32';
const VENV_PY = WIN ? path.join(TTS.DIR, 'venv', 'Scripts', 'python.exe') : path.join(TTS.DIR, 'venv', 'bin', 'python');

const step = (msg) => console.log(`\n▸ ${msg}`);
const fail = (msg) => { console.error(`\n✗ ${msg}`); process.exit(1); };

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (r.error || r.status !== 0) fail(`${cmd} ${args.join(' ')} failed${r.error ? `: ${r.error.message}` : ''}`);
}

// A Python ≥ 3.9 to create the environment with.
function findPython() {
  const candidates = process.env.TTS_PYTHON ? [[process.env.TTS_PYTHON]]
    : WIN ? [['py', '-3'], ['python'], ['python3']] : [['python3'], ['python']];
  for (const [cmd, ...pre] of candidates) {
    const r = spawnSync(cmd, [...pre, '-c', 'import sys; print("%d.%d" % sys.version_info[:2])'], { encoding: 'utf8' });
    if (r.status !== 0) continue;
    const [maj, min] = r.stdout.trim().split('.').map(Number);
    if (maj === 3 && min >= 9) return { cmd, pre, version: r.stdout.trim() };
  }
  return null;
}

async function download(url, dest) {
  if (fs.existsSync(dest)) { console.log(`  already there: ${path.basename(dest)}`); return; }
  console.log(`  ${url}`);
  const res = await fetch(url);
  if (!res.ok) fail(`download failed (HTTP ${res.status}): ${url}`);
  const tmp = `${dest}.part`;
  fs.writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
  fs.renameSync(tmp, dest);
}

fs.mkdirSync(path.join(TTS.DIR, 'voices'), { recursive: true });

step('Python environment (app/tts/venv)');
if (fs.existsSync(VENV_PY)) {
  console.log('  already there');
} else {
  const py = findPython();
  if (!py) fail('no Python ≥ 3.9 found — install one (python.org) or set TTS_PYTHON to its path');
  console.log(`  using ${[py.cmd, ...py.pre].join(' ')} (Python ${py.version})`);
  run(py.cmd, [...py.pre, '-m', 'venv', path.join(TTS.DIR, 'venv')]);
}

step('piper-tts + praat-parselmouth');
run(VENV_PY, ['-m', 'pip', 'install', '--disable-pip-version-check', '-q', '-r', path.join(APP, 'modules', 'tts', 'requirements.txt')]);

step(`voice ${TTS.VOICE}`);
// e.g. de_DE-kerstin-low → de/de_DE/kerstin/low/de_DE-kerstin-low.onnx
const [locale, name, quality] = TTS.VOICE.split('-');
const base = `https://huggingface.co/rhasspy/piper-voices/resolve/main/${locale.split('_')[0]}/${locale}/${name}/${quality}/${TTS.VOICE}`;
await download(`${base}.onnx.json`, path.join(TTS.DIR, 'voices', `${TTS.VOICE}.onnx.json`));
await download(`${base}.onnx`, path.join(TTS.DIR, 'voices', `${TTS.VOICE}.onnx`));

step('test render');
const st = tts.status();
if (!st.available) fail(st.reason);
const text = `Test ${new Date().toISOString()}: Hat der Fisch genau zu deinem Atem gepasst?`;
const t0 = Date.now();
const res = await tts.prerender([text]);
if (!res.ok) fail(`test render failed: ${res.errors.join('; ')}`);
fs.unlinkSync(res.files[text]);   // a one-off text — don't keep it in the cache
console.log(`  ok — rendered in ${((Date.now() - t0) / 1000).toFixed(1)} s`);

console.log('\n✓ TTS ready. iBreath\'s "read out questions" switch is now available.');
