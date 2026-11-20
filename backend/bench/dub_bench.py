"""Voice translation benchmark: runs the real engine pipeline (app/pipeline/
dub.py) on prepared test cases and measures time per stage and per model
part, peak memory, CPU use, and the quality of what comes out.

Not a test (minutes per case, needs the downloaded models and test media).
Run from the backend folder:

    python bench/dub_bench.py prepare DATA_DIR CASES_DIR
    python bench/dub_bench.py run CASES_DIR OUT_DIR [--only hi_40,si_news_40] [--label baseline]
    python bench/dub_bench.py translate DATA_DIR OUT_DIR [--n 100] [--beam 2] [--batch 8] [--label baseline]

DATA_DIR holds the source material (none of it is committed):
    {hi,kn,ta,te}.npy + .txt   FLEURS test clips, 16 kHz mono, 0.5 s of digital
                               silence between clips, and their transcripts
    {hi,kn,ta,te}.en.json      FLEURS English text of the same sentence ids
                               (human references for the translation)
    real_si.npy                a Sinhala news report, 16 kHz mono
    real_si_44k.f32            the same, 44.1 kHz stereo interleaved float32
    flores/flores200_dataset/devtest/*.devtest   FLORES-200 devtest text
    music.f32                  a music and effects bed, 44.1 kHz stereo (optional)

What it measures, per case (CASES_DIR/<case>/):
    time:     each stage (translate, separate, sample, voice load, speak,
              fit/mix), model loads, the voice model's parts (encoder,
              embedding, language model, decoder), tokens per second
    memory:   peak working set of the engine process during the render
    CPU:      process CPU time / wall time, in cores
    words:    the English voice recognised again by the general Whisper model
              and compared with the English text it was given: word error
              rate, words missing, sentences mostly missing
    voice:    speaker similarity proxy - cosine of the voice model's own
              speaker-encoder embeddings (CAMPPlus x-vector) between the
              speaker sample and each spoken sentence
    timing:   delay of each sentence from its source start, speed-ups, speech
              cut at the video's end
    loudness: per-sentence level of the English voice (dBFS), its spread and
              the largest jump between neighbours
    separation (cases with a known bed): SNR of the background against the
              true bed, and of the voice against the true speech
    translation (cases with references): chrF++ against the human English

Windows only for the memory numbers (GetProcessMemoryInfo).
"""

from __future__ import annotations

import argparse
import collections
import ctypes
import json
import os
import re
import subprocess
import sys
import time
import wave
from ctypes import wintypes
from pathlib import Path

