# State of Voice Agents

Published at https://sbmadhav.com/state-of-voice-agents/ as part of sbmadhav.com.

## Keep these on every page (index.html and editions/*/index.html)

- The shared header (it carries the Explore menu button, `<button ... id="exploreBtn">`) and `<script src="/assets/explore.js" defer></script>` before `</body>`.
- Site analytics: `<script src="/assets/analytics.js" defer></script>` plus the small click-tracking script after it (PDF and Ask Bolt events). GoatCounter, cookieless; never send personal data.
- When copying `index.html` into a new `editions/YYYY-MM/` folder, these lines come along; do not strip them.

## Design system and the shared header

- Every page pins sbmadhav.com design system 2.1.0: `/design-system/v/2.1.0/tokens.css` and `components.css` in `<head>`, `/design-system/v/2.1.0/header.js` (the sun/moon theme button, the one theme control) before `</body>`. Fonts are the self-hosted faces that `tokens.css` declares (preload Fredoka 600 and Nunito Sans); never add Google Fonts or a local `:root` palette. The report's semantic colours (`--accent`, `--signal`, `--good`, `--warn`, `--bad` and their `-soft` fills) are aliases of design-system tokens in one small `:root` block.
- Use tokens only: `--text-*` for type, `--space-*` for spacing, `--radius-*`, `--shadow-*`, `--z-*`, no raw hex. Display headings use `var(--display)` (Fredoka in Daybreak, Space Grotesk in Deep Space).
- The header between `<!-- md-header -->` and `<!-- /md-header -->` is the design system's `header.html`, composed in and committed (no build step). The page owns only its slots: `end` holds the Download PDF button. The report's section links live in the `.jump` bar under it, inside the sticky `.topbar`. After changing a slot, or after copying `index.html` into a new edition, run `python3 vendor/design-system-2.1.0/compose.py vendor/design-system-2.1.0/header.html index.html editions/*/index.html`. `.github/workflows/design-system.yml` runs it with `--check`.
- `vendor/design-system-2.1.0/` holds byte-for-byte copies of the published `header.html` and `compose.py`; never edit them. To move to a new version, vendor that version's files in a new folder, change every `/design-system/v/2.1.0/` link, run `compose.py`, update the workflow and review the diff.

## End-to-end tests

- Every change that affects behavior updates or adds the matching Playwright test in `e2e/` in the same commit; run `cd e2e && npx playwright test` before pushing.
- Run them with `cd e2e && npm ci && npx playwright test` (first time: `npx playwright install chromium webkit`). They test the live site, https://sbmadhav.com/state-of-voice-agents/, by default; set `BASE_URL` to test another host. To test a branch, `node e2e/local-server.mjs 8126` serves this checkout at `/state-of-voice-agents/` and proxies the rest of the site from https://sbmadhav.com; then `BASE_URL=http://localhost:8126 npx playwright test`. `.github/workflows/e2e.yml` runs them daily and after each push to `main` (it first waits for Pages to serve the pushed `index.html`).
- A new edition folder gets tested automatically (`e2e/tests/page.spec.ts` lists `editions/`).
- Never send Ask Bolt a question from a test: the worker calls the paid Claude API. Stub it with `page.route` when Bolt is switched on.
- `.nojekyll` publishes every file in the branch, so `e2e/` (test code, no secrets) is public at /state-of-voice-agents/e2e/. That is deliberate: switching to Jekyll to exclude it would also change how the `.md` files are served.
