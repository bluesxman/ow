---
name: refresh-patch-notes
description: Refresh data/patch-notes.json with the latest Blizzard patch notes, applying AI judgment to interpret each natural-language change into structured fields (mode, subject, metric, from/to, etc.). First step of the patch-day flow — followed by process-patch-notes for hero stat updates. Manually invoked on patch days. Opens a PR for human review.
disable-model-invocation: true
allowed-tools: Bash(npm run patch-notes:*) Bash(npm run typecheck) Bash(npm run lint) Bash(npm test) Bash(jq *) Bash(git *) Bash(gh pr *) Read Edit Write Grep Glob
effort: high
---

# refresh-patch-notes

Maintains `data/patch-notes.json` — the published, structured history of Blizzard's patch notes from `2025-12-09` onward (OW2 Season 20: Vendetta and the post-rebrand 2026 seasons).

The deterministic scrape pipeline (GHA, `npm run scrape`) does not write this file. Patch notes are natural-language and require interpretation that pattern-matching can't do well; that's this skill's job. The scrape pipeline writes the schema (a static contract) but not the data.

## Patch-day order

This is the first skill in the patch-day flow:

1. **refresh-patch-notes** (this skill) — fetches raw patches, interprets, writes `data/patch-notes.json`.
2. **[process-patch-notes](../process-patch-notes/SKILL.md)** — reads `data/patch-notes.json`, applies retail quantitative changes to `data/heroes/*.json`, and opens the **combined PR** containing both files.

When invoked as part of the patch-day flow, this skill **does not open its own PR** — it stages the change locally and hands off to `process-patch-notes`, which commits both sets of edits together so reviewers see the full causal chain (patch interpretation → applied stat numbers) in one diff.

When invoked **standalone** (e.g. re-interpreting an earlier patch without applying hero edits), this skill opens its own PR — see the "Standalone PR" section below.

## What this skill produces

`data/patch-notes.json` validates against `PatchNotesDocSchema` (see `src/validate.ts`). Each patch carries a list of sections, and each section carries a list of `changes`. Every change has two layers:

- **`raw.text`** — the bullet exactly as Blizzard wrote it, preserved verbatim.
- **`interpreted`** — AI judgment about what the bullet refers to. Nullable when the source is too ambiguous.

The interpreted layer carries:

- `mode`: `retail` | `stadium` | `mixed` | `unknown`
- `subject_kind`: `hero_general` | `ability` | `perk` | `role` | `system` | `map` | `unknown`
- `hero_slug`: matches `data/heroes/<slug>.json` when the change targets a hero, else null
- `subject_name`: ability name, perk name, hero name, or whatever Blizzard's bracketed prefix points at
- `metric`: one of the well-known stat names (`damage`, `cooldown`, etc.) or `other`
- `metric_phrase`: the natural-language phrase Blizzard used (e.g. "damage per projectile", "extra resource")
- `from`, `to`, `delta`: numeric or string; null when the bullet is qualitative
- `blizzard_commentary`: any inline dev notes or parenthetical caveats the bullet contains
- `notes`: free-form AI explanation when the call needed judgment

## Preflight

!`git status --porcelain`

!`git rev-parse --abbrev-ref HEAD`

!`npm run --silent patch-notes:dump-raw && cat .run/patch-notes-raw.json | jq '{fetched_at, cutoff_date, patch_count: (.patches | length), patches: [.patches[] | {date, title, section_count: (.sections | length)}]}'`

The dump script writes the raw deterministic parse to `.run/patch-notes-raw.json`. That's the input — patches sorted newest-first, with sections containing items (`kind: hero` with abilities and hero_level bullets, or `kind: general` with bullets and an optional title).

## Procedure

