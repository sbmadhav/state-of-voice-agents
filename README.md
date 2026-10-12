# State of Voice Agents

An interactive, vendor-neutral look at conversational voice agents in regulated contact centers (healthcare and financial services). It is published as a monthly edition and updated every 30 days.

**Read it:** https://sbmadhav.com/state-of-voice-agents/

![Voice Agents at the Front Door](og.png)

## Current edition: October 2026

Three theses:

1. **Reliability is the gap.** A single demo overstates readiness by 20 to 40 points. Measure repeatability (pass^3) on your own call types.
2. **Think silently, then respond.** A fast System-1 "thinker" makes silent, typed decisions: intent, risk, which sub-agent and which MCP tools. A conversational LLM "responder" does the talking.
3. **Invest in governed memory.** Limited Memory Language Models look facts up in a governed store instead of memorizing them. That makes facts traceable and deletable, and a model can be trained on your own data.

The page is in two parts:

- **Part I, for executives:**
  - Reliability benchmark, published results and an economics model.
  - The thinker-responder router demo, where to start, and trust and identity.
  - Limited-memory models, the options, and a 90-day pilot with a plan for after day 90.
  - A seven-seat debate.
- **Part II, for architects and engineers:**
  - Architecture, latency budget and pass^k measurement.
  - Failure modes, routing models compared, and how LMLM works.
  - Deployment posture, fraud controls, regulation, a claim check and the full source list.

Every figure links to its source. Vendor-reported numbers are labeled as such.

## Features

- Interactive charts and tools, each tagged "Interactive".
- **Ask Bolt:** a Q&A assistant grounded in the report, with optional web research. See [worker/README.md](worker/README.md) to switch on live answers.
- System, light and dark themes. The page follows the reader's device setting by default.
- **Download PDF** reformats the page for letter-size pages in the theme the reader chooses: tabs and filters are expanded and controls are hidden.

## Editions

| Edition | Link | Notes |
|---|---|---|
| October 2026 | [editions/2026-10](https://sbmadhav.com/state-of-voice-agents/editions/2026-10/) | First edition |

The root `index.html` always holds the latest edition. Each month's edition is also archived under `editions/YYYY-MM/`. See [UPDATING.md](UPDATING.md) for the monthly checklist and [CHANGELOG.md](CHANGELOG.md) for what changed.

## About

Part of [sbmadhav.com](https://sbmadhav.com/) and styled with its design system. By Madhav Srinivasan. Written in a personal capacity; not affiliated with any organization or vendor named. Outcome figures are customer- or vendor-reported unless marked otherwise. Regulatory summaries are not legal advice.

Corrections and source suggestions are welcome as GitHub issues.
