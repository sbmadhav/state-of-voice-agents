# Monthly update checklist

A new edition goes out every 30 days. Use this checklist each time.

## How an edition is built (since November 2026)
- The October 2026 edition (`editions/2026-10/`) is the full baseline report, with the interactive tools.
- Each monthly edition is an update that carries only what changed. Use the November 2026 page as the template.
- Give each edition its own headline and focus (November: financial services, with health care notes). Do not reuse the previous hero.
- Every changed figure shows its previous value next to the new one (comparison tiles, the "October versus November" style table, or "Was ... ; now ..." in the claim check).
- Anything unchanged is not repeated: link to the section where it was last stated (`/state-of-voice-agents/editions/YYYY-MM/#section-id`) and list it in the "Unchanged" index.
- When a section has changed so much that the update can no longer stand on the baseline, publish a new full baseline and say so in the changelog.

## 1. Refresh the evidence
- [ ] **Benchmarks:** re-check Cekura Bench, Sierra tau-voice, Regal Voice CX and Artificial Analysis speech leaderboards. Update the reliability chart and timeline.
- [ ] **Models and platforms:** note new releases from OpenAI (GPT-Live, Realtime, Decisions API), Google (Gemini Live), Sierra, ElevenLabs, Deepgram, Retell, LiveKit, Pipecat and Vapi.
- [ ] **System-1 decision models:** check TypeSafe Jev, Laya, the OpenAI Decisions API (beta or GA) and new open routers. Re-check the Banking77 numbers.
- [ ] **Limited-memory models:** look for new LMLM or Co-LMLM papers, checkpoints, or any enterprise or production use.
- [ ] **Deployments:** search for new published health system and bank results, including Sierra customer outcomes.
- [ ] **Regulation:** check FCC/TCPA and state AI disclosure laws (CA, TX, UT, CO), and confirm any items marked "secondary".
- [ ] **Fraud:** look for new deepfake and voice fraud data.

## Planned additions (carried from the November 2026 plan)
- [x] Financial services coverage (November 2026 update), so the subtitle can drop "healthcare first": published bank and credit union voice-agent results, a readiness map for financial call types, and GLBA, PCI DSS and UDAAP in the regulation section.
- [ ] Real failure examples: anonymized transcripts with root cause, consequence and the fix that prevented a repeat.
- [ ] Caller experience (partly covered in November for banking): whether callers want AI, how often they ask for a person, satisfaction by customer group.
- [ ] Long-term performance after launch (drift, novelty effects, changing call mix).
- [ ] Privacy depth: data retention, data residency, subprocessors and deletion across logs and backups.
- [ ] Economics: a cost-of-failure line (complaints, wrong actions, failed transfers, churn).
- [ ] Consider moving the technical appendix to its own page.
- [ ] Ask two or three human reviewers (a contact center operations leader, a compliance or privacy lead) before publishing.
- [ ] Give the comments a new thread name for the edition (the utterances `issue-term`, for example "Comments: November 2026 edition").

## 2. Update the page
- [ ] Edit `index.html`: the edition badge, research cutoff and "Next edition" date, then the content and sources.
- [ ] Re-verify every changed number against its source, and keep the evidence labels accurate.
- [ ] Add claims that are spreading in the market to the claim check.
- [ ] Test light and dark themes, phone width, and Download PDF in both themes.

## 3. Publish
- [ ] Copy `index.html` to `editions/YYYY-MM/index.html`, along with `og.png`. Keep the Explore menu and analytics scripts (see CLAUDE.md).
- [ ] Regenerate `bolt-context.txt`: the new update first, then the baseline text, so Bolt answers from both and knows which is current.
- [ ] Add a row to the README's Editions table and an entry to `CHANGELOG.md`.
- [ ] Pre-render the JavaScript-built content (sources, claim check, print tables, footnote numbers) into the HTML so crawlers and no-JS readers see it.
- [ ] Commit, push, and confirm the GitHub Pages build.
- [ ] Post a short "what changed this month" update on LinkedIn.
