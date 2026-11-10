# Changelog

## November 2026 update, research cutoff November 6, 2026

The first monthly update. From this edition on, the root page carries only what changed since the previous edition and links back for everything else; the October 2026 edition is the full baseline report.

- Focus: financial services, with health care notes.
- Headline and four comparison tiles (October value next to the new one): best repeat reliability 75.6% to 87.8%, credit union calls fully handled (none published to 37% to 66%), task completion with a TV on (38.7% to 8.6%), OpenAI Decisions API (beta to GA).
- October versus November table: eight findings that moved.
- Financial services: published bank and credit union voice-agent results (all vendor- or company-reported), a readiness map for financial call types, and customer acceptance data.
- New failure mode: the TV in the room (Veris vendor research), with VoxLock caller-voice isolation results and controls.
- Reliability: only the three new Cekura configurations and status changes; October's seven results are unchanged.
- Regulation: financial services rules mapped (GLBA, PCI DSS 3.3.1, CFPB and Regulation E and Z, model risk and third-party guidance, FFIEC and NYDFS, FinCEN, FCC 26-67, FCC 24-84, Colorado, Utah).
- Fraud: voice is a signal, not a factor; revised high-risk tier; financial fraud data.
- Models and routing: Decisions API GA, Zoom and LiveKit decision models, Jev latency and edge limits, Eleven Realtime, Regal's Oct 15 run, open speech models, Pipecat and Deepgram, ConvFill and Dessa.
- Health care notes: California AB 1979, clinic results, clinical speech recognition.
- Claim check: 17 new or revised claims only.
- "Unchanged since October" index linking to each October section; the interactive tools stay in the October edition.
- Bolt answers from the November update plus the October baseline. New Open Graph image and comments thread name.

## October 2026 (first edition), published October 12, 2026

- Theses: reliability gap, thinker-responder agents, and investing in limited-memory model training.
- Part I sections:
  - Reliability benchmark (Cekura Bench) and published health system results.
  - Economics model and the thinker-responder router demo.
  - Use-case readiness, trust and identity, and limited-memory models.
  - Options, a 90-day pilot with an after-day-90 plan, and a seven-seat debate.
- Part II, the technical appendix:
  - Architecture and latency.
  - pass^k reliability measurement and failure modes.
  - System-1 routing models compared, including Sierra Curie, OpenAI Decisions API, TypeSafe Jev, Laya and Arch-Router.
  - How LMLM works, deployment posture, fraud controls and regulation.
  - Claim check and sources.
- Features: interactive tags, system, light and dark themes, and PDF export.
- Research cutoff: October 12, 2026.

