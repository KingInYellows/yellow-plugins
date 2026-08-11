# Feature: Migrate the `workflows:` command namespace to `flow:`

## Overview

Rename the 10 commands under the `workflows:` namespace to `flow:`, because
native Claude Code's built-in `/workflows` occupies the prefix and typing
`/workflows` no longer narrows autocomplete to these commands. All 10 still
resolve when typed in full — the defect is ergonomic, not functional.

Decision record:
[`docs/brainstorms/2026-08-10-workflows-to-flow-namespace-migration-brainstorm.md`](../docs/brainstorms/2026-08-10-workflows-to-flow-namespace-migration-brainstorm.md).
Approach A was selected: rename immediately, no forwarders (usage is
author-only), land a machine-checked CI gate in the same PR as the rename,
then sweep prose across follow-up PRs against a shrinking allowlist.

**This plan corrects five material errors in that brainstorm.** They are called
out inline and summarized in [Corrections to the Brainstorm](#corrections-to-the-brainstorm).

## Problem Statement

### Current Pain Points

Typing `/workflows` in Claude Code no longer produces a useful autocomplete
shortlist, because the native built-in occupies that exact prefix. The full
command name must be typed every time.

### User Impact

Author-only. There is no external install base for this marketplace, which is
what rules out forwarders and deprecation stubs as unearned complexity.

### Success Criterion

Typing `/flow` narrows to exactly these 10 commands. This is the property the
migration exists to deliver — a green CI gate proves the *absence of a string*,
which is not the same thing. See [Acceptance Criteria](#acceptance-criteria).

## Proposed Solution

### Key Design Decisions

- **Namespace word `flow:`** — 4 characters, unique on `fl` against every
  occupied namespace in this repo. Chosen over `pipeline:`, `chain:`, and
  `cascade:` on typing-ergonomics grounds, which is the actual success
  criterion here.
- **The invocable name comes from `name:` frontmatter, not the directory.**
  Verified: `plugins/yellow-council/commands/council/` contains `council.md`
  (`name: council`) and `setup.md` (`name: council:setup`) — same directory,
  different namespaces. The directory rename is convention-following only and
  breaks nothing.
- **No forwarders.** Author-only usage; the deprecation machinery has no one to
  protect.
- **Gate before assertion.** This repo has documented repeat failures at
  exactly this shape — `sweep-incomplete-application-orphaned-jargon.md`
  ("sweep misses N+1", #664/#666) and `doc-fix-mechanical-verification-gap.md`
  ("assertion is not a check", 8 occurrences, #677). Three independent scans
  during brainstorm and planning each declared the reference census complete
  and each missed a location class (`.github/`, then `RESEARCH/`). Completeness
  must be machine-checked.

### Trade-off Accepted

`/workflows:*` stops resolving once the renamed version is published and
installed. Per [Bootstrap Safety](#bootstrap-safety) this does not happen at
merge time, so it does not block authoring the follow-up PRs.

## Corrections to the Brainstorm

| # | Brainstorm said | Actually |
|---|---|---|
| 1 | Functional surface is 10 `name:` fields | Also **9 `skill: "workflows:*"` runtime dispatch targets** in 3 plugins, **6 `description:` fields** rendered in the autocomplete picker, and ~9 runtime-emitted log/error strings |
| 2 | Two changesets (yellow-core, yellow-research) | **Four plugins** have functional changes in PR1; up to **seven** need changesets across the sweep PRs |
| 3 | New validator "needs an `ERROR-*` code or `validate:error-codes` fails" | Backwards. `lint-error-codes.js` fails when a script **hard-codes a literal** catalog code. Register in `errorCatalog.ts`, reference via string concatenation (`validate-solutions.js:22-24,83-87`) |
| 4 | Four permanent decoys; terminal state is exactly those four | Falsified. `.changeset/*.md`, root `CHANGELOG.md`, and this migration's own solution doc all legitimately name the old namespace |
| 5 | ~487 refs across four location classes | Superseded by the Reference Census below (re-derived against `main@72ca006d`), which is authoritative: **773** anchored `/workflows:<cmd>` references across **12** location classes. (An intermediate estimate of "489 across eight classes, `RESEARCH/` at 6, `docs/brainstorms/` at 179" was itself superseded by that re-derivation — the census corrects `RESEARCH/` to **10** and `docs/brainstorms/` to **173**.) |

## Reference Census

Re-derived 2026-08-10 against `main@72ca006d` (`rg --hidden`, command names
restricted to the 10 being renamed). The original brainstorm census used
`rg` without `--hidden`, which is why `.github/` was missed twice.

**Two measures, because the gate bans both shapes (§1.4):** slash-anchored
`/workflows:<cmd>` is the *prose* surface; unanchored `workflows:<cmd>` is the
superset that also catches `skill:` dispatch values, log tags, and
plugin-qualified refs. **The allowlist counts must come from the unanchored
matcher** — the one the gate actually enforces with.

| Location | `/workflows:` | `workflows:` | Disposition |
|---|---:|---:|---|
| `plans/complete/` | 220 | 325 | **exclude — archived plan records** |
| `plugins/` (excl. CHANGELOGs) | 197 | 280 | sweep — **PR2** |
| `docs/brainstorms/` | 173 | 268 | **exclude — historical** |
| `docs/` (other) | 85 | 92 | sweep — **PR3** |
| `plugins/*/CHANGELOG.md` | 58 | 70 | **exclude — release history** |
| `docs/solutions/` | 15 | 27 | **exclude — historical narrative** |
| `RESEARCH/` | 10 | 14 | sweep — **PR3** |
| `AUDIT_REPORT.md` | 5 | 5 | **exclude — dated snapshot** |
| `plans/` (open) | 3 | 7 | **exclude — this plan doc itself** |
| root `*.md` (AGENTS, CONTRIBUTING) | 3 | 3 | sweep — **PR1** |
| `.github/` | 2 | 2 | sweep — **PR1** |
| root `CHANGELOG.md` | 2 | 2 | **exclude — bot-generated history** |
| **Total** | **773** | **1095** | **sweep scope ≈ 391 unanchored** |

Corrections this re-derivation makes to the brainstorm's numbers: `RESEARCH/`
is 10 not 6, `AUDIT_REPORT.md` is 5 not 2, and two whole classes
(`plans/complete/`, `plugins/*/CHANGELOG.md`) were never counted — they were
named as exclusions without a magnitude, which is how an exclusion silently
grows. PR2's headline "197 refs" is the anchored figure; **the gate will see
280**.

Ruling `docs/brainstorms/` historical is the single largest scope decision in
this plan — it removes 173 of 773 references. The discriminator is *"is this
loaded into a future session or cited as authoritative instruction, versus a
dated closed record of a past decision?"* — not "is it old". Brainstorms are
dated decision records in the same class as `plans/complete/**`, which the
brainstorm already excluded; rewriting them would falsify the record of what
was decided when.

`docs/maintenance/plugin-audit-2026-06-10.md` is a frozen audit snapshot
despite living under a directory whose name suggests living docs — classify
per-file, not by directory.

## Implementation Plan

### PR1 — Rename, runtime surfaces, always-loaded instructions, and the gate

Everything here is functional or instruction-bearing. Nothing in PR1 is
deferrable to the sweep.

**1.1 — Directory moves (separate commit, no content edits)**

- [x] `git mv plugins/yellow-core/commands/workflows plugins/yellow-core/commands/flow` (9 files)
- [x] `git mv plugins/yellow-research/commands/workflows plugins/yellow-research/commands/flow` (1 file)
- [x] `git mv plugins/yellow-core/references/workflows-work plugins/yellow-core/references/flow-work`
- [x] Commit with **no content changes**, so Git's 50% rename-similarity
      threshold is met and `git log --follow` continuity survives
      (commit `5cc76058` — all 11 files recorded at 100% similarity)

**1.2 — Functional renames (second commit)**

- [x] `name:` frontmatter on all 10 files → `flow:<cmd>`
- [x] `description:` frontmatter on the 6 files that embed the old namespace —
      these render in the autocomplete picker, so a stale one is a regression
      of this migration's own goal: `brainstorm.md:3`, `decompose.md:3`,
      `spec.md:3`, `expand-shell.md:3`, `pick-next-shell.md:3`,
      `yellow-research/.../deepen-plan.md:3`
- [x] The 9 `skill: "workflows:*"` dispatch targets — these break at runtime:
      `yellow-linear/commands/linear/work.md:183,188`;
      `yellow-review/commands/review/sweep-all.md:201`;
      `yellow-core/.../plan.md:582,583,584`;
      `yellow-core/.../pick-next-shell.md:104,125,127`
- [x] The plugin-qualified refs. Re-derived mechanically: **12 total**, but
      the split differs from the brainstorm's (`brainstorm` ×5, `compound` ×3,
      `work` ×2, `deepen-plan` ×2 — not `compound` ×4 / `work` ×1). Only the
      **9 under `plugins/`** are PR1 scope
      (`yellow-core/CLAUDE.md:166` ×2, `skills/debugging/SKILL.md` ×7); the
      remaining 3 are historical provenance under `docs/research/` (×2) and
      `RESEARCH/upstream-snapshots/` (×1) and belong to PR3, where box 3.3
      already names the MANIFEST file
- [x] Runtime-emitted strings inside the 10 renamed files: log tags
      `plan.md:129,173`, user-facing error text `work.md:217,566`, `printf`
      paths at `decompose.md:50`, `pick-next-shell.md:24`,
      `expand-shell.md:148`. **Three more found than the brainstorm listed** —
      `deepen-plan.md:41,123,283` are the same class (user-facing "Run
      /workflows:plan first" error text); the brainstorm's list covered only
      `yellow-core`
- [x] `work.md:272`'s write-template `<!-- Updated by workflows:work -->` —
      otherwise `/flow:work` stamps the old name into every new plan file
- [x] `work.md:877`'s `${CLAUDE_PLUGIN_ROOT}/references/workflows-work/...`
      path → `references/flow-work/`. **Must land in the same PR as the 1.1
      directory move** — never split across PRs, or a merged intermediate
      state has the command silently failing to load its own reference doc.
      (Within PR1 it lands in this commit, not 1.1's, so 1.1 stays a pure
      rename for `git log --follow`; the intermediate commit is briefly
      inconsistent, which affects `git bisect` but not any merged state.)
      Nothing validates this coupling — AGENTS.md:274-276's slug convention is
      documentation-only. The moved reference doc's own header
      (`flow-work/graphite-command-reference.md:3`, "Loaded by `/workflows:work`
      (commands/workflows/work.md)") was fixed here too rather than deferred to
      PR2, so the moved unit stays self-consistent
- [x] Cross-references between the 10 commands, including the pipeline spec at
      `deepen-plan.md:24` (`/workflows:plan → /workflows:deepen-plan →
      /workflows:work`) — a user following the command's own instructions
      breaks if this is stale

**1.3 — Always-loaded instruction files (same PR, not the sweep)**

These are read as authoritative by every agent authoring PR2–4, including the
agent executing this plan. Leaving them stale self-poisons the follow-up work.

**Scope ruling — per-plugin `plugins/<name>/CLAUDE.md` files stay in PR2.**
They are auto-loaded too, so the 1.3 rationale reaches them, and PR1 leaves
`plugins/yellow-core/CLAUDE.md` internally inconsistent: its Commands list
still reads `/workflows:*` while its debugging-skill line now reads
`/yellow-core:flow:brainstorm`. Held to PR2 anyway on two grounds. First,
scope: those files are *plugin content* (they ship in the plugin, so editing
them is a plugin change requiring a changeset), whereas every 1.3 file is
repo-level authoring instruction. Second, blast radius: the inconsistency is
descriptive prose about which commands exist, not an instruction that would
mislead a sweeping agent into *writing* the old namespace — and it is
allowlisted at an exact count, so PR2 cannot quietly half-fix it.

- [x] `AGENTS.md:392`
- [x] `CONTRIBUTING.md:342,411`
- [x] `docs/CLAUDE.md:89` — loaded as project context every session
- [x] `.github/pull_request_template.md:23` — renders on every future PR
- [x] `.github/workflows/validate-schemas.yml:1191` — active CI config

**1.4 — The CI gate**

- [x] Register a new error code in
      `packages/domain/src/validation/errorCatalog.ts`. Check the new category
      prefix for substring collision against every existing prefix
      (`lint-error-codes.js:64-103` enforces this; `ERROR-DIST` vs `ERROR-DISC`
      was the deliberate near-miss test case). Registered `NAMESPACE`
      (`-001` stale reference, `-002` allowlist count drift, `-003` allowlist
      path missing) plus `ErrorCategory.NAMESPACE_MIGRATION`. **The obvious
      short prefix `NS` is unsafe** — it is a substring of the existing `INST`
      and would have failed `findPrefixCollisions`
- [x] Reference the code in the script via **string concatenation**, never a
      literal — `lint-error-codes.js:142-153` fails CI on a literal
      (pattern: `validate-solutions.js:83-87`). Verified: `lint-error-codes.js`
      reports "no scripts/ file re-implements any of the 52 catalog error
      codes" with the new script present
- [x] Ban **three shapes**, not one. A `/`-anchored-only pattern misses 21 of
      the functional sites. Implemented as a single **unslashed** matcher,
      which is the superset that subsumes all three; each shape is
      independently probed in the exercise below:
      - bare `/workflows:<cmd>`
      - unslashed `workflows:<cmd>` inside `skill: "..."` values and log tags
      - plugin-qualified `yellow-core:workflows:<cmd>` /
        `yellow-research:workflows:<cmd>`
- [x] Do **not** harden detection against the singular `workflow:` — matching
      `workflows:` requires the literal `s`, so that false positive is
      structurally impossible in the *gate*. The `flow`/`workflow` substring
      hazard lives entirely in the sweep's **replace** step. No hardening was
      added; probe C confirms `yellow-core:workflow:knowledge-compounder` and
      bare `workflow:work` exit 0. The matcher additionally enumerates the 10
      command names with a `(?![a-z-])` tail guard, so `workflows:worker` and
      `workflows:planetary` also do not trip it (probe D)
- [x] Allowlist keys on path **plus a per-command occurrence fingerprint**
      (`"decompose.md": { "work": 8, "plan": 4 }`). A path-only allowlist is
      non-monotonic — sweeping N−1 of N refs leaves the entry valid and hides
      partial completion. A path-plus-*total* allowlist is still blind to a
      same-count substitution: dropping one `workflows:work` reference while
      introducing a `workflows:plan` reference in the same file leaves the
      total unchanged, so the gate reports nothing (raised in review on PR1;
      the fingerprint is what closes it, and the exercise script probes that
      exact substitution). **The fingerprints must be emitted by the script
      itself** (a `--write-allowlist` mode), never transcribed from an ad-hoc
      `rg` run: the census above shows anchored and unanchored differ by ~40%,
      so hand-copied counts are wrong on day one and the hard-error rule below
      cannot catch a wrong *number*. PR2/PR3's "shrink the allowlist" steps
      re-run that same mode
- [x] A declared allowlist path missing from disk is a **hard error**, per the
      `MEMORY_PROTOCOL_SENTINEL` precedent
      (`validate-agent-authoring.js:129-179`). Without this the allowlist rots
      silently as PR2–4 delete entries
- [x] Walk the **whole repo from the root**, not a subtree — explicitly
      reaching `.github/`, `RESEARCH/`, and root `*.md`. Every existing
      validator roots at `PLUGINS_DIR` (`validate-agent-authoring.js:15`),
      which is why three prior scans missed classes. Traverse **hidden
      directories** — the brainstorm's census missed `.github/` twice purely
      because `rg` skips dotdirs by default
- [x] Permanent exclusions: singular `yellow-core:workflow:*` agent namespace
      (22 refs), `plugins/*/CHANGELOG.md`, root `CHANGELOG.md`,
      `plans/**` (open plans and `plans/complete/**` alike — dated records,
      and this migration's own plan doc lives there), `docs/brainstorms/**`,
      `docs/solutions/**`, `docs/maintenance/plugin-audit-2026-06-10.md`
      (frozen snapshot — the per-file classification the census section
      demands), `AUDIT_REPORT.md`, `.changeset/**`, plus `node_modules/`
      and `.git/`
- [x] Wire into `validate:schemas` in `package.json:20`, plus a focused
      `validate:flow-namespace` script and the two matching entries in
      `CLAUDE.md`'s Common Commands list.

      **`package.json` alone would have shipped the gate dead.** Nothing in
      CI runs `pnpm validate:schemas` — `validate-schemas.yml` dispatches
      nine *matrix targets* that each invoke validators directly, which is
      why the `authoring` target's own comment says its validators "were
      previously only run locally via `pnpm validate:schemas` … never
      enforced on a PR". The gate is therefore added to the `authoring` arm
      of **both** `validate-schemas.yml` and `validate-schemas-fork.yml`
      (fork PRs mirror that arm and would otherwise get weaker enforcement).

      The workflow's `paths:` filter also had to widen. It matched
      `scripts/**/*.js` but not `scripts/**/*.json`, and covered
      `docs/solutions/**` but not `docs/**`, `RESEARCH/**`, or root `*.md` —
      so **PR3 would not have triggered the workflow at all** (it touches
      only docs/, RESEARCH/, and the `.json` allowlist). Widened on both the
      `pull_request` and `push` triggers. Trade-off accepted: the nine-job
      matrix now also runs on docs-only PRs
- [x] `sed -i 's/\r$//'` the new script — WSL2 produces CRLF, which blocks
      merges here. Applied to both `validate-flow-namespace.js` and the
      generated `flow-namespace-allowlist.json`
- [x] **Exercise the gate before shipping it.** Reintroduce a `workflows:<cmd>`
      reference into a non-allowlisted file, confirm the script exits non-zero
      naming that file, then revert. Do this in PR1, not PR4 — a gate that
      ships unexercised is exactly the
      `codex-distribution-pipeline-silent-gaps.md` failure mode this plan
      cites, which produced zero CI signal for months. Also confirm the
      inverse: a clean tree exits zero.

      **Result — 11/11 probes passed against the real repo, all reverted:**
      clean tree → 0; each of the three banned shapes in a non-allowlisted
      file → 1 with `ERROR-NAMESPACE-001`; singular `workflow:` and
      `workflows:worker` → 0 (no false positive); inflated allowlist count →
      1 with `-002`; **same-total command substitution inside an allowlisted
      file → 1 with `-002`** (the probe for the per-command fingerprint —
      a total-only allowlist passes this case); allowlisted-but-now-clean
      file → 1 with `-002`; allowlisted path missing from disk → 1 with
      `-003`; tree restored → 0.
      Probe script retained at `scripts/exercise-flow-namespace-gate.sh` so
      PR2–PR4 can re-run it after each sweep

**1.5 — Changesets (4 plugins)**

- [x] `yellow-core` — `minor` (`.changeset/flow-namespace-rename.md`)
- [x] `yellow-research` — `minor` (same changeset file, per this repo's
      multi-package changeset precedent)
- [x] `yellow-linear` — `patch` (dispatch string only)
- [x] `yellow-review` — `patch` (dispatch string only)

### PR2 — `plugins/` prose sweep (197 refs, 43 files, 7 plugins)

- [x] 2.1: Sweep with an **anchored** pattern. Unanchored replace corrupts
      `workflow` → `floww`; `\b` alone is insufficient
      (`mcp-tool-rename-prefix-collision.md`). Used `perl`, not `sed`, so the
      replacement carries the same `(?![a-z-])` tail guard the gate matches
      with — `sed` has no lookahead. 60 refs across 24 files, 6 plugins
      (re-derived from this PR's own diff; `gt-workflow` and `yellow-research`
      ended up swept in PR1 during review, so they are counted there).

      **Found a gate blind spot by hand:** `plugins/yellow-core/CLAUDE.md`
      documented the namespace as the glob `` `/workflows:*` ``, which matched
      none of the gate's 10 enumerated command names. This is the
      "sweep misses N+1" mode the gate exists to prevent, so the matcher was
      widened to ban the collective forms `workflows:*` and `workflows:<cmd>`.
      That rule then needed a `(?!\*)` guard: markdown bold puts `**` right
      after a colon-terminated phrase (`**Template-driven workflows:**`), and
      a bare `\*` matched three of those as false positives
- [x] 2.2: Verify with a prefix-bleed grep for corrupted hybrids afterward.
      Zero hits for `floww`/`flowflow`/`workflows-flow`/`flow:flow`. Every
      `flow:` token in `plugins/` resolves to one of the 10 command names,
      the one `flow:*` glob, or three legitimate prose uses ("shares the
      `flow:` namespace")
- [x] 2.3: Remove swept paths from the gate allowlist in the same commit —
      regenerated via `--write-allowlist`, never hand-edited. 41 files /
      157 refs → **17 files / 109 refs**, now entirely `docs/` (13 files, 84
      refs) and `RESEARCH/` (4 files, 25 refs). These are the validator's own
      totals, not a transcription — the baseline moved when PR1's review
      pulled the `gt-workflow` and `yellow-research` sweeps forward, and the
      remaining count rose by 7 when the glob rule learned the markdown-
      escaped spelling `workflows:\*`, which had been invisible to it
- [x] 2.4: Changeset (`patch`) for **every** plugin touched — CI keys on
      `plugins/` paths, not semantics. **6 plugins**: the 7 this plan
      predicted, minus `gt-workflow` and `yellow-research` (swept in PR1,
      bumped by PR1's changeset), plus `yellow-docs`, which had one uncounted
      reference. Derived from the commit's diff, not from `git status`, so a
      concurrently-dirty tree cannot inflate it

### PR3 — `docs/` (85 anchored / 92 unanchored) + `RESEARCH/` (10 / 14)

**Known gate blind spot for this PR to close by hand.**
`docs/research/repo/background-compounding-triggers-repo-audit.md` names
`/workflows:review-staged`, which the gate's `(?![a-z-])` tail guard drops
because `review-staged` extends the command name `review`. It is a
*pre-existing* error either way — the command has always been
`/compound:review-staged`, never `/workflows:review-staged` — so the correct
fix is the right namespace, not `flow:`. The tail guard is deliberate (it is
what keeps `workflows:worker` from tripping the gate), so this is a trade the
gate makes knowingly, not a bug to fix in the matcher.

- [ ] 3.1: Sweep `docs/` excluding `brainstorms/` and `solutions/`
- [ ] 3.2: `RESEARCH/MERGE_PLAN.md`, `RESEARCH/01-plugin-inventory.md` — live
      analysis, sweep
- [ ] 3.3: `RESEARCH/upstream-snapshots/<sha>/MANIFEST.md:7` — self-authored
      provenance metadata, not vendored content; sweep-safe
- [ ] 3.4: Shrink allowlist

### PR4 — Terminal condition

- [ ] 4.1: Allowlist contains **only** the permanent exclusions
- [ ] 4.2: Add the standing dispatch-resolution validator (see
      [Pre-existing Blind Spot](#pre-existing-blind-spot-not-introduced-by-this-migration))
- [ ] 4.3: `/flow` autocomplete check on a clean install

## Technical Specifications

### Bootstrap Safety

Commands are served from `~/.claude/plugins/cache/yellow-plugins/yellow-core/1.27.2/`,
**not** from the worktree — verified: the cache still holds all 9
`name: workflows:*` values. Renaming in the repo does not change the live
session's commands until a published version bump plus
`/plugin marketplace update`. `/workflows:*` therefore keeps working
throughout the sweep, and there is **no window where the tooling needed to
author PR2–4 is unavailable**. This is what makes the no-forwarder decision
safe.

### Validator Coupling — none

- `validate-plugin.js` — its path check (`lib/plugin-rules.js:121-141`) is
  inert; neither plugin sets a `commands` key in `plugin.json`
- `validate-setup-all.js`, `generate-manifests.js` — do not touch command names
- `plugin.json` / `marketplace.json` — do not enumerate command names
- `validate-agent-authoring.js:149,153,1006` — literal `workflows` appears only
  in prose comments; they go stale but break nothing

### Pre-existing Blind Spot (not introduced by this migration)

`SKILL_REF_RE` at `validate-agent-authoring.js:1014` is
`/\bskill:\s*"([a-zA-Z0-9_-]+)"/g` — the character class **excludes `:`**, so
RULE 17 has never matched any `skill: "workflows:spec"` value and will not
match `skill: "flow:spec"` either. No validator anywhere resolves a namespaced
`skill:` dispatch target to a real command `name:`. PR4 should add one as a
**standing** rule, not a one-off migration check.

### Bump Type Rationale

`minor`, not `major`. The discriminator in this repo's actual precedent is
*"does it break an external caller"*, not *"is it a rename"*:
`plans/complete/yellow-debt-remove-v1-dual-read.md` used `patch` for a removal
with no external caller; `plugins/yellow-review/CHANGELOG.md:886-906` used
`major` for an agent rename that *did* break external `subagent_type` callers.
There is no external caller here. A major bump has no CI-enforced cost — no
caret ranges depend on `yellow-core`, and the root catalog track is decoupled
(`.changeset/config.json:8-9`) — but it would be `yellow-core`'s first-ever
major (currently 1.27.2) for a change that breaks nobody.

## Acceptance Criteria

1. **Set equality** — every `name:` under the 10 files equals its expected
   `flow:*` value; zero `name: workflows:` remains anywhere under `plugins/`.
2. **No dangling dispatch** — all 9 `skill: "flow:*"` targets and all 12
   plugin-qualified refs resolve to a real command `name:`.
3. **Gate terminal state** — the allowlist contains exactly the permanent
   exclusions, and a deliberately-reintroduced `workflows:` reference in a
   non-allowlisted file fails CI (prove the gate fires; a gate never exercised
   against a real removal is the
   `codex-distribution-pipeline-silent-gaps.md` failure mode, which produced
   zero CI signal for months).
4. **The actual goal, on a clean install** — typing `/flow` narrows to exactly
   these 10 commands; typing `/workflows` narrows to none of them.
5. `pnpm validate:schemas && pnpm test:unit && pnpm lint && pnpm typecheck`
   passes.

## Edge Cases

- **`.changeset/*.md` for PR1 must describe the rename** and will legitimately
  contain the old namespace. They are transient (consumed by the
  version-packages PR) but the gate runs on PR1 before that. `.changeset/**` is
  therefore a permanent exclusion.
- **This migration's own solution doc** will narrate the old namespace;
  `docs/solutions/**` is excluded, which covers it.
- **Moving an allowlisted file** must update its allowlist entry in the same
  commit — the hard-error-on-missing-path rule makes this fail loud rather than
  silently pass.
- **`references/flow-work/` slug convention** (AGENTS.md:274-276) is
  unenforced by any validator. The rename plus `work.md:877` is a manual-review
  coupling.

## Resolved Questions

Both open questions were closed before PR1 began.

- **Live `/flow` collision check** — *resolved 2026-08-10: clean.* Verified in a
  live Claude Code session by the repo author; no native built-in or installed
  plugin claims the `fl` prefix. The namespace word `flow:` stands and PR1 is
  not at risk of being wasted work.
- **Standalone script vs. rules inside `validate-agent-authoring.js`** —
  *resolved: standalone*, `scripts/validate-flow-namespace.js`. Deciding
  factors: the gate must walk `.github/`, `RESEARCH/`, and repo root, all
  outside `validate-agent-authoring.js`'s `PLUGINS_DIR` root
  (`validate-agent-authoring.js:15`), and it needs its own allowlist-emitting
  mode (`--write-allowlist`) that has no analogue in that file. Widening an
  existing validator's walk root to serve one new rule risks changing what
  every *other* rule in it sees.

## Stack Decomposition

<!-- stack-topology: linear -->
<!-- stack-trunk: main -->

### 1. agent/feat/flow-namespace-rename-and-gate
- **Type:** feat
- **Description:** Rename workflows: commands to flow:, fix runtime surfaces and always-loaded instructions, add the sweep-completeness CI gate
- **Scope:** plugins/yellow-core/commands/flow/, plugins/yellow-research/commands/flow/, plugins/yellow-core/references/flow-work/, plugins/yellow-linear/commands/linear/work.md, plugins/yellow-review/commands/review/sweep-all.md, packages/domain/src/validation/errorCatalog.ts, scripts/, package.json, AGENTS.md, CONTRIBUTING.md, docs/CLAUDE.md, .github/pull_request_template.md, .github/workflows/validate-schemas.yml, .changeset/
- **Tasks:** 1.1, 1.2, 1.3, 1.4, 1.5
- **Depends on:** (none)

### 2. agent/docs/flow-namespace-sweep-plugins
- **Type:** docs
- **Description:** Sweep the 197 prose references under plugins/ and shrink the gate allowlist accordingly
- **Scope:** plugins/, .changeset/
- **Tasks:** 2.1, 2.2, 2.3, 2.4
- **Depends on:** #1

### 3. agent/docs/flow-namespace-sweep-docs-research
- **Type:** docs
- **Description:** Sweep docs/ (excluding historical brainstorms and solutions) and RESEARCH/, shrinking the allowlist
- **Scope:** docs/, RESEARCH/
- **Tasks:** 3.1, 3.2, 3.3, 3.4
- **Depends on:** #2

### 4. agent/chore/flow-namespace-terminal-condition
- **Type:** chore
- **Description:** Reduce the allowlist to permanent exclusions only and add the standing skill-dispatch resolution validator
- **Scope:** scripts/, packages/domain/src/validation/errorCatalog.ts
- **Tasks:** 4.1, 4.2, 4.3
- **Depends on:** #3

## Stack Progress
<!-- Updated by flow:work. Do not edit manually. -->
- [x] 1. agent/feat/flow-namespace-rename-and-gate (completed 2026-08-10)
- [x] 2. agent/docs/flow-namespace-sweep-plugins (completed 2026-08-11)
- [ ] 3. agent/docs/flow-namespace-sweep-docs-research
- [ ] 4. agent/chore/flow-namespace-terminal-condition

## References

- Decision record:
  [`docs/brainstorms/2026-08-10-workflows-to-flow-namespace-migration-brainstorm.md`](../docs/brainstorms/2026-08-10-workflows-to-flow-namespace-migration-brainstorm.md)
- `docs/solutions/code-quality/mcp-tool-rename-prefix-collision.md` — `\b` does
  not stop substring corruption
- `docs/solutions/code-quality/multi-doc-schema-rename-drift.md` — define the
  allowlist once, cross-reference everywhere
- `docs/solutions/code-quality/frontmatter-sweep-and-canonical-skill-drift.md` —
  derive the file list mechanically, re-diff after
- `docs/solutions/integration-issues/codex-distribution-pipeline-silent-gaps.md` —
  unexercised gates emit no signal; registries indexing bare names miss
  qualified references
- `docs/solutions/code-quality/doc-fix-mechanical-verification-gap.md` —
  assertion is not a check
- `validate-agent-authoring.js:111-127,129-179,911,1014` — allowlist, sentinel,
  literal-ban, and blind-spot precedents
- `validate-solutions.js:22-24,83-87` — error-code concatenation pattern
