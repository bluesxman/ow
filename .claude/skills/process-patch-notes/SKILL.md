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

Run the apply utility — it walks `data/patch-notes.json` oldest-first, edits hero JSONs in place per the rules below, and writes a structured report to `.run/apply-report.json` for the PR body:

!`npm run patch-notes:apply`

Pass `--since=YYYY-MM-DD` to limit scope, or `--dry-run` to preview without writing:

```
npm run patch-notes:apply -- --since=2025-12-09
npm run patch-notes:apply -- --dry-run
```

> **Why oldest-first**: each applied change writes `field = to`. When multiple patches touch the same field over time (e.g. Pharah Hover Jets `bonus_movement_speed` was 40% pre-April-14, became 30% in the April 14 patch), iterating oldest-first means the newest patch's value lands last and survives — natural last-write-wins by time.

The script implements these skip rules. Each skipped change appears in the report under its bucket; surface them in the PR body so a human can spot-check.

1. **Skip on**:
   - `change.interpreted === null` — the AI couldn't interpret it (`uninterpretable`).
   - `change.interpreted.mode !== "retail"` — Stadium / mixed / unknown don't apply to retail hero JSON (`mode=stadium` etc.).
   - `change.interpreted.blizzard_commentary` contains `"(6v6)"` — 6v6 sub-mode tuning isn't tracked in the schema (single value per field) (`6v6`).
   - `change.interpreted.subject_kind === "perk"` — perks carry only name+description (`perk`).
   - `change.interpreted.subject_kind` ∈ {`system`, `map`, `role`, `unknown`} — no hero target (`no-hero-subject`).
   - `change.interpreted.metric === null` or `to === null` — qualitative (`qualitative`).
   - `change.interpreted.hero_slug` not in `data/heroes/` (`hero-not-in-roster`).
   - The targeted ability isn't in `hero.abilities[]` (`ability-not-found`) — the patch interpretation may have a wrong subject_slug; cross-check against `change.raw.text` before fixing upstream.
   - `metric` is in the patch enum but not on the targeted ability object (`ability-field-missing`) — schema gap; don't invent the field.
   - `metric === "other"` — not in the ability schema (`ability-metric-other`).

2. **Apply only when both safety rails clear** (these encode the April 2026 backfill's lessons):
   - **Composite-string fields** (`"10 (direct hit) / 25 - 7.5 (splash, enemy) / ..."`) — skip with `composite-slice-ambiguity`. Rewriting a single slice without per-slice metadata risks corrupting the others.
   - **Qualified-string fields** (`"9 seconds / -2 seconds per enemy hit"`, `"25% of damage dealt"`, `"35 per second"`) — skip with `qualified-string-ambiguity`. Bare-numeric `to` would silently strip the qualifier.
   - **`from`-value reconciliation** — the patch's `from` MUST match the existing stored value (numeric leading-token equality, with optional unit-bearing string OK). Skip with `value-mismatch` otherwise. Rationale: if Fandom has already drifted past `from`, applying `to` blindly corrupts a later state.
   - **Unit-preserving coercion** — when existing is `"9 seconds"` and `to` is the bare number `12`, write `"12 seconds"` (don't drop the unit).

3. **Hero-general writes** target `hero.stats.{health,armor,shields}` only. Other metrics (`damage`/`cooldown` at hero-general level usually mean a passive) skip with `hero-general-unsupported-metric`.

4. **JSON shape preserved** — no key reordering, no added fields, no removed fields.

After applying, rebuild aggregates so `data/index.json` and the top-level rollups stay in sync:

!`npm run patch-notes:rebuild-aggregates`

## Fandom drift audit

After applying, check whether Fandom's stored values still match the patch history's tip-of-tree. The audit compares each retail change's `to` against the corresponding ability/stat field, keeps only the LATEST patch per `(hero, subject)` pair, and buckets by category:

!`npm run patch-notes:audit-fandom`

Output buckets:

- **MATCHES** — Fandom matches `patch.to`. Up to date.
- **STALE** — Fandom matches `patch.from`. The latest patch on this field was missed by Fandom; warrants a manual edit (or a follow-up `process-patch-notes` run that catches it).
- **DRIFT** — Fandom matches neither `from` nor `to`. Spot-check by hand. Most are false positives: composite-string slices the audit doesn't peer inside (`"45 (swing) / 120 (overhead strike)"` contains `120` but the audit only checks the leading number), schema-naming mismatches (rate_of_fire vs. burst-time), multiplier-vs-absolute representations (Mercy Flash Heal "3x" stored as `60 / 120`), or values hidden in `modifies[]` sub-objects (Sierra Tracking Shot). Real Fandom errors are rare but present (the April 2026 backfill caught Anran Ignition burning duration `3s → 4s` this way).
- **N/A** — couldn't compare (ability removed, field renamed).

The audit doesn't write anything; surface notable STALE/DRIFT entries in the PR body for reviewer attention.

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
