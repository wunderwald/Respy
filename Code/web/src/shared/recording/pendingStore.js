// pendingStore — durable on-device queue of run documents not yet confirmed
// by the server, in IndexedDB (localStorage's ~5 MB would only hold a few
// ~1 MB runs). Entries are removed only after a successful upload.
//
// Entry shape: { run_id, queued_at, attempts, last_error, doc }

const DB_NAME = 'respy-data';
const STORE = 'pending_runs';

let dbPromise = null;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (!globalThis.indexedDB) { reject(new Error('IndexedDB unavailable')); return; }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(STORE, { keyPath: 'run_id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    dbPromise.catch(() => { dbPromise = null; }); // allow a later retry
  }
  return dbPromise;
}

async function tx(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const result = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(result?.result ?? result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export function putPending(entry) {
  return tx('readwrite', (s) => s.put(entry));
}

export function removePending(runId) {
  return tx('readwrite', (s) => s.delete(runId));
}

/** All pending entries, oldest first. */
export async function listPending() {
  const all = await tx('readonly', (s) => s.getAll());
  return all.sort((a, b) => a.queued_at.localeCompare(b.queued_at));
}

export function countPending() {
  return tx('readonly', (s) => s.count());
}
