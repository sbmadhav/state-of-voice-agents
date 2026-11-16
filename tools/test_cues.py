#!/usr/bin/env python3
"""Tests for tools/cues.py. Standard library only, no recognizer and no network: python3 tools/test_cues.py"""
import contextlib, io, json, os, pathlib, sys, tempfile, unittest, urllib.request

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import cues as c  # noqa: E402
import narration  # noqa: E402
import voiceover  # noqa: E402


def heard(text, start=0.0, step=0.5):
    """A made-up recognizer result: one word every `step` seconds, as (word, start, end)."""
    return [(w, round(start + i * step, 2), round(start + i * step + step * 0.8, 2)) for i, w in enumerate(text.split())]


PARAS = ["Section 3: New failure mode.",
         "With the TV on, task completion fell from 38.7 percent to 8.6 percent.",
         "Krisp VI 2.5 had a word error rate of 5.30 percent."]


class Tokens(unittest.TestCase):
    def test_the_script_and_the_recognizer_spell_alike(self):
        self.assertEqual(c.tokens("38.7 percent"), c.tokens("38.7%"))
        self.assertEqual(c.tokens("1,906 calls"), c.tokens("1 ,906 calls"))
        self.assertEqual(c.tokens("1,906 calls"), c.tokens("1906 calls"))
        self.assertEqual(c.tokens("the caller's voice"), c.tokens("The callers voice,"))
        self.assertEqual(c.tokens("café and TV"), c.tokens("Cafe & TV"))
        self.assertEqual(c.tokens("Nine of the 14"), c.tokens("9 of the 14"))
        self.assertEqual(c.tokens("2.2 L"), c.tokens("2.2L"))
        self.assertEqual(c.tokens("A\u2014b - c"), ["a", "b", "c"])


