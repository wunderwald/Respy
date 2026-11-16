// useMicBreathSignal — the browser-native replacement for the lab's
// LSL/mic_breath.py pipeline. Same shape: mic -> bandpass -> RMS envelope ->
// rolling-mean smoothing -> a continuous raw envelope value, delivered to a
// subscriber at ~100Hz. Normalization against a calibrated [min,max] range
// is intentionally NOT done here — callers (calibration or gameplay) decide
// what to do with the raw value, keeping this hook single-purpose.
//
// Usage:
//   const mic = useMicBreathSignal();
//   await mic.start();                 // requests mic permission, idempotent
//   const unsubscribe = mic.subscribe(raw => { ... });
//   mic.stop();                        // releases the mic + audio graph
import { useRef, useCallback, useEffect } from 'react';
import { RollingMean } from '../signal/RollingMean.js';
import { micSupport, micSupportMessage } from './micPermission.js';
// The `?url` suffix is Vite's explicit "give me this file's built, hashed
// URL" convention — unlike `new URL('./x.js', import.meta.url)`, which Vite
// only auto-detects for new Worker(...)/new SharedWorker(...) call sites,
// this form is guaranteed to copy the file into the build output under any
// usage (audioWorklet.addModule() included).
import breathWorkletUrl from './breathEnvelopeProcessor.js?url';

// Bandpass passband matches simulation/mic_breath.py (80-300Hz), implemented
// as two cascaded native BiquadFilterNodes (2nd-order each) approximating
// that script's 4th-order Butterworth bandpass — no filter coefficient math
// needed, the browser's own DSP does it.
const BP_LOW_HZ = 80;
const BP_HIGH_HZ = 300;
const BP_CENTER_HZ = Math.sqrt(BP_LOW_HZ * BP_HIGH_HZ);
const BP_Q = BP_CENTER_HZ / (BP_HIGH_HZ - BP_LOW_HZ);

const SMOOTH_WINDOW = 5; // same as mic_breath.py's SMOOTH_WINDOW

export function useMicBreathSignal() {
  const ref = useRef({
    audioCtx: null,
    stream: null,
    worklet: null,
    smoother: new RollingMean(SMOOTH_WINDOW),
    lastRaw: 0,
    subscribers: new Set(),
    starting: null, // in-flight start() promise, for idempotency
  });

  const start = useCallback(async () => {
    const s = ref.current;
    if (s.audioCtx) return; // already started
    if (s.starting) return s.starting;

    s.starting = (async () => {
      // Fail with a readable reason (shown by MicCalibration) rather than a
      // "cannot read properties of undefined" TypeError over plain HTTP.
      const support = micSupport();
      if (support !== 'ok') throw new Error(micSupportMessage(support));

      // Get the stream before creating the AudioContext, so a denied/failed
      // permission doesn't leave an orphaned, never-closed context behind.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      const audioCtx = new AudioContext();
      // A context created outside a user gesture can start 'suspended'
      // (Safari/Chrome autoplay policy); an active capture normally lifts
      // that, but ask explicitly. Not awaited — resume() can stay pending
      // rather than reject when the browser declines.
      if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});

      await audioCtx.audioWorklet.addModule(breathWorkletUrl);

      const source = audioCtx.createMediaStreamSource(stream);
      const bp1 = audioCtx.createBiquadFilter();
      bp1.type = 'bandpass';
      bp1.frequency.value = BP_CENTER_HZ;
      bp1.Q.value = BP_Q;
      const bp2 = audioCtx.createBiquadFilter();
      bp2.type = 'bandpass';
      bp2.frequency.value = BP_CENTER_HZ;
      bp2.Q.value = BP_Q;

      const worklet = new AudioWorkletNode(audioCtx, 'breath-envelope-processor');
      worklet.port.onmessage = (e) => {
        const smoothed = s.smoother.push(e.data);
        s.lastRaw = smoothed;
        for (const cb of s.subscribers) cb(smoothed);
      };

      // The worklet has no useful audio output, but some browsers suspend
      // nodes with no path to destination — route through a muted gain node
      // so it keeps running without anything audible.
      const mute = audioCtx.createGain();
      mute.gain.value = 0;

      source.connect(bp1);
      bp1.connect(bp2);
      bp2.connect(worklet);
      worklet.connect(mute);
      mute.connect(audioCtx.destination);

      Object.assign(s, { audioCtx, stream, source, bp1, bp2, worklet, mute });
    })();

    try {
      await s.starting;
    } finally {
      s.starting = null;
    }
  }, []);

  const stop = useCallback(() => {
    const s = ref.current;
    s.stream?.getTracks().forEach((t) => t.stop());
    s.audioCtx?.close().catch(() => {});
    s.smoother.reset();
    Object.assign(s, {
      audioCtx: null, stream: null, source: null,
      bp1: null, bp2: null, worklet: null, mute: null,
      lastRaw: 0,
    });
  }, []);

  const subscribe = useCallback((cb) => {
    ref.current.subscribers.add(cb);
    return () => ref.current.subscribers.delete(cb);
  }, []);

  const getRaw = useCallback(() => ref.current.lastRaw, []);

  /** Mic/audio context + processing parameters, for data export. */
  const getInfo = useCallback(() => {
    const s = ref.current;
    const track = s.stream?.getAudioTracks()[0];
    // deviceId/groupId are opaque per-origin identifiers — not useful for
    // analysis, so left out.
    const { deviceId: _d, groupId: _g, ...settings } = track?.getSettings?.() ?? {};
    // The worklet posts every whole number of 128-sample render quanta
    // closest to 10 ms, so the true rate depends on the context sample rate
    // (≈115 Hz at 44.1 kHz, ≈94 Hz at 48 kHz) — mirrors its quantaPerPost.
    const sr = s.audioCtx?.sampleRate;
    const quanta = sr ? Math.max(1, Math.round((sr * 0.01) / 128)) : null;
    return {
      device_label: track?.label ?? null,
      track_settings: settings,
      context_sample_rate_hz: s.audioCtx?.sampleRate ?? null,
      context_base_latency_s: s.audioCtx?.baseLatency ?? null,
      pipeline: {
        bandpass_hz: [BP_LOW_HZ, BP_HIGH_HZ],
        bandpass_impl: '2x cascaded BiquadFilterNode bandpass',
        bandpass_center_hz: BP_CENTER_HZ,
        bandpass_q: BP_Q,
        rms_window_ms: 100,     // breathEnvelopeProcessor.js RMS_WINDOW_SECS
        output_rate_hz_nominal: 100, // breathEnvelopeProcessor.js POST_INTERVAL_SECS
        output_rate_hz: sr ? sr / (128 * quanta) : null,
        rolling_mean_window: SMOOTH_WINDOW,
      },
    };
  }, []);

  useEffect(() => () => stop(), [stop]);

  return { start, stop, subscribe, getRaw, getInfo };
}

export default useMicBreathSignal;
