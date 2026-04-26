# CLAUDE.md

Project-specific rules for Claude Code working in this repo. General architecture and workflow guidance lives in [AGENTS.md](./AGENTS.md).

## Never scrape Fandom's web pages — use the MediaWiki API

`overwatch.fandom.com` is fronted by Cloudflare bot management. Any non-browser client (`WebFetch`, `fetch`, `curl`, even a Playwright headless run) gets a 403 challenge page back. The response body looks like HTML but contains zero data, and trying harder is not the answer — Fandom's supported automated path is their MediaWiki API at `/api.php`.

The `WebFetch(domain:*.fandom.com)` deny rule in `.claude/settings.json` enforces this for the rendered site.

### How to get Fandom data

- **Bulk hero data** (the scrape pipeline): `npm run scrape` (or `scrape:dry`, `scrape:dev`). The deterministic scraper uses [`src/sources/FandomClient.ts`](./src/sources/FandomClient.ts), which hits `https://overwatch.fandom.com/api.php?action=parse&prop=wikitext` and parses the returned wikitext via [`src/sources/fandomWikitext.ts`](./src/sources/fandomWikitext.ts).
- **Ad-hoc lookup for one hero**: `npm run probe:fandom -- <slug>` (e.g. `npm run probe:fandom -- kiriko`). Runs the same `FandomClient` + parser end-to-end and prints the normalized hero. This is the right tool for "what does Fandom currently say about Kiriko's healing rate?"-style verification — it reuses the production code path, so what it returns is what the scrape would write.
- **Reading wikitext for an arbitrary page** (rare; only when no other tool fits): the API endpoint is
  ```
  https://overwatch.fandom.com/api.php?action=parse&page=<PageTitle>&prop=wikitext&format=json
  ```
  Use `curl` only as a last resort — `npm run probe:fandom` already covers the hero case and gives you parsed output for free.

Blizzard's site (`overwatch.blizzard.com`) does not bot-block — `WebFetch` against it is fine.