# --root (DUB_BENCH_ROOT): another backend folder's engine code - an older
# version exported with `git archive` - to compare against this one.
sys.path.insert(0, os.environ.get("DUB_BENCH_ROOT") or os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import numpy as np  # noqa: E402

RATE = 44100
ASR_RATE = 16000


# --- process numbers ----------------------------------------------------------


class _PMC(ctypes.Structure):
    _fields_ = [
        ("cb", wintypes.DWORD),
        ("PageFaultCount", wintypes.DWORD),
        ("PeakWorkingSetSize", ctypes.c_size_t),
        ("WorkingSetSize", ctypes.c_size_t),
        ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
        ("QuotaPagedPoolUsage", ctypes.c_size_t),
        ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
        ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
        ("PagefileUsage", ctypes.c_size_t),
        ("PeakPagefileUsage", ctypes.c_size_t),
    ]


def peak_mb() -> float:
    if sys.platform != "win32":
        return float("nan")
    pmc = _PMC()
    pmc.cb = ctypes.sizeof(pmc)
    get = ctypes.windll.psapi.GetProcessMemoryInfo
    get.argtypes = [wintypes.HANDLE, ctypes.POINTER(_PMC), wintypes.DWORD]
    get.restype = wintypes.BOOL
    current = ctypes.windll.kernel32.GetCurrentProcess
    current.restype = wintypes.HANDLE
    get(current(), ctypes.byref(pmc), pmc.cb)
    return pmc.PeakWorkingSetSize / 2**20


def cpu_seconds() -> float:
    t = os.times()
    return t.user + t.system


# --- text metrics ----------------------------------------------------------------


def _ngrams(seq, n):
    return collections.Counter(tuple(seq[i : i + n]) for i in range(len(seq) - n + 1))


def chrf_pp(hyps: list[str], refs: list[str], beta: float = 2.0) -> float:
    """Corpus chrF++ (character 1-6 grams + word 1-2 grams, beta 2), as in
    sacrebleu's CHRF(word_order=2): statistics summed over the corpus."""
    stats = collections.defaultdict(lambda: [0, 0, 0])  # (kind, n) -> match, hyp, ref
    for h, r in zip(hyps, refs):
        hc, rc = h.replace(" ", ""), r.replace(" ", "")
        hw, rw = _words_punct(h), _words_punct(r)
        for n in range(1, 7):
            a, b = _ngrams(hc, n), _ngrams(rc, n)
            s = stats[("c", n)]
            s[0] += sum((a & b).values()); s[1] += sum(a.values()); s[2] += sum(b.values())  # fmt: skip
        for n in range(1, 3):
            a, b = _ngrams(hw, n), _ngrams(rw, n)
            s = stats[("w", n)]
            s[0] += sum((a & b).values()); s[1] += sum(a.values()); s[2] += sum(b.values())  # fmt: skip
    p = [s[0] / s[1] if s[1] else 0.0 for s in stats.values()]
    r = [s[0] / s[2] if s[2] else 0.0 for s in stats.values()]
    P, R = sum(p) / len(p), sum(r) / len(r)
    if P + R == 0:
        return 0.0
    return 100 * (1 + beta**2) * P * R / (beta**2 * P + R)


def _words_punct(s: str) -> list[str]:
    # sacrebleu's chrF word tokens: punctuation split off the ends of words
    out = []
    for w in s.split():
        m = re.match(r"^(\W*)(.*?)(\W*)$", w)
        out += [x for x in (m.group(1), m.group(2), m.group(3)) if x] if m else [w]
    return out


def norm_words(s: str) -> list[str]:
    s = s.lower().replace("%", " percent ").replace("&", " and ")
    s = re.sub(r"(\d),(\d)", r"\1\2", s)
    return re.findall(r"[a-z0-9]+(?:'[a-z]+)?", s)


def edit_ops(ref: list[str], hyp: list[str]) -> tuple[int, int, int]:
    """(substitutions, deletions, insertions) of the cheapest alignment."""
    n, m = len(ref), len(hyp)
    d = np.zeros((n + 1, m + 1), np.int32)
    d[:, 0] = np.arange(n + 1)
    d[0, :] = np.arange(m + 1)
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            d[i, j] = min(d[i - 1, j] + 1, d[i, j - 1] + 1, d[i - 1, j - 1] + (ref[i - 1] != hyp[j - 1]))
    i, j, s, dl, ins = n, m, 0, 0, 0
    while i or j:
        if i and j and d[i, j] == d[i - 1, j - 1] + (ref[i - 1] != hyp[j - 1]):
            s += ref[i - 1] != hyp[j - 1]
            i, j = i - 1, j - 1
        elif i and d[i, j] == d[i - 1, j] + 1:
            dl, i = dl + 1, i - 1
        else:
            ins, j = ins + 1, j - 1
    return s, dl, ins


NUMBER = re.compile(r"\d+(?:[.,]\d+)*")


def numbers_kept(src: str, out: str) -> tuple[int, int]:
    """(numbers in the source written in digits, how many appear in the output)."""
    want = [re.sub(r"[.,]", "", x) for x in NUMBER.findall(src)]
    have = {re.sub(r"[.,]", "", x) for x in NUMBER.findall(out)}
    return len(want), sum(1 for w in want if w in have)


# --- audio helpers -----------------------------------------------------------------


def resample(a: np.ndarray, rate: int, out_rate: int, channels: int = 1) -> np.ndarray:
    from app.pipeline import dub

    return dub._ffmpeg(a, rate, out_rate, channels)


def write_wav(path: Path, channels: list[np.ndarray], rate: int) -> None:
    pcm = (np.clip(np.vstack(channels).T, -1, 1) * 32767).astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(len(channels))
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm.tobytes())


