# AGENTS.md

This file is for AI agents working with this repository. Humans should start with [README.md](./README.md).

## What this repo is

A patch-tracking pipeline that publishes Overwatch hero data as static JSON under [`data/`](./data). The data is meant to be fetched by AI assistants that can't execute JavaScript on Blizzard's client-rendered hero UI.

Source-of-truth split:

- **[Overwatch Fandom Wiki](https://overwatch.fandom.com/)** owns abilities, perks, sub-roles, HP, and per-ability combat stats. One naming authority for everything ability-shaped — keys in `stats.abilities` always match an entry in `abilities[]`.
- **[Blizzard's Overwatch site](https://overwatch.blizzard.com/en-us/heroes/)** owns the roster (slug, display name, role, portrait) and the patch-notes feed used to override stale Fandom values.

## If you're consuming the data

1. **Start at [`index.json`](https://raw.githubusercontent.com/bluesxman/ow/main/data/index.json).** It carries `metadata` (freshness + source attribution + `schema_version`), a `usage` block with a recommended workflow, a `files` map describing every published file, a `links` block with raw URLs for every published file (top-level + per-hero), and a roster of all 51 heroes.
2. **For one hero**, fetch `https://raw.githubusercontent.com/bluesxman/ow/main/data/heroes/{slug}.json` — cheapest fetch, includes its own per-hero `attribution` block.
3. **For roster-wide queries**, fetch the topical aggregate ([`perks.json`](https://raw.githubusercontent.com/bluesxman/ow/main/data/perks.json), [`abilities.json`](https://raw.githubusercontent.com/bluesxman/ow/main/data/abilities.json), [`stats.json`](https://raw.githubusercontent.com/bluesxman/ow/main/data/stats.json)) instead of [`all.json`](https://raw.githubusercontent.com/bluesxman/ow/main/data/all.json).
4. **For schema/validation**, fetch [`schema.json`](https://raw.githubusercontent.com/bluesxman/ow/main/data/schema.json) — JSON Schema (draft-2020-12) describing the per-hero record. Generated at publish time from the zod schema in `src/validate.ts`.
5. **Check `metadata.last_updated`** before trusting the data. Refreshes happen manually on Overwatch patch days (no cron).
6. **Honor attribution.** Fandom-derived fields are CC-BY-SA 3.0 — see [`ATTRIBUTION.md`](https://raw.githubusercontent.com/bluesxman/ow/main/data/ATTRIBUTION.md) and the `metadata.sources` block in every JSON file.

### If your webfetch only follows URLs from previously-fetched content

Some agents (Claude.ai chat, for example) won't fetch arbitrary URLs — only ones that already appeared in a search result or a prior fetch. For those, [`links.md`](https://raw.githubusercontent.com/bluesxman/ow/main/data/links.md) is a flat markdown list of every published raw URL. Fetch that one URL once, and every other file in `data/` becomes reachable.

The full file inventory and use-case guidance lives in the "Published files" section of [README.md](./README.md).

## Data versioning (semver)

`metadata.schema_version` follows semver. The version is the contract between this repo and downstream consumers. Bump it deliberately:

- **Major** (`X.0.0`): breaking schema change. Renamed/removed fields, changed types, restructured shape, or any change that requires consumers to update parsing code. May include data changes too.
- **Minor** (`X.Y.0`): non-breaking schema change. Added optional fields, new aggregate files, additional metadata. Existing consumers keep working unchanged. May include data changes.
- **Patch** (`X.Y.Z`): data-only change. No schema change at all — same fields, same types, same shape. Routine refreshes from new patches go here.

Edit the constant in [`src/config.ts`](./src/config.ts) (`SCHEMA_VERSION`) and call out the bump in the PR body. Routine `chore(data): refresh hero data` PRs should use a patch bump; the scrape workflow does not bump it automatically — set it explicitly when you intend a release.

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
https://raw.githubusercontent.com/bluesxman/ow/main/data/links.md
https://raw.githubusercontent.com/bluesxman/ow/main/data/heroes/{slug}.json
```
