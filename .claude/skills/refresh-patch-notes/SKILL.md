---
name: refresh-patch-notes
description: Refresh data/patch-notes.json with the latest Blizzard patch notes, applying AI judgment to interpret each natural-language change into structured fields (mode, subject, metric, from/to, etc.). First step of the patch-day flow — followed by process-patch-notes for hero stat updates. Manually invoked on patch days. Opens a PR for human review.
disable-model-invocation: false
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

!`npm run --silent patch-notes:dump-raw && head -n 4 .run/patch-notes-raw.md && echo '---' && wc -l .run/patch-notes-raw.md`

The dump script writes a faithful Markdown rendering of every post-cutoff patch to `.run/patch-notes-raw.md`. That file is the input — patches are introduced with `# <patch title>` and separated by `---`, with whatever section/hero/ability heading hierarchy Blizzard published preserved verbatim. Read it end-to-end; it's the ground truth.

The deterministic layer does **not** classify items into hero vs. general buckets and does **not** infer modes — that's all your job. Anything visible on Blizzard's page should be visible in the markdown; if a bullet is missing, the deterministic scrape is broken (escalate, do not paper over).

## Procedure

1. **Read the existing file** (if present): `data/patch-notes.json`. Each patch already in the file should be re-emitted unchanged unless Blizzard has edited the patch text since last refresh — patches are keyed by `date`. History is preserved across refreshes; older patches that have rotated off Blizzard's rolling page must remain in the published file.

   **Exclude joke patches** — Blizzard publishes April Fools "patch notes" in the same feed (e.g., the April 1, 2026 "Underwatch Patch Notes" with absurd fake changes like "Cassidy fires a piercing bullet whenever saying hello"). These don't reflect real game state. Identify by the patch title (`Underwatch`, `April 1` joke style) and/or by the absurdity of the bullets. Drop the entire patch from the output and note the exclusion in the PR body. If unsure, ask the user.

2. **Read the raw markdown**: `.run/patch-notes-raw.md`. Each patch starts at a `# <title>` heading and runs until the next `---` separator. For each patch:
   - Parse the date out of the title (e.g. "April 23, 2026" → `2026-04-23`).
   - Set `url: null` (Blizzard doesn't publish stable per-patch URLs).
   - Walk the markdown in document order; the heading hierarchy is your guide. Typical shape:
     ```
     ## <Section> (e.g. "Hero Balance Updates", "Stadium Hero Updates", "Bug Fixes")
     ##### <Hero>
     <Ability>
     - <bullet>
     ```
     But Blizzard's exact heading depths and labels shift patch-to-patch. **Do not assume a fixed depth.** Use heading text and visual context (a name that matches a hero in `data/heroes/` is a hero; a name that matches an ability is an ability) to classify each bullet.

3. **For each section heading you encounter**, decide a `mode` for the changes nested under it:
   - Section title contains "Stadium" → `stadium`.
   - Section is "Hero Balance Updates", "Hero Updates", "Map Updates", "Bug Fixes", "General Updates", or a season opener → `retail` unless its content is explicitly Stadium-only.
   - A bare role label like `Tank` / `Damage` / `Support` immediately following a Stadium block → `stadium`.
   - When in doubt, set `unknown` and leave a `notes` explaining on each change.

   Set `group_label` on the published section when meaningful (a single hero name when the section has one hero block; a topic like "Mystery Heroes Updates" for general sub-blocks). Else null. The published `title` should match the original section heading text verbatim.

4. **For each bullet, emit one `change`**:
   - `raw.text`: the bullet text exactly as rendered in the markdown (after stripping the leading `- `).
   - `interpreted`: judgment fields below.
   - **Subject classification** — use the nearest enclosing heading(s):
     - Hero heading visible immediately above (matches a slug in `data/heroes/`): `hero_slug` = that slug.
     - Ability heading visible above the hero (matches a `name` in `data/heroes/<hero>.json#abilities[]`): `subject_kind: 'ability'`, `subject_name: <ability name>`.
     - Ability heading suffixed with "– Minor Perk" / "– Major Perk", or a bullet whose only context is a perk name (matches `perks.minor[*].name` or `perks.major[*].name`): `subject_kind: 'perk'`, `subject_name: <perk name>` (strip the suffix from the name).
     - Bullet directly under a hero heading with no ability heading: `subject_kind: 'hero_general'`, `subject_name: <hero name>`.
     - Bracketed prefix in the bullet itself (`[Ravenous Vortex] cooldown reduction…`) names a specific ability — prefer that as `subject_name` and set `subject_kind: 'ability'` even if no ability heading is visible. Strip the bracketed prefix from `metric_phrase`.
     - No hero or ability context (e.g. a `Bug Fixes` general bullet about Custom Bindings): `subject_kind: 'system'` (or `'map'` for map sections, `'role'` for role passive bullets); `hero_slug: null`; `subject_name: <whatever short label fits the bullet>`.
   - **`subject_slug` field** (foreign key into the affected hero's data):
     - When `subject_kind` is `'ability'`: look up the ability in `data/heroes/<hero_slug>.json`'s `abilities[]` and copy its `slug` field. Don't derive — read.
     - When `subject_kind` is `'perk'`: look up in `perks.minor[*]` / `perks.major[*]` of the same hero and copy its `slug`.
     - When `subject_kind` is anything else (`hero_general`, `system`, `map`, `role`, `unknown`): set `subject_slug: null`.
     - If lookup fails (e.g. the patch mentions an ability not in the current scrape — common for new heroes mid-cycle, removed abilities, or post-patch renames), set `subject_slug: null` and add a note in the `notes` field. The `process-patch-notes` skill will skip such entries with "Skipped (ability not found)" — that's the correct fail-safe.

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
