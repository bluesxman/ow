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
4. **For patch history**, fetch [`patch-notes.json`](https://raw.githubusercontent.com/bluesxman/ow/main/data/patch-notes.json) — structured Blizzard patch notes from 2025-12-09 onward (OW2 Season 20: Vendetta and later). Each change carries a `raw.text` (verbatim Blizzard wording) and an `interpreted` block (mode, subject, metric, from/to deltas) authored by Claude. Joke patches (Underwatch / April Fools) are excluded — only real balance and bug-fix patches are published.
5. **For schema/validation**, fetch [`schema.json`](https://raw.githubusercontent.com/bluesxman/ow/main/data/schema.json) (per-hero) or [`patch-notes-schema.json`](https://raw.githubusercontent.com/bluesxman/ow/main/data/patch-notes-schema.json) (patch notes) — JSON Schema (draft-2020-12) generated at publish time from zod schemas in `src/validate.ts`.
6. **Check `metadata.last_updated`** before trusting the data. Refreshes happen manually on Overwatch patch days (no cron).
7. **Honor attribution.** Fandom-derived fields are CC-BY-SA 3.0 — see [`ATTRIBUTION.md`](https://raw.githubusercontent.com/bluesxman/ow/main/data/ATTRIBUTION.md) and the `metadata.sources` block in every JSON file.

### Cross-ability effects: `abilities[].modifies`

Some abilities change another ability's stats or behavior — e.g. Sierra's `Tracking Shot` marks an enemy and the marked target is then tracked by `Helix Rifle` follow-up shots, with their own damage value distinct from `Helix Rifle`'s baseline. The `modifies?: AbilityModifies[]` field on an ability captures this.

Each entry carries `target_ability` (name of the affected ability on the same hero), an optional `description`, and any stat fields (`damage`, `cooldown`, `duration`, etc.) that apply when the modifier is in play. Consumers should read top-level ability fields as the ability's own primary effect, and `modifies[]` as secondary effects that apply to other named abilities.

The field is optional — most abilities don't have cross-effects and won't carry it. The Fandom scrape doesn't populate it; it's filled in by AI judgment via the patch-day workflow when patch notes reveal interactions.

### If your webfetch only follows URLs from previously-fetched content

Some agents (Claude.ai chat, for example) won't fetch arbitrary URLs — only ones that already appeared in a search result or a prior fetch. For those, [`links.md`](https://raw.githubusercontent.com/bluesxman/ow/main/data/links.md) is a flat markdown list of every published raw URL. Fetch that one URL once, and every other file in `data/` becomes reachable.

The full file inventory and use-case guidance lives in the "Published files" section of [README.md](./README.md).

## Data versioning (semver)

`metadata.schema_version` follows semver. The version is the contract between this repo and downstream consumers. Bump it deliberately:

- **Major** (`X.0.0`): breaking schema change. Renamed/removed fields, changed types, restructured shape, or any change that requires consumers to update parsing code. May include data changes too.
- **Minor** (`X.Y.0`): non-breaking schema change. Added optional fields, new aggregate files, additional metadata. Existing consumers keep working unchanged. May include data changes.
- **Patch** (`X.Y.Z`): data-only change. No schema change at all — same fields, same types, same shape. Routine refreshes from new patches go here.

The version reflects what's currently on `main`, not what's in flight. Don't bump until the schema change actually merges. While a PR is WIP, multiple breaking changes can accumulate under the same prospective bump — set `SCHEMA_VERSION` once for the whole batch when the PR is ready to merge. Don't add a "5.0.0" commit, then a "6.0.0" commit, then a "7.0.0" commit on the same unmerged branch — that churns the published contract for no reason and confuses reviewers.

Edit the constant in [`src/config.ts`](./src/config.ts) (`SCHEMA_VERSION`) and call out the bump in the PR body. Routine `chore(data): refresh hero data` PRs should use a patch bump; the scrape workflow does not bump it automatically — set it explicitly when you intend a release.

## Patch-day workflow

When Blizzard publishes a new patch, two AI-driven Claude Code skills update the data in sequence and commit a **single combined PR**:

1. **[`refresh-patch-notes`](./.claude/skills/refresh-patch-notes/SKILL.md)** — fetches the latest patch notes from Blizzard, applies AI judgment to interpret each natural-language bullet into structured fields (mode, subject, metric, from/to, etc.), and writes `data/patch-notes.json`. Stages the change locally; **does not open a PR** when chained into the patch-day flow.
2. **[`process-patch-notes`](./.claude/skills/process-patch-notes/SKILL.md)** — reads the structured `data/patch-notes.json` from step 1 and applies retail quantitative changes to `data/heroes/*.json`. Commits both files together and opens the combined PR.

```
User: "Update our data with the latest patch."
→ Claude invokes refresh-patch-notes (writes data/patch-notes.json, runs gates, stops)
→ Claude invokes process-patch-notes (edits data/heroes/*.json, commits everything, opens PR)
→ User reviews the single PR and merges
```

The combined PR shows the full causal chain in one diff: patch-notes interpretation alongside the applied hero stat numbers. A reviewer verifying "Cassidy Peacekeeper damage went 75 → 70" can see both the source bullet (`raw.text` in `data/patch-notes.json`) and the destination edit (`data/heroes/cassidy.json`) without context-switching.

Either skill can also be invoked **standalone**:

- `refresh-patch-notes` alone: re-interprets earlier patches, fixes interpretation errors, or backfills history. Opens its own PR for just `data/patch-notes.json`.
- `process-patch-notes` alone: re-applies an existing `data/patch-notes.json` to hero stats (e.g. after a manual hero-JSON revert). PR contains hero edits only.

Both skills run quality gates (`npm run typecheck`, `npm run lint`, `npm test`) before committing. The deterministic scrape (`npm run scrape`) is a separate, GHA-friendly workflow and does **not** participate in the patch-day flow — it's for refreshing Fandom-derived hero data wholesale (run on Fandom updates, not Blizzard patches).

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
