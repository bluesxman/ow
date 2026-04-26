---
name: process-patch-notes
description: Apply Blizzard patch-note stat changes to data/heroes/*.json. Reads data/patch-notes.json (the structured, AI-interpreted patch history produced by refresh-patch-notes) and applies retail quantitative changes to per-hero JSON. Manually invoked on patch days, after refresh-patch-notes has been run and reviewed. Opens a PR for human review.
disable-model-invocation: false
allowed-tools: Bash(npm run patch-notes:*) Bash(npm run typecheck) Bash(npm run lint) Bash(npm test) Bash(jq *) Bash(git *) Bash(gh pr *) Read Edit Grep Glob
argument-hint: [--since=YYYY-MM-DD]
effort: high
---

# process-patch-notes

Applies quantitative patch-note changes to `data/heroes/*.json`. The input is the published, AI-interpreted patch history at `data/patch-notes.json` — produced by the [refresh-patch-notes](../refresh-patch-notes/SKILL.md) skill.

Fandom's wiki (the source of every ability/perk/stat in the per-hero JSON) lags real patches by days or weeks. Blizzard's patch notes are authoritative — when they conflict with the Fandom-derived JSON, the patch notes win. This skill is the human-in-the-loop bridge that lets us ship corrected data before the next full Fandom-driven scrape catches up.

When you bump `data/`, also bump `metadata.schema_version` per the semver policy in [AGENTS.md](../../../AGENTS.md#data-versioning-semver): patch-only changes (this skill's normal mode) get a **patch** bump.

## Patch-day order

This is the second skill in the patch-day flow:

1. **[refresh-patch-notes](../refresh-patch-notes/SKILL.md)** updates `data/patch-notes.json` with the latest patches (does not commit when chained — stages locally and hands off).
2. **process-patch-notes** (this skill) reads `data/patch-notes.json`, edits `data/heroes/*.json`, and opens **a single combined PR** containing both files.

Run this skill only after `refresh-patch-notes` has produced a current `data/patch-notes.json`. The combined PR shows the full causal chain in one diff — patch interpretation alongside the applied hero stat numbers — so reviewers can verify both halves at once.

When invoked **standalone** (re-applying an old patch without re-interpreting it), `data/patch-notes.json` is unchanged and the PR contains hero edits only. That's fine.

## Preflight

!`git status --porcelain`

!`git rev-parse --abbrev-ref HEAD`

!`npm run --silent patch-notes:validate`

!`jq '{patch_count: (.patches | length), patches: [.patches[] | {date, title, change_count: ([.sections[].changes[]] | length)}]}' data/patch-notes.json`

The validate command exits non-zero if `data/patch-notes.json` is malformed — abort and ask the user to fix the upstream `refresh-patch-notes` PR before continuing.

## Update algorithm

Default scope: **all patches in `data/patch-notes.json`** that haven't been applied to hero JSONs yet. Pass `--since=YYYY-MM-DD` to limit to patches on or after a date — useful when a previous run of this skill already applied earlier patches.

For each patch in `data/patch-notes.json` **(oldest first)**, for each section, for each `change`:

> **Why oldest-first**: each applied change writes `field = to`. When multiple patches touch the same field over time (e.g. Pharah Hover Jets `bonus_movement_speed` was 40% pre-April-14, became 30% in the April 14 patch), iterating oldest-first means the newest patch's value lands last and survives — natural last-write-wins by time. Iterating newest-first would leave the oldest value in place, which is wrong.

1. **Skip the change entirely** if any of the following:
   - `change.interpreted === null` — the AI couldn't interpret it. Surface in PR body under "Skipped (uninterpretable)" with the raw text.
   - `change.interpreted.mode !== "retail"` — Stadium / mixed / unknown modes don't apply to retail hero JSON. Surface under "Skipped (mode=stadium)" or similar.
   - `change.interpreted.blizzard_commentary` contains `"(6v6)"` — 6v6 sub-mode tuning isn't tracked in the schema (single value per field). Surface under "Skipped (6v6 variant)".
   - `change.interpreted.subject_kind === "perk"` — perks carry only name+description in `hero.perks.*`, not numeric stats. Surface under "Skipped (perk numeric not tracked)".
   - `change.interpreted.subject_kind === "system"` or `"map"` or `"role"` or `"unknown"` — not directly applicable to a single hero's stats. Surface under "Skipped (no hero subject)".
   - `change.interpreted.metric === null` — qualitative behavior change with no numeric handle. Surface under "Skipped (qualitative)".
   - `change.interpreted.to === null` — no target value to write. Surface under "Skipped (qualitative)".
   - `change.interpreted.hero_slug` doesn't match any file in `data/heroes/` (PTR-only, recently-removed, or new hero not yet scraped). Surface under "Skipped (hero not in roster)".

2. **Apply the change** when none of the skip rules fire:
   - Read `data/heroes/<change.interpreted.hero_slug>.json`.
   - **Ability change** (`subject_kind === "ability"`): locate the entry in `hero.abilities[]` whose `slug` equals `change.interpreted.subject_slug` (exact match — the slug is a foreign key, not a normalized display name). Set the field named `change.interpreted.metric` to `change.interpreted.to`.
     - Composite-string slice handling: when the existing field value is a slash-separated string (e.g. `"10 (direct hit) / 25 - 7.5 (splash, enemy) / 12.5 - 3.75 (splash, self)"`), rewrite **only** the matching slice based on `change.interpreted.metric_phrase` (e.g. `"explosion damage"` → splash slice). If the slice mapping is ambiguous, skip the change and surface under "Skipped (composite-slice ambiguity)".
     - If `change.interpreted.subject_slug` doesn't match any ability in `hero.abilities[]`, surface under "Skipped (ability not found)" — this shouldn't happen if `refresh-patch-notes` interpreted correctly, so flag for the human to spot-check. Cross-check against `change.raw.text` and `change.interpreted.subject_name` (display label) before assuming the patch-notes interpretation is wrong.
   - **Hero-level change** (`subject_kind === "hero_general"`): only when `change.interpreted.metric` is one of `health`, `armor`, `shields`. Set `hero.stats.<metric>` to `change.interpreted.to`. Skip other metrics (e.g. `damage`, `cooldown` at hero-general level usually means a passive — not in the schema today).

3. **Preserve JSON shape**: do not reorder keys, do not add fields, do not remove fields.

4. **Audit trail**: when in doubt, fall back to `change.raw.text`. If the `interpreted` layer's call seems wrong (e.g. mismatched ability name), prefer the raw text and skip the change with a note rather than silently applying a wrong number.

After all per-hero edits:

!`npm run patch-notes:rebuild-aggregates`

## Quality gates

Before commit, run:

!`npm run typecheck`

!`npm run lint`

!`npm test`

If any gate fails, stop. Investigate (most likely cause: a hero JSON edit broke something — typically a copy-paste error on a composite string). Fix and re-run gates before committing.

## Branch and PR

The combined PR contains whatever's in the working tree — typically both `data/patch-notes.json` (from the chained `refresh-patch-notes` step) and the per-hero JSONs this skill just edited.

```
BRANCH=patch-day/$(date -u +%Y-%m-%d)
git checkout -b "$BRANCH"
git add data/
git commit -m "Patch-day update ($(date -u +%Y-%m-%d))"
git push -u origin "$BRANCH"
```

Then open a PR with `gh pr create` whose body contains:

- **Patch-notes refresh summary** (when `data/patch-notes.json` was modified):
  - New patches added to history (date + title).
  - Existing patches whose `raw.text` differed (Blizzard edited).
  - Any changes where `interpreted` was set to null and why.
  - Any changes whose `mode` was unknown — flag for human review.
- **Hero stat changes**:
  - Per-hero change summary — one bullet per field touched, in the form `Cassidy Peacekeeper damage: 75 → 70 (April 17 patch)`.
  - A "Skipped" section grouped by skip reason: stadium, 6v6, perk-numeric, qualitative, no-hero-subject, hero-not-in-roster, ability-not-found, composite-slice-ambiguity, uninterpretable. Each entry shows the patch date and the raw text.
- Gate results (`typecheck`, `lint`, `test` all OK).
- Schema validation result for `patch-notes.json`.

## Scope and known gaps

What this skill **does** write to:

- The matching `hero.abilities[i].*` numeric/string field for changes with `subject_kind === "ability"` and a known metric.
- `hero.stats.health` / `hero.stats.armor` / `hero.stats.shields` for `subject_kind === "hero_general"` numeric bullets.

What this skill explicitly **does not** write to (skip + note):

- **Stadium hero updates.** Stadium is a separate game mode with Powers, Items, currency costs, and bonuses that don't exist in `data/heroes/*.json`.
- **(6v6) variants.** The schema stores a single flat value per field; bullets where `blizzard_commentary` contains `"(6v6)"` (or any `(<mode>)` qualifier) are skipped.
- **Perk numeric tweaks.** Perks in `hero.perks.*` carry only `name` and `description`, not raw numbers.
- **Qualitative behavior changes.** Anything where `interpreted.metric` or `interpreted.to` is null — the next scrape will pick up the descriptive shift from Fandom.

If a patch repeatedly references a quantity that isn't tracked, that's a signal the schema needs to grow — surface it in the PR body's "Skipped" section so a follow-up can add the field to the scrape pipeline rather than papering over the gap here.

## Safety rails

- **Do not touch** `metadata.last_updated`, `metadata.patch_version`, `metadata.hero_count`, `metadata.heroes_failed`, `metadata.fandom_failed`. Those are owned by the scrape pipeline; `rebuild-aggregates` carries the existing values through verbatim. `metadata.schema_version` should be bumped to a new patch version (e.g. `5.0.0` → `5.0.1`) when this skill commits data changes — but only when the bump reflects what is on `main`, not what is in flight. If a schema-changing PR is open and unmerged, do not preemptively bump for that. See [AGENTS.md](../../../AGENTS.md#data-versioning-semver).
- **Do not touch** `data/ATTRIBUTION.md`, `data/CHANGELOG.md`, or `data/LICENSE`.
- **Read-only on `data/patch-notes.json`** — the upstream `refresh-patch-notes` skill owns writes to that file. This skill consumes it as input and may include it in the combined commit (when chained), but never edits it directly.
- **Do not touch** descriptive fields: `hero.abilities[*].description`, `hero.perks.*.name`, `hero.perks.*.description`, `hero.role`, `hero.portrait_url`. If a patch rewrites ability behavior qualitatively or renames an ability, skip and note in the PR body — the next Fandom-driven scrape will pick the new wording up.
- If a percent delta is in the raw text but the interpreted layer didn't compute `to` (e.g. base value unclear), skip and note — don't guess.
- Never merge the PR. Human review is the safety net.
