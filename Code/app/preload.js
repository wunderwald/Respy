/**
 * preload.js
 * ==========
 * Runs in the privileged preload context (contextIsolation: true).
 * Exposes a minimal, explicit API to the renderer via window.api.
 *
 * File I/O
 * --------
 * All three calls return a Promise that resolves to { ok: boolean, error?: string }.
 *
 *   window.api.ensureDir(dirPath)
 *     Creates dirPath (and any missing parents) if it does not exist.
 *
 *   window.api.writeCSV(filePath, content)
 *     Writes content to filePath, overwriting any existing file.
 *     Parent directories are created automatically.
 *
 *   window.api.appendCSV(filePath, content)
 *     Appends content to filePath.  Creates the file if it does not exist.
 *     Use this to write frame-data rows incrementally during a trial.
 *
 *   window.api.appendCSVSync(filePath, content)
 *     Synchronous variant of appendCSV: returns { ok, error? } directly and
 *     blocks until written. Only for final flushes in a 'pagehide' handler.
 *
 * All paths may be absolute or relative to the electron/ app directory.
 *
 * Usage example (renderer):
 *
 *   // Write a header row when a trial starts
 *   await window.api.writeCSV(
 *     'iBreathData/P01/frameData_1.csv',
 *     'trialIndex,timestamp,breathLevel_input,stimulusLevel\n'
 *   );
 *
 *   // Append one row per frame during the trial
 *   await window.api.appendCSV(
 *     'iBreathData/P01/frameData_1.csv',
 *     `1,2024-01-01T12:00:00.000Z,0.42,0.55\n`
 *   );
 *
 *   // Write the trial summary after the trial ends
 *   await window.api.writeCSV(
 *     'iBreathData/P01/trialData.csv',
 *     header + rows
 *   );
 */

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  /**
   * Creates a directory (and parents) if it does not exist.
   * @param {string} dirPath
   * @returns {Promise<{ ok: boolean, error?: string }>}
   */
  ensureDir: (dirPath) =>
    ipcRenderer.invoke("ensure-dir", dirPath),

  /**
   * Writes a full CSV string to filePath (overwrites).
   * @param {string} filePath
   * @param {string} content  – complete file content including header
   * @returns {Promise<{ ok: boolean, error?: string }>}
   */
  writeCSV: (filePath, content) =>
    ipcRenderer.invoke("write-csv", filePath, content),

  /**
   * Appends a string to filePath (creates file if needed).
   * Designed for incremental per-frame writes during a trial.
   * @param {string} filePath
   * @param {string} content  – one or more CSV rows, newline-terminated
   * @returns {Promise<{ ok: boolean, error?: string }>}
   */
  appendCSV: (filePath, content) =>
    ipcRenderer.invoke("append-csv", filePath, content),

  /**
   * Synchronous appendCSV — blocks the renderer until written. Only for the
   * last flush in a 'pagehide' handler, where an async call may be lost.
   * @returns {{ ok: boolean, error?: string }}
   */
  appendCSVSync: (filePath, content) =>
    ipcRenderer.sendSync("append-csv-sync", filePath, content),

  // HUD IPC — used by both the scene window (RemoteHud) and experimenter window
  hud: {
    // Scene window: push full state snapshot to the experimenter window
    sendState:   (state)  => ipcRenderer.send('hud:state', state),
    // Scene window: receive actions (start/next/abort/response/ready) from experimenter
    onAction:    (cb)     => ipcRenderer.on('hud:action', (_e, d) => cb(d)),
    // Experimenter window: send an action to the scene window
    sendAction:  (action) => ipcRenderer.send('hud:action', action),
    // Experimenter window: receive state snapshots from the scene window
    onState:     (cb)     => ipcRenderer.on('hud:state',  (_e, d) => cb(d)),
    // Scene window: request main to open the experimenter window
    openControl: ()       => ipcRenderer.send('hud:open-control'),
  },

  pickDir:  () => ipcRenderer.invoke("pick-directory"),
  pickFile: (opts) => ipcRenderer.invoke("pick-file", opts),
  readFile: (filePath) => ipcRenderer.invoke("read-file", filePath),

  /**
   * Checks whether a file exists, without reading its content.
   * Safe to use on large files (e.g. videos).
   * @param {string} filePath
   * @returns {Promise<{ ok: boolean, exists?: boolean, error?: string }>}
   */
  fileExists: (filePath) => ipcRenderer.invoke("file-exists", filePath),

  // Scene window self-management
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    restore:  () => ipcRenderer.send('window:restore'),
  },

  // Launcher IPC — used only by the launcher window
  launcher: {
    select: (frontend) => ipcRenderer.send('launcher:select', frontend),
  },

  // Session lifecycle (launcher mode only — no-ops for direct launches)
  session: {
    // Scene window: the session is over and its final file writes are sent.
    ended:      ()   => ipcRenderer.send('session:ended'),
    // Experimenter window: notified of the above → show "Back to menu".
    onEnded:    (cb) => ipcRenderer.on('session:ended', () => cb()),
    // Experimenter window: close both experiment windows, reopen the launcher.
    backToMenu: ()   => ipcRenderer.send('session:back-to-menu'),
  },

  // Frontend IPC — scene window pushes state, experimenter window sends actions
  frontend: {
    sendState:  (data) => ipcRenderer.send('frontend:state', data),
    onState:    (cb)   => ipcRenderer.on('frontend:state', (_e, d) => cb(d)),
    sendAction: (data) => ipcRenderer.send('frontend:action', data),
    onAction:   (cb)   => ipcRenderer.on('frontend:action', (_e, d) => cb(d)),
  },

  // Stream IPC — experimenter window sends data, scene window receives it
  stream: {
    sendSample:      (data) => ipcRenderer.send('stream:sample',          data),
    sendStatus:      (data) => ipcRenderer.send('stream:status',          data),
    sendGazeSample:  (data) => ipcRenderer.send('gaze:sample',            data),
    // Scene window calls this after registering onStatus to catch up on
    // any status that fired before the handler was ready (race condition fix).
    requestStatus:   ()     => ipcRenderer.send('stream:request-status'),
    onSample:        (cb)   => ipcRenderer.on('stream:sample',          (_e, d) => cb(d)),
    onStatus:        (cb)   => ipcRenderer.on('stream:status',          (_e, d) => cb(d)),
    onGazeSample:    (cb)   => ipcRenderer.on('gaze:sample',            (_e, d) => cb(d)),
    onRequestStatus: (cb)   => ipcRenderer.on('stream:request-status',  ()      => cb()),
  },
});