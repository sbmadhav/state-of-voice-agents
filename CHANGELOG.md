# Changelog

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
