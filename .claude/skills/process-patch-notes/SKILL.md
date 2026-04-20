---
name: process-patch-notes
description: Apply Blizzard patch-note stat changes to data/heroes/*.json. Invoke when Blizzard has published patches that the scraped Fandom stats haven't caught up to yet. Accepts an optional --since window (ISO date or Nd offset, default 30d).
disable-model-invocation: true
allowed-tools: Bash(npm run patch-notes:*) Bash(jq *) Bash(git *) Bash(gh pr *) Read Edit Grep Glob
argument-hint: [--since=YYYY-MM-DD | Nd]
effort: high
---

# process-patch-notes

Reads Blizzard's public patch notes, figures out which heroes and abilities in `data/heroes/*.json` are affected by quantitative changes, edits the per-hero JSONs in place, regenerates the aggregate files, and opens a PR for human review.

Fandom's wiki (the source of `stats.*` fields) lags real patches. This skill is the human-in-the-loop bridge until the next full scrape catches up.

## Preflight

!`git status --porcelain`

!`git rev-parse --abbrev-ref HEAD`

!`npm run --silent patch-notes:fetch -- $0 && cat .run/patch-notes.md`

!`npm run --silent patch-notes:affected && cat .run/patch-affected.json`

Invoked without arguments, the fetch script uses its 30-day default window. Pass `--since=YYYY-MM-DD` or `--since=Nd` to override (e.g. `/process-patch-notes --since=2026-04-01`).

## Update algorithm

For each entry in `.run/patch-affected.json` → `affected[]`:

1. Read `data/heroes/<slug>.json`.
2. For each ability in `affected[i].abilities`, find matching bullets in `.run/patch-notes.md` under the `#### <Hero>` → `- **<Ability>**` subtree. Apply **quantitative** changes only to `hero.stats.abilities[<Ability>].*`:
   - "X reduced from A to B" / "X increased from A to B" → set the field to `B`.
   - "X increased by N%" / "X reduced by N%" → compute from current JSON value; round to the nearest sensible unit (whole numbers for damage/health/ammo, one decimal for cooldowns, etc.); mention the rounding in the PR body.
   - Map natural-language phrases to JSON field names: "damage per projectile" → `damage`, "fire rate" → `rate_of_fire`, "cooldown" → `cooldown`, "ammo" → `ammo`, "healing" → `healing`, "duration" → `duration`, "range" → `range`, "movement speed" → `movement_speed`. When a phrase is unusual, skip and note in the PR body.
3. For `affected[i].hero_level_bullets`, update `hero.stats.health`, `hero.stats.armor`, or `hero.stats.shields` only when the bullet gives an unambiguous numeric value ("Health reduced from 250 to 225"). Skip qualitative effects ("can see enemies through walls").
4. Preserve JSON shape: do not reorder keys or add fields.
5. **Do not edit** any entry listed under `affected[i].skipped_abilities` — those are patch mentions for abilities the hero doesn't currently carry in `stats.abilities` (e.g., perks we don't track numerically, cross-referenced Stadium powers). Note them in the PR body instead.

After all per-hero files are updated:

!`npm run patch-notes:rebuild-aggregates`

## Branch and PR

```
BRANCH=patch-corrections/$(date -u +%Y-%m-%d)
git checkout -b "$BRANCH"
git add data/
git commit -m "Apply Blizzard patch corrections ($(date -u +%Y-%m-%d))"
git push -u origin "$BRANCH"
```

Then open a PR with `gh pr create` whose body contains:

- The `--since` window that was used.
- A per-hero change summary — one bullet per field touched, in the form `Cassidy Peacekeeper damage: 75 → 70 (April 17 patch)`.
- A "Skipped" section listing any ambiguous bullets, percent deltas that needed rounding, and entries from `skipped_abilities` / `unmatched` that the reviewer should spot-check.

## Safety rails

- **Do not touch** `metadata.last_updated`, `metadata.patch_version`, `metadata.hero_count`, `metadata.heroes_failed`, `metadata.fandom_failed`. Those are owned by the scrape pipeline; `rebuild-aggregates` carries the existing values through verbatim.
- **Do not touch** `data/ATTRIBUTION.md`, `data/CHANGELOG.md`, `data/LICENSE`, or anything under `data/.previous/`.
- **Do not touch** Blizzard-sourced fields: `hero.abilities[*].description`, `hero.perks.*`, `hero.role`, `hero.portrait_url`. If a patch note rewrites ability behavior qualitatively, skip and note in the PR body — the next scrape will pick up Blizzard's new description.
- If a bullet references a hero not in `data/heroes/` (PTR-only, removed, or new hero not yet scraped), skip and note.
- If a percent delta is ambiguous about the base value, skip and note — don't guess.
- Never merge the PR. Human review is the safety net.
