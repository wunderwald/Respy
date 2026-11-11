// Experimenter control window — stream selection + frontend-specific controls.
import { StreamManager } from './modules/stream/stream.js';
import { EYELINK_OFFLINE, EYELINK_UNAVAILABLE_STATES, EYELINK_SETUP_STATES }
  from './modules/stream/eyelinkControl.js';
import { CONFIG }        from './modules/ibreath/config.js';
import { CONFIG as BG }  from './modules/bioGame/bioGame_config.js';
import { CONFIG as BTG } from './modules/beltTrainingGame/beltTrainingGame_config.js';
import { CONFIG as BL }  from './modules/baseline/baseline_config.js';
import { loadNaturalBpm, RESTING, baselineFileStem } from './modules/baseline/baselineFiles.js';
import { SMOOTH_WINDOW_OPTIONS } from './modules/signal/signalUtils.js';
import { attachSubjectCheck } from './modules/subjectCheck.js';

// ── Frontend detection ────────────────────────────────────────────────────────

const frontend = new URLSearchParams(location.search).get('frontend') || 'ibreath';

// ── Resp stream (all frontends) ───────────────────────────────────────────────

const respStream = new StreamManager({
  container: document.getElementById('stream-bar'),
  label: 'resp stream',
  filter: 'resp',
});
respStream.on('sample', ({ value, channels }) => {
  window.api.stream.sendSample({ value, channels });
});

let lastRespStatus = null;
respStream.on('status', (event) => {
  lastRespStatus = event;
  window.api.stream.sendStatus(event);
});

// Scene window registers its onStatus handler after a dynamic import; if the
// stream already connected before that handler was ready the event is lost.
// When the scene calls requestStatus(), replay the last known status.
window.api.stream.onRequestStatus(() => {
  if (lastRespStatus) window.api.stream.sendStatus(lastRespStatus);
});

// ── Gaze stream (ibreath only) ────────────────────────────────────────────────

let gazeStream = null;
if (frontend === 'ibreath') {
  gazeStream = new StreamManager({
    container: document.getElementById('gaze-bar'),
    wsUrl: CONFIG.GAZE_STREAM_URL,
    label: 'gaze stream',
    filter: 'gaze',
  });
  gazeStream.on('sample', ({ channels }) => {
    window.api.stream.sendGazeSample({ channels });
  });
  gazeStream.on('status', ({ type }) => {
    if (type === 'disconnected') window.api.stream.sendGazeSample({ channels: null });
  });
} else {
  document.getElementById('gaze-bar').style.display = 'none';
}

// ── Timer bar (ibreath + baseline) ───────────────────────────────────────────

if (!['ibreath', 'baseline'].includes(frontend)) {
  document.getElementById('timer-bar').style.display = 'none';
}

// Breath-smoothing window dropdown (samples) — same control in every
// frontend that smooths the breath. Lives in the settings bar, so it locks
// with the other settings once the session starts.
function smoothWindowSelect(id, defaultValue, note = '') {
  const options = SMOOTH_WINDOW_OPTIONS.map((n) =>
    `<option value="${n}" ${n === defaultValue ? 'selected' : ''}>${n}</option>`).join('');
  return `
    <span class="label">smoothing</span>
    <select id="${id}" class="stream-select"
            title="Breath smoothing window in samples — larger = smoother but more delayed (≈ half the window)${note}">${options}</select>`;
}

function fmtTime(secs) {
  if (secs == null) return '—';
  secs = Math.max(0, Math.floor(secs));
  return `${Math.floor(secs / 60)}:${(secs % 60).toString().padStart(2, '0')}`;
}

// ── Settings bar (ibreath, bioGame, beltTrainingGame, baseline) ──────────────

const settingsBar = document.getElementById('settings-bar');

if (!['ibreath', 'bioGame', 'beltTrainingGame', 'baseline'].includes(frontend)) {
  settingsBar.style.display = 'none';
}

// ── Frontend-specific stats section ──────────────────────────────────────────

const statsEl = document.getElementById('stats');