class Align(unittest.TestCase):
    def test_a_paragraph_starts_at_its_first_matched_word(self):
        words = heard("Section three new failure mode") + heard("With the TV on task completion fell from 38.7% to 8.6%", 4.0) \
            + heard("Krisp VI 2.5 had a word error rate of 5.30%", 12.0)
        cues, share, misses = c.align(PARAS, words, 20.0)
        self.assertEqual(cues, [0.0, 4.0, 12.0])
        self.assertEqual(share, 1.0)      # "three" and "3", "38.7%" and "38.7 percent" are the same words
        self.assertEqual(misses, [])

    def test_two_tuples_work_too(self):
        words = [(w, s) for w, s, _ in heard("Section 3 new failure mode") + heard("With the TV on", 4.0)]
        self.assertEqual(c.align(PARAS[:2], words)[0], [0.0, 4.0])

    def test_the_first_cue_is_zero_and_cues_never_go_back(self):
        words = heard("Section 3 new failure mode", 0.7) + heard("With the TV on task completion fell", 4.04)
        cues, _, _ = c.align(PARAS[:2], words, 9.0)
        self.assertEqual(cues, [0.0, 4.0])
        # a recognizer whose clock jumps back does not produce a cue that goes back
        jumpy = heard("start here") + heard("alpha beta", 5.0) + heard("gamma delta", 3.0) + heard("epsilon zeta", 8.0)
        cues, _, _ = c.align(["Start here.", "Alpha beta.", "Gamma delta.", "Epsilon zeta."], jumpy, 10.0)
        self.assertEqual(cues, [0.0, 5.0, 5.0, 8.0])

    def test_times_are_rounded_to_a_tenth(self):
        words = [("one", 0.31, 0.5), ("two", 1.26, 1.5), ("three", 2.349, 2.5)]
        self.assertEqual(c.align(["One.", "Two.", "Three."], words)[0], [0.0, 1.3, 2.3])

    def test_recognizer_mistakes_are_tolerated(self):
        said = heard("Section 3 knew failure mowed") + heard("With the TV on task completion fell from 38.7% to 8.6%", 4.0)
        cues, share, misses = c.align(PARAS[:2], said, 12.0)
        self.assertEqual(cues, [0.0, 4.0])
        self.assertAlmostEqual(share, 19 / 21)    # every digit counts as a word: 21 tokens, two misheard
        self.assertEqual(sorted(misses), [("mode", "mowed"), ("new", "knew")])

    def test_a_paragraph_that_opens_with_a_misheard_name_starts_where_the_name_was_heard(self):
        said = heard("Section 3 new failure mode") + heard("crisp six 2.5 had a word error rate of 5.30%", 9.0)
        cues, share, _ = c.align([PARAS[0], PARAS[2]], said, 15.0)
        self.assertEqual(cues, [0.0, 9.0])    # not 10.0, where "2.5", its first matched word, was heard
        self.assertLess(share, 1.0)

    def test_an_unheard_paragraph_is_placed_by_its_share_of_characters(self):
        paras = ["Alpha beta gamma.", "x" * 30, "y" * 10, "Delta epsilon."]
        said = heard("alpha beta gamma", 0.0) + heard("delta epsilon", 20.0)
        cues, share, _ = c.align(paras, said, 25.0)
        # 17 + 30 + 10 characters share the 20 seconds before "delta"
        self.assertEqual(cues, [0.0, round(20 * 17 / 57, 1), round(20 * 47 / 57, 1), 20.0])
        self.assertAlmostEqual(share, 5 / 7)

    def test_unheard_paragraphs_at_the_end_run_to_the_end_of_the_recording(self):
        paras = ["Alpha beta gamma delta.", "z" * 23, "w" * 46]
        cues, _, _ = c.align(paras, heard("alpha beta gamma delta", 2.0), 94.0)
        self.assertEqual(cues, [0.0, 23.5, 47.0])

    def test_nothing_heard(self):
        cues, share, _ = c.align(["Alpha beta.", "Gamma delta."], [], 10.0)
        self.assertEqual(share, 0.0)
        self.assertEqual(len(cues), 2)
        self.assertEqual(cues[0], 0.0)
        self.assertEqual(c.align([], [])[0], [])

    def test_a_cue_moves_to_the_middle_of_the_silence_before_the_paragraph(self):
        # The recognizer counts the pause as part of the next word: "With" is said at 4.6, after a silence
        said = [("failure", 2.0, 2.4), ("mode.", 2.4, 3.0), ("With", 3.0, 4.9), ("the", 4.9, 5.1), ("TV", 5.1, 5.4), ("on", 5.4, 5.8)]
        paras = ["Failure mode.", "With the TV on."]
        self.assertEqual(c.align(paras, said, 8.0)[0], [0.0, 3.0])
        self.assertEqual(c.align(paras, said, 8.0, [(3.6, 4.6)])[0], [0.0, 4.1])
        # a silence somewhere else is not the paragraph break
        self.assertEqual(c.align(paras, said, 8.0, [(0.5, 1.5), (6.0, 7.5)])[0], [0.0, 3.0])

    def test_a_one_word_paragraph_does_not_lend_its_silence_to_the_next(self):
        # "Wait." is a paragraph of its own; the silence before it is longer than the one after it
        said = [("recommend", 147.06, 147.34), ("it.", 147.34, 147.66), ("Wait.", 148.38, 148.86),
                ("Waiting", 149.5, 149.86), ("until", 149.86, 150.2)]
        paras = ["I recommend it.", "Wait.", "Waiting until 2027."]
        quiet = [(147.7, 148.4), (148.9, 149.4)]
        self.assertEqual(c.align(paras, said, 160.0, quiet)[0], [0.0, 148.1, 149.2])
        # of two silences as near, the longer is the break
        said = [("mode.", 2.4, 3.0), ("With", 3.0, 4.9), ("the", 4.9, 5.1)]
        self.assertEqual(c.align(["Mode.", "With the."], said, 8.0, [(3.0, 3.2), (3.0, 4.6)])[0], [0.0, 3.8])

    def test_one_cue_for_each_paragraph_whatever_was_heard(self):
        paras = [f"Paragraph number {i} says something." for i in range(40)]
        said = heard(" ".join(p for i, p in enumerate(paras) if i % 3), 1.0, 0.3)
        cues, share, _ = c.align(paras, said, 80.0)
        self.assertEqual(len(cues), len(paras))
        self.assertEqual(cues[0], 0.0)
        self.assertEqual(cues, sorted(cues))
        self.assertTrue(all(round(x, 1) == x for x in cues))


