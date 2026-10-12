# Bolt, the report's Q&A assistant

A small Cloudflare Worker that lets readers ask Bolt questions about the report. Bolt answers from the report text (`bolt-context.txt` at the site root) and, when the reader leaves "Search the web" on, uses the Claude API web search tool to find and cite newer sources.

**Status: paused.** Bolt is hidden on the page (`BOLT_ENABLED = false` in `index.html`) while a thinker-responder version is designed. This Worker is kept for reference.

## Deploy (about 10 minutes)

1. Install Wrangler and sign in: `npm i -g wrangler`, then `wrangler login`.
2. From this folder, add your Claude API key as a secret: `wrangler secret put ANTHROPIC_API_KEY`.
3. Deploy: `wrangler deploy`. Note the URL it prints, for example `https://bolt-voice-agents.<your-subdomain>.workers.dev`.
4. In `index.html` (and the archived edition), set `const BOLT_ENDPOINT = '<that URL>';`, then commit and push.
5. In the Claude Console, set a monthly spend limit for the key.

## Cost and safety

- Model: `claude-sonnet-5-5` by default (set `MODEL` in `wrangler.toml`). The report text is sent as a cached system prompt, so repeat questions cost much less.
- Web search is billed per search; each question is capped at 3 searches (`MAX_SEARCHES`).
- Only requests from the site's origins are accepted (`ALLOWED_ORIGINS`), each visitor is limited to 10 questions a minute, and questions are capped at 1,500 characters with 12 messages of history.
- The API key stays in the Worker. Nothing is stored.

## Monthly editions

`bolt-context.txt` is regenerated with each edition. The Worker caches it for an hour, so Bolt picks up a new edition automatically.
