#!/usr/bin/env python3
"""Paragraph timings for the read-along highlight: when each paragraph of a script starts in its recording.

    python3 tools/cues.py audio/2026-11                 time the sections that have no timings yet, or whose
                                                        timings no longer fit the script
    python3 tools/cues.py audio/2026-11 --all           time every recorded section again
    python3 tools/cues.py audio/2026-11 --section tv    only this section (repeat the option for more)
    python3 tools/cues.py audio/2026-11 --check         no recognizer: every section that has timings has one
                                                        for each paragraph of its script

For each section in the edition's manifest.json whose MP3 is in the folder, the recording is transcribed with
word timestamps (faster-whisper, the small English model, on the CPU), the recognized words are matched to the
words of the script (audio/<edition>/<section-id>.txt), and the manifest entry gets "cues": the second at which
each paragraph starts, one for each paragraph, rounded to 0.1, the first 0, never decreasing. Nothing else in the
manifest changes, and it is written as tools/voiceover.py writes it. The page highlights the element of
<section-id>.blocks.json (tools/narration.py) that belongs to the last cue at or before the playing time.

A paragraph starts where its first matched word was heard or, when it opens with words that were misheard (a
name, usually), where those were heard. The recognizer counts the pause before a word as part of the word, so
its start times run up to a second early at a paragraph break; the cue is therefore moved to the middle of the
silence that the recording has there. A paragraph with no matched word is placed between its neighbors by its
share of their characters.

The share of script words that were matched is printed for each section; it is also a check on the recording
itself. The recognizer now and then skips a stretch of speech, so a stretch where five or more script words in
a row went unheard is listened to a second time before the share is counted. Under 90 percent the words that
did not match are listed, and under 70 percent no cues are written, so that section plays without a highlight.

The script is matched as it is now, also when it changed after the recording (its hash differs from the
manifest's): a reworded sentence leaves the paragraphs where they were. tools/voiceover.py rebuilds a section's
manifest entry when it records it again, which drops the old cues with the old audio.

Needs faster-whisper (pip install faster-whisper) and, to decode the MP3s, ffmpeg on the PATH; without ffmpeg
the library's own decoder is used. --check and the alignment itself need only the standard library.
"""
import argparse, difflib, hashlib, json, os, pathlib, re, shutil, subprocess, sys, unicodedata

MODEL = "base.en"
MIN_MATCH = 0.70    # under this share of matched words, a section gets no cues
WARN_MATCH = 0.90   # under this share, the words that did not match are listed
RATE = 16000        # samples a second, as the recognizer wants them
HOLE = 5            # this many script words in a row with nothing heard: listen to that stretch again
PAUSE = 0.15        # a silence at least this long, in seconds, can be the break between two paragraphs
SMALL = {w: [*str(i)] for i, w in enumerate(
    "zero one two three four five six seven eight nine ten eleven twelve".split())}