if (frontend === 'ibreath') {
  // ── iBreath HUD ─────────────────────────────────────────────────────────────

  statsEl.innerHTML = `
    <span>
      <span class="label">trial</span>
      <span id="ib-trial">—</span>
    </span>
    <span id="ib-trial-type">—</span>
    <span>
      <span class="label">delay</span>
      <span id="ib-delay">—</span>
    </span>
    <span>
      <span class="label">subject</span>
      <input id="ib-subject" type="text" value="${CONFIG.SUBJECT_CODE}"
             placeholder="subject code" autocomplete="off" spellcheck="false" />
    </span>
    <span id="ib-controls">
      <button id="ib-start-btn"       disabled>Start</button>
      <button id="ib-next-btn"        style="display:none">Next trial</button>
      <button id="ib-abort-btn"       style="display:none">Abort trial</button>
      <button id="ib-pause-btn"       style="display:none">Pause</button>
      <button id="ib-play-btn"        style="display:none">Play</button>
      <button id="ib-cal-retry-btn"   style="display:none">Retry calibration</button>
      <button id="ib-cal-default-btn" style="display:none">Use default calibration</button>
    </span>
    <span id="ib-space-hint" class="space-hint" style="display:none">Press SPACE to continue</span>
    <span id="ib-eyetrack-group" class="eyetrack-group" style="display:none">
      <span class="label">eye tracker</span>
      <span id="ib-eyelink-state" class="eyelink-state" data-state="offline"
            title="run_bridge.py control connection (${CONFIG.EYELINK_CONTROL_URL})">offline</span>
      <button id="ib-gaze-btn" disabled title="Run an EyeLink calibration on the participant screen">Calibrate</button>
      <button id="ib-eyelink-rec-btn" disabled>Start recording</button>
      <label id="debug-gaze-label"><input type="checkbox" id="s-debug-gaze" ${CONFIG.DEBUG_GAZE ? 'checked' : ''}> show gaze position</label>
      <span id="ib-eyelink-hint" class="eyelink-hint" style="display:none"
            title="EyeLink setup mode only ends when the operator exits it">Host PC: C calibrate · V validate · Enter accept · Esc exit setup</span>
      <span id="ib-eyelink-error" class="preset-warning" style="display:none"></span>
    </span>
  `;

  // ── iBreath settings bar ────────────────────────────────────────────────────

  settingsBar.innerHTML = `
    <span class="label">settings</span>
    <label><input type="checkbox" id="s-use-eye-tracking"> use eye tracking</label>
    <span class="label">signal type</span>
    <select id="s-signal-type" class="stream-select">
      <option value="physiological" ${CONFIG.INPUT_SIGNAL_TYPE === 'physiological' ? 'selected' : ''}>Physiological</option>
      <option value="peaksOnly"     ${CONFIG.INPUT_SIGNAL_TYPE === 'peaksOnly'     ? 'selected' : ''}>Peaks only</option>
    </select>
    <span class="label">cal secs</span>
    <input id="s-cal-secs" type="number" class="settings-num" min="5" max="120" step="5"
           value="${CONFIG.CALIBRATION_SECS}" />
    <span class="label">trials</span>
    <input id="s-num-trials" type="number" class="settings-num" min="1" step="1"
           value="${CONFIG.MAX_NUM_TRIALS}" title="Number of trials — set by the preset if it defines numTrials" />
    <span id="s-trials-warning" class="preset-warning" style="display:none"></span>
    ${smoothWindowSelect('s-smooth-window', CONFIG.SMOOTH_WINDOW, '. Physiological signal only (not used for Peaks only).')}
    <span class="label">preset</span>
    <select id="s-preset" class="stream-select">
      <option value="">None (sync only)</option>
      <option value="iBreath_mixed_questions">iBreath — mixed questions</option>
      <option value="iBreath_only_sync_question">iBreath — sync only</option>
      <option value="iBreath_adults">iBreath — adults</option>
      <option value="iBeat_mixed_questions">iBeat — mixed questions</option>
      <option value="iBeat_only_sync_question">iBeat — sync only</option>
      <option value="iBeat_adults">iBeat — adults</option>
      <option value="__browse__">Browse…</option>
    </select>
    <span id="s-preset-status" style="font-size:11px;opacity:0.6"></span>
    <span id="ib-preset-warning" class="preset-warning" style="display:none"></span>
  `;

  const stateEl            = document.getElementById('ib-state-text');   // in #timer-bar
  const elapsedEl          = document.getElementById('ib-elapsed');       // in #timer-bar
  const remainingEl        = document.getElementById('ib-remaining');     // in #timer-bar
  const trialEl            = document.getElementById('ib-trial');
  const delayEl            = document.getElementById('ib-delay');
  const trialTypeEl        = document.getElementById('ib-trial-type');
  const subjectInput       = document.getElementById('ib-subject');
  const subjectCheck       = attachSubjectCheck(subjectInput, document.getElementById('ib-start-btn'),
    (code) => `${CONFIG.DATA_DIR}/${code}/trialData.csv`);
  const startBtn           = document.getElementById('ib-start-btn');
  const nextBtn            = document.getElementById('ib-next-btn');
  const spaceHintEl        = document.getElementById('ib-space-hint');
  const abortBtn           = document.getElementById('ib-abort-btn');
  const pauseBtn           = document.getElementById('ib-pause-btn');
  const playBtn            = document.getElementById('ib-play-btn');
  const gazeBtn            = document.getElementById('ib-gaze-btn');
  const calRetryBtn        = document.getElementById('ib-cal-retry-btn');
  const calDefaultBtn      = document.getElementById('ib-cal-default-btn');
  const useEyeTrackingBox  = document.getElementById('s-use-eye-tracking');
  const eyetrackGroupEl    = document.getElementById('ib-eyetrack-group');
  const eyelinkStateEl     = document.getElementById('ib-eyelink-state');
  const eyelinkRecBtn      = document.getElementById('ib-eyelink-rec-btn');
  const eyelinkErrorEl     = document.getElementById('ib-eyelink-error');
  const eyelinkHintEl      = document.getElementById('ib-eyelink-hint');
  const gazeBarEl          = document.getElementById('gaze-bar');
  eyetrackGroupEl.appendChild(gazeBarEl);   // fold the existing gaze-stream status pill into the shared group

  const signalTypeSelect  = document.getElementById('s-signal-type');
  const numTrialsInput    = document.getElementById('s-num-trials');
  const trialsWarningEl   = document.getElementById('s-trials-warning');
  const presetSelect      = document.getElementById('s-preset');
  const presetStatusEl    = document.getElementById('s-preset-status');
  const presetWarningEl   = document.getElementById('ib-preset-warning');

  // ── Clocks ──────────────────────────────────────────────────────────────────

  let experimentStartedAt = null;
  let stateTimer          = null;   // { startedAt, duration } or null

  setInterval(() => {
    elapsedEl.textContent   = experimentStartedAt
      ? fmtTime((Date.now() - experimentStartedAt) / 1000)
      : '—';
    remainingEl.textContent = (stateTimer && stateTimer.duration != null)
      ? fmtTime(stateTimer.duration - (Date.now() - stateTimer.startedAt) / 1000)
      : '—';
  }, 250);

  // ── Receive state from scene window ─────────────────────────────────────────

  let gazeCalibrating  = false;
  let eyelinkState     = EYELINK_OFFLINE;
  let eyelinkRecording = false;

  const EYELINK_LABELS = {
    setup:   'setup — waiting for operator',
    aborted: 'aborted — bridge shutting down',
  };

  // Eye-tracker buttons only make sense while the bridge's control socket is
  // up and it isn't busy connecting / calibrating.
  function updateEyelinkControls() {
    const online  = !EYELINK_UNAVAILABLE_STATES.has(eyelinkState);
    const inSetup = EYELINK_SETUP_STATES.has(eyelinkState);
    const busy    = gazeCalibrating || inSetup || eyelinkState === 'connecting';
    const label   = EYELINK_LABELS[eyelinkState] ?? eyelinkState;
    eyelinkStateEl.textContent   = eyelinkRecording && eyelinkState !== 'recording'
      ? `${label} (recording)` : label;
    eyelinkHintEl.style.display  = inSetup ? '' : 'none';
    eyelinkStateEl.dataset.state = eyelinkState;
    gazeBtn.disabled             = !online || busy;
    eyelinkRecBtn.disabled       = !online || busy;
    eyelinkRecBtn.textContent    = eyelinkRecording ? 'Stop recording' : 'Start recording';
  }

  window.api.hud.onState(({ stateText, stateColor, trialText, delayText, trialType,
                             startEnabled, nextVisible, abortVisible, pauseVisible, playVisible, inputsLocked,
                             experimentStartedAt: esa, stateTimer: st, gazeCalibrating: gc, calFailed,
                             eyelinkState: es, eyelinkRecording: er, eyelinkError: ee }) => {
    if (esa !== undefined) experimentStartedAt = esa;
    if (st  !== undefined) stateTimer          = st;
    if (stateText    !== undefined) stateEl.textContent        = stateText;
    if (stateColor   !== undefined) stateEl.style.color        = stateColor;
    if (trialText    !== undefined) trialEl.textContent        = trialText;
    if (delayText    !== undefined) delayEl.textContent        = delayText;
    if (trialType    !== undefined) {
      trialTypeEl.textContent  = trialType ? trialType.toUpperCase() : '—';
      trialTypeEl.dataset.type = trialType ?? '';
    }
    if (startEnabled !== undefined) subjectCheck.setStartEnabled(startEnabled);
    if (nextVisible  !== undefined) {
      nextBtn.style.display     = nextVisible ? '' : 'none';
      spaceHintEl.style.display = nextVisible ? '' : 'none';
    }
    if (abortVisible !== undefined) abortBtn.style.display     = abortVisible ? '' : 'none';
    if (pauseVisible !== undefined) pauseBtn.style.display     = pauseVisible ? '' : 'none';
    if (playVisible  !== undefined) playBtn.style.display      = playVisible  ? '' : 'none';
    if (gc !== undefined) gazeCalibrating  = gc;
    if (es !== undefined) eyelinkState     = es;
    if (er !== undefined) eyelinkRecording = er;
    if (gc !== undefined || es !== undefined || er !== undefined) updateEyelinkControls();
    if (ee !== undefined) {
      eyelinkErrorEl.textContent   = ee ? `⚠ ${ee}` : '';
      eyelinkErrorEl.style.display = ee ? '' : 'none';
    }
    if (calFailed    !== undefined) {
      calRetryBtn.style.display   = calFailed ? '' : 'none';
      calDefaultBtn.style.display = calFailed ? '' : 'none';
    }
    if (inputsLocked !== undefined) {
      subjectInput.disabled       = inputsLocked;
      if (inputsLocked) subjectCheck.lock();
      if (inputsLocked) {
        // Stream selection stays live even once everything else locks, so the
        // experimenter can recover from a dropped stream mid-session.
        for (const el of settingsBar.querySelectorAll('input, button, select')) {
          el.disabled = true;
        }
      }
    }
  });

  // ── Send actions to scene window ─────────────────────────────────────────────

  startBtn.addEventListener('click', () => {
    if (!subjectCheck.isValid()) return;   // the hint under the subject field says why
    const numTrials = parseTrialCount(numTrialsInput.value);
    if (numTrials == null) {   // the field is editable then; the warning next to it says why
      updateTrialsWarning();
      numTrialsInput.focus();
      return;
    }
    window.api.hud.sendAction({
      type:            'start',
      subjectCode:     subjectCheck.code(),
      // Recorded in trialData.csv (`preset`); commas would break the column.
      presetName:      (activePreset?.name ?? '').replace(/[,\r\n]/g, ' '),
      debugGaze:       document.getElementById('s-debug-gaze').checked,
      inputSignalType: signalTypeSelect.value,
      calibrationSecs: parseInt(document.getElementById('s-cal-secs').value) || CONFIG.CALIBRATION_SECS,
      numTrials,
      smoothWindow:    Number(document.getElementById('s-smooth-window').value),
      questions:       activePreset?.questions ?? null,
      configOverrides: activePreset?.configOverrides ?? null,
    });
  });
  nextBtn.addEventListener('click',  () => window.api.hud.sendAction({ type: 'next' }));
  abortBtn.addEventListener('click', () => window.api.hud.sendAction({ type: 'abort' }));
  pauseBtn.addEventListener('click', () => window.api.hud.sendAction({ type: 'pause' }));
  playBtn.addEventListener('click',  () => window.api.hud.sendAction({ type: 'play' }));
  gazeBtn.addEventListener('click',  () => window.api.hud.sendAction({ type: 'recalibrateGaze' }));
  eyelinkRecBtn.addEventListener('click', () => window.api.hud.sendAction({
    type: eyelinkRecording ? 'eyelinkStopRecording' : 'eyelinkStartRecording',
  }));
  calRetryBtn.addEventListener('click',   () => window.api.hud.sendAction({ type: 'retryCalibration' }));
  calDefaultBtn.addEventListener('click', () => window.api.hud.sendAction({ type: 'useDefaultCalibration' }));

  // ── Eye tracking on/off — unchecked by default; hides the whole eye-tracking group ────

  function applyEyeTrackingVisibility(enabled) {
    eyetrackGroupEl.style.display = enabled ? '' : 'none';
  }
  applyEyeTrackingVisibility(useEyeTrackingBox.checked);

  function setEyeTracking(enabled) {
    useEyeTrackingBox.checked = enabled;
    applyEyeTrackingVisibility(enabled);
    window.api.hud.sendAction({ type: 'setUseEyeTracking', value: enabled });
  }
  useEyeTrackingBox.addEventListener('change', () => setEyeTracking(useEyeTrackingBox.checked));

  // ── Presets ──────────────────────────────────────────────────────────────────
  //
  // A preset is a JSON file (bundled under app/presets/, or any file via
  // "Browse…") that can define: inputSignalType / useEyeTracking / numTrials
  // (pre-filled and locked in the UI the moment the preset loads — not
  // deferred to Start), a custom `questions` list (replacing the default
  // sync-only question), and arbitrary `configOverrides` (applied to CONFIG
  // at Start, same as every other setting). See docs/ibreath.md for the file
  // format.

  let activePreset = null;

  // Whole number ≥ 1, or null.
  function parseTrialCount(v) {
    const n = Number(v);
    return Number.isInteger(n) && n >= 1 ? n : null;
  }

  // Trial attributes are balanced in shuffled blocks — left/right and
  // pufferfish/starfish in blocks of 4 (sync/async in blocks of 2) — so
  // only a multiple of 4 gives exactly balanced counts. Not blocking: the
  // session runs either way.
  function updateTrialsWarning() {
    const n = parseTrialCount(numTrialsInput.value);
    const msg = n == null
      ? '⚠ trials must be a whole number ≥ 1'
      : n % 4 !== 0
        ? `⚠ ${n} is not a multiple of 4: trial params won't be exactly balanced`
        : '';
    trialsWarningEl.textContent   = msg;
    trialsWarningEl.style.display = msg ? '' : 'none';
  }
  numTrialsInput.addEventListener('input', updateTrialsWarning);

  function updateSyncWarning(questions) {
    const list = questions?.length ? questions : CONFIG.QUESTIONS;
    const hasSync = list.some(q => q.id === 'sync');
    presetWarningEl.style.display = hasSync ? 'none' : '';
    presetWarningEl.textContent = hasSync ? '' :
      '⚠ no "sync" question in this preset — the adaptive async delay will never change';
  }

  function applyPreset(preset) {
    activePreset = preset;

    if (preset?.inputSignalType !== undefined) {
      signalTypeSelect.value    = preset.inputSignalType;
      signalTypeSelect.disabled = true;
    } else {
      signalTypeSelect.disabled = false;
    }

    if (preset?.useEyeTracking != null) {
      setEyeTracking(preset.useEyeTracking);
      useEyeTrackingBox.disabled = true;
    } else {
      useEyeTrackingBox.disabled = false;
    }

    if (preset?.numTrials !== undefined) {
      const n = parseTrialCount(preset.numTrials);
      if (n != null) {
        numTrialsInput.value    = n;
        numTrialsInput.disabled = true;
      } else {
        // Don't lock a bad value in — leave the field editable and say why.
        numTrialsInput.disabled = false;
        const warn = `⚠ preset numTrials ${JSON.stringify(preset.numTrials)} is not a whole number ≥ 1 — set trials manually`;
        presetStatusEl.textContent = presetStatusEl.textContent ? `${presetStatusEl.textContent} · ${warn}` : warn;
      }
    } else {
      numTrialsInput.disabled = false;
    }
    updateTrialsWarning();

    updateSyncWarning(preset?.questions);
  }

  async function fetchBundledPreset(name) {
    const res = await fetch(`presets/${name}.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  presetSelect.addEventListener('change', async () => {
    const value = presetSelect.value;
    presetStatusEl.textContent = '';

    if (value === '') {
      applyPreset(null);
      return;
    }

    if (value === '__browse__') {
      try {
        const path = await window.api.pickFile({ title: 'Load iBreath preset', extensions: ['json'] });
        if (!path) { presetSelect.value = ''; applyPreset(null); return; }
        const result = await window.api.readFile(path);
        if (!result.ok) throw new Error(result.error);
        const preset = JSON.parse(result.content);
        const fileName = path.split(/[\\/]/).pop();
        preset.name ??= fileName.replace(/\.json$/i, '');   // recorded as the preset's name
        presetStatusEl.textContent = `loaded: ${fileName}`;
        applyPreset(preset);   // may append a warning to the status
      } catch (err) {
        console.error('[Preset] failed to load:', err);
        presetStatusEl.textContent = `⚠ failed to load: ${err.message}`;
        presetSelect.value = '';
        applyPreset(null);
      }
      return;
    }

    try {
      applyPreset(await fetchBundledPreset(value));
    } catch (err) {
      console.error('[Preset] failed to load:', err);
      presetStatusEl.textContent = `⚠ failed to load: ${err.message}`;
      presetSelect.value = '';
      applyPreset(null);
    }
  });

  applyPreset(null);   // initial state: no preset, default sync-only question

  // ── Keyboard shortcuts ────────────────────────────────────────────────────────

  window.addEventListener('keydown', (e) => {
    if (document.activeElement === subjectInput) return;
    switch (e.code) {
      case 'Space':      e.preventDefault(); window.api.hud.sendAction({ type: 'next' }); break;
      case 'Escape':     window.api.hud.sendAction({ type: 'abort' }); break;
      // iBreath's #onResponse expects the side ('left' = first answer label).
      case 'ArrowLeft':  window.api.hud.sendAction({ type: 'response', value: 'left' });  break;
      case 'ArrowRight': window.api.hud.sendAction({ type: 'response', value: 'right' }); break;
    }
  });

  // ── Request current HUD state on load ────────────────────────────────────────

  window.api.hud.sendAction({ type: 'ready' });

} else if (frontend === 'visualizer') {
  // ── Visualizer status ────────────────────────────────────────────────────────

  statsEl.innerHTML = `
    <span><span id="v-status-dot"></span><span id="v-status-text">connecting…</span></span>
    <span><span class="label">value</span><span id="v-val">—</span></span>
    <span><span class="label">samples/s</span><span id="v-sps">—</span></span>
  `;
  const vDotEl  = document.getElementById('v-status-dot');
  const vTextEl = document.getElementById('v-status-text');
  const vValEl  = document.getElementById('v-val');
  const vSpsEl  = document.getElementById('v-sps');

  window.api.frontend.onState(({ dotClass, statusText, value, sps }) => {
    if (dotClass   !== undefined) vDotEl.className    = dotClass;
    if (statusText !== undefined) vTextEl.textContent = statusText;
    if (value      !== undefined && value !== null) vValEl.textContent = value;
    if (sps        !== undefined) vSpsEl.textContent  = sps;
  });

} else if (frontend === 'bioGame') {
  // ── BioGame HUD ──────────────────────────────────────────────────────────────

  statsEl.innerHTML = `
    <span>
      <span class="label">status</span>
      <span id="bg-status">waiting for stream…</span>
    </span>
    <span>
      <span class="label">subject</span>
      <input id="bg-subject" type="text" value="${BG.SUBJECT_CODE}"
             placeholder="subject code" autocomplete="off" spellcheck="false" />
    </span>
    <span>
      <span class="label">group</span>
      <select id="bg-group" class="stream-select">
        <option value="slow">Target (slow 6 BPM)</option>
        <option value="natural">Control (natural)</option>
      </select>
    </span>
    <span id="bg-natural-bpm-wrap">
      <span class="label">natural BPM</span>
      <input id="bg-natural-bpm" type="number" min="4" max="20" step="0.5"
             value="${BG.NATURAL_BPM}" style="width:46px" />
      <span id="bg-bpm-source" style="font-size:11px;opacity:0.5">—</span>
    </span>
    <span>
      <span class="label">score</span>
      <span id="bg-score">—</span>
    </span>
    <span id="ib-controls">
      <button id="bg-start-btn"       disabled>Start</button>
      <button id="bg-next-btn"        style="display:none">Start Game 2</button>
      <button id="bg-abort-btn"       style="display:none">Abort game</button>
      <button id="bg-cal-retry-btn"   style="display:none">Retry calibration</button>
      <button id="bg-cal-default-btn" style="display:none">Use default calibration</button>
    </span>
    <span id="bg-space-hint" class="space-hint" style="display:none">Press SPACE to continue</span>
    <span id="bg-warning" style="display:none;color:#e0a838;"></span>
  `;

  // ── bioGame settings bar ──────────────────────────────────────────────────────

  settingsBar.innerHTML = `
    <span class="label">settings</span>
    <label><input type="checkbox" id="bg-show-curve" ${BG.SHOW_CURVE ? 'checked' : ''}>
      show target curve</label>
    <span class="label">cal secs</span>
    <input id="bg-cal-secs" type="number" class="settings-num" min="5" max="120" step="5"
           value="${BG.CALIBRATION_SECS}" />
    ${smoothWindowSelect('bg-smooth-window', BG.SMOOTH_WINDOW)}
  `;

  const bgStatusEl   = document.getElementById('bg-status');
  const bgSubjectEl  = document.getElementById('bg-subject');
  const bgSubjectCheck = attachSubjectCheck(bgSubjectEl, document.getElementById('bg-start-btn'),
    (code) => `${BG.DATA_DIR}/${code}/eventData.csv`);
  const bgGroupEl    = document.getElementById('bg-group');
  const bgNatBpmWrap = document.getElementById('bg-natural-bpm-wrap');
  const bgNatBpmEl   = document.getElementById('bg-natural-bpm');
  const bgBpmSrcEl   = document.getElementById('bg-bpm-source');
  const bgScoreEl    = document.getElementById('bg-score');
  const bgStartBtn      = document.getElementById('bg-start-btn');
  const bgNextBtn       = document.getElementById('bg-next-btn');
  const bgSpaceHintEl   = document.getElementById('bg-space-hint');
  const bgAbortBtn      = document.getElementById('bg-abort-btn');
  const bgCalRetryBtn   = document.getElementById('bg-cal-retry-btn');
  const bgCalDefaultBtn = document.getElementById('bg-cal-default-btn');
  const bgWarningEl     = document.getElementById('bg-warning');

  // Show natural-BPM field only for the natural condition
  bgNatBpmWrap.style.display = BG.GROUP === 'natural' ? '' : 'none';
  bgGroupEl.addEventListener('change', () => {
    bgNatBpmWrap.style.display = bgGroupEl.value === 'natural' ? '' : 'none';
  });

  // ── Baseline BPM auto-load ────────────────────────────────────────────────────

  // Natural breathing rate = the subject's *Resting* baseline estimates (see
  // modules/baseline/baselineFiles.js — shared with the baseline writer).
  async function tryLoadBaseline(subjectCode) {
    const res = await loadNaturalBpm(subjectCode, window.api.readFile);

    if (res.status === 'missing') {
      bgBpmSrcEl.textContent = `no ${RESTING.label} baseline for ${subjectCode} — enter manually`;
      bgBpmSrcEl.style.color = '';
      return;
    }
    if (res.status === 'invalid') {
      bgBpmSrcEl.textContent = 'no valid BPM in file — enter manually';
      bgBpmSrcEl.style.color = 'rgba(255,190,60,0.85)';
      return;
    }

    bgNatBpmEl.value       = res.bpm.toFixed(1);
    bgBpmSrcEl.textContent = `auto from ${RESTING.label} baseline (${res.count} estimates, avg ${res.bpm.toFixed(1)} BPM)`;
    bgBpmSrcEl.style.color = 'rgba(100,220,130,0.9)';
  }

  // Trigger on subject change (debounced) and immediately on init
  let bpmLoadTimer = null;
  bgSubjectEl.addEventListener('input', () => {
    clearTimeout(bpmLoadTimer);
    bpmLoadTimer = setTimeout(
      () => tryLoadBaseline(bgSubjectEl.value.trim() || 'TEST'),
      400
    );
  });
  tryLoadBaseline(bgSubjectEl.value.trim() || 'TEST');

  // ── Receive state from scene window ─────────────────────────────────────────

  window.api.frontend.onState(({ stateText, score, startEnabled, startText, nextText,
                                  nextVisible, abortVisible, calFailed, inputsLocked, warning }) => {
    if (stateText    !== undefined) bgStatusEl.textContent      = stateText;
    if (score        != null)       bgScoreEl.textContent       = score;
    if (startEnabled !== undefined) bgSubjectCheck.setStartEnabled(startEnabled);
    if (startText    !== undefined) bgStartBtn.textContent      = startText;
    if (nextText     !== undefined) bgNextBtn.textContent       = nextText;
    if (warning      !== undefined) {
      bgWarningEl.textContent   = warning ?? '';
      bgWarningEl.style.display = warning ? '' : 'none';
    }
    if (nextVisible  !== undefined) {
      bgNextBtn.style.display     = nextVisible ? '' : 'none';
      bgSpaceHintEl.style.display = nextVisible ? '' : 'none';
    }
    if (abortVisible !== undefined) bgAbortBtn.style.display    = abortVisible ? '' : 'none';
    if (calFailed    !== undefined) {
      bgCalRetryBtn.style.display   = calFailed ? '' : 'none';
      bgCalDefaultBtn.style.display = calFailed ? '' : 'none';
    }
    if (inputsLocked !== undefined && inputsLocked) {
      bgSubjectEl.disabled = true;
      bgSubjectCheck.lock();
      bgGroupEl.disabled   = true;
      bgNatBpmEl.disabled  = true;
      // Stream selection stays live even once everything else locks, so the
      // experimenter can recover from a dropped stream mid-session.
      for (const el of settingsBar.querySelectorAll('input, button, select')) {
        el.disabled = true;
      }
    }
  });

  // ── Send actions to scene window ─────────────────────────────────────────────

  bgStartBtn.addEventListener('click', () => {
    if (!bgSubjectCheck.isValid()) return;   // the hint under the subject field says why
    window.api.frontend.sendAction({
      type:            'start',
      subjectCode:     bgSubjectCheck.code(),
      group:           bgGroupEl.value,
      naturalBpm:      parseFloat(bgNatBpmEl.value) || BG.NATURAL_BPM,
      showCurve:       document.getElementById('bg-show-curve').checked,
      calibrationSecs: parseInt(document.getElementById('bg-cal-secs').value) || BG.CALIBRATION_SECS,
      smoothWindow:    Number(document.getElementById('bg-smooth-window').value),
    });
  });
  bgNextBtn.addEventListener('click',  () => window.api.frontend.sendAction({ type: 'next' }));
  bgAbortBtn.addEventListener('click', () => window.api.frontend.sendAction({ type: 'abort' }));
  bgCalRetryBtn.addEventListener('click',   () => window.api.frontend.sendAction({ type: 'retryCalibration' }));
  bgCalDefaultBtn.addEventListener('click', () => window.api.frontend.sendAction({ type: 'useDefaultCalibration' }));

  // ── Keyboard shortcuts ────────────────────────────────────────────────────────

  window.addEventListener('keydown', (e) => {
    if (document.activeElement === bgSubjectEl) return;
    switch (e.code) {
      case 'Space':  e.preventDefault(); window.api.frontend.sendAction({ type: 'next' });  break;
      case 'Escape': window.api.frontend.sendAction({ type: 'abort' }); break;
    }
  });

  // ── Request current state on load ─────────────────────────────────────────────

  window.api.frontend.sendAction({ type: 'ready' });

} else if (frontend === 'baseline') {
  // ── Baseline HUD ─────────────────────────────────────────────────────────────

  statsEl.innerHTML = `
    <span id="bl-status">waiting for stream…</span>
    <span>
      <span class="label">subject</span>
      <input id="bl-subject" type="text" value="TEST"
             placeholder="subject code" autocomplete="off" spellcheck="false" />
    </span>
    <span>
      <span class="label">name</span>
      <select id="bl-name" class="stream-select">
        ${BL.NAMES.map((n) => `<option value="${n.label}">${n.label}</option>`).join('')}
      </select>
    </span>
    <span id="ib-controls">
      <button id="bl-start-btn" disabled>Start</button>
      <button id="bl-next-btn"  style="display:none">Start video</button>
      <button id="bl-abort-btn" style="display:none">Abort</button>
    </span>
    <span id="bl-space-hint" class="space-hint" style="display:none">Press SPACE to continue</span>
    <span id="bl-warning" style="display:none;color:#e0a838;"></span>
  `;

  // ── Baseline settings bar ─────────────────────────────────────────────────

  settingsBar.innerHTML = `
    <span class="label">settings</span>
    <label><input type="checkbox" id="bl-full-video" checked> play full video</label>
    <input id="bl-duration" type="number" class="settings-num" min="1" step="1"
           value="${BL.DURATION_SECS}" disabled />
    <span class="label">secs</span>
    <span id="bl-video-len" class="label"></span>
  `;

  const blStatusEl    = document.getElementById('bl-status');
  const blSubjectEl   = document.getElementById('bl-subject');
  // File name depends on the baseline name too (see refresh on name change below).
  const blSubjectCheck = attachSubjectCheck(blSubjectEl, document.getElementById('bl-start-btn'),
    (code) => {
      const name = BL.NAMES.find((n) => n.label === document.getElementById('bl-name')?.value) ?? BL.NAMES[0];
      return `${baselineFileStem(code, name.slug)}.csv`;
    });
  const blNameEl      = document.getElementById('bl-name');
  const blStartBtn    = document.getElementById('bl-start-btn');
  const blAbortBtn    = document.getElementById('bl-abort-btn');
  const blNextBtn     = document.getElementById('bl-next-btn');
  const blSpaceHintEl = document.getElementById('bl-space-hint');
  const blWarningEl   = document.getElementById('bl-warning');
  const blFullVideoEl = document.getElementById('bl-full-video');
  const blDurationEl  = document.getElementById('bl-duration');
  const blVideoLenEl  = document.getElementById('bl-video-len');

  // Video length as reported by the scene window (null until its metadata
  // has loaded / when there's no playable video).
  let blVideoAvailable = true;
  let blVideoSecs      = null;
  let blLocked         = false;

  function blCustomSecs() {
    const v = parseFloat(blDurationEl.value);
    return Number.isFinite(v) && v > 0 ? v : null;
  }

  // Seconds field is only editable with "play full video" off (and before
  // Start); the hint says what "full video" means right now, and flags
  // custom values the video can't fill.
  function updateDurationControls() {
    blDurationEl.disabled = blLocked || blFullVideoEl.checked;
    let hint;
    if (!blVideoAvailable) {
      hint = `no video — full = ${fmtTime(BL.DURATION_SECS)} countdown`;
    } else if (blVideoSecs == null) {
      hint = 'video length: loading…';
    } else {
      hint = `video length: ${fmtTime(blVideoSecs)}`;
      const custom = blCustomSecs();
      if (!blFullVideoEl.checked && custom != null && custom > blVideoSecs) {
        hint += ' — longer than the video: it loops until the time is up';
      }
    }
    if (!blFullVideoEl.checked && blCustomSecs() == null) hint = 'enter a duration > 0 secs';
    blVideoLenEl.textContent = hint;
  }
  blFullVideoEl.addEventListener('change', updateDurationControls);
  blDurationEl.addEventListener('input', updateDurationControls);
  updateDurationControls();

  const blTimerStateEl   = document.getElementById('ib-state-text');
  const blElapsedEl      = document.getElementById('ib-elapsed');
  const blRemainingEl    = document.getElementById('ib-remaining');

  let blRecordingStartedAt = null;
  let blDurationSecs       = null;

  setInterval(() => {
    if (!blRecordingStartedAt) return;
    const elapsed = (Date.now() - blRecordingStartedAt) / 1000;
    blElapsedEl.textContent   = fmtTime(elapsed);
    blRemainingEl.textContent = blDurationSecs != null
      ? fmtTime(blDurationSecs - elapsed)
      : '—';
  }, 250);

  window.api.frontend.onState(({ stateText, startEnabled, abortVisible, nextVisible, inputsLocked,
                                  recordingStartedAt, duration, warning,
                                  videoAvailable, videoDurationSecs }) => {
    if (recordingStartedAt !== undefined) blRecordingStartedAt = recordingStartedAt;
    if (duration           !== undefined) blDurationSecs       = duration;
    if (videoAvailable !== undefined || videoDurationSecs !== undefined) {
      if (videoAvailable    !== undefined) blVideoAvailable = videoAvailable;
      if (videoDurationSecs !== undefined) blVideoSecs      = videoDurationSecs;
      updateDurationControls();
    }
    if (stateText !== undefined) {
      blStatusEl.textContent    = stateText;
      blTimerStateEl.textContent = stateText;
      if (stateText === 'done' || stateText === 'aborted') {
        blRecordingStartedAt  = null;
        blElapsedEl.textContent   = '—';
        blRemainingEl.textContent = '—';
      }
    }
    if (startEnabled !== undefined) blSubjectCheck.setStartEnabled(startEnabled);
    if (abortVisible !== undefined) blAbortBtn.style.display = abortVisible ? '' : 'none';
    if (nextVisible  !== undefined) {
      blNextBtn.style.display     = nextVisible ? '' : 'none';
      blSpaceHintEl.style.display = nextVisible ? '' : 'none';
    }
    if (warning !== undefined) {
      blWarningEl.textContent   = warning ?? '';
      blWarningEl.style.display = warning ? '' : 'none';
    }
    if (inputsLocked) {
      blLocked = true;
      blSubjectEl.disabled   = true;
      blSubjectCheck.lock();
      blNameEl.disabled      = true;
      blFullVideoEl.disabled = true;
      updateDurationControls();
      // Stream selection stays live even once everything else locks, so the
      // experimenter can recover from a dropped stream mid-session.
    }
  });

  blNameEl.addEventListener('change', () => blSubjectCheck.refresh());

  blStartBtn.addEventListener('click', () => {
    if (!blSubjectCheck.isValid()) return;   // the hint under the subject field says why
    const fullVideo = blFullVideoEl.checked;
    const custom    = blCustomSecs();
    if (!fullVideo && custom == null) {   // the hint already says why
      blDurationEl.focus();
      return;
    }
    window.api.frontend.sendAction({
      type:         'start',
      subjectCode:  blSubjectCheck.code(),
      name:         blNameEl.value,
      fullVideo,
      durationSecs: fullVideo ? undefined : custom,
    });
  });
  blAbortBtn.addEventListener('click', () => window.api.frontend.sendAction({ type: 'abort' }));
  blNextBtn.addEventListener('click',  () => window.api.frontend.sendAction({ type: 'next' }));

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape') window.api.frontend.sendAction({ type: 'abort' });
    if (e.code === 'Space' && document.activeElement !== blSubjectEl && document.activeElement !== blDurationEl) {
      e.preventDefault();
      window.api.frontend.sendAction({ type: 'next' });
    }
  });

  window.api.frontend.sendAction({ type: 'ready' });

} else if (frontend === 'beltTrainingGame') {
  // ── Belt Training Game HUD ───────────────────────────────────────────────────

  statsEl.innerHTML = `
    <span>
      <span class="label">status</span>
      <span id="btg-status">waiting for stream…</span>
    </span>
    <span>
      <span class="label">subject</span>
      <input id="btg-subject" type="text" value="${BTG.SUBJECT_CODE}"
             placeholder="subject code" autocomplete="off" spellcheck="false" />
    </span>
    <span>
      <label><input type="checkbox" id="btg-auto-proceed"> auto-proceed</label>
    </span>
    <span id="ib-controls">
      <button id="btg-start-btn"       disabled>Start</button>
      <button id="btg-next-btn"        style="display:none">Next trial</button>
      <button id="btg-abort-btn"       style="display:none">Abort trial</button>
      <button id="btg-cal-retry-btn"   style="display:none">Retry calibration</button>
      <button id="btg-cal-default-btn" style="display:none">Use default calibration</button>
    </span>
    <span id="btg-space-hint" class="space-hint" style="display:none">Press SPACE to continue</span>
  `;

  // ── Belt Training Game settings bar ───────────────────────────────────────

  settingsBar.innerHTML = `
    <span class="label">settings</span>
    <span class="label">cal secs</span>
    <input id="btg-cal-secs" type="number" class="settings-num" min="5" max="120" step="5"
           value="${BTG.CALIBRATION_SECS}" />
    ${smoothWindowSelect('btg-smooth-window', BTG.SMOOTH_WINDOW)}
  `;

  const btgStatusEl      = document.getElementById('btg-status');
  const btgSubjectEl     = document.getElementById('btg-subject');
  const btgSubjectCheck  = attachSubjectCheck(btgSubjectEl, document.getElementById('btg-start-btn'),
    (code) => `${BTG.DATA_DIR}/${code}/eventData.csv`);
  const btgAutoProceedEl = document.getElementById('btg-auto-proceed');
  const btgStartBtn      = document.getElementById('btg-start-btn');
  const btgNextBtn       = document.getElementById('btg-next-btn');
  const btgSpaceHintEl   = document.getElementById('btg-space-hint');
  const btgAbortBtn      = document.getElementById('btg-abort-btn');
  const btgCalRetryBtn   = document.getElementById('btg-cal-retry-btn');
  const btgCalDefaultBtn = document.getElementById('btg-cal-default-btn');

  window.api.frontend.onState(({ stateText, startEnabled, startText,
                                  nextVisible, abortVisible, calFailed, inputsLocked }) => {
    if (stateText    !== undefined) btgStatusEl.textContent = stateText;
    if (startEnabled !== undefined) btgSubjectCheck.setStartEnabled(startEnabled);
    if (startText    !== undefined) btgStartBtn.textContent = startText;
    if (nextVisible  !== undefined) {
      btgNextBtn.style.display     = nextVisible ? '' : 'none';
      btgSpaceHintEl.style.display = nextVisible ? '' : 'none';
    }
    if (abortVisible !== undefined) btgAbortBtn.style.display = abortVisible ? '' : 'none';
    if (calFailed    !== undefined) {
      btgCalRetryBtn.style.display   = calFailed ? '' : 'none';
      btgCalDefaultBtn.style.display = calFailed ? '' : 'none';
    }
    if (inputsLocked !== undefined && inputsLocked) {
      btgSubjectEl.disabled = true;
      btgSubjectCheck.lock();
      // Stream selection stays live even once everything else locks, so the
      // experimenter can recover from a dropped stream mid-session.
      for (const el of settingsBar.querySelectorAll('input, button, select')) {
        el.disabled = true;
      }
    }
  });

  btgStartBtn.addEventListener('click', () => {
    if (!btgSubjectCheck.isValid()) return;   // the hint under the subject field says why
    window.api.frontend.sendAction({
      type:            'start',
      subjectCode:     btgSubjectCheck.code(),
      calibrationSecs: parseInt(document.getElementById('btg-cal-secs').value) || BTG.CALIBRATION_SECS,
      smoothWindow:    Number(document.getElementById('btg-smooth-window').value),
      autoProceed:     btgAutoProceedEl.checked,
    });
  });
  btgAutoProceedEl.addEventListener('change', () =>
    window.api.frontend.sendAction({ type: 'setAutoProceed', autoProceed: btgAutoProceedEl.checked })
  );
  btgNextBtn.addEventListener('click',  () => window.api.frontend.sendAction({ type: 'next' }));
  btgAbortBtn.addEventListener('click', () => window.api.frontend.sendAction({ type: 'abort' }));
  btgCalRetryBtn.addEventListener('click',   () => window.api.frontend.sendAction({ type: 'retryCalibration' }));
  btgCalDefaultBtn.addEventListener('click', () => window.api.frontend.sendAction({ type: 'useDefaultCalibration' }));

  window.addEventListener('keydown', (e) => {
    if (document.activeElement === btgSubjectEl) return;
    switch (e.code) {
      case 'Space':  e.preventDefault(); window.api.frontend.sendAction({ type: 'next' });  break;
      case 'Escape': window.api.frontend.sendAction({ type: 'abort' }); break;
    }
  });

  window.api.frontend.sendAction({ type: 'ready' });

} else {
  statsEl.style.display = 'none';
}

// ── Back to menu (launcher mode) ──────────────────────────────────────────────
//
// Main only forwards session:ended when the app was started from the
// launcher, so this button never appears for direct `npm run <frontend>`
// launches. The scene keeps showing its end screen until it's clicked.

window.api.session.onEnded(() => {
  if (document.getElementById('back-to-menu-btn')) return;
  const btn = document.createElement('button');
  btn.id          = 'back-to-menu-btn';
  btn.textContent = 'Back to menu';
  btn.addEventListener('click', () => {
    btn.disabled = true;
    window.api.session.backToMenu();
  });
  (document.getElementById('ib-controls') ?? statsEl).appendChild(btn);
});
