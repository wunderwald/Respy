// Subject code checks for the experimenter window (all frontends).
//
// Wraps a subject input with a hint line underneath:
//   - invalid code (anything but letters, digits, - and _) → error, Start
//     disabled: the code goes into file names and CSV columns.
//   - data for this code already exists (existingPath(code) is on disk) →
//     warning only; Start stays enabled and would overwrite it.
// An empty field means 'TEST', as in every Start handler.
// Returns { code, isValid, setStartEnabled, refresh, lock }: the frontend's
// state handler must call setStartEnabled() instead of setting
// startBtn.disabled itself, so an invalid code keeps Start disabled.

export const SUBJECT_RE = /^[A-Za-z0-9_-]+$/;

export function attachSubjectCheck(inputEl, startBtn, existingPath) {
  const wrap = document.createElement('span');
  wrap.className = 'subject-field';
  inputEl.replaceWith(wrap);
  const hint = document.createElement('span');
  hint.className = 'subject-hint';
  wrap.append(inputEl, hint);

  let startEnabled = !startBtn.disabled;
  let locked = false;
  let seq = 0;
  const code    = () => inputEl.value.trim() || 'TEST';
  const isValid = () => SUBJECT_RE.test(code());
  const apply   = () => { startBtn.disabled = !startEnabled || !isValid(); };
  const show    = (text, kind) => { hint.textContent = text; hint.dataset.kind = kind; };

  async function refresh() {
    const mySeq = ++seq;
    apply();
    if (locked) return show('', '');
    if (!isValid()) return show('⚠ only letters, digits, - and _', 'error');
    show('', '');
    const path = existingPath(code());
    const res  = path ? await window.api.fileExists(path).catch(() => null) : null;
    if (mySeq !== seq || locked) return;   // a newer check (or Start) superseded this one
    if (res?.ok && res.exists) show(`⚠ data for ${code()} already exists — Start will overwrite it`, 'warning');
  }

  inputEl.addEventListener('input', refresh);
  refresh();
  return {
    code, isValid, refresh,
    setStartEnabled(v) { startEnabled = v; apply(); },
    lock() { locked = true; seq++; show('', ''); },
  };
}