class Holes(unittest.TestCase):
    def test_a_skipped_stretch_is_found_with_room_around_it(self):
        paras = ["Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi."]
        said = heard("alpha beta gamma delta", 0.0) + heard("omicron pi", 40.0)
        got = c.holes(paras, said, 45.0)
        self.assertEqual(len(got), 1)
        t0, t1 = got[0]
        self.assertEqual(t0, 0.5)             # two words before "delta", the last word heard before the gap
        self.assertEqual(t1, 40.4)            # the end of "omicron", the first word heard after it
        self.assertEqual(c.holes(paras, heard(paras[0]), 45.0), [])

    def test_a_few_misheard_words_are_not_a_hole(self):
        self.assertEqual(c.holes(PARAS[:1], heard("Section 3 knew failure mowed")), [])
        said = heard("Section 3 new failure mode") + heard("with the TV on task completion fell from 38.7% to 8.6%", 4.0) \
            + heard("crisp six 2.5 had a word error rate of 5.30%", 12.0)
        self.assertEqual(c.holes(PARAS, said, 20.0), [])

    def test_words_missing_at_the_end_run_to_the_end_of_the_recording(self):
        paras = ["Alpha beta gamma.", "Delta epsilon zeta eta theta iota."]
        self.assertEqual(c.holes(paras, heard("alpha beta gamma"), 30.0), [(0.0, 30.0)])


