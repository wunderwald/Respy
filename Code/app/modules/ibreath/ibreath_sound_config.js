// iBreath sound configuration.
// Paths are relative to the Electron app root (app/).
// Volumes are linear 0–1.

export const SOUND_CONFIG = {
  // ── Files ───────────────────────────────────────────────────────────────
  AMBIENCE: 'sounds/ambience.wav',   // steady background loop during trial (muted, see AMBIENCE_VOLUME)
  // Stimulus-scaled loop during trial: 'white' = generated white noise, or a
  // file path (e.g. 'sounds/breath.wav') to use a sample instead.
  NOISE:    'white',
  JINGLE:   'sounds/jingle.wav',     // loop played during pre-trial animation

  // ── Levels ──────────────────────────────────────────────────────────────
  AMBIENCE_VOLUME:   0,     // 0 = muted (not loaded or played); was 0.5
  // Noise gain is mapped linearly from the stimulus level [0, 1] onto
  // [NOISE_VOLUME_MIN, NOISE_VOLUME_MAX]. Full-scale white noise is loud, so
  // the maximum is kept low — tune by ear on the lab setup.
  NOISE_VOLUME_MIN:  0.0,   // noise gain at stimulus level 0
  NOISE_VOLUME_MAX:  0.015, // noise gain at stimulus level 1 (≈ −41 dBFS; was 0.06, and 0.8 for breath.wav)
  WHITE_NOISE_SECS:  10,    // length of the generated noise loop (short loops repeat audibly)
  JINGLE_VOLUME:     0.6,
  JINGLE_LOOPS:      4,     // number of times to play the jingle per display phase

  // ── Timing ──────────────────────────────────────────────────────────────
  FADE_SECS: 1.0,           // fade-in / fade-out duration
};