def db(x: float) -> float:
    return float(10 * np.log10(max(x, 1e-12)))


def snr(true: np.ndarray, est: np.ndarray) -> float:
    n = min(true.shape[-1], est.shape[-1])
    t, e = true[..., :n], est[..., :n]
    return db(float(np.sum(t**2)) / max(float(np.sum((t - e) ** 2)), 1e-12))


# --- case preparation -------------------------------------------------------------

PAUSE, MAX_SENTENCE = 0.7, 15.0
END = re.compile(r"[.!?।][\"')\]]*$")


def dub_sentences(words: list[dict]) -> list[dict]:
    """src/lib/editor/dubPlan.ts dubSentences, the same rules."""
    out, cur = [], []

    def flush():
        nonlocal cur
        if cur:
            out.append({"start": cur[0]["start"], "end": cur[-1]["end"], "text": " ".join(w["text"] for w in cur)})
        cur = []

    for w in words:
        if cur and (w["start"] - cur[-1]["end"] >= PAUSE or w["end"] - cur[0]["start"] > MAX_SENTENCE):
            flush()
        cur.append(w)
        if END.search(w["text"]):
            flush()
    flush()
    return out


def _fleurs_clips(a: np.ndarray) -> list[np.ndarray]:
    """The clips of a FLEURS .npy, split at the 8000-sample runs of digital
    silence fleurs.py put between them."""
    zero = np.concatenate([[0], (a == 0).astype(np.int8), [0]])
    edges = np.flatnonzero(np.diff(zero))
    starts, ends = edges[::2], edges[1::2]
    cuts = [(s, e) for s, e in zip(starts, ends) if e - s >= 8000]
    clips, at = [], 0
    for s, e in cuts:
        if s > at:
            clips.append(a[at:s])
        at = e
    if at < len(a):
        clips.append(a[at:])
    return clips


def _speech_span(a: np.ndarray, rate: int) -> tuple[float, float]:
    frame = rate // 50
    n = len(a) // frame
    lv = np.sqrt(np.mean(a[: n * frame].reshape(n, frame) ** 2, axis=1) + 1e-12)
    on = np.flatnonzero(lv > lv.max() * 0.05)
    return (on[0] * frame / rate, (on[-1] + 1) * frame / rate) if len(on) else (0.0, len(a) / rate)


