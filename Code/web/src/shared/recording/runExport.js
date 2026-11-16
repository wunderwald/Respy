// runExport — assembles a finished run's full JSON document (game data +
// session/device context) and downloads it. For now the browser download is
// the only sink; uploading to a server later only needs a different sink for
// the same document.

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

function fileStamp(iso) {
  // local time, filesystem-safe: 2026-11-16_14-03-27
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
    + `_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

export function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Build the export document for a finished run and download it.
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
  downloadJson(`${game}_${variant}_${fileStamp(time.started_at)}.json`, doc);
}
