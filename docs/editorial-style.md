# Editorial style: how an edition is written

Every edition of this report is an article for a human reader, not a reference deck. This page is the standard each edition is edited against. It came out of an editorial review of the October and November 2026 editions on November 15, 2026, which found that most of their words sat in table cells, bullets, tiles and labels, with too little prose connecting them.

## What good technical publications do

These conventions are borrowed, and each is worth rereading at the source.

- **Tell the story of the work, uncertainty included.** IEEE Spectrum asks for "accessible magazine stories for a broad engineering audience" that explain how the work developed and what was learned, and asks authors to be candid about what remains uncertain. <https://spectrum.ieee.org/guidelines-expert-authors>
- **Write a story, not a topic.** MIT Technology Review's editors want a focused story with a nut graf: one paragraph, near the top, that says what the piece is about and why it matters now. <https://healthjournalism.org/freelancers/freelance-market-guide/mit-technology-review-freelance-market-guide/>
- **Do not instruct the reader.** The Economist's style guide: "Do not be too didactic. If too many sentences begin Compare, Consider, Expect, Imagine, Look at, Note, Prepare for, Remember or Take, readers will think they are reading a textbook." <https://blog.passle.net/post/102cxv5/do-not-be-stuffy-the-economists-style-guide>
- **Open on a hook, state the goal, define terms in the sentence.** Timothy B. Lee and Sean Trott's explainer on language models defines each term where it first appears, introduces every figure with a sentence and keeps paragraphs to two to four sentences. <https://www.understandingai.org/i/135476638/word-vectors>
- **A recurring report has a byline, a date, a takeaways box and a prose body.** InfoQ's trend reports state their method up front and report changes between editions in sentences. <https://www.infoq.com/articles/architecture-trends-2025/>
- **Put a claim over every exhibit, and give each number its comparison.** Stanford's AI Index sets each chart under a heading that states a finding, with a paragraph that reads the chart. <https://hai.stanford.edu/news/ai-index-2025-state-of-ai-in-10-charts>
- **An update carries only what moved.** Thoughtworks Technology Radar: "If a blip doesn't move, it fades from the Radar." <https://www.thoughtworks.com/en-ca/radar/faq>

## Style sheet

**Voice.** One named author writing to a peer. Use first person singular for method and judgment ("I did not run my own tests"). Use "you" sparingly and never "we". Use the present tense for the state of things and the past tense for tests and events. Prefer active verbs.

**Sentences and paragraphs.** Every sentence has a subject and a finite verb. That holds in captions, tiles, cards and table cells too. No sentence begins with a label and a colon. Use at most one semicolon in a paragraph. Keep the average sentence under 22 words. A paragraph develops one idea in two to five sentences.

**Section openings.** A section opens with 60 to 120 words of narrative before any table, list, tile or tool. The opening says what was found, who found it and why a contact center should care. The sentence before an interactive tool or exhibit says what to look for in it.

**Headings.** A heading states the section's finding, so that the headings read in order summarize the piece. Section numbers stay in the eyebrow above the heading.

**Numbers.** The first mention of a figure says who measured it, what was measured, on how many, and what it compares with ("from 6.2 minutes to 2.4"). Write the attribution into the sentence ("Tampa General reports", "in Cekura's benchmark, which a testing vendor runs") and put the evidence chip after that sentence. Where a paragraph mixes evidence types, each sentence carries its own chip. Citation markers stay next to the claim they support. Percentages are numerals with the % sign (75.6%), in prose and in exhibits alike; the narration reads the sign as "percent".

**Listening.** Each section is also read aloud. Evidence chips are for the eye and are not read (from the December 2026 edition on), so the sentence itself must say who reported a figure: "Veris reports", "by the vendor's account". The "new" tag is read once per item. Read a section's script (`python3 tools/narration.py --stdout`) before recording it.

**Exhibits.** Use a table when items are compared on the same attributes. Use a list when three or more items are parallel, such as criteria, steps or controls. Each exhibit has a caption that states its finding and its evidence label, and the prose refers to it. Table cells are complete clauses.

