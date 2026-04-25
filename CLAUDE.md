# CLAUDE.md

Project-specific rules for Claude Code working in this repo. General architecture and workflow guidance lives in [AGENTS.md](./AGENTS.md).

## Do not WebFetch the Fandom site

`overwatch.fandom.com` (and Fandom in general) is fronted by Cloudflare bot management. It returns `403` to non-browser clients — including `WebFetch`. Trying it wastes a round-trip and produces a misleading challenge-page HTML body that looks like real content but contains zero data.

When you need wiki data:

- **Scrape pipeline:** the deterministic scraper in `src/sources/fandom*.ts` already uses Playwright (a real headless browser) to fetch hero pages. Use `npm run scrape` or its dry variants.
- **Ad-hoc lookups:** call the MediaWiki API directly with `curl`, not `WebFetch`. Endpoint:
  ```
  https://overwatch.fandom.com/api.php?action=parse&page=<Hero>&prop=wikitext&format=json
  ```
  This returns raw wikitext as JSON and is the supported path for automated access.

A `WebFetch(domain:*.fandom.com)` deny rule is set in `.claude/settings.json` to enforce this.

Blizzard's site (`overwatch.blizzard.com`) is fine to `WebFetch` — it doesn't bot-block.
