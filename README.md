# ow — Overwatch hero data for Claude.ai

Publishes Overwatch hero data — abilities, perks, stats — as static JSON at `raw.githubusercontent.com` URLs, consumable by Claude.ai conversations and other AI agents.

## Why

Claude.ai's web fetch can't execute JavaScript, so client-rendered hero data on game sites is invisible to it. This pipeline pulls structured data from the [Overwatch Fandom Wiki](https://overwatch.fandom.com/) (one ability-naming authority → guaranteed self-consistent JSON) and reads the [Blizzard roster page](https://overwatch.blizzard.com/en-us/heroes/) for slugs/roles/portraits and the official patch-notes feed for the canonical patch version. Claude fetches the JSON files; no rendering required.

## Published files

After the workflow runs, these are available at:

```
https://raw.githubusercontent.com/bluesxman/ow/main/data/<file>
```

| File | Use when |
|---|---|
| `index.json` | You need to discover what files exist, which heroes are covered, and how to navigate them. Includes a `usage` block with a recommended workflow + a `files` map with one-line descriptions of every file below. **Start here.** |
| `schema.json` | You want to validate or generate types for the per-hero record. JSON Schema (draft-2020-12), generated from `src/validate.ts`. |
| `heroes.json` | You only need the roster (slug, name, role). |
| `perks.json` | You need perks across all heroes. |
| `abilities.json` | You need abilities across all heroes. |
| `stats.json` | You need HP, damage, rate of fire, falloff, cooldowns, ammo, reload, etc. |
| `all.json` | You need everything in one fetch. |
| `heroes/<slug>.json` | You only care about one hero — cheapest fetch. |
| `ATTRIBUTION.md` | Per-hero source URLs + CC-BY-SA 3.0 notice. |
| `LICENSE` | CC-BY-SA 3.0, covering all data in this directory. |
| `links.md` | You're working with an agent (e.g., Claude.ai chat) whose webfetch only follows URLs that appear in fetched content. Paste this single URL once to unlock fetches for every other file. The same URL list also lives under `links` in `index.json`. |

Every JSON file carries a `metadata` block with `last_updated`, `patch_version`, `hero_count`, `heroes_failed`, `fandom_failed`, `sources` (explicit per-source attribution), and `schema_version`. The current schema version is `"5.0.0"` — see [Schema versioning (semver)](#schema-versioning-semver) below.

Every `heroes/<slug>.json` also includes a top-level `attribution` block with the exact Fandom and Blizzard page URLs the data came from.

## Schema versioning (semver)

`metadata.schema_version` follows semver:

- **Major** (`X.0.0`): breaking schema change — renamed/removed fields, changed types, restructured shape. Consumers will need to update parsing code. May include data changes.
- **Minor** (`X.Y.0`): non-breaking schema change — added optional fields, new aggregate files, additional metadata. Existing consumers keep working unchanged. May include data changes.
- **Patch** (`X.Y.Z`): data-only change — same fields, same types, same shape. Routine refreshes from new patches go here.

The version reflects what's currently on `main`, not what's in flight — don't bump until a schema change actually merges. While a PR is WIP, accumulate breaking changes under one bump rather than churning the version commit-by-commit. The version is set in [`src/config.ts`](./src/config.ts) and is not auto-bumped by the scrape workflow.

For AI agents specifically, see [AGENTS.md](./AGENTS.md).

## Local use

Requires Node 24+.

```bash
npm install
npx playwright install --with-deps chromium
npm test              # run unit tests against saved fixtures
npm run scrape:dry    # scrape live, don't write published files
npm run scrape        # scrape live, write data/
npm run scrape:dev    # like scrape:dry but caches Blizzard + Fandom responses to .cache/
npm run cache:clear   # delete .cache/
```

The scraper hits two Blizzard pages (the roster and the patch-notes index) and then makes 51 requests to Fandom's `api.php` spaced ≥2.5 seconds apart. The full run takes a few minutes, dominated by the Fandom throttle.

### Local caching for development

The `--cache` flag stores every Blizzard page (HTML) and Fandom API response (JSON) under `.cache/` (gitignored). On a subsequent run with `--cache`, hits are served from disk — no network, no Fandom throttling. CI never passes `--cache`, so production scrapes always fetch live.

Combine with `--hero <slug>` to iterate on a single hero in seconds rather than minutes:

```bash
npx tsx src/index.ts --dry-run --cache --hero reaper
```

Clear the cache when Blizzard or Fandom publishes changes you want to pick up:

```bash
npm run cache:clear
```

## When to run

The scraper runs **only on manual trigger** — no cron. When new Overwatch patch notes drop, go to the [Actions tab](https://github.com/bluesxman/ow/actions/workflows/scrape.yml) and click "Run workflow". This minimizes load on both sources and ensures every scrape corresponds to actual game changes.

When the scrape produces changes, the workflow opens a `data-refresh/<date>-<run-id>` branch and a PR against `main` rather than pushing directly. Review the diff under `data/`, then merge manually to publish the new JSON to `raw.githubusercontent.com/bluesxman/ow/main/data/`.

## Maintaining data between scrapes

Fandom's wiki — the source of all ability/perk/stats data — often lags real Blizzard patches by days or weeks. Blizzard's patch notes are authoritative; when they conflict with Fandom-derived JSON, patch notes win. Apply a patch directly:

```bash
# In Claude Code, from this repo:
/process-patch-notes --since=2026-04-01
```

The bundled `process-patch-notes` skill (at `.claude/skills/process-patch-notes/`) fetches the latest patch notes, cross-references them with `data/heroes/*.json`, edits the affected per-hero files in place, regenerates the aggregate files, and opens a PR for human review. Invoke it manually — it does not run unless asked.

## When a perk is renamed

The scraper uses a known-good validation fixture (`src/__tests__/fixtures/validation.json`) as a confidence check. If Reaper's "Soul Reaving" becomes "Soul Harvest" in a future patch, the scraper will **deliberately fail** rather than silently publish a changed name. Update the fixture and commit — this is an intentional human checkpoint.

## License and attribution

This repository is dual-licensed:

- **Source code** (everything outside `data/`) is released under the [MIT License](./LICENSE).
- **Published data** (`data/**`) is released under [CC-BY-SA 3.0](./data/LICENSE), matching the upstream Fandom license.

### Data sources

| Source | License | Fields contributed |
|---|---|---|
| [Blizzard Entertainment](https://overwatch.blizzard.com/en-us/heroes/) | Blizzard ToS (reproduced under a claim of nominative/fair use) | `name`, `role`, `portrait_url`, `metadata.patch_version` |
| [Overwatch Fandom Wiki](https://overwatch.fandom.com/) | [CC-BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | `sub_role`, `abilities[]` (name + description), `perks.minor`, `perks.major`, `stats.health`, `stats.armor`, `stats.shields`, `stats.abilities.*` (damage, rate_of_fire, falloff, ammo, reload, spread, projectile_radius, projectile_speed, pellets, headshot, cooldown, duration, range, radius, healing, health, dps) |

Per-hero direct source links are enumerated in [`data/ATTRIBUTION.md`](./data/ATTRIBUTION.md) and embedded in every `heroes/<slug>.json` under the top-level `attribution` key.

### Redistributing this data

If you republish any file from `data/` (or a derivative work), CC-BY-SA 3.0's **share-alike** clause requires that you:

1. Preserve the `metadata.sources` block in each JSON file (or equivalent attribution).
2. License your redistribution under CC-BY-SA 3.0 (or a compatible license).
3. Link back to this repository and to the Fandom source.