**Jargon.** Define each term in the sentence where it first appears in each edition: repeat reliability (pass^3), BAA, TCPA, VAD, MCP, IVR, diarization, full-duplex, System 1. A product name gets a short gloss the first time.

**Advice.** Give the reason first and the recommendation second, written as a statement about what a team should do. Runs of imperatives belong only in a captioned checklist.

**Endings.** Each section closes on what follows from it and, where it helps, points to the next section. No section ends on a table.

**Monthly updates.** Lead with the month's most consequential finding. State the period covered once. Report each change in a sentence that carries both values and names the section of the earlier edition. Use the "new" tag once per item and never as a sentence. Call a correction a correction and say what the earlier edition said. Unchanged material gets a pointer, not a repeat.

**Banned patterns.** "Label: fragment." Tags used as sentences ("New this month. Vendor-reported."). Arrows in place of verbs. "Read X as Y." Headings that only name a category. Bullets without verbs. Middle dots joining a label to a heading.

## Before and after

Brackets show where an existing evidence chip stays.

| Before | After |
|---|---|
| "On Sierra's voice benchmark, the best score rose from 30% to 67% in eight months. Lock in your data and evaluations, not a model." | "Any ranking in this report has a short shelf life. On Sierra's voice benchmark the best score more than doubled in eight months, from 30% to 67%. A team's own test data and evaluations do not age that way, which is why they, and not a model, are the thing to lock in." |
| "44%. Of repetitive calls automated." | "Intermountain, which uses Hyro with Agentforce Health, reports that it has automated 44% of its repetitive calls. [self-reported]" |
| "Peers compound gains. IVR frustration persists. No internal evaluation muscle. ROI logic: Negative. Verdict: Not recommended." | "Waiting has costs. Peers compound their gains, callers stay frustrated with the phone menu (the interactive voice response system, or IVR), and the organization builds no evaluation skill of its own. The return is negative, because the abandonment and scheduling gains are forgone. I do not recommend it." |
| "Mechanism: Echo treated as interruption; agent stops mid-word." | "The agent hears its own echo, takes it for the caller interrupting and stops mid-word." |
| "Reviewed for the first time, bank and credit union voice-agent results look like October's health care results" | "Banks and credit unions are putting voice agents on the same kind of call that health systems chose first: the routine one." |
| "Read 'BAA' as GLBA vendor terms, PCI scope and incident-notice clauses (section 5)." | "Where October asks for a business associate agreement (BAA), a bank should look for its own equivalents: vendor terms under the Gramm-Leach-Bliley Act (GLBA), the scope of its card-security (PCI) assessment, and incident-notice clauses. Section 5 sets them out. [author's view]" |
| "OpenAI Decisions API: beta to generally available (October 22) on GPT-6 Luna, up to 400 questions a request, 10 cents per million input tokens." | "OpenAI's Decisions API, in public beta in October, became generally available on October 22. It runs on GPT-6 Luna, takes up to 400 questions in a request and costs 10 cents per million input tokens. [new, vendor-reported]" |
| "Change since October: Unchanged; first to second." | "Retell's scores are unchanged, but PolyAI's arrival moves it from first place to second." |

## Hard rules

1. No new facts, figures, quotes, people, sources, anecdotes or scenes. Acronym expansions and standard definitions are allowed and must be correct.
2. Every figure, date, name, citation marker and link survives an edit with the same value and unit. Compare the numbers before and after.
3. Evidence labels (independent, vendor-reported, company-reported, self-reported, unverified, author's view) stay on the claims they qualify. None is upgraded, merged or dropped.
4. Hedges survive: "about", "up to", "in one test", "directional", "illustrative", "a projection", "allegations only", and margins of error. Regulatory summaries stay orientation, not legal advice.
5. Synthetic and illustrative material stays labeled as such.
6. No em dashes and no emojis. American English, with "health care" as two words.
7. No section, exhibit, tool, id or anchor is deleted or renumbered, because later editions link to them.
8. An archived edition that is edited after publication keeps its original publication date and says, under the byline, when the text was edited and that the findings and figures are unchanged.