def sha256(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def paragraphs(script):
    """The paragraphs of a script: tools/narration.py separates them with a blank line."""
    return [p for p in script.strip().split("\n\n") if p]


def tokens(text):
    """Lowercase tokens, spelled so that the script and the recognizer agree where they say the same thing:
    "38.7%" and "38.7 percent", "caller's" and "callers", "café" and "cafe", "nine" and "9". Words are runs of
    letters and every digit stands alone, so "1,906", "1 ,906" and "1906" are the same four tokens."""
    t = unicodedata.normalize("NFKD", text.lower().replace("\u2019", "'"))
    t = "".join(ch for ch in t if not unicodedata.combining(ch))
    t = t.replace("%", " percent ").replace("&", " and ").replace("'", "")
    out = []
    for w in re.findall(r"[a-z]+|\d", t):
        out.extend(SMALL.get(w, [w]))   # a number word becomes its digits ("twelve" is 1, 2)
    return out


def _match(paras, heard):
    """Script tokens with their paragraphs, recognized tokens with the index of their word in `heard`, and how
    the two sequences line up (difflib opcodes)."""
    words, owner = [], []
    for i, p in enumerate(paras):
        for w in tokens(p):
            words.append(w)
            owner.append(i)
    said, word = [], []
    for k, h in enumerate(heard):
        for w in tokens(h[0]):
            said.append(w)
            word.append(k)
    ops = difflib.SequenceMatcher(None, words, said, autojunk=False).get_opcodes()
    return words, owner, said, word, ops


def holes(paras, heard, duration=None, least=HOLE):
    """Stretches of the recording, as (from, to) in seconds, where at least `least` script words in a row have
    nothing heard against them. Either the recording leaves them out or, far more often, the recognizer
    skipped speech there, and listening to the stretch again recovers it. The stretch runs from two words
    before the last matched word to the end of the next matched word, because a skipped passage tends to be
    hidden inside a neighboring word that the recognizer made seconds long. Pure."""
    words, owner, said, word, ops = _match(paras, heard)
    total = max([float(duration or 0)] + [float(h[-1]) for h in heard[-1:]])
    out = []
    for tag, i1, i2, j1, j2 in ops:
        if tag == "equal" or (i2 - i1) - (j2 - j1) < least:
            continue
        t0 = float(heard[max(0, word[j1 - 1] - 2)][1]) if j1 else 0.0
        t1 = float(heard[word[j2]][-1]) if j2 < len(said) else total
        out.append((t0, t1))
    return out


def align(paras, heard, duration=None, pauses=()):
    """Where each paragraph starts. Pure: no recognizer, no files.

    paras     the script's paragraphs, in order
    heard     what a recognizer heard, in order: (word, start) or (word, start, end), times in seconds
    duration  the recording's length in seconds, the end point for trailing paragraphs that were not heard
    pauses    the recording's silences as (from, to) pairs; a paragraph start is moved to the middle of the
              one between the word before it and the end of its first word

    Returns (cues, share, misses): one start time for each paragraph (rounded to 0.1, the first 0, never
    decreasing); the share of script words that were matched; and (script words, heard words) pairs for the
    stretches that were not, longest first."""
    words, owner, said, word, ops = _match(paras, heard)
    first = [None] * len(paras)     # for each paragraph, the index in `heard` of the word it starts with
    matched, misses = 0, []
    for tag, i1, i2, j1, j2 in ops:
        if tag == "equal":
            matched += i2 - i1
            for k in range(i2 - i1):
                if first[owner[i1 + k]] is None:
                    first[owner[i1 + k]] = word[j1 + k]
        elif tag in ("replace", "delete"):
            misses.append((" ".join(words[i1:i2]), " ".join(said[j1:j2])))
        if tag == "replace":
            # A paragraph that opens inside a misheard stretch (a name, usually) starts at the matching point
            # of what was heard there, which is closer than its first exactly matched word
            for i in range(i1, i2):
                if (i == 0 or owner[i - 1] != owner[i]) and first[owner[i]] is None:
                    first[owner[i]] = word[j1 + (i - i1) * (j2 - j1) // (i2 - i1)]
    share = matched / len(words) if words else 0.0
    misses.sort(key=lambda m: -len(m[0]))
    if not paras:
        return [], share, misses

    starts = [None] * len(paras)
    for i, k in enumerate(first):
        if k is None:
            continue
        t = starts[i] = float(heard[k][1])
        if pauses and k:
            # The break is a silence between the start of the word before and the end of this one: the one
            # nearest to where the recognizer put the start of this word, the longer one if two are as near
            lo = float(heard[k - 1][1])
            hi = float(heard[k][2]) if len(heard[k]) > 2 else (float(heard[k + 1][1]) if k + 1 < len(heard) else t + 1.0)
            near = [(max(a - t, t - b, 0.0), a - b, a, b) for a, b in pauses if b > lo and a < hi]
            if near:
                _, _, a, b = min(near)
                starts[i] = (a + b) / 2
    # The first paragraph starts with the recording. Unheard paragraphs share the time between the heard ones.
    starts[0] = 0.0
    end = max([float(duration or 0)] + [float(h[1]) for h in heard[-1:]] + [s for s in starts if s is not None])
    known = [i for i, s in enumerate(starts) if s is not None]
    for a, b in zip(known, known[1:] + [len(paras)]):
        if b - a < 2:
            continue
        t0, t1 = starts[a], (starts[b] if b < len(paras) else end)
        sizes = [len(paras[i]) for i in range(a, b)]
        total, run = sum(sizes) or 1, 0
        for i in range(a + 1, b):
            run += sizes[i - a - 1]
            starts[i] = t0 + (t1 - t0) * run / total
    cues, last = [], 0.0
    for s in starts:
        last = max(last, round(s, 1))
        cues.append(last)
    return cues, share, misses


def problems(cues, script, duration=None):
    """What is wrong with a section's cues, as a list of sentences; empty when they fit its script. A wrong
    count comes first."""
    out = []
    n = len(paragraphs(script))
    if not isinstance(cues, list) or not all(isinstance(c, (int, float)) and not isinstance(c, bool) for c in cues):
        return ["cues is not a list of numbers"]
    if len(cues) != n:
        out.append(f"{len(cues)} cues for {n} paragraphs")
    if cues and cues[0] != 0:
        out.append(f"the first cue is {cues[0]}, not 0")
    if any(b < a for a, b in zip(cues, cues[1:])):
        out.append("the cues go backwards")
    if cues and duration and cues[-1] > duration:
        out.append(f"the last cue ({cues[-1]}) is past the end of the recording ({duration})")
    return out


def decode(path):
    """The recording as 16 kHz mono float32 samples."""
    import numpy
    if shutil.which("ffmpeg"):
        raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-f", "s16le", "-ac", "1", "-ar", str(RATE), "-"],
                             check=True, capture_output=True).stdout
        return numpy.frombuffer(raw, numpy.int16).astype(numpy.float32) / 32768.0
    from faster_whisper.audio import decode_audio
    return decode_audio(str(path), sampling_rate=RATE)


def silences(samples):
    """The recording's silences of at least PAUSE seconds, as (from, to) pairs in seconds: stretches whose
    loudness, in 10 ms steps, stays under 3 percent of the level of the loud passages."""
    import numpy
    step = RATE // 100
    n = len(samples) // step
    if not n:
        return []
    level = numpy.sqrt((samples[:n * step].reshape(n, step) ** 2).mean(axis=1))
    quiet = (level < max(0.002, 0.03 * float(numpy.percentile(level, 95)))).astype(numpy.int8)
    edges = numpy.flatnonzero(numpy.diff(numpy.concatenate(([0], quiet, [0]))))
    return [(round(a * step / RATE, 2), round(b * step / RATE, 2))
            for a, b in zip(edges[::2].tolist(), edges[1::2].tolist()) if (b - a) * step / RATE >= PAUSE]


def recognize(model, samples, offset=0.0):
    """(word, start, end) for every word the recognizer hears in the samples, which begin `offset` seconds
    into the recording."""
    segments, _ = model.transcribe(samples, word_timestamps=True, beam_size=1, condition_on_previous_text=False)
    return [(w.word.strip(), round(float(w.start) + offset, 2), round(float(w.end) + offset, 2))
            for seg in segments for w in (seg.words or [])]


def listen(model, samples, paras, quiet, duration=None):
    """What the recognizer hears in a recording, and how many stretches it took from a second pass: a stretch
    where it skipped words of the script is heard again, cut out at the silences (`quiet`) around it so that no
    word is split, and kept if it matches the script better."""
    heard = recognize(model, samples)
    again = 0
    middles = [(a + b) / 2 for a, b in quiet]
    for t0, t1 in holes(paras, heard, duration):
        lo = max([m for m in middles if m <= t0], default=0.0)
        hi = min([m for m in middles if m >= t1], default=len(samples) / RATE)
        second = recognize(model, samples[int(lo * RATE):int(hi * RATE)], lo)
        trial = [w for w in heard if w[2] <= lo] + second + [w for w in heard if w[2] > hi]
        if align(paras, trial, duration)[1] > align(paras, heard, duration)[1]:
            heard, again = trial, again + 1
    return heard, again


def save(mpath, manifest):
    """Write the manifest as tools/voiceover.py does, in one step, so a stopped run never leaves half a file."""
    tmp = mpath.with_name(mpath.name + ".tmp")
    tmp.write_text(json.dumps(manifest, indent=2) + "\n")
    os.replace(tmp, mpath)


def check(folder, entries):
    """Print what is wrong with the stored cues of an edition; return the number of sections that fail."""
    bad = with_cues = 0
    for sid, e in entries.items():
        if "cues" not in e:
            continue
        with_cues += 1
        f = folder / f"{sid}.txt"
        if not f.exists():
            print(f"{folder.name}/{sid}: cues, but no script {f.name}")
            bad += 1
            continue
        script = f.read_text(encoding="utf-8")
        found = problems(e["cues"], script, e.get("duration"))
        if not found:
            continue
        if e.get("sha256") != sha256(script) and isinstance(e["cues"], list) and len(e["cues"]) != len(paragraphs(script)):
            # An edited script that waits for its recording. The page shows no highlight when the counts
            # differ, so this is reported and does not fail: a text edit must not need new audio to pass.
            print(f"{folder.name}/{sid}: {found[0]}; the script changed after the recording, so the page shows "
                  f"no highlight for this section until it is recorded or timed again")
            continue
        print(f"{folder.name}/{sid}: " + "; ".join(found))
        bad += 1
    print(f"cues: edition {folder.name}, {with_cues} of {len(entries)} sections have cues"
          + (f", {bad} with problems" if bad else ""))
    return bad


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("folders", nargs="+", help="edition audio folders, e.g. audio/2026-11")
    ap.add_argument("--check", action="store_true", help="verify the stored cues against the scripts; no recognizer")
    ap.add_argument("--all", action="store_true", help="time every recorded section, also those whose cues fit")
    ap.add_argument("--section", action="append", default=[], help="only this section id (may be repeated)")
    ap.add_argument("--model", default=MODEL, help=f"faster-whisper model (default {MODEL})")
    ap.add_argument("--models", default=None, metavar="DIR",
                    help="folder that holds, or will hold, the downloaded model (default: the library's own cache)")
    ap.add_argument("--words", default=None, metavar="DIR",
                    help="also save what the recognizer heard, with times, as DIR/<edition>-<section>.json")
    a = ap.parse_args()

    bad = 0
    model = None
    rates = []
    for name in a.folders:
        folder = pathlib.Path(name)
        mpath = folder / "manifest.json"
        if not mpath.exists():
            sys.exit(f"cues: no {mpath}")
        manifest = json.loads(mpath.read_text())
        entries = manifest.get("sections", {})
        if a.check:
            bad += check(folder, entries)
            continue
        for sid in a.section:
            if sid not in entries:
                sys.exit(f"cues: no section {sid} in {mpath}")
        for sid, e in entries.items():
            if a.section and sid not in a.section:
                continue
            script_file = folder / f"{sid}.txt"
            if not script_file.exists():
                continue
            script = script_file.read_text(encoding="utf-8")
            if not e.get("file") or not (folder / e["file"]).is_file():
                print(f"{folder.name}/{sid}: no MP3 in the folder (hosted elsewhere, or not recorded); skipped")
                continue
            if not a.all and not a.section and "cues" in e and not problems(e["cues"], script, e.get("duration")):
                continue
            if model is None:
                try:
                    from faster_whisper import WhisperModel
                except ImportError:
                    sys.exit("cues: faster-whisper is not installed (pip install faster-whisper)")
                model = WhisperModel(a.model, device="cpu", compute_type="int8", download_root=a.models)
            paras = paragraphs(script)
            samples = decode(folder / e["file"])
            quiet = silences(samples)
            heard, again = listen(model, samples, paras, quiet, e.get("duration"))
            if a.words:
                out = pathlib.Path(a.words)
                out.mkdir(parents=True, exist_ok=True)
                (out / f"{folder.name}-{sid}.json").write_text(json.dumps(heard) + "\n")
            cues, share, misses = align(paras, heard, e.get("duration"), quiet)
            rates.append((share, f"{folder.name}/{sid}"))
            words = sum(len(tokens(p)) for p in paras)
            note = (f"; {again} stretch(es) heard twice" if again else "") \
                + ("" if e.get("sha256") == sha256(script) else "; the script changed after this recording")
            if share < MIN_MATCH:
                e.pop("cues", None)
                verdict = "NO CUES WRITTEN"
                bad += 1
            else:
                e["cues"] = cues
                verdict = "cues written"
            print(f"{folder.name}/{sid}: {len(paras)} paragraphs, {share:.1%} of {words} words matched, "
                  f"{verdict}{note}", flush=True)
            if share < WARN_MATCH:
                for want, got in misses[:8]:
                    print(f"    script: {want[:110]!r}  heard: {got[:110]!r}")
            save(mpath, manifest)   # after every section, so a run that stops keeps what it has timed
    if a.check:
        sys.exit(1 if bad else 0)
    if rates:
        low = [f"{n} {s:.1%}" for s, n in sorted(rates) if s < WARN_MATCH]
        print(f"cues: {len(rates)} sections timed; lowest match {min(rates)[0]:.1%} ({min(rates)[1]}); "
              + (f"under {WARN_MATCH:.0%}: " + ", ".join(low) if low else f"none under {WARN_MATCH:.0%}"))
    else:
        print("cues: nothing to time")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
