// dataApi — sends finished run documents to the data server, which stores
// them in MySQL (the browser can't talk to MySQL itself). Contract and table
// schema: server/README.md, server/schema.sql.
//
// Every run is first written to the on-device queue (pendingStore), then
// uploaded; it leaves the queue only once the server confirms it. So nothing
// is lost while the URL is still a placeholder, the tablet is offline, or the
// server is down — the queue is retried on page load, when the device comes
// back online, every minute, and after each run.

import { putPending, removePending, listPending, countPending } from './pendingStore.js';

/** Configured in .env (VITE_DATA_API_URL) — see the comment there. */
export const DATA_API_URL = import.meta.env.VITE_DATA_API_URL ?? '';

const REQUEST_TIMEOUT_MS = 30_000;
const AUTO_FLUSH_INTERVAL_MS = 60_000;

/** False while the URL is empty or still the *.invalid placeholder. */
export function isConfigured() {
  try {
    return !!DATA_API_URL && !new URL(DATA_API_URL).hostname.endsWith('.invalid');
  } catch {
    return false;
  }
}

// ── status for the UI ──────────────────────────────────────────────────────

let lastError = null;
const listeners = new Set();

/** @param {(status: {pending: number, configured: boolean, lastError: string|null}) => void} cb */
export function onUploadStatus(cb) {
  listeners.add(cb);
  getUploadStatus().then(cb);
  return () => listeners.delete(cb);
}

export async function getUploadStatus() {
  let pending = 0;
  try { pending = await countPending(); } catch { /* no IndexedDB */ }
  return { pending, configured: isConfigured(), lastError };
}

async function notify() {
  const status = await getUploadStatus();
  for (const cb of listeners) cb(status);
}

// ── upload ──────────────────────────────────────────────────────────────────

/**
 * POST one document. 2xx (and 409 "already stored") = done.
 * @returns {Promise<{ok: true} | {ok: false, retryable: boolean, error: string}>}
 */
async function post(doc) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(DATA_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(doc),
      signal: ctrl.signal,
    });
    if (res.ok || res.status === 409) return { ok: true };
    // 4xx other than timeout/rate-limit: this document is the problem —
    // keep it queued, but don't let it block the documents behind it.
    const retryable = res.status >= 500 || res.status === 408 || res.status === 429;
    return { ok: false, retryable, error: `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, retryable: true, error: e?.name === 'AbortError' ? 'timeout' : (e?.message || 'network error') };
  } finally {
    clearTimeout(timer);
  }
}

let flushing = null;

/** Try to upload everything queued on this device. Single-flight. */
export function flushPending() {
  if (!flushing) {
    flushing = doFlush().finally(() => { flushing = null; notify(); });
  }
  return flushing;
}

async function doFlush() {
  if (!isConfigured()) return;
  let entries;
  try { entries = await listPending(); } catch { return; }
  lastError = null;
  for (const entry of entries) {
    const result = await post(entry.doc);
    if (result.ok) {
      await removePending(entry.run_id);
      continue;
    }
    lastError = result.error;
    await putPending({ ...entry, attempts: entry.attempts + 1, last_error: result.error });
    if (result.retryable) break; // server/network down — stop, retry later
  }
}

/**
 * Queue a finished run document and try to upload it right away.
 * @param {object} doc  must carry a unique `run_id`
 */
export async function submitRun(doc) {
  // Ask the browser not to evict our storage under pressure (best effort).
  navigator.storage?.persist?.().catch(() => {});
  try {
    await putPending({
      run_id: doc.run_id,
      queued_at: new Date().toISOString(),
      attempts: 0,
      last_error: null,
      doc,
    });
  } catch (e) {
    // No IndexedDB (rare: some private modes) — one direct attempt, no queue.
    console.error('[dataApi] could not queue run, sending once without retry:', e);
    if (isConfigured()) {
      const result = await post(doc);
      if (!result.ok) console.error('[dataApi] upload failed, run NOT stored:', result.error);
    }
    return;
  }
  notify();
  flushPending();
}

let autoFlushStarted = false;

/** Retry the queue now, whenever the device comes online, and periodically. Idempotent. */
export function startAutoFlush() {
  if (autoFlushStarted) return;
  autoFlushStarted = true;
  flushPending();
  window.addEventListener('online', () => flushPending());
  setInterval(() => flushPending(), AUTO_FLUSH_INTERVAL_MS);
}