def prepare(data: Path, cases: Path) -> None:
    cases.mkdir(parents=True, exist_ok=True)
    music = np.fromfile(data / "music.f32", "<f4").reshape(-1, 2).T if (data / "music.f32").is_file() else None

    for lang in ("hi", "kn", "ta", "te"):
        a = np.load(data / f"{lang}.npy")
        texts = (data / f"{lang}.txt").read_text(encoding="utf-8").split("\n")
        refs = json.loads((data / f"{lang}.en.json").read_text(encoding="utf-8"))
        clips = _fleurs_clips(a)
        assert len(clips) == len(texts), (lang, len(clips), len(texts))
        parts, sentences, t = [], [], 0.0
        gap = np.zeros(ASR_RATE // 2, np.float32)
        for clip, text, ref in zip(clips, texts, refs):
            s, e = _speech_span(clip, ASR_RATE)
            sentences.append({"start": round(t + s, 3), "end": round(t + e, 3), "text": text, "ref": ref})
            parts += [clip, gap]
            t += (len(clip) + len(gap)) / ASR_RATE
            if t >= 40:
                break
        speech = resample(np.concatenate(parts), ASR_RATE, RATE)
        mix = np.vstack([speech, speech])
        _save_case(cases / f"{lang}_40", lang, mix, sentences, {"source": "FLEURS test, one speaker per clip"})
        if lang == "hi" and music is not None:
            n = mix.shape[1]
            bed = np.tile(music, (1, n // music.shape[1] + 1))[:, :n]
            bed = bed * (0.35 * np.sqrt(np.mean(speech**2)) / max(np.sqrt(np.mean(bed**2)), 1e-9))
            _save_case(cases / "hi_40_music", lang, mix + bed, sentences, {"source": "FLEURS hi + music bed at about -9 dB"}, bed=bed, speech=mix)

    # The Sinhala news report: its sentences from the Sinhala speech model,
    # as the editor would make them.
    raw = np.fromfile(data / "real_si_44k.f32", "<f4").reshape(-1, 2).T.copy()
    words_path = cases / "si_words.json"
    if not words_path.is_file():
        from app.pipeline import speech

        res = speech.transcribe(np.load(data / "real_si.npy"), "si", lambda *_: None)
        words_path.write_text(json.dumps(res["words"], ensure_ascii=False), encoding="utf-8")
    words = json.loads(words_path.read_text(encoding="utf-8"))
    for name, seconds in (("si_news_40", 40), ("si_news_169", raw.shape[1] / RATE)):
        w = [x for x in words if x["end"] <= seconds]
        _save_case(cases / name, "si", raw[:, : int(seconds * RATE)], dub_sentences(w), {"source": "Sinhala news report; sentences from the si speech model"})


def _save_case(d: Path, lang: str, mix: np.ndarray, sentences: list[dict], meta: dict, bed=None, speech=None) -> None:
    d.mkdir(parents=True, exist_ok=True)
    np.ascontiguousarray(mix.T, "<f4").tofile(d / "mix.f32")
    if bed is not None:
        np.save(d / "bed.npy", bed.astype(np.float32))
        np.save(d / "speech.npy", speech.astype(np.float32))
    meta = {**meta, "lang": lang, "seconds": round(mix.shape[1] / RATE, 2), "sentences": len(sentences)}
    (d / "case.json").write_text(json.dumps({"meta": meta, "sentences": sentences}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(d.name, meta)


# --- one pipeline run (in its own process, for its memory peak) -------------------


class _TimedSession:
    def __init__(self, session, name: str, times: dict, calls: dict):
        self._s, self._name, self._times, self._calls = session, name, times, calls

    def run(self, *a, **k):
        t = time.perf_counter()
        try:
            return self._s.run(*a, **k)
        finally:
            self._times[self._name] += time.perf_counter() - t
            self._calls[self._name] += 1

    def __getattr__(self, name):
        return getattr(self._s, name)


def run_case(case_dir: Path, out: Path) -> dict:
    from app.pipeline import dub

    case = json.loads((case_dir / "case.json").read_text(encoding="utf-8"))
    sentences = [{k: s[k] for k in ("start", "end", "text")} for s in case["sentences"]]
    mix = np.fromfile(case_dir / "mix.f32", "<f4").reshape(-1, 2).T.copy()
    total = mix.shape[1] / RATE

    stage = collections.defaultdict(float)
    parts = collections.defaultdict(float)
    calls = collections.defaultdict(int)
    seen: dict = {}

    def timed(name, fn):
        def wrap(*a, **k):
            t = time.perf_counter()
            try:
                return fn(*a, **k)
            finally:
                stage[name] += time.perf_counter() - t

        return wrap

    orig_session = dub._session

    def session(path, threads, *a, **k):
        t = time.perf_counter()
        s = orig_session(path, threads, *a, **k)
        name = Path(str(path)).name.split(".")[0]
        parts[f"load {name}"] += time.perf_counter() - t
        return _TimedSession(s, name, parts, calls)

    import ctranslate2

    orig_translator = ctranslate2.Translator

    def translator(*a, **k):
        t = time.perf_counter()
        x = orig_translator(*a, **k)
        parts["load translator"] += time.perf_counter() - t
        return x

    orig_translate, orig_sample = dub.translate, dub.voice_sample
    orig_init = dub.Voice.__init__
    new = hasattr(dub, "schedule")  # 2.0: schedule(), Voice.say_all(), a report

    def translate(texts, *a, **k):
        res = orig_translate(texts, *a, **k)
        seen["english"] = [getattr(x, "text", x) for x in res]
        return res

    def sample(*a, **k):
        res = orig_sample(*a, **k)
        seen["sample"] = res[0] if isinstance(res, tuple) else res
        return res

    patches = {
        "_session": session,
        "translate": timed("translate", translate),
        "separate": timed("separate", dub.separate),
        "voice_sample": timed("sample", sample),
    }
    if new:
        orig_schedule, orig_say_all = dub.schedule, dub.Voice.say_all

        def schedule(starts, lengths, total_, *a, **k):
            res = orig_schedule(starts, lengths, total_, *a, **k)
            seen["fit"] = res[0]
            return res

        def say_all(self, texts, *a, **k):
            res = orig_say_all(self, texts, *a, **k)
            seen["spoken"] = res[0]
            return res

        patches["schedule"] = schedule
        dub.Voice.say_all = timed("speak", say_all)
    else:
        orig_fit, orig_say = dub.fit, dub.Voice.say

        def fit(starts, spoken, total_, *a, **k):
            res = orig_fit(starts, spoken, total_, *a, **k)
            seen["fit"], seen["spoken"] = res, spoken
            return res

        patches["fit"] = fit
        dub.Voice.say = timed("speak", orig_say)
    saved = {k: getattr(dub, k) for k in patches}
    for k, v in patches.items():
        setattr(dub, k, v)
    ctranslate2.Translator = translator
    dub.Voice.__init__ = timed("voice load", orig_init)
    try:
        cpu0, t0 = cpu_seconds(), time.perf_counter()
        rendered = dub.render(mix, sentences, lambda *_: None, case["meta"]["lang"]) if new else dub.render(mix, sentences, lambda *_: None)
        english, background = rendered[0], rendered[1]
        seen["report"] = rendered[2] if len(rendered) > 2 else None
        wall = time.perf_counter() - t0
        cpu = cpu_seconds() - cpu0
        peak = peak_mb()
    finally:
        for k, v in saved.items():
            setattr(dub, k, v)
        ctranslate2.Translator = orig_translator
        dub.Voice.__init__ = orig_init
        if new:
            dub.Voice.say_all = orig_say_all
        else:
            dub.Voice.say = orig_say

    out.mkdir(parents=True, exist_ok=True)
    write_wav(out / "english.wav", [english], RATE)
    write_wav(out / "background.wav", [background[0], background[1]], RATE)
    write_wav(out / "preview.wav", [english + background[0], english + background[1]], RATE)

    stage = dict(stage)
    stage["fit and mix"] = wall - sum(stage.values())
    speak_tokens = calls.get("language_model", 0)
    res = {
        "case": case_dir.name,
        "meta": case["meta"],
        "wall_s": round(wall, 1),
        "realtime_factor": round(wall / total, 2),
        "cpu_cores": round(cpu / wall, 2),
        "peak_mb": round(peak),
        "stages_s": {k: round(v, 1) for k, v in stage.items()},
        "parts_s": {k: round(v, 2) for k, v in sorted(parts.items())},
        "calls": dict(calls),
        "lm_steps_per_s": round(speak_tokens / max(parts.get("language_model", 1e-9), 1e-9), 1),
        "sep_s_per_chunk": round(parts.get("htdemucs_ft_vocals_fp16weights", parts.get("htdemucs_ft_vocals", 0)) / max(1, calls.get("htdemucs_ft_vocals_fp16weights", calls.get("htdemucs_ft_vocals", 0))), 2),
        "report": seen.get("report"),
    }
    res.update(quality(case, mix, english, background, seen, case_dir))
    (out / "result.json").write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
    return res


def hear(english: np.ndarray, at: float, end: float) -> list[str]:
    """The words the general speech model hears in one placed sentence of
    the English track, transcribed on its own (whole-track transcription
    gave words near a sentence's edge to its neighbour)."""
    from app.pipeline import speech

    seg = english[max(0, int((at - 0.1) * RATE)) : int((end + 0.3) * RATE)]
    if len(seg) < RATE // 10:
        return []
    return [w["text"] for w in speech.transcribe(resample(seg, RATE, ASR_RATE), "en", lambda *_: None)["words"]]


def rescore(out_dir: Path) -> dict:
    """Word errors of a saved run again, from its english.wav and placements."""
    res = json.loads((out_dir / "result.json").read_text(encoding="utf-8"))
    with wave.open(str(out_dir / "english.wav")) as w:
        english = np.frombuffer(w.readframes(w.getnframes()), "<i2").astype(np.float32) / 32768
    per = res["per_sentence"]
    for p in per:
        end = p["at"] + p["said_s"] / p["tempo"]
        sub, dl, ins = edit_ops(norm_words(p["english"]), norm_words(" ".join(hear(english, p["at"], end))))
        p.update(sub=sub, ins=ins, **{"del": dl})
    nw = sum(p["words"] for p in per) or 1
    res["wer"] = round(sum(p["sub"] + p["del"] + p["ins"] for p in per) / nw, 3)
    res["words_missing"] = round(sum(p["del"] for p in per) / nw, 3)
    res["sentences_mostly_missing"] = sum(1 for p in per if p["words"] and p["del"] / p["words"] > 0.5)
    (out_dir / "result.json").write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
    return res


def quality(case: dict, mix: np.ndarray, english: np.ndarray, background: np.ndarray, seen: dict, case_dir: Path) -> dict:
    from app.pipeline import dub, speech

    src = case["sentences"]
    eng_text = seen.get("english", [])
    kept = [(s, t) for s, t in zip(src, eng_text) if t]
    q: dict = {"sentences": len(src), "translated": len(kept), "empty_translations": len(src) - len(kept)}

    refs = [s.get("ref") for s in src]
    if all(refs) and eng_text:
        q["chrf_pp"] = round(chrf_pp(eng_text, refs), 1)

    # Words: the English track recognised again.
    total = english.shape[0] / RATE
    fits = seen.get("fit", [])
    spoken = seen.get("spoken", [])
    per = []
    for (s, t), (at, tempo), wav in zip(kept, fits, spoken):
        end = at + len(wav) / dub.VOICE_RATE / tempo
        heard = hear(english, at, end)
        ref_w, hyp_w = norm_words(t), norm_words(" ".join(heard))
        sub, dl, ins = edit_ops(ref_w, hyp_w)
        cut = max(0.0, end - total)
        per.append({
            "src_start": s["start"], "at": round(at, 2), "delay": round(at - s["start"], 2), "tempo": round(tempo, 3),
            "said_s": round(len(wav) / dub.VOICE_RATE, 2), "slot_s": round(s["end"] - s["start"], 2),
            "cut_s": round(cut, 2), "words": len(ref_w), "sub": sub, "del": dl, "ins": ins,
            "english": t,
        })  # fmt: skip
    nw = sum(p["words"] for p in per) or 1
    q["wer"] = round(sum(p["sub"] + p["del"] + p["ins"] for p in per) / nw, 3)
    q["words_missing"] = round(sum(p["del"] for p in per) / nw, 3)
    q["sentences_mostly_missing"] = sum(1 for p in per if p["words"] and p["del"] / p["words"] > 0.5)
    q["max_delay_s"] = round(max((p["delay"] for p in per), default=0), 2)
    q["mean_delay_s"] = round(float(np.mean([p["delay"] for p in per])) if per else 0, 2)
    q["sped_up"] = sum(1 for p in per if p["tempo"] > 1.001)
    q["cut_at_end_s"] = round(sum(p["cut_s"] for p in per), 2)

    # Loudness of each placed sentence.
    levels = []
    for p, wav in zip(per, spoken):
        a = int(p["at"] * RATE)
        b = min(len(english), a + int(len(wav) / dub.VOICE_RATE / p["tempo"] * RATE))
        seg = english[a:b]
        if len(seg):
            levels.append(db(float(np.mean(seg**2))))
    for p, lv in zip(per, levels):
        p["level_dbfs"] = round(lv, 1)
    if levels:
        q["level_dbfs"] = {"min": round(min(levels), 1), "median": round(float(np.median(levels)), 1), "max": round(max(levels), 1),
                           "spread_sd": round(float(np.std(levels)), 1),
                           "max_jump": round(max((abs(a - b) for a, b in zip(levels, levels[1:])), default=0), 1)}  # fmt: skip
    q["peak"] = round(float(np.max(np.abs(english))) if len(english) else 0, 3)

    # Speaker similarity proxy: the voice model's own speaker encoder.
    if "sample" in seen and spoken:
        enc = dub._session(speech._model_path(dub.VOICE) / "onnx/speech_encoder_q4.onnx", speech._cpu_threads())

        def emb(a24):
            x = enc.run(None, {"audio_values": a24[None, : int(9.5 * dub.VOICE_RATE)].astype(np.float32)})[2]
            x = np.asarray(x, np.float32).reshape(-1)
            return x / (np.linalg.norm(x) + 1e-9)

        ref = emb(seen["sample"])
        gen = [emb(w) for w in spoken if len(w) > dub.VOICE_RATE]
        q["speaker_sim_sample"] = round(float(np.mean([g @ ref for g in gen])), 3) if gen else None
        # Against the speaker's own speech: each source sentence of the
        # separated voice (mix minus background). Mean over all pairs of a
        # generated sentence and a source sentence; "source_self" is the
        # same measure between different source sentences (what the same
        # person scores here - FLEURS clips are different speakers).
        voice = (mix - background).mean(axis=0)
        own = []
        for s in src:
            a, b = int(s["start"] * RATE), int(s["end"] * RATE)
            if b - a > RATE:
                own.append(emb(resample(voice[a:b], RATE, dub.VOICE_RATE)))
        if gen and own:
            q["speaker_sim_source"] = round(float(np.mean([g @ o for g in gen for o in own])), 3)
            q["speaker_sim_source_min"] = round(float(min(float(np.mean([g @ o for o in own])) for g in gen)), 3)
        if len(own) > 1:
            q["speaker_sim_source_self"] = round(float(np.mean([own[i] @ own[j] for i in range(len(own)) for j in range(len(own)) if i != j])), 3)

    # Separation against the true parts, where known.
    if (case_dir / "bed.npy").is_file():
        bed, sp = np.load(case_dir / "bed.npy"), np.load(case_dir / "speech.npy")
        q["background_snr_db"] = round(snr(bed, background), 1)
        q["voice_snr_db"] = round(snr(sp, mix - background), 1)
    else:
        spans = np.zeros(mix.shape[1], bool)
        for s in src:
            spans[int(s["start"] * RATE) : int(s["end"] * RATE)] = True
        if spans.any():
            q["background_in_speech_db"] = round(db(float(np.mean(background[:, spans] ** 2))) - db(float(np.mean(mix[:, spans] ** 2))), 1)
    q["per_sentence"] = per
    return q


# --- translation only --------------------------------------------------------------

FLORES = {"si": "sin_Sinh", "hi": "hin_Deva", "kn": "kan_Knda", "ta": "tam_Taml", "te": "tel_Telu",
          "en": "eng_Latn", "fr": "fra_Latn", "de": "deu_Latn", "es": "spa_Latn", "it": "ita_Latn"}


def run_translate(data: Path, out: Path, n: int, opts: dict, label: str, langs: list[str]) -> dict:
    from app.pipeline import dub

    root = data / "flores" / "flores200_dataset" / "devtest"
    res = {"label": label, "n": n, "opts": opts, "langs": {}}
    total_t = 0.0
    for spec in langs:  # "si" (into English) or "fr-de" (source-target)
        lang, target = spec.split("-") if "-" in spec else (spec, "en")
        eng = (root / f"{FLORES[target]}.devtest").read_text(encoding="utf-8").split("\n")[:n]
        src = (root / f"{FLORES[lang]}.devtest").read_text(encoding="utf-8").split("\n")[:n]
        t = time.perf_counter()
        if hasattr(dub, "schedule"):  # 2.0: checks need the language
            o = dict(opts)
            if target != "en":
                o["target"] = target
            if o.get("context") is True:  # FLORES devtest runs article by article: the sentence before
                o["context"] = [None] + list(range(len(src) - 1))
            raw = dub.translate(src, lambda *_: None, language=lang, **o)
        else:
            raw = dub.translate(src, lambda *_: None, **opts)
        hyp = [getattr(x, "text", x) for x in raw]
        flags = collections.Counter(f for x in raw for f in getattr(x, "flags", []))
        retried = sum(1 for x in raw if getattr(x, "retried", False))
        dt = time.perf_counter() - t
        total_t += dt
        want = got = 0
        for s, h in zip(src, hyp):
            a, b = numbers_kept(s, h)
            want, got = want + a, got + b
        ratio = [len(h.split()) / max(1, len(r.split())) for h, r in zip(hyp, eng)]
        res["langs"][spec] = {
            "chrf_pp": round(chrf_pp(hyp, eng), 1),
            "seconds": round(dt, 1),
            "empty": sum(1 for h in hyp if not h.strip()),
            "numbers_kept": f"{got}/{want}",
            "short_lt_0.5": sum(1 for r in ratio if r < 0.5),
            "long_gt_2": sum(1 for r in ratio if r > 2),
            "flags_left": dict(flags),
            "retried": retried,
            "ratio_p1_p99": [round(float(np.percentile([len(h.split()) / max(1, len(s.split())) for h, s in zip(hyp, src)], q)), 2) for q in (1, 99)],
        }
        print(spec, res["langs"][spec], flush=True)
        (out / f"translate-{label}-{spec}.txt").write_text("\n".join(hyp), encoding="utf-8")
    res["seconds"] = round(total_t, 1)
    res["chrf_pp_mean"] = round(float(np.mean([v["chrf_pp"] for v in res["langs"].values()])), 1)
    (out / f"translate-{label}.json").write_text(json.dumps(res, indent=1), encoding="utf-8")
    return res


def main() -> None:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("prepare")
    p.add_argument("data", type=Path)
    p.add_argument("cases", type=Path)
    r = sub.add_parser("run")
    r.add_argument("cases", type=Path)
    r.add_argument("out", type=Path)
    r.add_argument("--only", default="")
    r.add_argument("--label", default="run")
    r.add_argument("--root", default="", help="backend folder whose engine code to run (default: this one)")
    r.add_argument("--one", action="store_true", help=argparse.SUPPRESS)
    rs = sub.add_parser("rescore")
    rs.add_argument("runs", type=Path, nargs="+", help="OUT_DIR/<label>/<case> folders")
    t = sub.add_parser("translate")
    t.add_argument("data", type=Path)
    t.add_argument("out", type=Path)
    t.add_argument("--n", type=int, default=100)
    t.add_argument("--label", default="run")
    t.add_argument("--langs", default="si,hi,kn,ta,te")
    t.add_argument("--opts", default="", help="JSON of dub.translate keyword options")
    a = ap.parse_args()

    if a.cmd == "prepare":
        prepare(a.data, a.cases)
    elif a.cmd == "rescore":
        for d in a.runs:
            r = rescore(d)
            print(d, "wer", r["wer"], "missing", r["words_missing"], "mostly missing", r["sentences_mostly_missing"])
    elif a.cmd == "translate":
        a.out.mkdir(parents=True, exist_ok=True)
        run_translate(a.data, a.out, a.n, json.loads(a.opts) if a.opts else {}, a.label, a.langs.split(","))
    elif a.one:
        res = run_case(a.cases, a.out)
        print(json.dumps({k: v for k, v in res.items() if k != "per_sentence"}, ensure_ascii=False))
    else:
        names = a.only.split(",") if a.only else sorted(d.name for d in a.cases.iterdir() if (d / "case.json").is_file())
        summary = []
        for name in names:
            out = a.out / a.label / name
            # Its own process: a clean memory peak per case.
            env = {**os.environ, "PYTHONIOENCODING": "utf-8"}
            if a.root:
                env["DUB_BENCH_ROOT"] = str(Path(a.root).resolve())
            proc = subprocess.run([sys.executable, __file__, "run", str(a.cases / name), str(out), "--one"], text=True, encoding="utf-8", errors="replace", env=env)
            if proc.returncode == 0 and (out / "result.json").is_file():
                res = json.loads((out / "result.json").read_text(encoding="utf-8"))
                summary.append({k: v for k, v in res.items() if k != "per_sentence"})
                print(name, json.dumps(summary[-1]["stages_s"]), "wall", res["wall_s"], flush=True)
            else:
                print(name, "FAILED", proc.returncode, flush=True)
        (a.out / a.label).mkdir(parents=True, exist_ok=True)
        (a.out / a.label / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