1. **Read the existing file** (if present): `data/patch-notes.json`. Each patch already in the file should be re-emitted unchanged unless Blizzard has edited the patch text since last refresh — patches are keyed by `date`. History is preserved across refreshes; older patches that have rotated off Blizzard's rolling page must remain in the published file.

   **Exclude joke patches** — Blizzard publishes April Fools "patch notes" in the same feed (e.g., the April 1, 2026 "Underwatch Patch Notes" with absurd fake changes like "Cassidy fires a piercing bullet whenever saying hello"). These don't reflect real game state. Identify by the patch title (`Underwatch`, `April 1` joke style) and/or by the absurdity of the bullets. Drop the entire patch from the output and note the exclusion in the PR body. If unsure, ask the user.

2. **Read the raw input**: `.run/patch-notes-raw.json`. For each patch in `patches[]`:
   - Use the same `date` and `title` as in the raw input.
   - Set `url: null` (Blizzard doesn't publish stable per-patch URLs).
   - Map raw sections to published sections (see step 3).

3. **For each section in the raw input**:
   - Set `title` to the raw section title verbatim.
   - Set `mode` based on the section title and surrounding context. Rules:
     - Title contains "Stadium" → `stadium`.
     - Section appears immediately after a `Stadium Updates` / `Stadium Hero Updates` block in the same patch and re-uses a generic name like `Tank` / `Damage` / `Support` → `stadium`.
     - Section is `Map Updates`, `Bug Fixes`, `General Updates`, `Hero Updates`, or a season opener → `retail` unless the section explicitly contains Stadium-only content.
     - When in doubt, set `unknown` and leave a note on each change.
   - Set `group_label` to the section's grouping subject when meaningful (a single hero name when the section has one hero block; a topic like "Mystery Heroes Updates" for general sub-blocks). Else null.

4. **For each item in the raw section**, flatten to `changes[]`:
   - **Hero items (`kind: hero`)**: emit one change per `hero_level` bullet and one change per ability bullet. Each gets:
     - `raw.text`: the bullet text.
     - `interpreted.hero_slug`: `item.hero_slug` (already normalized by the parser).
     - For ability bullets: `subject_kind: 'ability'`, `subject_name: <ability_name>` (or `'perk'` if the ability name carries a `– Minor Perk` / `– Major Perk` suffix; in that case strip the suffix from `subject_name`).
     - For hero-level bullets: `subject_kind: 'hero_general'`, `subject_name: <hero name>`.
     - Bracketed prefixes (`[Ravenous Vortex]`, `[Annihilation]`) reference a specific ability — when present, prefer that as `subject_name` and set `subject_kind: 'ability'`. Strip the bracketed prefix from `metric_phrase` so it doesn't leak into the metric label.
   - **General items (`kind: general`)**: one change per bullet.
     - When the item carries a `title`, use it as `subject_name` and set `subject_kind: 'system'` (or `'map'` for map sections, `'role'` for role passive bullets).
     - When `title` is empty, treat as a flat section bullet — `subject_name: null`, `subject_kind: 'system'`.

5. **Metric extraction** (per change). Apply when the bullet states a quantitative change clearly:
   - `damage per projectile reduced from 75 to 70` → `metric: 'damage'`, `from: 75`, `to: 70`, `delta: -5`, `metric_phrase: 'damage per projectile'`.
   - `cooldown reduced from 14 to 12 seconds` → `metric: 'cooldown'`, `from: '14 seconds'`, `to: '12 seconds'`, `delta: '-2 seconds'`. Strings are fine when units matter.
   - `Ultimate cost increased by 30%` → `metric: 'ultimate_cost'`, `from: null`, `to: null`, `delta: '+30%'`.
   - `Re-enabled.` → metric/from/to/delta all null. Subject is the hero (general); leave a `notes` explaining.
   - `(6v6) Maximum health reduced from 650 to 600` → set `mode: 'retail'` (still retail, just the 6v6 sub-mode), put `'(6v6)'` in `blizzard_commentary`, set `metric: 'health'`, `from: 650`, `to: 600`. The 6v6 distinction is a known schema gap; the AI surfaces it via `blizzard_commentary` rather than splitting modes.
   - When the metric doesn't match any enum (e.g. "Visibility duration"), use `metric: 'other'` and put the phrase in `metric_phrase`.

6. **Mode classification per change**:
   - Section-mode wins by default — change inherits its section's `mode`.
   - Override only when the bullet explicitly contradicts (rare). When a Stadium bullet appears inside a non-Stadium section (typically inside `Bug Fixes`), set the change's `mode: 'stadium'` and put `'Stadium fix appearing in retail bug-fix section'` in `notes`.

7. **Blizzard commentary**:
   - Capture parenthetical caveats: `(6v6)`, `(Up from 50%)`, `(Down from 100)`, `(during Rally)`, `(default)`. These go into `blizzard_commentary[]` as raw fragments.
   - Capture inline dev notes when Blizzard wraps them in `[Dev Note]`-style markers.
   - Keep the raw `text` intact regardless.

8. **`notes` field**: write a one-line explanation when:
   - The subject was inferred rather than stated (e.g. "subject inferred from sibling bullets in the same Ramattra block").
   - The metric is `other` (explain what was actually being measured).
   - Mode was overridden from the section's mode.
   - You couldn't confidently classify and `interpreted` could have been null but you made a best-effort call.
   - When the call is unambiguous, `notes: ''`.

9. **When to set `interpreted: null`**: the bullet is so unmoored from any subject (e.g. "Re-enabled." with no surrounding hero context, or "Stadium" appearing as a single-word bullet) that any inference would be a guess. Better to ship `null` than misleading structure.

10. **Validate**: `npm run patch-notes:validate -- data/patch-notes.json` — must exit 0.

11. **Rebuild aggregates**: `npm run patch-notes:rebuild-aggregates`. The patch-notes file is independent from the hero aggregates, but this keeps `data/index.json`'s timestamps consistent.

12. **Quality gates** — run before committing:

    !`npm run typecheck`

    !`npm run lint`

    !`npm test`

    Hand-edited JSON occasionally introduces shape errors that the schema validator misses (typos in untyped string fields, escaped quotes that break JSON.parse on a second pass, etc.). Stop and investigate if any gate fails.

## When chained into the patch-day flow

When the user has asked Claude to "update our data with the latest patch", or has invoked `process-patch-notes` immediately after this skill, **do not open a PR here**. Stop after step 12 (gates). Hand off to `process-patch-notes` — that skill will commit both `data/patch-notes.json` and `data/heroes/*.json` together and open the single combined PR.

In this mode, `git status` should show `data/patch-notes.json` as the only change in the working tree at hand-off time. Do not `git add`, do not commit, do not push, do not open a PR.

## Standalone PR

When invoked **standalone** — re-interpreting an earlier patch, fixing an interpretation error, or otherwise updating `data/patch-notes.json` without intending to apply hero edits — open a PR for just the patch-notes change:

```
BRANCH=patch-notes/$(date -u +%Y-%m-%d)
git checkout -b "$BRANCH"
git add data/patch-notes.json
git commit -m "Refresh patch-notes.json ($(date -u +%Y-%m-%d))"
git push -u origin "$BRANCH"
```

Open the PR with `gh pr create` whose body lists:

- New patches added to history (date + title).
- Existing patches whose `raw.text` differed (Blizzard edited).
- Any changes where `interpreted` was set to null and why.
- Any changes whose `mode` was unknown — flag for human review.
- Schema validation result.

## Safety rails

- Do **not** write `raw.text` other than what came out of the deterministic scrape — that's the source-of-truth for what Blizzard actually published.
- Do **not** delete patches from history. The history accumulates monotonically; even if Blizzard rotates a patch off their rolling page, our `data/patch-notes.json` keeps it.
- Do **not** edit `metadata.schema_version` here — that's owned by code-change PRs, not data-only refreshes.
- Do **not** use this skill to fix hero stats. That's `process-patch-notes` — separate concern.
- When the deterministic scrape fails (network error, HTML structure change), fix the scrape pipeline first; don't paper over it with manual JSON edits.
