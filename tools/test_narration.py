#!/usr/bin/env python3
"""Tests for tools/narration.py. Standard library only: python3 tools/test_narration.py"""
import contextlib, io, json, pathlib, sys, tempfile, unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import narration as n  # noqa: E402
import voiceover  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
PAGES = [ROOT / "index.html", *sorted((ROOT / "editions").glob("*/index.html"))]

PAGE = """<main data-audio-base="/state-of-voice-agents/audio/{ed}/">
<header class="hero" id="brief"><h1>Headline</h1>
  <details class="howto"><summary>How to read this</summary>
    <p>Two labels say where a claim comes from: <span class="chip k-ind">independent</span> <span class="chip k-ven">vendor-reported</span></p>
  </details>
</header>
<section id="tv"><div class="head"><p class="eyebrow">3 · New failure mode</p><h2>A second voice breaks most agents</h2></div>
  <div class="prose">
    <p>Veris reports that task completion fell from 38.7% to 8.6%.<a class="c" data-s="veris">[3]</a> <span class="chip k-ven">vendor-reported</span> The calls were simulated.</p>
    <p>A team should test for it. <span class="chip k-our">author's view</span></p>
    <p>One figure keeps its label. <span class="chip k-ven" data-say="By the vendor's count.">vendor-reported</span></p>
  </div>
  <div class="tbl"><table data-narrate="{{0}}. The verdict is {{1}}. {{2}}">
    <thead><tr><th>Claim</th><th>Verdict</th><th>Evidence</th></tr></thead>
    <tbody><tr><td>The API is generally available</td><td><span class="chip k-ind">verified</span></td><td>It left beta. <span class="chip k-ven">vendor-reported</span></td></tr></tbody>
  </table></div>
</section>
</main>"""


def scripts(edition):
    main = n.main_node(n.parse(PAGE.format(ed=edition)))
    n.set_edition(edition)
    return dict(n.narration(main))


class EvidenceChips(unittest.TestCase):
    def test_editions_recorded_before_the_rule_keep_their_labels(self):
        tv = scripts("2026-11")["tv"]
        self.assertIn("8.6 percent. Vendor-reported. The calls were simulated.", tv)
        self.assertIn("A team should test for it. Author's view.", tv)

    def test_later_editions_do_not_read_chips_aloud(self):
        tv = scripts("2026-12")["tv"]
        self.assertIn("fell from 38.7 percent to 8.6 percent. The calls were simulated.", tv)
        self.assertIn("A team should test for it.\n", tv)
        self.assertNotIn("endor-reported", tv.replace("By the vendor's count.", ""))
        self.assertNotIn("uthor's view", tv)

    def test_a_chip_that_is_the_content_is_still_read(self):
        s = scripts("2026-12")
        # the legend that explains the labels
        self.assertIn("independent", s["brief"].lower())
        self.assertIn("vendor-reported", s["brief"].lower())
        # a table cell whose whole value is the label, and a chip with its own spoken text
        self.assertIn("The verdict is verified.", s["tv"])
        self.assertIn("One figure keeps its label. By the vendor's count.", s["tv"])
        # a label beside other text in a cell is dropped, and the row still reads as sentences
        self.assertIn('The API is generally available. The verdict is verified. It left beta.\n', s["tv"])

    def test_the_rule_starts_with_the_december_2026_edition(self):
        for edition, spoken in (("2026-10", True), ("2026-11", True), ("2026-12", False), ("2027-01", False)):
            n.set_edition(edition)
            self.assertEqual(n.SPEAK_LABELS, spoken, edition)


# A page with every kind of block: eyebrow, heading, paragraphs, a figure caption, a table read through a
# template, stat tiles, a numbered list, nested list items and the Sources section
BLOCKS_PAGE = """<main data-audio-base="/state-of-voice-agents/audio/2026-11/">
<header class="hero" id="brief">
  <div class="wrap">
    <div class="edition-nav" data-narrate-skip><p>Not read</p></div>
    <p class="eyebrow">Monthly update</p>
    <h1>Headline</h1>
    <p class="standfirst">Standfirst <b>in bold</b>.<a class="c" data-s="x">[1]</a> <span class="chip k-ven">vendor-reported</span></p>
    <div class="stats">
      <div class="stat"><span class="eyebrow">Best score</span><span class="was">It was 75.6%</span><span class="v num">87.8<small>%</small></span><p>PolyAI leads.</p></div>
      <div class="stat"><span class="eyebrow">Share of calls</span><span class="was">Not reviewed</span><span class="v">7%</span><p>Southern Cross reports it.</p></div>
    </div>
  </div>
</header>
<section id="tv">
  <div class="wrap">
    <div class="head"><p class="eyebrow">3 · New failure mode</p><h2>A second voice breaks most agents<a class="hash" href="#tv" data-narrate-skip></a></h2>
      <p class="lede">A test puts it first.</p></div>
    <div class="prose"><p>The noise that hurts most is another voice.</p></div>
    <figure class="exhibit" id="fig-tv-1">
      <figcaption class="caption"><strong>The open model leaked the fewest words.</strong> <a class="share" href="#" data-narrate-skip>Share</a></figcaption>
      <div class="tbl"><table data-narrate="{0} had a word error rate of {1}.">
        <thead><tr><th>Tool</th><th>Error rate (WER)</th></tr></thead>
        <tbody>
          <tr><td>VoxLock</td><td class="n">4.95%</td></tr>
          <tr hidden><td>Hidden row</td><td>1%</td></tr>
          <tr><td>Krisp <p>VI 2.5</p></td><td class="n">5.30%</td></tr>
        </tbody></table></div>
    </figure>
    <div class="panel">
      <ol>
        <li>Isolate the caller's voice.</li>
        <li><p>Read back the amount.</p></li>
      </ol>
      <ul><li>A plain item <ul><li>with a nested one</li></ul></li></ul>
    </div>
  </div>
</section>
<section id="sources"><div class="wrap"><div class="head"><p class="eyebrow">Sources</p><h2>Sources and evidence labels</h2></div>
  <ol id="src"><li id="src-a">One</li><li id="src-b">Two</li></ol></div></section>
</main>"""


