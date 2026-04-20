# AGENTS.md

This file is for AI agents working with this repository. Humans should start with [README.md](./README.md).

## What this repo is

A patch-tracking pipeline that scrapes [Blizzard's Overwatch hero pages](https://overwatch.blizzard.com/en-us/heroes/) and the [Overwatch Fandom Wiki](https://overwatch.fandom.com/) and publishes the result as static JSON under [`data/`](./data). The data is meant to be fetched by AI assistants that can't execute JavaScript on Blizzard's client-rendered perks UI.

## If you're consuming the data

1. **Start at [`data/index.json`](./data/index.json).** It carries `metadata` (freshness + source attribution + `schema_version`), a `usage` block with a recommended workflow, a `files` map describing every published file, and a roster of all 51 heroes.
2. **For one hero**, fetch [`data/heroes/{slug}.json`](./data/heroes/) — cheapest fetch, includes its own per-hero `attribution` block.
3. **For roster-wide queries**, fetch the topical aggregate (`perks.json`, `abilities.json`, `stats.json`) instead of `all.json`.
4. **For schema/validation**, fetch [`data/schema.json`](./data/schema.json) — JSON Schema (draft-2020-12) describing the per-hero record. Generated at publish time from the zod schema in `src/validate.ts`.
5. **Check `metadata.last_updated`** before trusting the data. Refreshes happen manually on Overwatch patch days (no cron).
6. **Honor attribution.** Fandom-derived fields are CC-BY-SA 3.0 — see [`data/ATTRIBUTION.md`](./data/ATTRIBUTION.md) and the `metadata.sources` block in every JSON file.

The full file inventory and use-case guidance lives in the "Published files" section of [README.md](./README.md).

## If you're modifying the code

- Read [README.md](./README.md) first.
- Run `npm run typecheck && npm run lint && npm test` before any commit.
- The scrape workflow is **manual-only**; do not enable cron triggers.
- Open a PR — do not push directly to `main`. The user merges manually.

## Stable URLs

Published files are served from `raw.githubusercontent.com`:

```
https://raw.githubusercontent.com/bluesxman/ow/main/data/index.json
https://raw.githubusercontent.com/bluesxman/ow/main/data/schema.json
https://raw.githubusercontent.com/bluesxman/ow/main/data/heroes/{slug}.json
```
