export const CONFIG = {
  // Subject / experiment
  SUBJECT_CODE: "TEST",

  // Signal scaling (matching MATLAB LOG_SCALING_SYNC path)
  LOG_SCALE_DEPTH: 500,
  BREATH_SCALE_BASE_LOG: 1.2,

  // Smoothing
  SMOOTH_WINDOW: 64,        // samples (matches smoothBreathRT.m windowSize) — physiological signal only

  // Input signal type — set by the experimenter's "signal type" control, locked once a session starts.
  // 'physiological': continuous breath-like signal, smoothed via SMOOTH_WINDOW (default).
  // 'peaksOnly':     sparse ECG-peak signal (e.g. AD Instruments fast-response output) — every
  //                  detected peak triggers a swell/fade pulse instead (see PEAK_* below). From
  //                  there on (calibration, sync/async trials, CSV) both types are identical.
  INPUT_SIGNAL_TYPE: 'physiological',
  PEAK_SWELL_MS: 80,          // rise time to full level on a detected peak
  PEAK_FADE_MS: 260,          // decay time back to 0 after the swell
  PEAK_CROSS_FRACTION: 0.5,   // fraction of the way from the tracked min to max that counts as "in a peak"

  // Calibration
  CALIBRATION_SECS: 30,     // seconds to record before first trial

  // TODO: measure real min/max from pilot recordings and replace these placeholders
  DEFAULT_CAL_RANGE: [0.2, 0.8],  // used if the experimenter chooses "use default" after a failed calibration

  // Trial timing
  MAX_NUM_TRIALS: 80,
  MAX_TRIAL_TIME: 30,       // seconds
  MIN_TRIAL_TIME: 5,       // seconds
  ITI_MIN: 2000,       // ms
  ITI_MAX: 3000,       // ms

  // Async signal — delayed real-time breath signal.
  // Delay is adaptive: it starts at MAX_DELAY_MS and steps toward MIN_DELAY_MS
  // each time the participant correctly identifies an async trial as
  // out-of-sync, or back toward MAX_DELAY_MS when they get it wrong.
  MIN_DELAY_MS: 2000,
  MAX_DELAY_MS: 3000,
  DELAY_STEP_MS: 200,

  // Cloud stimulus size (fraction of the shorter half-scene dimension)
  CLOUD_SIZE_MIN: 0.10,     // at stimulusLevel = 0
  CLOUD_SIZE_MAX: 0.45,     // at stimulusLevel = 1

  // Data output base directory (relative to Electron app dir) — do not change
  DATA_DIR: "output_data/ibreath",

  // Questions after trials
  SHOW_QUESTIONS: true,      // show a post-trial response question after each trial (fixed — not exposed in experimenter UI)
  RESPONSE_TIMEOUT_SECS: 5,        // seconds before a non-response is recorded as 'timeout'

  // Active question set. Each entry: { id, text, answers: [leftLabel, rightLabel], probability }.
  // probability values across the set must sum to ~1. `id` is the stable identifier used by
  // CSV/markers/the adaptive-delay logic (which specifically requires an 'sync' entry with
  // answers ['yes', 'no'] to function); `text`/`answers` are freely overridable display strings
  // (e.g. for translations). Replaced wholesale by a preset's `questions` list when one is
  // loaded; this single-entry default (100% 'sync') is what's used when no preset is loaded.
  QUESTIONS: [
    { id: 'sync', text: 'Was the fish in sync with your breathing?', answers: ['yes', 'no'], probability: 1 },
  ],

  // Flash image
  FLASHING_IMAGE: true,         // show a flash image in 50% of trials (fixed — not exposed in experimenter UI)
  FLASH_IMAGE: 'pinkfish',   // image name — label for CSV and draw-routine selector
  FLASH_DURATION: 250,          // ms the flash is visible
  FLASH_TIME_MIN: 5,            // earliest flash onset (seconds into trial)
  FLASH_TIME_MAX: 20,           // latest flash onset (seconds into trial)

  // Animation display (pre-trial animation)
  ANIMATION_DISPLAY: true, // show animated display between ITI/READY and trial
  DISPLAY_SECS: 5,         // seconds to show the animated display before each trial

  // Gaze input (optional LSL stream via second bridge)
  GAZE_STREAM_URL: 'ws://localhost:8766',
  EYELINK_CONTROL_URL: 'ws://localhost:9002',   // eyelink_to_lsl/run_bridge.py control API
  DEBUG_GAZE: false,      // overlay a dot at the current gaze position

  // Marker output (LSL via WebSocket)
  SEND_MARKERS: true,
  MARKER_STREAM_URL: 'ws://localhost:9001',

  // Experiment control
  AUTO_ADVANCE: true,      // skip the READY state — advance to next trial automatically (fixed — not exposed in experimenter UI)
};

// Snapshot of the hardcoded defaults above, taken once at module load — used to reset CONFIG
// before applying a preset's configOverrides, so a value an earlier session's preset changed
// doesn't silently linger into a later session that loads no preset (or a different one) that
// doesn't mention that key. QUESTIONS is excluded: it's always set explicitly every session
// (to either a preset's `questions` or this default), never merged.
export const CONFIG_DEFAULTS = { ...CONFIG, QUESTIONS: CONFIG.QUESTIONS };

export const STATE = {
  IDLE: 'idle',
  CALIBRATING: 'calibrating',
  READY: 'ready',      // between trials — waiting for experimenter
  DISPLAY: 'display',  // 5-second pre-trial animation
  TRIAL: 'trial',
  RESPONSE: 'response',   // post-trial question (SHOW_QUESTIONS only)
  ITI: 'iti',
  PAUSED: 'paused',    // experimenter paused mid-experiment
  EYETRACK_CAL: 'eyetrack_cal',  // eye tracker recalibration in progress
  DONE: 'done',
};
