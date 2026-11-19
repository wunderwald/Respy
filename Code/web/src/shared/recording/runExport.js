// runExport — assembles a finished run's full JSON document (game data +
// session/device context) and hands it to dataApi, which queues it on the
// device and uploads it to the data server (→ MySQL).

import { submitRun } from './dataApi.js';

export const SCHEMA_VERSION = 1;

function newId() {
  return globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// One per page load: every run played without reloading shares it.
const SESSION_ID = newId();
let runIndex = 0;

export function deviceInfo() {
  const nav = navigator;
  const uaData = nav.userAgentData;
  return {
    user_agent: nav.userAgent,
    // Chromium-only structured UA; null elsewhere (Safari, Firefox)
    ua_data: uaData ? { platform: uaData.platform, mobile: uaData.mobile, brands: uaData.brands } : null,
    platform: nav.platform ?? null,
    language: nav.language ?? null,
    languages: nav.languages ? [...nav.languages] : null,
    max_touch_points: nav.maxTouchPoints ?? null,
    hardware_concurrency: nav.hardwareConcurrency ?? null,
    device_memory_gb: nav.deviceMemory ?? null, // Chromium-only
    screen: {
      width: screen.width,
      height: screen.height,
      device_pixel_ratio: window.devicePixelRatio ?? 1,
      orientation: screen.orientation?.type ?? null,
    },
    viewport: { width: window.innerWidth, height: window.innerHeight },
    fullscreen: !!(document.fullscreenElement || document.webkitFullscreenElement),
  };
}

/**
 * Build the document for a finished run and submit it for upload.
 * @param {object} runData  from the game's getRunData() — must contain
 *                          game, variant, time, config, detection, summary,
 *                          events, timeseries
 * @param {object} [context] page-level extras, e.g. { audio, calibration }
 */
export function exportRun(runData, context = {}) {
  if (!runData) return;
  runIndex += 1;
  const { game, variant, time, config, detection, summary, events, timeseries } = runData;
  const doc = {
    schema_version: SCHEMA_VERSION,
    run_id: newId(),  // unique per run — the server dedupes retried uploads on it
    game,
    variant,
    session_id: SESSION_ID,
    run_index: runIndex,
    exported_at: new Date().toISOString(),
    time,
    device: deviceInfo(),
    ...context,
    config,
    detection,
    summary,
    events,
    timeseries,
  };
  submitRun(doc);
}
