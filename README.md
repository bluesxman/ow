# ow — Overwatch hero data for Claude.ai

Scrapes hero data from [overwatch.blizzard.com](https://overwatch.blizzard.com/en-us/heroes/) and enriches it with combat stats from the [Overwatch Fandom Wiki](https://overwatch.fandom.com/), publishing static JSON files consumable by Claude.ai conversations via `raw.githubusercontent.com` URLs.

## Why

Claude.ai's web fetch can't execute JavaScript, so the client-rendered Perks section of Blizzard hero pages is invisible to it. This pipeline runs a real browser, extracts the data, enriches it with numeric combat stats from Fandom's MediaWiki API, and publishes it as plain JSON. Claude fetches the files; no rendering required.

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

Every JSON file carries a `metadata` block with `last_updated`, `patch_version`, `hero_count`, `heroes_failed`, `fandom_failed`, `sources` (explicit per-source attribution), `schema_version`. The current schema version is `"3"`.

Every `heroes/<slug>.json` also includes a top-level `attribution` block with the exact Fandom and Blizzard page URLs the data came from.

For AI agents specifically, see [AGENTS.md](./AGENTS.md).

## Local use

Requires Node 24+.

```bash
npm install
npx playwright install --with-deps chromium
npm test              # run unit tests against saved fixtures
npm run scrape:dry    # scrape live, don't write published files
npm run scrape        # scrape live, write data/
```

The scraper sequentially hits 51 hero pages on Blizzard (one browser tab at a time) and then makes 51 requests to Fandom's `api.php` spaced ≥2.5 seconds apart. The full run takes ~5 minutes.

## When to run

The scraper runs **only on manual trigger** — no cron. When new Overwatch patch notes drop, go to the [Actions tab](https://github.com/bluesxman/ow/actions/workflows/scrape.yml) and click "Run workflow". This minimizes load on both sources and ensures every scrape corresponds to actual game changes.

When the scrape produces changes, the workflow opens a `data-refresh/<date>-<run-id>` branch and a PR against `main` rather than pushing directly. Review the diff under `data/`, then merge manually to publish the new JSON to `raw.githubusercontent.com/bluesxman/ow/main/data/`.

## When Blizzard renames a perk

The scraper uses a known-good validation fixture (`src/__tests__/fixtures/validation.json`) as a confidence check. If Reaper's "Soul Reaving" becomes "Soul Harvest" in a future patch, the scraper will **deliberately fail** rather than silently publish a changed name. Update the fixture and commit — this is an intentional human checkpoint.

## License and attribution

This repository is dual-licensed:

- **Source code** (everything outside `data/`) is released under the [MIT License](./LICENSE).
- **Published data** (`data/**`) is released under [CC-BY-SA 3.0](./data/LICENSE), matching the upstream Fandom license.

### Data sources

| Source | License | Fields contributed |
|---|---|---|
| [Blizzard Entertainment hero pages](https://overwatch.blizzard.com/en-us/heroes/) | Blizzard ToS (reproduced under a claim of nominative/fair use) | `name`, `role`, `portrait_url`, `perks`, `abilities[].description` |
| [Overwatch Fandom Wiki](https://overwatch.fandom.com/) | [CC-BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | `stats.health`, `stats.armor`, `stats.shields`, `stats.abilities.*` (damage, rate_of_fire, falloff, ammo, reload, spread, projectile_radius, projectile_speed, pellets, headshot, cooldown, duration, range, radius, healing, dps), `sub_role` |

Per-hero direct source links are enumerated in [`data/ATTRIBUTION.md`](./data/ATTRIBUTION.md) and embedded in every `heroes/<slug>.json` under the top-level `attribution` key.

### Redistributing this data

If you republish any file from `data/` (or a derivative work), CC-BY-SA 3.0's **share-alike** clause requires that you:

1. Preserve the `metadata.sources` block in each JSON file (or equivalent attribution).
2. License your redistribution under CC-BY-SA 3.0 (or a compatible license).
3. Link back to this repository and to the Fandom source.
