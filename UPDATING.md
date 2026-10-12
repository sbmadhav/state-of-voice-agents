# Monthly update checklist

A new edition goes out every 30 days. Use this checklist each time.

## 1. Refresh the evidence
- [ ] **Benchmarks:** re-check Cekura Bench, Sierra tau-voice, Regal Voice CX and Artificial Analysis speech leaderboards. Update the reliability chart and timeline.
- [ ] **Models and platforms:** note new releases from OpenAI (GPT-Live, Realtime, Decisions API), Google (Gemini Live), Sierra, ElevenLabs, Deepgram, Retell, LiveKit, Pipecat and Vapi.
- [ ] **System-1 decision models:** check TypeSafe Jev, Laya, the OpenAI Decisions API (beta or GA) and new open routers. Re-check the Banking77 numbers.
- [ ] **Limited-memory models:** look for new LMLM or Co-LMLM papers, checkpoints, or any enterprise or production use.
- [ ] **Deployments:** search for new published health system and bank results, including Sierra customer outcomes.
- [ ] **Regulation:** check FCC/TCPA and state AI disclosure laws (CA, TX, UT, CO), and confirm any items marked "secondary".
- [ ] **Fraud:** look for new deepfake and voice fraud data.

## 2. Update the page
- [ ] Edit `index.html`: the edition badge, research cutoff and "Next edition" date, then the content and sources.
- [ ] Re-verify every changed number against its source, and keep the evidence labels accurate.
- [ ] Add claims that are spreading in the market to the claim check.
- [ ] Test light and dark themes, phone width, and Download PDF in both themes.

## 3. Publish
- [ ] Copy `index.html` to `editions/YYYY-MM/index.html`, along with `og.png`. Keep the Explore menu and analytics scripts (see CLAUDE.md).
- [ ] Regenerate `bolt-context.txt` from the new page text so Bolt answers from the new edition.
- [ ] Add a row to the README's Editions table and an entry to `CHANGELOG.md`.
- [ ] Commit, push, and confirm the GitHub Pages build.
- [ ] Post a short "what changed this month" update on LinkedIn.