### Revisions, October 12, 2026
- Failure modes: added background noise and chatter, and wrong-speaker turns, with mitigations (isolating the caller's voice, diarization, speaker-aware VAD).
- Fraud controls: added voiceprint verification with liveness detection for critical transactions and authorizations.
- PDF export: the page header, footer and page numbers now follow the chosen theme, so they stay readable in dark mode.
- Navigation: Download PDF and the theme switcher are pinned outside the scrolling section links. Fixed horizontal overflow on phones.
- Evidence labels: replaced a venue label ("ICLR 2026") with the standard "independent" label.

### Revisions, October 12, 2026 (later)
- Restyled to the sbmadhav.com design system colors and type, kept in a calm, executive register. Added the site favicon and the Bolt mark in the header, which links back to sbmadhav.com.
- Added an About section with links to sbmadhav.com and LinkedIn.
- Added Ask Bolt, a Q&A assistant grounded in the report with optional web research, plus the Cloudflare Worker that powers it (`worker/`).
- Canonical address is now https://www.sbmadhav.com/state-of-voice-agents/.

### Revisions, October 12, 2026 (accessibility)
- Adopted design system 2.0: every text, control, hover, pressed and focus state meets WCAG 2.1 AA in light and dark (checked automatically on every element).
- Dark mode is calmer: soft coral and lavender accents instead of neon pink and purple.
- The sbmadhav.com home logo is now the header icon and favicon. Canonical address is https://sbmadhav.com/state-of-voice-agents/.

### Revisions, October 12, 2026 (settings and comments)
- Color mode choice is shared with every sbmadhav.com page (same saved setting), applied before the page paints.
- Ask Bolt is hidden for now while a thinker-responder version is designed.
- Added a comments section using giscus (GitHub Discussions). It stays hidden until Discussions is enabled and its category id is set.

### Revisions, October 12, 2026 (production essentials)
- New section, "What separates a good agent": a golden test set and evaluation framework, hearing the right caller (noise, side conversations, diarization), real-time emotion detection with sentiment on every call, and persona as brand.
- Woven through the page: evaluation-first in the suggested path, the pilot's golden set (200+ scenarios incl. noise and upset callers), the release scorecard, the after-day-90 plan, the think tank and the thinker's decisions (speaker and emotion).
- Dropped "System-2" terminology; the responder is a conversational LLM.

### Revisions, October 12, 2026 (public comments)
- Comments are live: a public section using utterances (GitHub issues, free and open source, no ads or tracking), replacing the hidden giscus setup. It follows the page theme and loads only when scrolled near. Direct GitHub links are shown as a fallback.

### Revisions, October 12, 2026 (pilot framing)
- Section 11 is now "A pilot playbook" instead of "Recommended next step", framed for readers at any stage: a way to start, expand or reset, or an audit for teams already in production.

### Revisions, October 12, 2026 (review feedback)
Changes after outside reviews of the page:
- Credibility:
  - The 75.6% repeat-reliability figure now shows its sample size and margin of error (about 65% to 84%); the top three platforms are effectively tied.
  - New "How to read this report" note: method, how vendors were chosen, how evidence is weighted, which tools are illustrative, and a disclosure (personal capacity, no commercial relationship with any vendor named).
- Limited-memory models: reframed as "build the governed fact store now, trial limited-memory training only once it beats retrieval." Live data such as balances and appointment slots stays on tool calls.
- Privacy: deleting a fact from the store removes it from the model, but logs, transcripts and backups need their own deletion.
- Pilot: the gates now explain where each number comes from and how to adjust it by risk. The stop rule now targets "advice beyond approved content".
- Identity: a friction-by-risk table (low, medium, high) with the trade-offs of liveness checks and texted codes.
- Thinker-responder: it works beside speech-to-speech models too. Routes are committed only on the finished turn, and the agent routes again when the caller corrects themselves.
- Emotion detection and personas: labeled as earlier-stage evidence to pilot behind the golden test set.
- Economics: new sliders for the higher cost of escalated calls and for repeat calls, plus the agent's cost per resolved call and worst, expected and best cases. Default savings are lower as a result.
- Structure:
  - A five-minute read (what we know, what to watch, what to do) replaces the suggested path.
  - Routing speed, cascade cost and the thesis checks moved to Part II, so Part I is shorter.
- Regulation section labeled as an orientation summary, not legal advice.
- Removed the note about sources that could not be retrieved.

### Revisions, October 12, 2026 (precision pass)
- Latency: says plainly that a speech-to-text, LLM, text-to-speech cascade lands near 1.5 s a turn even with a router and prefetch. Turns under 800 ms need speech-to-speech or full-duplex models.
- Pilot gate:
  - The pass^3 bar is now set by risk: about 85% for informational calls, 95% for anything that writes data or moves money.
  - A single critical failure blocks launch.
  - Framed as a risk-management choice, with its margin of error.
- Router design: new "who owns state" rule. The thinker writes typed fields each turn, the responder owns the conversation and the details it collects, and corrections or topic shifts trigger a re-route.
- Headline stats: the 18x research figure replaced with the healthcare fraud statistic; 22 ms vs 2.3 s labeled as a cross-study comparison.
- Section 9: the factual-precision chart moved to Part II; Part I keeps the business case for a governed fact store.
- Source audit, corrections:
  - Cekura Bench: "over real phone lines" replaced with "on live calls" plus how platforms were configured.
  - WellSpan: removed an unsupported Spanish-outreach detail.
  - Sierra: removed an unsupported mention of a health system speaker.
  - Talkdesk survey: respondents described correctly.
  - Knowledge-based authentication: an unsupported "over half" figure replaced with the sourced payer case.
  - Colorado: the replacement law (SB 26-189) covers automated decisions, not chatbot disclosure.
  - TCPA: consent wording notes the narrow healthcare exemptions.
  - Laya: the 76.6% score is on its own benchmark, not Banking77.
  - Jev cascade: the upper-bound note worded as the source does.
  - DATAMARK: its inconsistent baseline is noted.
  - Human cost per call: labeled as a published illustration.

### Revisions, October 12, 2026 (third review)
- Scope: the subtitle is now "Healthcare first, with notes for financial services"; full financial services coverage is planned for November.
- Corrections:
  - Tampa General is shown as 6.2 to 2.4 minutes rather than a percentage.
  - Banking77 described as 3,080 questions across 77 intents.
  - Replaced the "100 observations to detect a 5% change" rule with a correct estimate (several hundred runs per version).
  - Clarified which model each T-REx score belongs to.
  - Glossed Jev's Noul output type (a 0 to 1 "is this true?" answer).
  - Removed a duplicated statistic and an internally inconsistent case study.
- Framing:
  - The thinker-responder model is described as a deliberate difference from OpenAI's and Sierra's fast-talker design, not a convergence.
  - Thesis 1 now cites the measured 18 to 38 point gap.
  - The headline routing-speed figure was replaced with the CX survey finding.
- Additions:
  - A stop control so the thinker can cut audio mid-turn.
  - Resolution counted only with no repeat contact within 48 hours.
  - Multilingual routers for callers who mix languages.
  - Checking outbound lists against the FCC Reassigned Numbers Database.
- Section 6: two foundations (golden test set, hearing the right caller) and two experiments (emotion, persona). Personas are now a choice, then kept consistent per caller.
- Method note: Sierra appears in the market analysis where evidence exists; it was not part of the seven-platform test.
- Evidence labels: consolidated to the legend's set. Verdicts such as "holds" and "qualify" now use a neutral style. Unconfirmed laws are labeled "unverified".
- Trimmed weak evidence (a single-call noise figure, browser echo rates, a one-day gateway share, developer burnout). Think tank seats labeled as synthetic perspectives. The disclosure no longer repeats in the footer. Added a "That is the executive read" stop point after the pilot.
- Author line no longer names industries.
- Sources, the claim check, print tables and footnote numbers are now in the HTML itself, not only built by JavaScript.

### Revisions, October 12, 2026 (executive summary; edition frozen)
- New ten-minute executive summary after the opening: nine plain-language points, each linked to its evidence.
- Added:
  - PCI guidance for card payments by phone (pause recording, or masked keypad entry).
  - Redacting personal data from transcripts.
  - State call-recording consent laws.
  - Phone-network audio and integrations as practical limits.
  - What counts as a failed benchmark scenario.
- The October edition is now frozen; further changes go to the November edition (see UPDATING.md).
