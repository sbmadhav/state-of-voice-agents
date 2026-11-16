#!/usr/bin/env python3
"""Tests for tools/narration.py. Standard library only: python3 tools/test_narration.py"""
import pathlib, sys, unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import narration as n  # noqa: E402

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


if __name__ == "__main__":
    unittest.main()
