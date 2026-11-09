// WebSocket client for eyelink_to_lsl/run_bridge.py's control API.
// Bidirectional: sends {"type": "calibrate"|"start"|"stop"|"status"} and
// receives {"type": "status", "state": ..., "recording": bool, ...} broadcasts.
//
// While the control socket is closed (bridge not running yet, crashed, or
// closed), onStatus receives a synthetic { state: 'offline' } status, so the
// UI can tell "bridge not reachable" apart from the bridge's own states.

export const EYELINK_OFFLINE = 'offline';

// Bridge states grouped by what the app does with them. Keep every
// state-based decision on these sets, so a new bridge state only has to be
// added here.
//
// Bridge unreachable or going away: it accepts no more commands. The bridge
// only sends 'aborted' while shutting down (shutdown / Ctrl+C during a
// calibration), so it counts as gone as well.
export const EYELINK_UNAVAILABLE_STATES = new Set([EYELINK_OFFLINE, 'disconnected', 'aborted']);
// EyeLink setup mode: 'setup' = waiting for the operator (C/V/Esc on the
// Host PC), 'calibrating' = targets on screen.
export const EYELINK_SETUP_STATES = new Set(['setup', 'calibrating']);
// Calibration finished and the tracker is usable.
export const EYELINK_CALIBRATED_STATES = new Set(['calibrated', 'recording']);

export class EyeLinkControl {
  #ws = null;
  #url;
  #connected = false;
  #lastState = null;
  #onStatus;
  #onError;

  constructor(url, { onStatus, onError } = {}) {
    this.#url = url;
    this.#onStatus = onStatus ?? (() => {});
    this.#onError = onError ?? (() => {});
    this.#open();
  }

  get connected() { return this.#connected; }

  calibrate() { return this.#send({ type: 'calibrate' }); }
  start()     { return this.#send({ type: 'start' }); }
  stop()      { return this.#send({ type: 'stop' }); }
  status()    { return this.#send({ type: 'status' }); }

  // Commands are dropped (not queued) while offline: a queued 'calibrate'
  // firing minutes later when the bridge comes back would be a surprise.
  #send(obj) {
    if (this.#ws?.readyState !== WebSocket.OPEN) {
      console.warn('[EyeLinkControl] not connected — dropped command:', obj.type);
      return false;
    }
    this.#ws.send(JSON.stringify(obj));
    return true;
  }

  #emitStatus(status) {
    this.#lastState = status.state;
    this.#onStatus(status);
  }

  #reportOffline() {
    if (this.#lastState !== EYELINK_OFFLINE) {
      this.#emitStatus({ type: 'status', state: EYELINK_OFFLINE, recording: false });
    }
  }

  #open() {
    try {
      this.#ws = new WebSocket(this.#url);
    } catch {
      this.#reportOffline();
      setTimeout(() => this.#open(), 2000);
      return;
    }
    this.#ws.onopen = () => {
      this.#connected = true;
      console.log('[EyeLinkControl] connected');
    };
    this.#ws.onmessage = ({ data }) => {
      let msg;
      try {
        msg = JSON.parse(data);
      } catch {
        return;
      }
      if (msg.type === 'status') {
        this.#emitStatus(msg);
      } else if (msg.type === 'error') {
        console.warn('[EyeLinkControl] error:', msg.message);
        this.#onError(msg.message);
      }
    };
    this.#ws.onclose = () => {
      this.#connected = false;
      this.#reportOffline();
      setTimeout(() => this.#open(), 2000);
    };
    this.#ws.onerror = () => {};
  }
}
