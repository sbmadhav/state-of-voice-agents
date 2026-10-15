# State of Voice Agents

Published at https://sbmadhav.com/state-of-voice-agents/ as part of sbmadhav.com.

## Keep these on every page (index.html and editions/*/index.html)

- The Explore menu button in the nav (`<button ... id="exploreBtn">`) and `<script src="/assets/explore.js" defer></script>` before `</body>`.
- Site analytics: `<script src="/assets/analytics.js" defer></script>` plus the small click-tracking script after it (PDF and Ask Bolt events). GoatCounter, cookieless; never send personal data.
- When copying `index.html` into a new `editions/YYYY-MM/` folder, these lines come along; do not strip them.

## End-to-end tests

- Every change that affects behavior updates or adds the matching Playwright test in `e2e/` in the same commit; run `cd e2e && npx playwright test` before pushing.
- Run them with `cd e2e && npm ci && npx playwright test` (first time: `npx playwright install chromium webkit`). They test the live site, https://sbmadhav.com/state-of-voice-agents/, by default; set `BASE_URL` to test another host. `.github/workflows/e2e.yml` runs them daily and after each push to `main` (it first waits for Pages to serve the pushed `index.html`).
- A new edition folder gets tested automatically (`e2e/tests/page.spec.ts` lists `editions/`).
- Never send Ask Bolt a question from a test: the worker calls the paid Claude API. Stub it with `page.route` when Bolt is switched on.
- `.nojekyll` publishes every file in the branch, so `e2e/` (test code, no secrets) is public at /state-of-voice-agents/e2e/. That is deliberate: switching to Jekyll to exclude it would also change how the `.md` files are served.
