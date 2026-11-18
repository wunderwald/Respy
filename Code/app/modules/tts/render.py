"""
render.py — pre-render German speech (iBreath questions) with Piper TTS.

Run by the Electron main process (modules/tts/ttsMain.js) with the TTS
environment's Python (app/tts/venv, set up by `npm run tts:setup`). The voice
model is loaded once per run, then every job is rendered to its WAV file.

Questions get a rising end (question intonation): Piper's German voices tend
to fall at the end of a sentence, like a statement. Over the last
`rise_secs` of voiced speech the pitch is raised by up to `rise_semitones`
(quadratic ramp), using Praat's PSOLA resynthesis via parselmouth — the
timing and the voice stay unchanged.

stdin  (JSON): {"model": "<.onnx path>", "length_scale": 1.0,
                "rise_semitones": 6, "rise_secs": 0.6,
                "jobs": [{"text": "...", "out": "<.wav path>"}, ...]}
stdout (JSON lines): {"out": ..., "ok": true}  or  {"out": ..., "ok": false, "error": ...}
Exit code 0 when the voice loaded (individual jobs may still fail), 1 otherwise.
"""

import json
import os
import sys
import wave
from pathlib import Path

import piper

# espeak-ng (pronunciation) only accepts a short data path; a long install
# folder silently breaks it. Run from inside the piper package and point it
# at its data with a short relative path instead.
os.chdir(Path(piper.__file__).parent)
os.environ["ESPEAK_DATA_PATH"] = "."

from piper import PiperVoice, SynthesisConfig  # noqa: E402


def add_question_rise(path, semitones, secs):
    import parselmouth
    from parselmouth.praat import call

    snd = parselmouth.Sound(str(path))
    manip = call(snd, "To Manipulation", 0.01, 75, 600)
    tier = call(manip, "Extract pitch tier")
    n = call(tier, "Get number of points")
    if n < 2:
        return  # nothing voiced to bend
    points = [(call(tier, "Get time from index", i), call(tier, "Get value at index", i))
              for i in range(1, n + 1)]
    t_end = points[-1][0]                # end of the last voiced stretch
    t_start = t_end - secs
    new = call("Create PitchTier", "rise", snd.xmin, snd.xmax)
    for t, f in points:
        w = min(1.0, max(0.0, (t - t_start) / secs)) ** 2
        call(new, "Add point", t, f * 2 ** (semitones * w / 12))
    call([new, manip], "Replace pitch tier")
    call(manip, "Get resynthesis (overlap-add)").save(str(path), "WAV")


def main():
    req = json.load(sys.stdin)
    try:
        voice = PiperVoice.load(req["model"], espeak_data_dir=Path("espeak-ng-data"))
    except Exception as e:  # noqa: BLE001
        print(f"could not load voice {req.get('model')}: {e}", file=sys.stderr)
        return 1

    config = SynthesisConfig(length_scale=req.get("length_scale") or 1.0)
    rise = req.get("rise_semitones") or 0
    secs = req.get("rise_secs") or 0.6

    for job in req.get("jobs", []):
        out = Path(job["out"])
        tmp = out.with_suffix(".part.wav")
        try:
            out.parent.mkdir(parents=True, exist_ok=True)
            with wave.open(str(tmp), "wb") as wf:
                voice.synthesize_wav(job["text"], wf, syn_config=config)
            if rise:
                add_question_rise(tmp, rise, secs)
            os.replace(tmp, out)  # only complete files ever appear under the final name
            print(json.dumps({"out": str(out), "ok": True}), flush=True)
        except Exception as e:  # noqa: BLE001
            tmp.unlink(missing_ok=True)
            print(json.dumps({"out": str(out), "ok": False, "error": str(e)}), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
