# Feature: Audit Followups — 2026-05-07

## Overview

Implement the 11 "apply" decisions from the 2026-05-07 audit followups
brainstorm: clean three INFO warnings, remove the lone validator ERROR,
declare cross-plugin MCP dependencies, kill the 30s session-start block,
pin opus on five deep-analysis review personas, restrict tools on eight
read-only research agents, and add a `validate-doc-counts.js` lint to
prevent narrative-doc drift.

Source brainstorm: `docs/brainstorms/2026-05-07-audit-followups-brainstorm.md`
Source audit: `AUDIT_REPORT.md`

## Problem Statement

### Current Pain Points

- **Active release blocker (X-02):** `validate-agent-authoring.js` hard-errors
  on a correct CHANGELOG entry in `yellow-review/CHANGELOG.md` because it
  greps prose without distinguishing it from declarations. Blocks
  `pnpm release:check`.
- **30s cold-session penalty (H-01):** `yellow-morph`'s SessionStart hook
  runs synchronously with a 30s timeout, blocking every cold session for
  any user with morph installed. Single largest user-visible perf cost.
- **Silent cross-plugin deps (X-01):** `/debt:sync`, `/ci:report-linear`,
  and `/chatprd:link-linear` require `yellow-linear` MCP but declare no
  dependency; failures appear at runtime as opaque "tool not found".
- **Three legacy 2-segment subagent_types (C-02):** `yellow-core/commands/workflows/plan.md`
  lines 90/98/132 emit INFO warnings on every validator run.
- **Inconsistent model pinning (A-01):** five deep-analysis reviewers
  (security-sentinel, performance-oracle, adversarial-reviewer,
  agent-cli-readiness-reviewer, agent-native-reviewer) inherit by default
  while peer personas pin opus or sonnet — quality is non-deterministic.
- **Read-only agents have full tool surface (A-02 Phase 1):** eight research
  agents inherit `Edit`/`Write` they never legitimately use; least-privilege
  hardening is missing.
- **Plugin count drift (M-01):** `CLAUDE.md` says "14 plugins", `README.md`
  says "17 plugins", actual count is 18 (`jq '.plugins | length'`). No
  lint catches the drift.
- **One WARNING (M-02):** `prewarm-morph.sh` is non-executable; works only
  because `bash script.sh` is the invocation form.
- **One INFO (X-02 fallout):** validator finding a deprecated agent
  reference inside CHANGELOG prose triggers a false ERROR.

### User Impact

- Marketplace consumers who install `yellow-morph` wait ~30s on every cold
  session.
- Marketplace consumers who install `yellow-debt`, `yellow-ci`, or
  `yellow-chatprd` without `yellow-linear` see opaque silent failures.
- Plugin authors running `pnpm release:check` are blocked by the validator
  false positive.
- Reviewers running personas like `security-sentinel` get inconsistent
  output quality depending on whether they happened to invoke from a
  context where the parent's model is opus or sonnet.

### Business Value

- Unblocks the release pipeline (X-02).
- Removes the largest user-visible perf cost in the marketplace (H-01).
- Surfaces install-time dependency violations as warnings instead of
  runtime "tool not found" errors (X-01).
- Establishes least-privilege precedent for the agent surface (A-02 P1).
- Self-protects narrative documentation against count drift (M-01 lint).

## Proposed Solution

### High-Level Architecture

Six stacked PRs, ordered so the release blocker lands first and the
schema-changing PR is isolated for an external smoke-test gate:

```
main
 │
 ├─ PR 1: X-02 (validator fix) — release blocker, no plugin touches
 │
 ├─ PR 2: C-02 + M-01 reactive + M-02 + C-01 doc note
 │       (mechanical single-file edits across yellow-core, yellow-morph, gt-workflow)
 │
 ├─ PR 3: H-01 async morph prewarm (perf change isolated)
 │
 ├─ PR 4: X-01 cross-plugin dependency schema  ← external gate
 │       (must pass fresh `claude plugin install` smoke test before tag)
 │
 ├─ PR 5: A-01 model pins + A-02 Phase 1 tool restrictions
 │       (yellow-core, yellow-review, yellow-research, yellow-codex, yellow-linear)
 │
 └─ PR 6: M-01 preventive (validate-doc-counts.js + release:check wiring)
```

PRs 2 and 6 can land in any order relative to each other. PR 4 is the
only one with an explicit external gate.

### Key Design Decisions

1. **X-02 — frontmatter-only matching, not skip-CHANGELOG:** The validator's
   intent is "catch broken `subagent_type:` declarations in agent/command
   files," not "lint prose." Restricting matches to YAML frontmatter blocks
   (between the leading `---` delimiters) preserves intent while stopping
   prose false positives. Skip-CHANGELOG would also miss a future README
   or solution doc that documents a deleted agent.

2. **H-01 — fork-and-disown, not nohup:** Parent process emits
   `{"continue": true}` immediately, then the actual prewarm work runs in a
   detached background subshell `( prewarm_work ) & disown` BEFORE the JSON
   line is printed. Standard POSIX pattern; no zombie children. Trade-off:
   if the user invokes a morph tool within ~30s of session start on a slow
   connection, they may still hit a cold cache. Accepted and documented.

3. **X-01 — warn-not-error:** Validator warns when a declared dep is missing
   from `marketplace.json`. Hard error would block users who install a
   subset of the marketplace. The warning is enough to surface the
   coupling at install time.

4. **X-01 — `{plugin, reason}` shape:** Optional array of objects with
   `plugin` (required, string) and `reason` (required, string). No version
   constraints in v1 — simpler to ship, easier to extend later. Implementation
   pass may refine the shape; this is the recommended starting point.

5. **A-01 — opus on the five deepest analysis personas:** The pattern is
   already established (`audit-synthesizer`, `architecture-strategist`,
   `research-conductor` are pinned to opus). Adding `security-sentinel`,
   `performance-oracle`, `adversarial-reviewer`,
   `agent-cli-readiness-reviewer`, and `agent-native-reviewer` completes
   the convention.

6. **A-02 Phase 1 — read-only research agents only:** Phase 1 restricts
   to `[Read, Grep, Glob]` (and `Bash` for git-history-analyzer) the eight
   agents that have no plausible reason to mutate the workspace. Phase 2
   (write-capable agents) is deferred — those need per-agent judgment
   that belongs in its own brainstorm pass.

7. **M-01 — composite lint (`validate-doc-counts.js`):** Reads marketplace
   as canonical source, greps narrative docs for any `\d+ plugins`-style
   claim, fails on mismatch. Extensible to "consumers", "marketplace
   plugins", or any other count-bearing phrase.

### Trade-offs Considered

- **C-01 (gt-workflow namespace):** Considered renaming the seven
  un-namespaced commands to `gt:amend`, `gt:sync`, etc. Rejected:
  collision risk is theoretical (six are `gt-`-prefixed; only `smart-submit`
  is generic and no observed conflict). Documenting the exception is
  cheaper than rename churn across user habits and docs.
