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
      const audioCtx = new AudioContext();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });

      const workletUrl = new URL('./breathEnvelopeProcessor.js', import.meta.url);
      await audioCtx.audioWorklet.addModule(workletUrl);

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

  useEffect(() => () => stop(), [stop]);

  return { start, stop, subscribe, getRaw };
}

export default useMicBreathSignal;
