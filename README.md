# ow — Overwatch hero data for Claude.ai

Scrapes hero data from [overwatch.blizzard.com](https://overwatch.blizzard.com/en-us/heroes/) on a schedule and publishes static JSON files consumable by Claude.ai conversations via `raw.githubusercontent.com` URLs.

## Why

Claude.ai's web fetch can't execute JavaScript, so the client-rendered Perks section of Blizzard hero pages is invisible to it. This pipeline runs a real browser, extracts the data, and publishes it as plain JSON. Claude fetches the files; no rendering required.

## Published files

After the workflow runs, these are available at:

```
https://raw.githubusercontent.com/bluesxman/ow/main/data/<file>
```

| File | Use when |
|---|---|
| `index.json` | You need to discover what files exist and which heroes are covered. **Start here.** |
| `heroes.json` | You only need the roster (slug, name, role). |
| `perks.json` | You need perks across all heroes. |
| `abilities.json` | You need abilities across all heroes. |
| `stats.json` | You need HP / damage / cooldown numbers. |
| `all.json` | You need everything in one fetch. |
| `heroes/<slug>.json` | You only care about one hero — cheapest fetch. |

Every file carries a `metadata` block: `last_updated`, `patch_version`, `hero_count`, `heroes_failed`, `source`, `schema_version`.

## Local use

Requires Node 24+.

```bash
npm install
npx playwright install --with-deps chromium
npm test              # run unit tests against saved fixtures
npm run scrape:dry    # scrape live, don't write published files
npm run scrape        # scrape live, write data/
```

## Scheduling

GitHub Actions runs the scraper Tue–Fri at 17:00 UTC (~10:00 PT — a few hours after Blizzard's typical Tuesday patch deploys). Manual runs via `workflow_dispatch`.

## When Blizzard renames a perk

The scraper uses a known-good validation fixture (`src/__tests__/fixtures/validation.json`) as a confidence check. If Reaper's "Soul Reaving" becomes "Soul Harvest" in a future patch, the scraper will **deliberately fail** rather than silently publish a changed name. Update the fixture and commit — this is an intentional human checkpoint.