- **A-02 Phase 2 (write-capable agents):** Considered including
  `correctness-reviewer`, `silent-failure-hunter`, `code-simplifier` etc.
  in this pass. Rejected: each needs case-by-case judgment on whether
  `Edit`/`Write` are legitimate (some have autofix paths, some don't).
  Belongs in a separate brainstorm.
- **S-01 (create-agent-skills line count):** Considered splitting the 513-line
  SKILL.md against the 500-line soft cap. Rejected: 13 lines is well within
  the soft-cap tolerance, and the audit found no proven duplication. Per
  the project memory rule, line counts are guidelines, not split-triggers.
- **Risk 7 (empirical hook timing):** Considered including a cold-start
  timing harness in this cycle. Rejected: H-01's async-fork fix is
  correct on principle (blocking 30s on session start is objectively bad).
  An empirical baseline is a separate validation project.

## Implementation Plan

### Phase 1 — PR 1: X-02 validator frontmatter-only matching

**Branch:** `audit/x-02-validator-frontmatter-only`
**Stacks on:** `main`
**Plugins touched:** none (scripts/ only)
**Changeset required:** no

- [ ] 1.1: Read `scripts/validate-agent-authoring.js` end-to-end; locate
  the `subagent_type:` matching logic and the function that scans CHANGELOG
  paths. Identify the `extractFrontmatter` helper at line 67 — confirm
  whether the current matcher uses it or scans the full file body.

<!-- deepen-plan: codebase -->
> **Codebase:** `scripts/validate-agent-authoring.js` line 273 applies the
> `pluginSubagentPattern` regex to *every* `.md` file under `plugins/` via
> `walk(PLUGINS_DIR, …)` at line 144 — including CHANGELOG.md. The
> `extractFrontmatter` helper (line 62) is currently used only in the
> `agentFiles` loop at line 164, NOT in the `markdownFiles` loop (lines
> 271-298). The fix is ~3 lines: in the markdownFiles loop, call
> `extractFrontmatter` per file, skip files where it returns null, and
> restrict the pattern match to the frontmatter string only.
>
> **Test path correction:** the regression fixture in step 1.4 must go at
> `tests/integration/validate-agent-authoring/changelog-prose.fixture.md`
> (vitest watches `tests/integration` per package.json line 19), NOT at the
> path written in step 1.4. The existing related test is
> `tests/integration/validate-agent-authoring-review-rule.test.ts`.
<!-- /deepen-plan -->
- [x] 1.2: ⚠️ **REVISED at implementation time:** the brainstorm's
  "frontmatter-only" approach would have lost validation of legitimate
  body-code-block dispatches (the C-02 INFO matches in plan.md) AND inline
  `Task(subagent_type=...)` references in command/CLAUDE files (~11 such
  usages found via grep). Switched to **skip CHANGELOG.md only** at the
  walk predicate. Rationale: CHANGELOGs document history including
  deletions; their `subagent_type:` references are not live dispatches
  and must not be validated against the current agent registry. Single-
  line filter at `markdownFiles` walk:
  ```js
  const markdownFiles = walk(
    PLUGINS_DIR,
    (filePath) =>
      filePath.endsWith('.md') && path.basename(filePath) !== 'CHANGELOG.md'
  );
  ```
  Body-code-block validation, inline `Task(subagent_type=...)`
  validation, and frontmatter validation all preserved. See
  `docs/solutions/build-errors/validate-agent-authoring-changelog-skip.md`.
- [ ] 1.3: Run `pnpm release:check` — verify the false-positive ERROR on
  `plugins/yellow-review/CHANGELOG.md` no longer fires.
- [ ] 1.4: Add a regression test:
  - `tests/validate-agent-authoring/changelog-prose.fixture.md` containing
    a `yellow-review:review:code-reviewer` reference inside a Markdown bullet
  - Test asserts the validator does NOT flag this fixture
  - Pair fixture: a real `agent.md` with a broken `subagent_type:` in
    frontmatter → must still be flagged
- [ ] 1.5: Run `pnpm test:unit && pnpm validate:schemas`.
- [ ] 1.6: Commit with `fix(scripts): restrict subagent_type validator to frontmatter`.
- [ ] 1.7: `gt submit` → PR 1.

**Acceptance criteria:**
- `pnpm release:check` exits 0 with no ERROR or unrelated WARNING from
  this rule.
- New fixture test passes; broken-frontmatter case still fails as expected.
- No changes to `plugins/`.

---

### Phase 2 — PR 2: Mechanical single-file edits

**Branch:** `audit/c-02-m-01-m-02-mechanical`
**Stacks on:** `main` (independent of PR 1; can land in parallel)
**Plugins touched:** yellow-core, yellow-morph, gt-workflow
**Changeset required:** yes (one changeset covering all three)

#### 2.1 — C-02: legacy subagent_types in plan.md

- [ ] 2.1.1: Edit `plugins/yellow-core/commands/workflows/plan.md`:
  - Line 90: `yellow-core:repo-research-analyst` → `yellow-core:research:repo-research-analyst`
  - Line 98: `yellow-core:best-practices-researcher` → `yellow-core:research:best-practices-researcher`
  - Line 132: `yellow-core:spec-flow-analyzer` → `yellow-core:workflow:spec-flow-analyzer`
- [ ] 2.1.2: Run `pnpm validate:agents` — confirm the three INFO warnings
  on these lines are gone.

#### 2.2 — M-01 reactive: plugin count drift

- [ ] 2.2.1: Edit `CLAUDE.md` line 8 — `"14 plugins"` → `"18 plugins"`.
- [ ] 2.2.2: Edit `README.md` line 3 — `"17 plugins"` → `"18 plugins"`.
  *(Bonus finding: README.md was not in the brainstorm but has the same
  drift; the lint in PR 6 will require both to be correct anyway.)*

#### 2.3 — M-02: chmod +x prewarm hook

- [ ] 2.3.1: `chmod +x plugins/yellow-morph/hooks/scripts/prewarm-morph.sh`
- [ ] 2.3.2: Run `pnpm validate:schemas` — confirm the WARNING is gone.

#### 2.4 — C-01: gt-workflow namespace exception (doc note)

- [ ] 2.4.1: Open `plugins/gt-workflow/CLAUDE.md`. Add a `## Namespace
  exception` section after any existing top-level intro section (preserve
  existing structure). Section content must cover the three points from
  the brainstorm:
  1. The seven commands ship un-namespaced intentionally — they predate
     the namespacing convention.
  2. Collision risk is low: six are `gt-`-prefixed; only `smart-submit`
     is generic and no observed conflict.
  3. Future contributors and auditors should not re-flag without a
     concrete trigger (real collision or incoming clashing plugin).
- [ ] 2.4.2: Skip the changeset bump on `gt-workflow` per the brainstorm
  recommendation — CLAUDE.md is documentation of an existing convention,
  not a behavior change. (If the CI changeset gate complains, add a patch
  bump retroactively.)

#### 2.5 — Validation, changeset, commit, submit

- [ ] 2.5.1: Run `pnpm validate:schemas && pnpm validate:agents`.
- [ ] 2.5.2: `pnpm changeset` — patch bump on `yellow-core` and `yellow-morph`
  (gt-workflow only if the gate insists; otherwise skip per 2.4.2).
- [ ] 2.5.3: Normalize line endings on any new/edited files: `sed -i 's/\r$//' <files>`
  (WSL2 hygiene per project memory).
- [ ] 2.5.4: Commit with `chore(audit): apply mechanical followups (C-02, M-01 reactive, M-02, C-01 doc)`.
- [ ] 2.5.5: `gt submit` → PR 2.

**Acceptance criteria:**
- `pnpm validate:agents` shows zero INFO warnings on `plan.md` lines 90/98/132.
- `pnpm validate:schemas` shows zero WARNING on `prewarm-morph.sh`.
- `CLAUDE.md` and `README.md` both say "18 plugins".
- `gt-workflow/CLAUDE.md` documents the namespace exception in three points.
- Changeset present; PR CI baseline gate green.

---

### Phase 3 — PR 3: H-01 async morph prewarm

**Branch:** `audit/h-01-morph-async-prewarm`
**Stacks on:** `main` (independent; can land after PR 1/2)
**Plugins touched:** yellow-morph
**Changeset required:** yes (patch bump)

- [ ] 3.1: Read `plugins/yellow-morph/hooks/scripts/prewarm-morph.sh`
  in full. Identify:
  - The `json_exit` helper at top
  - Where the prewarm work begins (likely after sourcing `lib/`)
  - All exit paths that currently print `{"continue": true}`

<!-- deepen-plan: codebase -->
> **Codebase:** No precedent exists in any plugin for `& disown`, `nohup`,
> or `setsid` — grep across `plugins/` returned zero hits. Closest comparable
> hook is `plugins/yellow-ruvector/hooks/scripts/session-start.sh` but it
> runs synchronously ("Must complete within 3 seconds"). `prewarm-morph.sh`
> already has the `json_exit` helper (lines 13-18) correctly in place; the
> script body ends at line 56. The refactor wraps lines 39-56 in
> `( ... ) & disown` and moves `json_exit` (no-arg, success) to immediately
> follow the disown line.
<!-- /deepen-plan -->
- [ ] 3.2: Refactor to fork-and-disown:
  - Wrap the actual prewarm work in `( prewarm_work ) & disown`
  - Print `{"continue": true}` and exit on the parent immediately after
    spawning the background subshell — within hundreds of milliseconds, not
    seconds
  - The 5s parent timeout (set in plugin.json below) is a defensive ceiling
    in case the parent itself stalls (e.g., environment lookups)
  - Keep the existing `json_exit` helper for parent error paths
  - Background subshell errors must NOT print to stdout (would corrupt the
    parent's JSON output) — log to stderr only

<!-- deepen-plan: external -->
> **Research:** The brainstorm's proposed redirect `( prewarm_work >&2 2>&1 ) & disown`
> contains a logical no-op: `>&2 2>&1` redirects stdout to stderr, then redirects
> stderr to stderr (the second redirect is a no-op against the redirected
> stdout). Use `>/dev/null 2>&1` instead — the canonical POSIX form, silences
> both child streams. If child stderr should still appear in Claude Code's
> logs, use `>/dev/null` (suppress stdout only, leave stderr through).
>
> `disown` alone is sufficient on bash 3.2+ (Linux and macOS — Claude Code's
> hook runner is not a terminal session leader). `setsid` is Linux-only via
> util-linux (not in macOS base install) and overkill here. `nohup` is for
> terminal-hangup paths that don't apply to subprocess hooks. Zombie reaping
> is automatic via PID 1 reparenting after the parent exits — no `wait` call
> needed.
>
> Recommended final form for step 3.2:
> ```bash
> ( prewarm_work >/dev/null 2>&1 ) & disown
> printf '{"continue": true}\n'
> ```
> Sources: bash(1) man page (`disown`, job control, SIGHUP behavior); POSIX
> signal semantics (zombie reaping via init reparenting).
<!-- /deepen-plan -->
- [ ] 3.3: Add a comment block in the script documenting the trade-off:
  "If the user invokes a morph tool within ~30s of session start on a slow
  connection, they may still hit a cold cache. This is the accepted
  trade-off — the alternative blocks every cold session by 30s."
- [ ] 3.4: Edit `plugins/yellow-morph/.claude-plugin/plugin.json`:
  - Lower `hooks.SessionStart[0].hooks[0].timeout` from `30` to `5`.
- [ ] 3.5: Manual smoke test:
  - Run the script directly: `bash plugins/yellow-morph/hooks/scripts/prewarm-morph.sh`
  - Confirm parent returns in <1s
  - Confirm the background prewarm completes (check installed package)
  - Confirm no zombie children: `ps -ef | grep prewarm` after parent exits
- [ ] 3.6: Run `pnpm validate:schemas`.
- [ ] 3.7: `pnpm changeset` — patch bump on `yellow-morph`.
- [ ] 3.8: Normalize line endings: `sed -i 's/\r$//' plugins/yellow-morph/hooks/scripts/prewarm-morph.sh`.
- [ ] 3.9: Commit with `perf(yellow-morph): run prewarm in detached background to unblock session start`.
- [ ] 3.10: `gt submit` → PR 3.

**Acceptance criteria:**
- Manual run shows parent process exits in <1s.
- Background subshell completes successfully without zombies.
- `pnpm validate:schemas` passes.
- `plugin.json` SessionStart timeout is 5.

---

### Phase 4 — PR 4: X-01 cross-plugin dependency schema  ⚠️ external gate

**Branch:** `audit/x-01-cross-plugin-dependencies`
**Stacks on:** `main` (independent; do NOT tag a release until smoke test passes)
**Plugins touched:** yellow-debt, yellow-ci, yellow-chatprd
**Changeset required:** yes (patch bumps on all three plugins)

<!-- deepen-plan: codebase -->
> **Codebase BLOCKER:** `schemas/plugin.schema.json` lines 296-327 already
> define a `dependencies` array with `{name: string, version: semver-range}`
> items. The brainstorm's proposed `{plugin, reason}` shape **directly
> conflicts** with the existing definition. `validate-plugin.js` line 26
> explicitly notes that schema-shape validation for `dependencies` is
> AJV-delegated to the schema. The schema is locked by `additionalProperties: false`
> at line 329.
>
> **Rule numbering confirmed:** highest existing rule in `validate-plugin.js`
> is RULE 10 (line 876). The new cross-marketplace check should be RULE 11.
> `monitors` (schema lines 228-263) is the closest array-of-objects precedent.
>
> **Required reconciliation BEFORE coding** — pick one:
> 1. **(Recommended)** Extend the existing `{name, version}` shape with
>    optional `optional: boolean` and `reason: string` fields (see external
>    annotation below for prior art).
> 2. Introduce a separate `softDependencies` array — increases maintenance
>    surface, splits intent across two fields.
> 3. Replace the existing definition — breaks any existing manifests that
>    use the current `{name, version}` shape (audit needed first).
<!-- /deepen-plan -->

<!-- deepen-plan: external -->
> **Research — prior art for inter-plugin deps:**
>
> | Ecosystem | Field | Shape | Optional support | Reason text |
> |---|---|---|---|---|
> | VS Code | `extensionDependencies` | `string[]` (publisher.id) | No | No |
> | npm 7+ | `peerDependencies` + `peerDependenciesMeta` | `{name: range}` + `{name: {optional: true}}` | **Yes (companion object)** | No |
> | JetBrains | `<depends optional="true" config-file="...">` | string ID + attrs | **Yes (inline attr)** | No |
> | Chrome MV3 | — | (no field) | — | — |
> | Atom / Obsidian | — | (no field; runtime only) | — | — |
>
> **Dominant pattern:** hard deps in one array, optionality as a companion
> annotation, no reason text in any schema. npm 7's `peerDependenciesMeta`
> is the canonical "annotate without splitting" approach. JetBrains is the
> closest precedent for optional-with-structured-consequence.
>
> **Recommendation: Option (a) — extend existing shape:**
> ```json
> "dependencies": [
>   {
>     "name": "yellow-linear",
>     "version": "*",
>     "optional": true,
>     "reason": "debt:sync uses mcp__plugin_yellow-linear_linear__create_issue"
>   }
> ]
> ```
>
> Schema changes (apply to existing definition, lines 296-327):
> - Add optional `optional: boolean` (default `false`) to each dep object
> - Add optional `reason: string` (informational, no validation enforcement)
> - Keep `name` + `version` required; preserve existing semver-range validator
>
> Validator behavior (RULE 11 in `validate-plugin.js`):
> - For each `dependencies` entry where `optional !== true`, cross-check
>   `name` against the marketplace catalog → WARNING if missing.
> - Optional deps stay silent when missing (matches npm `peerDependenciesMeta`
>   semantics: declared, not enforced).
>
> Mark `reason` as informational in the schema description so future readers
> understand it is non-normative. No ecosystem ships reason-text in schema,
> but none prohibits it — net adds an audit trail at zero cost. (Sources:
> npm `peerDependenciesMeta` docs; VS Code Extension Manifest reference;
> JetBrains plugin.xml `<depends>` element.)
<!-- /deepen-plan -->

#### 4.1 — Schema extension

- [ ] 4.1.1: ⚠️ **REVISED per codebase finding:** the `dependencies` field
  already exists in `schemas/plugin.schema.json` (lines 296-327) with shape
  `{name: string, version: semver-range}`. **Extend** the existing definition
  rather than creating a new field:
  ```json
  // Existing item shape (lines 296-327) — keep name + version required
  {
    "type": "object",
    "properties": {
      "name": { "type": "string" },
      "version": { "type": "string", "format": "semverRange" },
      "optional": {
        "type": "boolean",
        "default": false,
        "description": "When true, validator does not warn if dep is missing from marketplace catalog"
      },
      "reason": {
        "type": "string",
        "description": "Informational — explains why this plugin is required. Not validated."
      }
    },
    "required": ["name", "version"],
    "additionalProperties": false
  }
  ```
- [ ] 4.1.2: Confirm `additionalProperties: false` at the manifest top level
  is unchanged (the field already exists there); only the per-item object
  schema needs the additions.

#### 4.2 — Validator soft-warn

- [ ] 4.2.1: Edit `scripts/validate-plugin.js`. Add RULE 11 (verified — current
  highest is RULE 10 at line 876):
  - For each plugin manifest, if `dependencies` is present, iterate each
    entry's `name` field (NOT `plugin` — the existing schema field is `name`)
  - Skip entries where `optional === true` (matches npm `peerDependenciesMeta`
    semantics: declared but not enforced)
  - Cross-check against the marketplace catalog (`.claude-plugin/marketplace.json`)
  - If declared (non-optional) dep not present in catalog: WARNING (not ERROR)
    with message naming the consuming plugin, the missing dep `name`, the
    declared `version`, and the `reason` field for context if present
- [ ] 4.2.2: Add a unit test fixture: a manifest declaring `dependencies:
  [{plugin: "non-existent-plugin", reason: "..."}]` — expect WARNING.
- [ ] 4.2.3: Add a positive test: declaring `yellow-linear` as a dep
  → no warning.

#### 4.3 — Manifest declarations

- [ ] 4.3.1: Edit `plugins/yellow-debt/.claude-plugin/plugin.json`:
  ```json
  "dependencies": [
    {
      "name": "yellow-linear",
      "version": "*",
      "optional": true,
      "reason": "debt:sync uses mcp__plugin_yellow-linear_linear__create_issue"
    }
  ]
  ```
- [ ] 4.3.2: Edit `plugins/yellow-ci/.claude-plugin/plugin.json`:
  ```json
  "dependencies": [
    {
      "name": "yellow-linear",
      "version": "*",
      "optional": true,
      "reason": "ci:report-linear uses mcp__plugin_yellow-linear_linear__create_issue"
    }
  ]
  ```
- [ ] 4.3.3: Edit `plugins/yellow-chatprd/.claude-plugin/plugin.json`:
  ```json
  "dependencies": [
    {
      "name": "yellow-linear",
      "version": "*",
      "optional": true,
      "reason": "chatprd:link-linear uses mcp__plugin_yellow-linear_linear__create_issue"
    }
  ]
  ```

  **Why `optional: true`:** the consumer plugins degrade gracefully when
  yellow-linear is missing (Linear-specific commands surface "MCP not found"
  rather than crashing the install). Marking the deps optional prevents the
  validator from warning on installations that legitimately omit yellow-linear.
  Hard-required deps (`optional: false` or omitted) would warn at validate
  time but still install — the warning serves as the audit signal.

#### 4.4 — Validation, changeset, smoke gate, submit

- [ ] 4.4.1: Run `pnpm validate:schemas` and `pnpm test:unit`.
- [ ] 4.4.2: `pnpm changeset` — patch bumps on `yellow-debt`, `yellow-ci`,
  `yellow-chatprd`. The schemas/scripts changes do not require a changeset.
- [ ] 4.4.3: ⚠️ **External gate — do NOT tag a release until this passes:**
  Fresh `claude plugin install` on a clean machine for at least one of the
  three modified plugins. Confirm Claude Code's remote validator accepts
  the new `dependencies` field. Local CI passing does NOT guarantee
  acceptance (per project memory: "Local CI ≠ remote validation").
  - If remote rejects: rework the field shape, do NOT silently strip the
    field; document the rejection mode in `docs/solutions/build-errors/`.
- [ ] 4.4.4: Normalize line endings: `sed -i 's/\r$//' <touched JSON files>`.
- [ ] 4.4.5: Commit with `feat(plugins): declare cross-plugin MCP dependencies (X-01)`.
- [ ] 4.4.6: `gt submit` → PR 4.

**Acceptance criteria:**
- `pnpm validate:schemas` passes; new dep field validates against schema.
- `pnpm validate:plugins` warns (not errors) on a manifest declaring a
  fictional dep; passes silently when deps are valid.
- All three modified manifests declare `yellow-linear` as a dep with
  human-readable reason text.
- Fresh-install smoke test passes before any release tag.

---

### Phase 5 — PR 5: A-01 model pins + A-02 Phase 1 tool restrictions

**Branch:** `audit/a-01-model-pins-a-02-tool-restrictions`
**Stacks on:** `main` (independent; can land after PR 1)
**Plugins touched:** yellow-core, yellow-review, yellow-research, yellow-codex, yellow-linear
**Changeset required:** yes (patch bumps on all five)

#### 5.1 — A-01: pin opus on five deep-analysis review personas

<!-- deepen-plan: codebase -->
> **Codebase:** Existing pinned agent
> `plugins/yellow-core/agents/review/architecture-strategist.md` line 4
> uses `model: opus` (bare string), NOT `claude-opus-4-5` or any qualified
> identifier. The plan's hedging on the opus identifier is **resolved: use
> `model: opus`** for all 5 A-01 targets to match precedent.
>
> Note: the plan References section lists `audit-synthesizer.md` under
> `agents/synthesis/` — this directory does **not exist** in the current
> codebase. Update that reference; only `architecture-strategist.md` is
> a confirmed precedent.
<!-- /deepen-plan -->

For each file below, change `model: inherit` (currently line 4 in all
five) to `model: opus` (bare string, matching `architecture-strategist.md`
precedent):

- [ ] 5.1.1: `plugins/yellow-core/agents/review/security-sentinel.md` → `model: opus`
- [ ] 5.1.2: `plugins/yellow-core/agents/review/performance-oracle.md` → `model: opus`
- [ ] 5.1.3: `plugins/yellow-review/agents/review/adversarial-reviewer.md` → `model: opus`
- [ ] 5.1.4: `plugins/yellow-review/agents/review/agent-cli-readiness-reviewer.md` → `model: opus`
- [ ] 5.1.5: `plugins/yellow-review/agents/review/agent-native-reviewer.md` → `model: opus`
- [ ] 5.1.6: Run `pnpm validate:agents` — clean; each frontmatter has a
  single-line `model:` field.

#### 5.2 — A-02 Phase 1: tool restrictions on read-only research agents

<!-- deepen-plan: codebase -->
> **Codebase — verified current `tools:` per-agent (read agent body BEFORE editing):**
>
> | Agent | Current `tools:` | Plan target | Final action |
> |---|---|---|---|
> | `learnings-researcher` | `Read, Grep, Glob` | `[Read, Grep, Glob]` | **No-op — already at target, skip** |
> | `repo-research-analyst` | `Read, Grep, Glob, Bash` | `[Read, Grep, Glob]` | **Keep Bash** (used in body) → `[Read, Grep, Glob, Bash]` |
> | `best-practices-researcher` | `WebSearch, WebFetch, Read, Glob, Grep` | `[Read, Grep, Glob]` | **Keep WebSearch + WebFetch** → `[Read, Grep, Glob, WebSearch, WebFetch]` |
> | `git-history-analyzer` | `Bash, Read, Grep, Glob` | `[Read, Grep, Glob, Bash]` | Plan correct |
> | `spec-flow-analyzer` | `Read, Grep, Glob, Bash` | `[Read, Grep, Glob]` | **Keep Bash** → `[Read, Grep, Glob, Bash]` |
> | `code-researcher` | `Read, Grep, Glob, Bash, ToolSearch, 4× MCP` | `[Read, Grep, Glob]` | **Far too narrow — keep ToolSearch + MCP tools**; A-02 is a no-op for this agent |
> | `codex-analyst` | `Bash, Read, Grep, Glob` | `[Read, Grep, Glob, Bash]` | Plan correct |
> | `linear-explorer` | `Bash, ToolSearch, 5× MCP` (no Read/Grep/Glob) | `[Read, Grep, Glob, ToolSearch, mcp__*]` | **Verify Read/Grep/Glob are used in body before adding** — if not used, leave unchanged |
>
> **Net effect:** A-02 P1 is mostly a confirmation/audit pass, not a
> restriction pass. Only `git-history-analyzer` and `codex-analyst` exactly
> match the brainstorm's restriction list. `learnings-researcher` is already
> minimal. The other five require per-body verification and produce
> narrower changes than the brainstorm anticipated. The hardening value is
> still present — it codifies "no Edit/Write" on agents that don't have it
> — but the diff per agent is small or empty.
<!-- /deepen-plan -->

For each agent below, update the frontmatter `tools:` field. The
brainstorm specifies `[Read, Grep, Glob]` for pure read-only agents; for
`git-history-analyzer` add `Bash` (verified open question — git commands
are required). Before editing each file, read the existing `tools:` value
to confirm the change is a strict narrowing (no functional regression):

**Per-agent actions (revised per codebase findings above):**

- [ ] 5.2.1: `plugins/yellow-core/agents/research/learnings-researcher.md`
  → **No-op** (already `[Read, Grep, Glob]`); document in commit message
  that this agent was audited and confirmed minimal.
- [ ] 5.2.2: `plugins/yellow-core/agents/research/repo-research-analyst.md`
  → keep current `[Read, Grep, Glob, Bash]`; **no-op** unless body shows
  Bash is unused. Audit only.
- [ ] 5.2.3: `plugins/yellow-core/agents/research/best-practices-researcher.md`
  → keep `[WebSearch, WebFetch, Read, Glob, Grep]`; **no-op** unless body
  shows WebSearch/WebFetch unused. Audit only.
- [ ] 5.2.4: `plugins/yellow-core/agents/research/git-history-analyzer.md`
  → confirm `[Bash, Read, Grep, Glob]` is current; **no-op** (resolves
  brainstorm Open Question 2 — Bash is required and present).
- [ ] 5.2.5: `plugins/yellow-core/agents/workflow/spec-flow-analyzer.md`
  → keep current `[Read, Grep, Glob, Bash]`; **no-op** unless body shows
  Bash is unused. Audit only.
- [ ] 5.2.6: `plugins/yellow-research/agents/research/code-researcher.md`
  → keep current full set (`Read, Grep, Glob, Bash, ToolSearch, 4× MCP`);
  **no-op** — restricting to `[Read, Grep, Glob]` would break the agent.
  Audit only.
- [ ] 5.2.7: `plugins/yellow-codex/agents/research/codex-analyst.md`
  → confirm `[Bash, Read, Grep, Glob]` is current; **no-op** (Bash needed
  for Codex CLI invocation).
- [ ] 5.2.8: `plugins/yellow-linear/agents/research/linear-explorer.md`
  → read body to verify whether Read/Grep/Glob are actually used. If yes,
  add them to the existing `[Bash, ToolSearch, mcp__*]` set. If no, leave
  unchanged. **Decision deferred to body inspection at edit time.**

**A-02 P1 is largely an audit/confirmation pass.** The brainstorm
overestimated the restriction surface — most agents already have the
narrowed scope or legitimately need additional tools. Document the audit
outcome in the PR description so future contributors see "these 8 agents
were checked for least-privilege; current tools are correct."

**On-touch rule reminder:** every edited `.md` must have:
- Single-line `description:` (NOT folded scalar `>` and NOT multi-line
  single-quoted) — grep `'^description: [>|]'` after edits
- `user-invokable` (with k), NOT `user-invocable`, if it's a skill (not
  applicable here, but verify)
- LF line endings (run `sed -i 's/\r$//' <file>` after each edit on WSL2)

#### 5.3 — Validation, changeset, submit

- [ ] 5.3.1: Run `pnpm validate:agents && pnpm validate:schemas`.
- [ ] 5.3.2: `pnpm changeset` — patch bumps on all five plugins:
  yellow-core, yellow-review, yellow-research, yellow-codex, yellow-linear.
- [ ] 5.3.3: Normalize line endings on all 13 modified `.md` files.
- [ ] 5.3.4: Commit with `feat(agents): pin opus on deep reviewers + restrict tools on read-only research agents (A-01, A-02 P1)`.
- [ ] 5.3.5: `gt submit` → PR 5.

**Acceptance criteria:**
- All 5 A-01 agents have `model: <opus-id>` (matching existing pinned
  pattern — read one to confirm exact string).
- All 8 A-02 P1 agents have a narrowed `tools:` field.
- `pnpm validate:agents` passes clean.
- No agent regressions: each restricted agent still has the tools it
  actually uses (verified by reading agent body before editing).

---

### Phase 6 — PR 6: M-01 preventive — `validate-doc-counts.js`

**Branch:** `audit/m-01-doc-counts-lint`
**Stacks on:** `main` (independent; can land after PR 2)
**Plugins touched:** none (scripts/, root docs/, package.json)
**Changeset required:** no (scripts and root docs only)

- [ ] 6.1: Create `scripts/validate-doc-counts.js` (~50 lines) that:
  - Reads `.claude-plugin/marketplace.json` → `plugins.length` is the
    canonical count
  - Greps `CLAUDE.md`, `README.md`, and all root-level `.md` files (not
    inside `plugins/`, `docs/solutions/`, or `node_modules/`) for these
    patterns:
    - `\d+ plugins` (case-insensitive)
    - `\d+ marketplace plugins`
    - `\d+ consumers` (audit also tracks consumer count drift)
  - For each match, parse the integer and compare to canonical
  - Mismatch → `process.exit(1)` with a message naming the file, line
    number, found count, and expected count
  - Match → silent success
  - `console.error` for tooling output (stderr); reserve stdout for
    machine-readable mode if needed
- [ ] 6.2: Add unit test at `tests/integration/validate-doc-counts.test.ts`
  (vitest watches `tests/integration` per package.json line 19; fixture path
  in earlier draft was wrong):
  - Describe block: `describe('validate-doc-counts', ...)` matching the
    convention in `tests/integration/validate-plugin.test.ts`
  - Fixture: temp file with `"15 plugins"` when canonical is 18 → expect
    exit 1 with the file/line/expected/found in stderr
  - Fixture: temp file with `"18 plugins"` → expect exit 0
  - Fixture: temp file with no count claim → expect exit 0

<!-- deepen-plan: codebase -->
> **Codebase:** Current `release:check` (package.json line 29):
> ```text
> "release:check": "pnpm run validate:schemas && pnpm run validate:versions && pnpm run typecheck"
> ```
> Insert `validate:doc-counts` after `validate:versions`, before `typecheck`:
> ```text
> "release:check": "pnpm run validate:schemas && pnpm run validate:versions && pnpm run validate:doc-counts && pnpm run typecheck"
> ```
> The `&&` chaining pattern is used consistently in the package.json scripts
> block. Test convention from `tests/integration/validate-plugin.test.ts`:
> describe-block named for the script, vitest auto-discovers from
> `--dir tests/integration`.
<!-- /deepen-plan -->
- [ ] 6.3: Wire into `package.json`:
  - Add script: `"validate:doc-counts": "node scripts/validate-doc-counts.js"`
  - Add to `release:check`: chain after `validate:versions` (so the
    full chain becomes `validate:schemas && validate:versions && validate:doc-counts && typecheck`)
- [ ] 6.4: Manual sanity check:
  - Run `pnpm validate:doc-counts` on the post-PR-2 tree → expect exit 0
    (PR 2 already fixed CLAUDE.md and README.md)
  - Temporarily edit CLAUDE.md to `"17 plugins"` → run again → expect exit 1
  - Restore CLAUDE.md
- [ ] 6.5: Run full `pnpm release:check` → confirm clean.
- [ ] 6.6: Normalize line endings on the new script: `sed -i 's/\r$//' scripts/validate-doc-counts.js`.
- [ ] 6.7: Commit with `feat(scripts): add validate-doc-counts.js to catch narrative-doc count drift`.
- [ ] 6.8: `gt submit` → PR 6.

**Acceptance criteria:**
- `pnpm validate:doc-counts` exists as a standalone npm script.
- `pnpm release:check` invokes it and fails fast on any mismatch.
- Unit tests cover positive, negative (mismatch), and absent-claim cases.
- Adding a fake `"99 plugins"` to any root narrative doc fails the check
  with file/line context.

---

## Technical Specifications

### Files to Modify

| Phase | File | Change |
|---|---|---|
| 1 | `scripts/validate-agent-authoring.js` | Frontmatter-only matching for `subagent_type:` rule |
| 2 | `plugins/yellow-core/commands/workflows/plan.md` | Lines 90, 98, 132: 2-segment → 3-segment |
| 2 | `CLAUDE.md` | Line 8: `14` → `18` |
| 2 | `README.md` | Line 3: `17` → `18` |
| 2 | `plugins/yellow-morph/hooks/scripts/prewarm-morph.sh` | `chmod +x` |
| 2 | `plugins/gt-workflow/CLAUDE.md` | Append `## Namespace exception` section |
| 3 | `plugins/yellow-morph/hooks/scripts/prewarm-morph.sh` | Fork-and-disown refactor |
| 3 | `plugins/yellow-morph/.claude-plugin/plugin.json` | `timeout: 30` → `5` |
| 4 | `schemas/plugin.schema.json` | Add optional `dependencies` field |
| 4 | `scripts/validate-plugin.js` | Add cross-marketplace dep check (warn) |
| 4 | `plugins/yellow-debt/.claude-plugin/plugin.json` | Declare `yellow-linear` dep |
| 4 | `plugins/yellow-ci/.claude-plugin/plugin.json` | Declare `yellow-linear` dep |
| 4 | `plugins/yellow-chatprd/.claude-plugin/plugin.json` | Declare `yellow-linear` dep |
| 5 | 5× review agent `.md` files | `model: inherit` → `model: <opus>` |
| 5 | 8× research agent `.md` files | Narrow `tools:` field |
| 6 | `package.json` | Add `validate:doc-counts` script; chain into `release:check` |

### Files to Create

- `scripts/validate-doc-counts.js` — narrative-doc count lint (~50 lines)
- `tests/validate-doc-counts.test.ts` — unit tests for the lint
- `tests/validate-agent-authoring/changelog-prose.fixture.md` — regression
  fixture for X-02

### Dependencies

None added. All work uses existing tooling (Node, jq for shell, AJV for
schema, vitest for tests).

### API Changes

**`schemas/plugin.schema.json`** gains an optional top-level `dependencies`
array. Existing manifests without the field validate unchanged.

```json
// Before
{
  "name": "yellow-debt",
  "version": "1.x.x"
  // ...
}

// After (optional)
{
  "name": "yellow-debt",
  "version": "1.x.x",
  "dependencies": [
    { "plugin": "yellow-linear", "reason": "debt:sync uses ..." }
  ]
}
```

**Validator output** gains a new WARNING category (not ERROR) for
declared deps missing from marketplace — does not break any existing
gate. PR 4 must verify Claude Code's remote validator accepts the new
field via fresh-install smoke test.

### Database Changes

None.

## Testing Strategy

### Per-PR validation gates

| PR | Required gates |
|---|---|
| 1 | `pnpm test:unit && pnpm validate:schemas && pnpm release:check` |
| 2 | `pnpm validate:schemas && pnpm validate:agents` |
| 3 | Manual smoke (parent <1s, no zombies) + `pnpm validate:schemas` |
| 4 | `pnpm validate:schemas && pnpm test:unit` + ⚠️ fresh-install smoke |
| 5 | `pnpm validate:agents && pnpm validate:schemas` |
| 6 | `pnpm release:check` (now includes `validate:doc-counts`) |

### Regression fixtures

- **X-02 fixture (PR 1):** prose mention of a deprecated subagent_type
  inside `tests/validate-agent-authoring/changelog-prose.fixture.md` →
  must NOT trigger the validator
- **X-01 fixtures (PR 4):** unit-test fixture with a fictional dep →
  must trigger WARNING; positive fixture with valid dep → must pass
- **M-01 fixtures (PR 6):** three fixtures (mismatch, match, absent
  claim) covering exit codes 1/0/0

### Manual checks

- **PR 3 H-01:** time `bash plugins/yellow-morph/hooks/scripts/prewarm-morph.sh`
  → parent must exit in <1s; check `ps -ef | grep prewarm` after parent
  exits → background subshell may still run, but no zombies (`Z` in `ps`).
- **PR 4 X-01 smoke gate:** fresh `claude plugin install yellow-debt`
  on a clean Claude Code install. Confirm install succeeds and the
  remote validator does not reject the new `dependencies` field.

## Acceptance Criteria

1. **X-02 fixed:** `pnpm release:check` exits 0 on the post-PR-1 tree;
   the fixture-based regression test is in place.
2. **C-02 fixed:** `pnpm validate:agents` shows zero INFO warnings on
   `yellow-core/commands/workflows/plan.md`.
3. **H-01 fixed:** parent process of `prewarm-morph.sh` exits in <1s;
   SessionStart timeout in `plugin.json` is 5; trade-off comment present
   in script.
4. **X-01 fixed:** all three consumer plugins declare `yellow-linear` as
   a dep with human-readable reasons; validator warns on missing deps;
   fresh-install smoke test passes.
5. **A-01 fixed:** all 5 deep-analysis reviewers have explicit `model:`
   pinning (opus); none on `inherit`.
6. **A-02 P1 fixed:** all 8 read-only research agents have a narrowed
   `tools:` field; none inherit `Edit`/`Write` they don't use.
7. **M-01 fixed:** `CLAUDE.md` and `README.md` reflect 18 plugins;
   `validate-doc-counts.js` lint catches future drift; wired into
   `release:check`.
8. **M-02 fixed:** `prewarm-morph.sh` is executable; no validator WARNING.
9. **C-01 documented:** `plugins/gt-workflow/CLAUDE.md` has the three-point
   namespace exception block.

## Edge Cases & Error Handling

- **PR 1 — frontmatter detection edge case:** files without frontmatter
  (CHANGELOG.md, README.md) must be skipped, not treated as "frontmatter
  with empty content." Test with a fixture that has a YAML-like block
  inside fenced code (` ```yaml … ``` `) — must not be parsed as
  frontmatter.
- **PR 3 — fork race:** if the parent exits before `disown` completes,
  the subshell may receive SIGHUP. The standard pattern handles this:
  `( prewarm_work ) & disown` runs `disown` synchronously before the
  parent returns. Verify with `ps` after a manual run.
- **PR 3 — stdout corruption:** background subshell must NEVER write to
  stdout (the parent's `{"continue": true}` line is the only stdout
  output Claude Code reads). Redirect all background output: `( prewarm_work
  >&2 2>&1 ) & disown` or similar.
- **PR 4 — schema rejection by remote:** if Claude Code's remote
  validator rejects the new `dependencies` field, do NOT silently strip
  it. Document the rejection in `docs/solutions/build-errors/` and
  rework the field shape (e.g., move under a custom namespace or escape
  via `metadata`).
- **PR 4 — circular declaration:** validator must not treat self-reference
  as a dep (a plugin declaring itself as a dep). Add fixture if not
  already covered.
- **PR 5 — agent body uses tools not in restricted set:** before editing
  each agent's `tools:` field, read the body and confirm no tool not in
  the new list is invoked. Specifically check `Bash`, `Edit`, `Write`,
  `WebFetch`, `WebSearch`, `Task` invocations in the prompt body.
- **PR 6 — false positive on legitimate count claim:** if a doc says
  `"34 consumers"` (different metric, see PR #785 history), the lint must
  not fail. Limit pattern to specific phrases listed in 6.1, not bare
  `\d+`.

## Performance Considerations

- **H-01 expected impact:** session start latency drops from ~30s
  (synchronous prewarm) to <1s (parent only) for users with morph
  installed. Measured via the manual smoke gate; an empirical baseline
  belongs in a separate project (Risk 7 — deferred).
- **Validator changes (PRs 1, 4, 6):** add a few file scans + a few
  cross-references. Negligible impact on `pnpm release:check` runtime
  (already O(n) over manifests).

## Security Considerations

- **PR 5 A-02 P1:** restricting tools is a least-privilege improvement,
  not a regression. Read-only agents that previously inherited `Edit`/`Write`
  could not have legitimately needed them; restriction blocks accidental
  workspace mutation by these agents.
- **PR 4 X-01:** dependency declaration does not introduce code execution.
  The validator only reads and compares strings.
- **No new external surface:** all changes are local to scripts, schemas,
  manifests, and agent metadata. No new MCP servers, no new userConfig,
  no new userland-facing input parsing.

## Migration & Rollback

- **PR 1:** scripts-only change. Rollback = revert commit. No user data
  affected.
- **PR 2:** mechanical edits. Rollback = revert. No user data affected.
- **PR 3:** if the async pattern misbehaves in the wild, rollback restores
  synchronous prewarm with `timeout: 30`. Communicate via plugin.json
  changelog if revert ships.
- **PR 4:** ⚠️ migration step — fresh-install smoke test BEFORE tagging.
  If remote validator rejects, rollback to `main` and rework field shape
  before re-attempting. Document in `docs/solutions/build-errors/` per
  project memory pattern.
- **PR 5:** model pins and tool restrictions are reversible by reverting
  the agent `.md` files. No state migration.
- **PR 6:** lint addition. Rollback = revert. No effect on existing
  release pipeline beyond removing the new gate.

## Stack Decomposition
<!-- stack-topology: parallel -->
<!-- stack-trunk: main -->

PRs 2-6 are mutually independent off `main`. PR 1 is the recommended anchor
because it clears the active `pnpm release:check` blocker, but no PR
formally depends on another. Topology is `parallel` — each branch is created
from trunk, not stacked.

### 1. agent/audit/x-02-validator-frontmatter-only
- **Type:** fix
- **Description:** restrict subagent_type validator to YAML frontmatter
- **Scope:** scripts/validate-agent-authoring.js, tests/integration/validate-agent-authoring/changelog-prose.fixture.md, AUDIT_REPORT.md, docs/brainstorms/2026-05-07-audit-followups-brainstorm.md, plans/audit-followups-2026-05-07.md
- **Tasks:** 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7
- **Depends on:** (none)

### 2. agent/audit/c-02-m-01-m-02-mechanical
- **Type:** chore
- **Description:** apply mechanical audit followups (C-02, M-01 reactive, M-02, C-01 doc note)
- **Scope:** plugins/yellow-core/commands/workflows/plan.md, CLAUDE.md, README.md, plugins/yellow-morph/hooks/scripts/prewarm-morph.sh, plugins/gt-workflow/CLAUDE.md
- **Tasks:** 2.1.1, 2.1.2, 2.2.1, 2.2.2, 2.3.1, 2.3.2, 2.4.1, 2.4.2, 2.5.1, 2.5.2, 2.5.3, 2.5.4, 2.5.5
- **Depends on:** (none)

### 3. agent/audit/h-01-morph-async-prewarm
- **Type:** perf
- **Description:** run yellow-morph prewarm in detached background to unblock session start
- **Scope:** plugins/yellow-morph/hooks/scripts/prewarm-morph.sh, plugins/yellow-morph/.claude-plugin/plugin.json
- **Tasks:** 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10
- **Depends on:** (none)

### 4. agent/audit/x-01-cross-plugin-dependencies
- **Type:** feat
- **Description:** declare cross-plugin MCP dependencies via existing schema dependencies field
- **Scope:** schemas/plugin.schema.json, scripts/validate-plugin.js, plugins/yellow-debt/.claude-plugin/plugin.json, plugins/yellow-ci/.claude-plugin/plugin.json, plugins/yellow-chatprd/.claude-plugin/plugin.json
- **Tasks:** 4.1.1, 4.1.2, 4.2.1, 4.2.2, 4.2.3, 4.3.1, 4.3.2, 4.3.3, 4.4.1, 4.4.2, 4.4.3, 4.4.4, 4.4.5, 4.4.6
- **Depends on:** (none) — ⚠️ external gate: do NOT tag a release until fresh `claude plugin install` smoke test passes

### 5. agent/audit/a-01-model-pins-a-02-tool-restrictions
- **Type:** feat
- **Description:** pin opus on deep-analysis review personas + audit tools on read-only research agents
- **Scope:** plugins/yellow-core/agents/review/security-sentinel.md, plugins/yellow-core/agents/review/performance-oracle.md, plugins/yellow-review/agents/review/adversarial-reviewer.md, plugins/yellow-review/agents/review/agent-cli-readiness-reviewer.md, plugins/yellow-review/agents/review/agent-native-reviewer.md, plugins/yellow-core/agents/research/, plugins/yellow-core/agents/workflow/spec-flow-analyzer.md, plugins/yellow-research/agents/research/code-researcher.md, plugins/yellow-codex/agents/research/codex-analyst.md, plugins/yellow-linear/agents/research/linear-explorer.md
- **Tasks:** 5.1.1, 5.1.2, 5.1.3, 5.1.4, 5.1.5, 5.1.6, 5.2.1, 5.2.2, 5.2.3, 5.2.4, 5.2.5, 5.2.6, 5.2.7, 5.2.8, 5.3.1, 5.3.2, 5.3.3, 5.3.4, 5.3.5
- **Depends on:** (none)

### 6. agent/audit/m-01-doc-counts-lint
- **Type:** feat
- **Description:** add validate-doc-counts.js to catch narrative-doc plugin-count drift
- **Scope:** scripts/validate-doc-counts.js, tests/integration/validate-doc-counts.test.ts, package.json
- **Tasks:** 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8
- **Depends on:** (none) — works best after item 2 lands so the lint passes its baseline check

## References

### Source documents
- `docs/brainstorms/2026-05-07-audit-followups-brainstorm.md` — decisions
- `AUDIT_REPORT.md` — full audit + executive summary

### Project docs
- `CLAUDE.md` — repository purpose, validator chain, release flow
- `AGENTS.md` — critical agent authoring rules (referenced by PR 5)
- `docs/solutions/build-errors/userconfig-type-title-remote-validator-drift.md`
  — precedent for "local CI ≠ remote validation" (PR 4 smoke gate)
- `docs/solutions/code-quality/skill-frontmatter-attribute-and-format-requirements.md`
  — single-line description rule (PR 5 on-touch)

### Schemas + scripts
- `schemas/plugin.schema.json` — modified by PR 4
- `scripts/validate-agent-authoring.js` — modified by PR 1
- `scripts/validate-plugin.js` — modified by PR 4
- `scripts/validate-doc-counts.js` — created by PR 6

### Existing pinned-model agents (reference for PR 5 A-01)
- `plugins/yellow-core/agents/review/architecture-strategist.md` (opus) ← **confirmed precedent; uses `model: opus` bare**
- `plugins/yellow-research/agents/research/research-conductor.md` (opus)
- `plugins/yellow-docs/agents/review/coherence-reviewer.md` (haiku)
- ~~`plugins/yellow-core/agents/synthesis/audit-synthesizer.md`~~ — **does not exist** (corrected by codebase research)

<!-- deepen-plan: external -->
> **External research sources** (used in PR 3 and PR 4 annotations above):
> - npm `peerDependencies` + `peerDependenciesMeta` semantics (npm 7+ — canonical
>   "annotate without splitting" pattern for optional peer deps)
> - VS Code Extension Manifest reference — `extensionDependencies` shape
>   (string-array, no optionality, no reason field)
>   <https://code.visualstudio.com/api/references/extension-manifest>
> - JetBrains plugin.xml — `<depends optional="true" config-file="...">`:
>   closest precedent for optional-with-structured-consequence
> - Chrome Extensions Manifest V3 — confirms absence of cross-extension dep field
> - bash(1) man page — `disown`, job control, SIGHUP signal forwarding behavior
> - POSIX signal semantics — zombie reaping via PID 1 (init/launchd) reparenting
>
> Ceramic and Tavily MCP sources returned no useful results for these queries
> (Ceramic: 0 hits for plugin dep schemas; Tavily: API key absent). Synthesis
> from training data on stable specifications.
<!-- /deepen-plan -->

### Items NOT addressed in this cycle
- A-02 Phase 2 (write-capable agent restrictions) — separate brainstorm
- S-01 (`create-agent-skills` SKILL.md line count) — soft-cap, no proven duplication
- Risk 6 (changeset enforcement gap) — separate audit topic
- Risk 7 (empirical hook latency baseline) — separate validation project
