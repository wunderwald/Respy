// micPermission — check for, and request, microphone permission without
// keeping the mic open. Used by the launcher to make sure permission is
// already granted before a mic game is opened, and by useMicBreathSignal
// to fail with a readable reason instead of a TypeError.

/**
 * Whether this page can use the mic at all, independent of permission.
 * @returns {'ok' | 'insecure' | 'unsupported'}
 *   'insecure'    — not a secure context (e.g. http://<lan-ip>); browsers
 *                   hide navigator.mediaDevices entirely, so this needs HTTPS.
 *   'unsupported' — secure context, but no getUserMedia (very old browser).
 */
export function micSupport() {
  if (!window.isSecureContext) return 'insecure';
  if (!navigator.mediaDevices?.getUserMedia) return 'unsupported';
  return 'ok';
}

/** Human-readable explanation for a non-'ok' micSupport() result. */
export function micSupportMessage(support) {
  if (support === 'insecure') {
    return 'Das Mikrofon funktioniert nur über eine sichere Verbindung. '
      + `Bitte die Seite über https:// statt ${window.location.protocol}// öffnen.`;
  }
  if (support === 'unsupported') {
    return 'Dieser Browser unterstützt keinen Mikrofonzugriff.';
  }
  return null;
}

/**
 * Current permission state without prompting, where the browser can tell us.
 * Firefox doesn't accept 'microphone' in permissions.query (throws), and some
 * browsers lack the Permissions API — both report 'prompt', i.e. "unknown,
 * ask by requesting".
 * @returns {Promise<{state: 'granted' | 'denied' | 'prompt', status: PermissionStatus | null}>}
 *   `status` (when available) fires 'change' if the user flips the setting.
 */
export async function queryMicPermission() {
  try {
    const status = await navigator.permissions.query({ name: 'microphone' });
    return { state: status.state, status };
  } catch {
    return { state: 'prompt', status: null };
  }
}

/**
 * Prompt for the mic (if not already granted) and release it immediately —
 * we only want the grant, not an open stream.
 * @returns {Promise<{state: 'granted' | 'denied' | 'error', message?: string}>}
 */
export async function requestMicPermission() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    return { state: 'granted' };
  } catch (e) {
    if (e?.name === 'NotAllowedError' || e?.name === 'SecurityError') {
      return { state: 'denied' };
    }
    // NotFoundError (no mic), NotReadableError (mic busy), ...
    return { state: 'error', message: e?.message || e?.name || 'Mikrofonzugriff fehlgeschlagen' };
  }
}
