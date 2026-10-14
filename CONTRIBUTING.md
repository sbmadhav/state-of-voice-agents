# Contributing to State of Voice Agents

Thanks for taking the time to help. This is an independent, vendor-neutral report on conversational voice agents, published monthly at https://sbmadhav.com/state-of-voice-agents/.

## What is welcome

- Corrections: a number that does not match its source, a broken or outdated link, a claim that has changed. Please include the source.
- Source suggestions for the next edition: published results, benchmarks, papers, regulation updates.
- Bug fixes in the page: charts, interactive tools, themes, the PDF export, phone layout.
- Accessibility: keyboard use, screen reader labels, contrast, reduced motion.

The easiest way to suggest a correction or a source is a GitHub issue. Pull requests are welcome for page fixes.

## What is not

- Changes to the analysis, the theses or the recommendations. The report is the author's own view. Make the case in an issue instead.
- Vendor marketing, or edits that favor one vendor.
- Changes to archived editions under `editions/`, other than broken links.
- New third-party scripts or trackers.

## How a change gets merged

1. Fork the repo and create a branch from `main`.
2. Make the change and check it as described below.
3. Open a pull request against `main` and fill in the checklist.

Every pull request needs an approving review from the owner (@sbmadhav, the code owner of every file) and every review conversation resolved. Nothing merges without the owner's approval. `main` deploys straight to the live report, so the branch is protected: no direct pushes from contributors, no force pushes.

## Local setup

The report is a single static page. It loads the Explore menu, analytics and fonts from the rest of sbmadhav.com by absolute URL, so for the full look serve it from a checkout of the main site:

```sh
git clone https://github.com/sbmadhav/sbmadhav.github.io.git
git clone https://github.com/<you>/state-of-voice-agents.git
cd sbmadhav.github.io
ln -s ../state-of-voice-agents state-of-voice-agents
python3 -m http.server 8000
```

Then open http://localhost:8000/state-of-voice-agents/. Do not commit the link.

## Checks

There is no automated build. Before opening a pull request:

- Every changed number matches its source, and the evidence labels (vendor-reported, customer-reported) are still accurate.
- Light and dark themes, a 390px wide phone, and Download PDF in both themes all look right.
- The Explore menu button and the `/assets/explore.js` and `/assets/analytics.js` scripts are still on every page (see `CLAUDE.md`).
- For a new edition, follow [UPDATING.md](UPDATING.md).

## Style rules

- Plain, clear English. Never use em dashes. Use a period, comma or colon.
- Every figure links to its source.
- Follow the sbmadhav.com design system (https://sbmadhav.com/design-system/) for anything visual.
- Never send personal data to analytics.

## Published files

This repo has a `.nojekyll` file, so GitHub Pages publishes every file in it as is, including these docs. Do not commit secrets, notes or drafts.

## Security problems

Do not open a public issue. See [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contribution is licensed under the [MIT License](LICENSE), the same license as the rest of this repo.