def walk(sec, path):
    """The element a block's path leads to: element children only, as the page counts them."""
    for i in path:
        sec = [c for c in sec.children if isinstance(c, n.Node)][i]
    return sec


def sections(source):
    """The page's <main> and its narrated elements by id, with the edition's rules switched on."""
    main = n.main_node(n.parse(source))
    n.set_edition(main.attrs["data-audio-base"].rstrip("/").rsplit("/", 1)[1])
    secs = {s.attrs["id"]: s for s in
            main.find_all(lambda x: x.attrs.get("id") and (x.tag == "section" or "hero" in x.classes))}
    return main, secs


class Blocks(unittest.TestCase):
    def blocks(self, source=BLOCKS_PAGE):
        main, secs = sections(source)
        return {sid: (text, blocks, secs[sid]) for sid, text, blocks in n.narration_blocks(main)}

    def test_each_paragraph_names_the_element_it_comes_from(self):
        text, blocks, sec = self.blocks()["tv"]
        paras = n.paragraphs(text)
        self.assertEqual(len(blocks), len(paras))
        got = [(walk(sec, path).tag, " ".join(sorted(walk(sec, path).classes)), para)
               for (path, _), para in zip(blocks, paras)]
        self.assertEqual(got, [
            ("p", "eyebrow", "Section 3: New failure mode."),
            ("h2", "", "A second voice breaks most agents."),
            ("p", "lede", "A test puts it first."),
            ("p", "", "The noise that hurts most is another voice."),
            ("figcaption", "caption", "The open model leaked the fewest words."),
            ("tr", "", "VoxLock had a word error rate of 4.95 percent."),
            ("tr", "", "Krisp VI 2.5 had a word error rate of 5.30 percent."),
            ("li", "", "First, isolate the caller's voice."),
            ("li", "", "Second, read back the amount."),
            ("li", "", "A plain item."),
            ("li", "", "With a nested one."),
        ])

    def test_a_table_row_maps_to_its_tr(self):
        text, blocks, sec = self.blocks()["tv"]
        rows = [(path, walk(sec, path)) for path, _ in blocks if walk(sec, path).tag == "tr"]
        self.assertEqual([n.squash(n.raw_text(r)) for _, r in rows], ["VoxLock4.95%", "Krisp VI 2.55.30%"])
        # the paragraph inside the second row's cell does not get a block of its own
        self.assertEqual(sum(walk(sec, path).tag == "p" and walk(sec, path).parent.tag == "td" for path, _ in blocks), 0)
        # paths count element children in the static HTML: the hidden row is not read, but it is counted
        self.assertEqual([path[-1] for path, _ in rows], [0, 2])
        self.assertEqual(rows[0][0][:-1], rows[1][0][:-1])

    def test_stat_tiles_and_the_sources_section(self):
        b = self.blocks()
        text, blocks, sec = b["brief"]
        self.assertEqual([walk(sec, path).tag for path, _ in blocks], ["p", "h1", "p", "div", "div"])
        self.assertEqual([" ".join(walk(sec, path).classes) for path, _ in blocks[3:]], ["stat", "stat"])
        self.assertEqual(n.paragraphs(text)[3], "Best score: 87.8 percent. It was 75.6 percent. PolyAI leads.")
        # the Sources script is written by the tool, not rendered: both paragraphs point at the heading
        text, blocks, sec = b["sources"]
        self.assertEqual(len(n.paragraphs(text)), 2)
        self.assertEqual([walk(sec, path).tag for path, _ in blocks], ["h2", "h2"])

    def test_the_prefix_is_the_start_of_the_elements_text(self):
        for sid, (text, blocks, sec) in self.blocks().items():
            for path, prefix in blocks:
                self.assertEqual(prefix, n.text_key(walk(sec, path)), (sid, path))
                self.assertRegex(prefix, r"^[a-z0-9]{1,16}$")
        text, blocks, sec = self.blocks()["brief"]
        self.assertEqual(blocks[2][1], "standfirstinbold")   # markup, case and punctuation do not count
        self.assertEqual(blocks[3][1], "bestscoreitwas75")

    def test_markers_never_change_a_script(self):
        """The same render with the markers switched off gives the same text: the fixtures and every page."""
        sources = [BLOCKS_PAGE, PAGE.format(ed="2026-11"), PAGE.format(ed="2026-12")]
        sources += [p.read_text(encoding="utf-8") for p in PAGES]
        self.assertGreaterEqual(len(PAGES), 3)
        compared = 0
        for source in sources:
            main, secs = sections(source)
            for sid, sec in secs.items():
                marked = n.render(sec)
                keep, n.mark = n.mark, lambda node, text: text
                try:
                    plain = n.render(sec)
                finally:
                    n.mark = keep
                self.assertNotIn(n.MARK_OPEN, plain)
                self.assertEqual(n.unmark(marked), plain, sid)
                compared += 1
        self.assertGreater(compared, 40)

    def test_fixture_scripts_are_what_they_were_before_blocks(self):
        self.assertEqual(scripts("2026-11")["tv"], (
            "Section 3: New failure mode.\n\nA second voice breaks most agents.\n\n"
            "Veris reports that task completion fell from 38.7 percent to 8.6 percent. Vendor-reported. The calls "
            "were simulated.\n\nA team should test for it. Author's view.\n\n"
            "One figure keeps its label. By the vendor's count.\n\n"
            "The API is generally available. The verdict is verified. It left beta. Vendor-reported.\n"))

    def test_every_page_has_one_block_for_each_paragraph(self):
        for page in PAGES:
            main, secs = sections(page.read_text(encoding="utf-8"))
            for sid, text, blocks in n.narration_blocks(main):
                self.assertEqual(len(blocks), len(n.paragraphs(text)), (page, sid))
                for path, prefix in blocks:
                    self.assertEqual(n.text_key(walk(secs[sid], path)), prefix, (page, sid, path))

    def test_the_blocks_file_carries_the_scripts_hash_as_voiceover_computes_it(self):
        text, blocks, _ = self.blocks()["tv"]
        data = json.loads(n.blocks_json(text, blocks))
        self.assertEqual(data["sha256"], voiceover.sha256(text))
        self.assertEqual(data["blocks"], blocks)
        self.assertEqual(data["blocks"][0], [[0, 0, 0], "3newfailuremode"])


