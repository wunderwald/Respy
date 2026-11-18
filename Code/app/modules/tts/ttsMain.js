// ttsMain.js — local text-to-speech for the Electron main process.
//
// Piper TTS (German voice) runs in its own Python environment under app/tts/
// — downloaded by `npm run tts:setup`, not part of git (~100 MB). Without it
// the read-out is simply unavailable: status() says why, and the
// experimenter UI disables its "read out questions" switch.
//
// Rendered audio is cached in app/tts/cache/, one WAV per text + voice
// settings, so each text is rendered only once (≈ 0.1 s per question plus
// ≈ 0.2–0.5 s to load the voice, per prerender() call that has new texts).
//
//   status()          → { available, reason, voice }
//   prerender(texts)  → { ok, files: { text: wavPath }, errors: [..] }
//   read(wavPath)     → Buffer (cache files only)

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { spawn } = require("child_process");

const APP_DIR = path.join(__dirname, "..", "..");

const TTS = {
  DIR:            path.join(APP_DIR, "tts"),
  VOICE:          "de_DE-kerstin-low",   // Piper voice (tts/voices/<VOICE>.onnx + .onnx.json)
  LENGTH_SCALE:   1.0,                   // > 1 = slower speech
  RISE_SEMITONES: 6,                     // question intonation: pitch rise at the end (0 = off)
  RISE_SECS:      0.6,                   // … over the last this-many seconds of voiced speech
  TIMEOUT_MS:     60000,
};

const pythonPath = () => process.platform === "win32"
  ? path.join(TTS.DIR, "venv", "Scripts", "python.exe")
  : path.join(TTS.DIR, "venv", "bin", "python");
const modelPath  = () => path.join(TTS.DIR, "voices", `${TTS.VOICE}.onnx`);
const renderPy   = path.join(__dirname, "render.py");
const cacheDir   = () => path.join(TTS.DIR, "cache");

function status() {
  const missing = [
    [pythonPath(), "TTS environment"],
    [modelPath(), `voice ${TTS.VOICE}`],
    [`${modelPath()}.json`, `voice ${TTS.VOICE} config`],
    [renderPy, "render.py"],
  ].filter(([p]) => !fs.existsSync(p)).map(([, what]) => what);
  return missing.length
    ? { available: false, voice: TTS.VOICE, reason: `Piper TTS not installed (missing: ${missing.join(", ")}) — run "npm run tts:setup" in app/` }
    : { available: true, voice: TTS.VOICE, reason: "" };
}

// Cache file per text + everything that changes the sound.
function cacheFile(text) {
  const key = crypto.createHash("sha1")
    .update(JSON.stringify([TTS.VOICE, TTS.LENGTH_SCALE, TTS.RISE_SEMITONES, TTS.RISE_SECS, text]))
    .digest("hex").slice(0, 20);
  return path.join(cacheDir(), `${key}.wav`);
}

// One render run at a time: two overlapping calls (preset switch + Start)
// never write the same cache file twice.
let queue = Promise.resolve();

function prerender(texts) {
  const run = queue.then(() => prerenderNow(texts));
  queue = run.catch(() => {});
  return run;
}

async function prerenderNow(texts) {
  const st = status();
  if (!st.available) return { ok: false, files: {}, errors: [st.reason] };

  const unique = [...new Set((texts ?? []).filter((t) => typeof t === "string" && t.trim()))];
  const files = Object.fromEntries(unique.map((t) => [t, cacheFile(t)]));
  const jobs = unique.filter((t) => !fs.existsSync(files[t])).map((t) => ({ text: t, out: files[t] }));
  if (jobs.length === 0) return { ok: true, files, errors: [] };

  fs.mkdirSync(cacheDir(), { recursive: true });
  const request = {
    model: modelPath(), length_scale: TTS.LENGTH_SCALE,
    rise_semitones: TTS.RISE_SEMITONES, rise_secs: TTS.RISE_SECS, jobs,
  };
  const { code, stdout, stderr } = await runPython(request);
  const results = stdout.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } });
  const errors = [];
  if (code !== 0) errors.push(stderr.trim().split("\n").pop() || `render.py exited with code ${code}`);
  for (const r of results) if (r && !r.ok) errors.push(`${path.basename(r.out)}: ${r.error}`);

  // Only texts whose file now exists count as rendered.
  const done = Object.fromEntries(Object.entries(files).filter(([, f]) => fs.existsSync(f)));
  const missing = unique.filter((t) => !done[t]);
  if (missing.length && errors.length === 0) errors.push(`no audio for: ${missing.join(" | ")}`);
  return { ok: missing.length === 0, files: done, errors };
}

function runPython(request) {
  return new Promise((resolve) => {
    let stdout = "", stderr = "", finished = false;
    const child = spawn(pythonPath(), [renderPy], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    const finish = (code) => { if (!finished) { finished = true; clearTimeout(timer); resolve({ code, stdout, stderr }); } };
    const timer = setTimeout(() => { stderr += "\ntimed out"; child.kill(); finish(-1); }, TTS.TIMEOUT_MS);
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("error", (e) => { stderr += `\n${e.message}`; finish(-1); });
    child.on("close", (code) => finish(code));
    child.stdin.end(JSON.stringify(request));
  });
}

function read(wavPath) {
  const resolved = path.resolve(wavPath);
  if (!resolved.startsWith(path.resolve(cacheDir()) + path.sep)) throw new Error("not a TTS cache file");
  return fs.readFileSync(resolved);
}

module.exports = { TTS, status, prerender, read };