class Stored(unittest.TestCase):
    SCRIPT = "One.\n\nTwo.\n\nThree.\n"

    def test_problems(self):
        self.assertEqual(c.problems([0, 1.5, 3], self.SCRIPT, 10), [])
        self.assertEqual(c.problems([0, 0, 0.0], self.SCRIPT, 10), [])
        self.assertEqual(c.problems([0, 1.5], self.SCRIPT, 10), ["2 cues for 3 paragraphs"])
        self.assertIn("the first cue is 0.4, not 0", c.problems([0.4, 1.5, 3], self.SCRIPT, 10))
        self.assertIn("the cues go backwards", c.problems([0, 3, 1.5], self.SCRIPT, 10))
        self.assertTrue(any("past the end" in p for p in c.problems([0, 3, 11], self.SCRIPT, 10)))
        self.assertEqual(c.problems("0,1,2", self.SCRIPT), ["cues is not a list of numbers"])
        self.assertEqual(c.problems([0, "1", 2], self.SCRIPT), ["cues is not a list of numbers"])

    def test_paragraphs_are_counted_as_narration_and_voiceover_split_them(self):
        self.assertEqual(c.paragraphs(self.SCRIPT), narration.paragraphs(self.SCRIPT))
        self.assertEqual(c.paragraphs(self.SCRIPT), self.SCRIPT.strip().split("\n\n"))
        self.assertEqual(c.sha256(self.SCRIPT), voiceover.sha256(self.SCRIPT))

    def folder(self, tmp, entries):
        folder = pathlib.Path(tmp) / "2026-11"
        folder.mkdir()
        for sid in entries:
            (folder / f"{sid}.txt").write_text(self.SCRIPT, encoding="utf-8")
        manifest = {"edition": "2026-11", "sections": entries, "total_duration": 12.5}
        (folder / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
        return folder

    def check(self, folder):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            bad = c.check(folder, json.loads((folder / "manifest.json").read_text())["sections"])
        return bad, out.getvalue()

    def test_check_passes_when_every_section_with_cues_has_one_for_each_paragraph(self):
        entry = {"file": "a.mp3", "sha256": c.sha256(self.SCRIPT), "duration": 12.5}
        with tempfile.TemporaryDirectory() as tmp:
            folder = self.folder(tmp, {"a": {**entry, "cues": [0, 4.2, 8]}, "b": dict(entry)})
            bad, said = self.check(folder)
            self.assertEqual(bad, 0)
            self.assertIn("1 of 2 sections have cues", said)

    def test_check_fails_on_a_wrong_count_for_the_script_that_was_recorded(self):
        entry = {"file": "a.mp3", "sha256": c.sha256(self.SCRIPT), "duration": 12.5}
        with tempfile.TemporaryDirectory() as tmp:
            folder = self.folder(tmp, {"a": {**entry, "cues": [0, 4.2]}, "b": {**entry, "cues": [0, 9, 4]}})
            bad, said = self.check(folder)
            self.assertEqual(bad, 2)
            self.assertIn("2026-11/a: 2 cues for 3 paragraphs", said)
            self.assertIn("2026-11/b: the cues go backwards", said)

    def test_check_reports_but_does_not_fail_a_script_edited_after_its_recording(self):
        stale = {"file": "a.mp3", "sha256": "0" * 64, "duration": 12.5}
        with tempfile.TemporaryDirectory() as tmp:
            folder = self.folder(tmp, {"a": {**stale, "cues": [0, 4.2]}, "b": {**stale, "cues": [0, 4.2, 8]}})
            bad, said = self.check(folder)
            self.assertEqual(bad, 0)
            self.assertIn("2026-11/a: 2 cues for 3 paragraphs; the script changed after the recording", said)
            self.assertNotIn("2026-11/b", said)   # a reworded script with the same paragraphs keeps its cues
        # cues that are wrong in themselves fail whatever the script
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(self.check(self.folder(tmp, {"a": {**stale, "cues": [0, 9, 4]}}))[0], 1)

    def test_save_writes_the_manifest_as_voiceover_does(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = self.folder(tmp, {"a": {"file": "a.mp3", "sha256": "0" * 64, "duration": 38.27, "bytes": 612310}})
            mpath = folder / "manifest.json"
            before = mpath.read_text()
            manifest = json.loads(before)
            c.save(mpath, manifest)
            self.assertEqual(mpath.read_text(), before)          # nothing changed, byte for byte
            manifest["sections"]["a"]["cues"] = [0.0, 4.2]
            c.save(mpath, manifest)
            after = json.loads(mpath.read_text())
            self.assertEqual(after["sections"]["a"]["cues"], [0.0, 4.2])
            del after["sections"]["a"]["cues"]
            self.assertEqual(after, json.loads(before))          # every other field as it was
            self.assertEqual(mpath.read_text(), json.dumps(manifest, indent=2) + "\n")
            self.assertEqual([p.name for p in folder.glob("*.tmp")], [])


class Run(unittest.TestCase):
    """The command itself, with a made-up recognizer in place of faster-whisper and no audio decoded."""

    SCRIPTS = {"a": "Alpha beta gamma.\n\nDelta epsilon zeta.\n", "b": "One two three.\n\nFour five six.\n",
               "c": "Red green blue.\n\nCyan magenta yellow.\n", "d": "Hosted elsewhere.\n"}
    HEARD = {"a.mp3": heard("alpha beta gamma") + heard("delta epsilon zeta", 5.0),
             "b.mp3": heard("something else entirely was recorded here"),
             "c.mp3": heard("red green blue") + heard("cyan magenta yellow", 7.0)}

    def run_tool(self, folder, *args):
        import types
        fake = types.ModuleType("faster_whisper")
        fake.WhisperModel = lambda *a, **k: "model"
        keep = (c.decode, c.silences, c.recognize, sys.argv, sys.modules.get("faster_whisper"))
        heard_by = []
        c.decode = lambda path: pathlib.Path(path).name          # the "samples" are the file's name
        c.silences = lambda samples: []
        c.recognize = lambda model, samples, offset=0.0: (heard_by.append(samples), self.HEARD[samples])[1]
        sys.modules["faster_whisper"] = fake
        sys.argv = ["cues.py", str(folder), *args]
        out = io.StringIO()
        try:
            with contextlib.redirect_stdout(out):
                c.main()
            code = 0
        except SystemExit as e:
            code = e.code
        finally:
            c.decode, c.silences, c.recognize, sys.argv = keep[:4]
            if keep[4] is None:
                del sys.modules["faster_whisper"]
            else:
                sys.modules["faster_whisper"] = keep[4]
        return code, out.getvalue(), heard_by

    def edition(self, tmp):
        folder = pathlib.Path(tmp) / "2026-11"
        folder.mkdir()
        for sid, text in self.SCRIPTS.items():
            (folder / f"{sid}.txt").write_text(text, encoding="utf-8")
        for name in self.HEARD:
            (folder / name).write_bytes(b"not decoded in this test")
        entry = lambda sid, **more: {"file": f"{sid}.mp3", "sha256": c.sha256(self.SCRIPTS[sid]), "duration": 12.5,
                                     "bytes": 1, "characters": len(self.SCRIPTS[sid]), "voice_id": "v", "model_id": "m", **more}
        manifest = {"edition": "2026-11", "sections": {
            "a": entry("a"),
            "b": entry("b", cues=[0, 3.3]),                       # cues from somewhere, but the recording says other words
            "c": {**entry("c"), "sha256": "0" * 64},              # its script was reworded after the recording
            "d": {"url": "https://audio.example.test/2026-11/d-0a1b2c3d.mp3", "sha256": c.sha256(self.SCRIPTS["d"]), "duration": 2.0},
        }, "total_duration": 39.5}
        (folder / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
        return folder, manifest

    def test_cues_are_written_beside_every_other_field(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder, before = self.edition(tmp)
            code, said, heard_by = self.run_tool(folder, "--all")
            text = (folder / "manifest.json").read_text()
            after = json.loads(text)
            self.assertEqual(after["sections"]["a"]["cues"], [0.0, 5.0])
            # the current script is matched even though it is not the one that was recorded
            self.assertEqual(after["sections"]["c"]["cues"], [0.0, 7.0])
            self.assertIn("2026-11/c: 2 paragraphs, 100.0% of 6 words matched, cues written; the script changed after this recording", said)
            # under 70 percent nothing is written, old cues go, the words that did not match are listed, exit 1
            self.assertNotIn("cues", after["sections"]["b"])
            self.assertIn("2026-11/b: 2 paragraphs, 0.0% of 6 words matched, NO CUES WRITTEN", said)
            self.assertIn("script: '1 2 3 4 5 6'", said)
            self.assertEqual(code, 1)
            # a section whose MP3 is not in the folder is left alone
            self.assertIn("2026-11/d: no MP3 in the folder", said)
            self.assertEqual(after["sections"]["d"], before["sections"]["d"])
            self.assertEqual(sorted(heard_by), ["a.mp3", "b.mp3", "c.mp3"])
            # nothing else changed, and the file is written as voiceover.py writes it
            for sid in "abc":
                after["sections"][sid].pop("cues", None)
                before["sections"][sid].pop("cues", None)
            self.assertEqual(after, before)
            self.assertEqual(text, json.dumps(json.loads(text), indent=2) + "\n")
            self.assertEqual(list(json.loads(text)["sections"]), ["a", "b", "c", "d"])
            self.assertEqual(list(json.loads(text)["sections"]["a"])[-1], "cues")

    def test_only_sections_without_fitting_cues_are_timed_unless_all_is_asked(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder, _ = self.edition(tmp)
            self.run_tool(folder, "--all")
            first = (folder / "manifest.json").read_text()
            code, said, heard_by = self.run_tool(folder)
            self.assertEqual(heard_by, ["b.mp3"])                 # a and c have cues that fit; b has none
            self.assertEqual((folder / "manifest.json").read_text(), first)
            code, said, heard_by = self.run_tool(folder, "--section", "a")
            self.assertEqual((code, heard_by), (0, ["a.mp3"]))
            self.assertEqual((folder / "manifest.json").read_text(), first)
            # the check passes on what the run wrote: b has no cues, the others have one for each paragraph
            code, said, heard_by = self.run_tool(folder, "--check")
            self.assertEqual((code, heard_by), (0, []))
            self.assertIn("2 of 4 sections have cues", said)


# One silent MPEG-1 Layer III frame (128 kbps, 44.1 kHz), enough for voiceover.py to call it an MP3
FRAME = bytes.fromhex("fffb9000") + bytes(413)


class Rerecording(unittest.TestCase):
    """tools/voiceover.py rebuilds a section's manifest entry when it records it again, so the cues of the old
    audio go with it. ElevenLabs is never called: the request function is replaced and the network is closed."""

    def test_a_new_recording_drops_the_old_cues(self):
        def no_network(*a, **k):
            raise AssertionError("a test must not open a connection")

        with tempfile.TemporaryDirectory() as tmp:
            folder = pathlib.Path(tmp) / "2026-11"
            folder.mkdir()
            (folder / "old.txt").write_text("Unchanged text.\n")
            (folder / "new.txt").write_text("Edited text.\n\nA second paragraph.\n")
            (folder / "old.mp3").write_bytes(FRAME * 4)
            (folder / "new.mp3").write_bytes(FRAME * 4)
            same = {"voice_id": voiceover.DEFAULT_VOICE, "model_id": voiceover.DEFAULT_MODEL}
            manifest = {"edition": "2026-11", "sections": {
                "new": {"file": "new.mp3", "sha256": "0" * 64, "duration": 9.9, "cues": [0, 4.2, 7.7], **same},
                "old": {"file": "old.mp3", "sha256": voiceover.sha256("Unchanged text.\n"), "duration": 3.3, "cues": [0], **same}}}
            (folder / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")

            calls = []
            keep = (voiceover.tts, urllib.request.urlopen, sys.argv, dict(os.environ))
            voiceover.tts = lambda key, voice, model, text, ids, nxt: (calls.append(text) or FRAME * 8, "request-1")
            urllib.request.urlopen = no_network
            sys.argv = ["voiceover.py", str(folder)]
            for name in ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "AUDIO_BASE_URL",
                         "ELEVENLABS_VOICE_ID", "ELEVENLABS_MODEL_ID", "GITHUB_STEP_SUMMARY"):
                os.environ.pop(name, None)
            os.environ["ELEVENLABS_API_KEY"] = "not-a-real-key"
            try:
                with contextlib.redirect_stdout(io.StringIO()):
                    voiceover.main()
            finally:
                voiceover.tts, urllib.request.urlopen, sys.argv = keep[:3]
                os.environ.clear()
                os.environ.update(keep[3])

            self.assertEqual(calls, ["Edited text.\n\nA second paragraph."])   # only the edited section was recorded
            after = json.loads((folder / "manifest.json").read_text())["sections"]
            self.assertNotIn("cues", after["new"])
            self.assertEqual(after["new"]["sha256"], voiceover.sha256("Edited text.\n\nA second paragraph.\n"))
            self.assertEqual(after["old"]["cues"], [0])                        # the untouched section keeps its cues
            # and what is left passes the check
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(c.check(folder, after), 0)


if __name__ == "__main__":
    unittest.main()