class BlocksOnDisk(unittest.TestCase):
    """--check fails when a blocks file is missing or out of date, and writing them never touches a script."""

    def run_tool(self, *args):
        out = io.StringIO()
        keep = sys.argv
        sys.argv = ["narration.py", "--page", str(self.page), *args]
        try:
            with contextlib.redirect_stdout(out):
                n.main()
            return 0, out.getvalue()
        except SystemExit as e:
            return e.code, out.getvalue()
        finally:
            sys.argv = keep

    def test_check_and_write(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            self.page = root / "index.html"
            self.page.write_text(BLOCKS_PAGE.replace("</header>", '<span id="read-min">About 1 min read</span></header>', 1),
                                 encoding="utf-8")
            keep, n.ROOT = n.ROOT, root
            try:
                self.assertEqual(self.run_tool()[0], 0)
                folder = root / "audio" / "2026-11"
                self.assertEqual(sorted(p.name for p in folder.iterdir()), [
                    "brief.blocks.json", "brief.txt", "sources.blocks.json", "sources.txt", "tv.blocks.json", "tv.txt"])
                before = {p.name: p.read_bytes() for p in folder.glob("*.txt")}
                self.assertEqual(self.run_tool("--check")[0], 0)
                # --stdout prints the scripts, as before
                code, printed = self.run_tool("--stdout")
                self.assertIn("=== tv (", printed)
                self.assertNotIn("blocks", printed)
                # a missing blocks file fails the check; a run puts it back
                (folder / "tv.blocks.json").unlink()
                code, printed = self.run_tool("--check")
                self.assertEqual(code, 1)
                self.assertIn("tv.blocks.json", printed)
                self.assertNotIn("tv.txt", printed)
                self.assertEqual(self.run_tool()[0], 0)
                # so does one that is out of date
                (folder / "tv.blocks.json").write_text('{"sha256": "0", "blocks": []}\n')
                self.assertEqual(self.run_tool("--check")[0], 1)
                self.assertEqual(self.run_tool()[0], 0)
                self.assertEqual(self.run_tool("--check")[0], 0)
                # and one for a section that no longer exists
                (folder / "gone.blocks.json").write_text("{}")
                self.assertEqual(self.run_tool("--check")[0], 1)
                self.assertEqual(self.run_tool()[0], 0)
                self.assertFalse((folder / "gone.blocks.json").exists())
                # none of it touched a script
                self.assertEqual({p.name: p.read_bytes() for p in folder.glob("*.txt")}, before)
            finally:
                n.ROOT = keep


if __name__ == "__main__":
    unittest.main()
