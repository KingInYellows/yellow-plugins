# Feature: yellow-core Skills-Only Codex Pilot

## Overview

yellow-core is the smallest, lowest-risk first Codex enablement: exactly three
read-only skills, no hooks, no MCP, no agents. It exercises the entire
generation-validation-install pipeline end to end for the first time (first
non-empty Codex marketplace state) while the only Claude-side change is
converting the plan-status command into a thin wrapper over a new canonical
skill — with a parity gate proving identical behavior.

## Origin

- Spec: `plans/specs/claude-code-codex-plugin-pilot.md`
- Covers: R22, R23, R19 (partial: yellow-core-surfaces), R39 (partial:
  pr3-delivery), R42 (partial: yellow-core-acceptance)
- Shell: claude-code-codex-plugin-pilot-03-yellow-core-pilot

## Pattern Survey

- **yellow-core will be the first real Codex-enabled plugin.** All 17
  `catalog/plugins/*.json` files currently carry only
  `"targets": {"claude": true, "codex": {"enabled": false}}` — no plugin has
  ever populated `interface`, `skillAllowlist`, `description`, or
  `componentPaths`. `scripts/validate-codex.js`'s own header comment and
  Shell 02's plan confirm this explicitly. There is no existing catalog entry
  to pattern-match; the field names below come directly from
  `schemas/catalog-plugin.schema.json`.
- **No pure command→skill wrapper precedent exists**, but a fixed
  Skill-tool-invocation idiom does: `plugins/yellow-review/commands/review/sweep.md:90,122`
  reads "Invoke the `Skill` tool with `skill: "review:pr"`" / "`skill:
  "review:resolve"`" — always the skill's frontmatter `name:` value, never
  the filename. Replicate this exact prose idiom for `plan-status`.
- **Skill frontmatter/body convention** (from
  `plugins/yellow-core/skills/agent-native-architecture/SKILL.md` and
  `.../agent-native-audit/SKILL.md`, both already in this shell's
  allowlist): frontmatter is only `name`, single-line `description` (WHAT +
  "Use when..."), `user-invokable: false` — no `allowed-tools`. Body uses the
  three-heading structure `## What It Does` / `## When to Use` / `## Usage`.
  Both directories contain **only** `SKILL.md`, no sidecar files — required,
  because `buildCodexSkillTree` in `scripts/lib/generate/emit-codex.js`
  hard-rejects any skill directory with sidecar files (only `SKILL.md` is
  ever copied to the Codex distribution).
- **Two live slash-command references must not reach the skill body.**
  `plugins/yellow-core/commands/plan/status.md:16-18` reads "This command is
  a sibling of `/plan:complete` ... and `/workflows:plan`" — both are real
  registered command names (`plan:complete`, `workflows:plan`). If copied
  verbatim into the new skill's `SKILL.md`, `pnpm validate:codex`'s
  registry-gated `slash-command-syntax` exposure-lint check
  (`scripts/validate-codex.js:217,275-285`) will fail once
  `targets.codex.enabled: true` is set. The bash blocks themselves (Phase 1 +
  Phase 2 counting/rendering logic) contain no slash references and move
  over unchanged; only this one prose cross-reference needs rewording.
- **`componentPaths.skills` is NOT defaulted where the manifest builder
  reads it.** `buildCodexPluginManifest` (`scripts/lib/generate/emit-codex.js:100-103`)
  only sets the manifest's `"skills"` pointer when `codex.componentPaths.skills`
  is explicitly present — unlike `buildCodexSkillTree` and the exposure-lint
  collector, which both default to `./codex/skills`. Omitting the field from
  the catalog source passes every automated gate (schema, generate, lint) but
  silently ships a manifest with no `"skills"` field, surfacing only at
  manual Codex-app acceptance. The catalog entry below sets it explicitly.
- **Parity-gate design decision (shell lists no Open Questions, so resolved
  here rather than re-escalated):** the closest local precedent,
  `plugins/yellow-core/tests/plan-commands.bats`, mirrors `status.md`'s grep
  logic as hand-copied bats functions (`count_checked`/`count_unchecked`) —
  a *third* re-implementation, drift-prone against R23's "proving identical
  output before/after." Instead, this plan captures the command's actual
  stdout against fixed fixture scenarios **before** editing it as golden
  files, then asserts the extracted skill's logic reproduces them
  byte-for-byte **after** the move — a real before/after diff rather than
  another parallel reimplementation. This still can't literally source a
  shared script from inside the skill directory (sidecar files are rejected
  by the Codex skill-tree builder), so the skill's bash and the test's bash
  are two copies of the same literal block — same constraint
  `plan-commands.bats` already lives with, just anchored to a captured
  baseline instead of hand-derived expectations.
- **Changeset format precedent**: `.changeset/plan-complete-file-provenance-tier.md`
  (already applied, visible via `git show 67c0d212:.changeset/...`) —
  `'yellow-core': minor` frontmatter, one prose paragraph, trailing
  `<!-- markdownlint-disable-file MD041 -->`.
- **Codex spike findings from Shell 01** (argument passing: Codex skills
  receive verbatim prompt text, no `$ARGUMENTS` primitive) are not load-bearing
  here — `plan-status` takes no arguments (`status.md`'s `argument-hint: ''`,
  no `$ARGUMENTS` anywhere in its body).

## Implementation

- [x] Step 1: Capture parity baseline **before** touching `status.md`. Create
      three fixture scenarios under
      `plugins/yellow-core/tests/fixtures/plan-status/` (a temp-dir-style
      setup mirroring `plan-commands.bats`'s `setup()`/`FIXTURE_DIR`
      pattern): `empty/` (no `.md` files), `mixed/` (files with a mix of
      `- [x]`/`- [ ]` boxes, one at 100% completion to exercise the
      `-- ready to complete` annotation), `zero-task/` (a prose-only `.md`
      with no checkboxes, to exercise the `[ 0/0 ]` rendering). Run
      `plugins/yellow-core/commands/plan/status.md`'s current Phase 1 and
      Phase 2 bash blocks against each scenario (with `plans/`/`plans/complete/`
      pointed at the fixture dirs) and save raw stdout as golden files:
      `plugins/yellow-core/tests/fixtures/plan-status/{empty,mixed,zero-task}.golden.txt`.

- [x] Step 2: Create the canonical skill at
      `plugins/yellow-core/skills/plan-status/SKILL.md`. Frontmatter:
      `name: plan-status`, single-line `description` (WHAT + "Use when...",
      matching the style of `agent-native-architecture/SKILL.md:3`),
      `user-invokable: false`. Body: `## What It Does` / `## When to Use` /
      `## Usage` headings (matching
      `plugins/yellow-core/skills/agent-native-audit/SKILL.md`'s structure).
      Move `status.md`'s Phase 1 and Phase 2 bash blocks into `## Usage`
      **unchanged** (same grep/printf logic, same `-- ready to complete`
      annotation, same `[ 0/0 ]` zero-task rendering). Carry the `## Notes`
      content (the three bullets about `[ 0/0 ]` rendering, the annotation
      scope, and stray-checkbox handling in archived files) into `## Usage`
      too, but reword the "sibling of `/plan:complete` ... and
      `/workflows:plan`" line to prose with no slash-command syntax (e.g.
      "complements the plan-completion and plan-creation workflows in this
      repo") — this line stays out of the skill entirely if it reads more
      naturally dropped than reworded; the wrapper command (Step 3) is the
      right home for it since it is Claude-only and never Codex-distributed.
      Confirm the skill directory contains only `SKILL.md` (no
      `references/` subdirectory).

- [x] Step 3: Convert `plugins/yellow-core/commands/plan/status.md` into a
      thin wrapper. Frontmatter: keep `name: plan:status`, `description`,
      and `argument-hint: ''` unchanged; change `allowed-tools` from
      `[Bash]` to `[Skill]`. Replace the two bash code-fence phases with
      prose: "Invoke the `Skill` tool with `skill: "plan-status"`." (matching
      the exact idiom at `plugins/yellow-review/commands/review/sweep.md:90,122`
      — the skill's frontmatter `name:` value, not a filename). Keep the
      "sibling of `/plan:complete` ... `/workflows:plan`" cross-reference
      here in the wrapper (Claude-only, fine to keep as slash syntax).

- [x] Step 4: Write the parity gate at
      `plugins/yellow-core/tests/plan-status-parity.bats`. Duplicate the
      skill's exact bash logic as bats functions (same convention as
      `count_checked`/`count_unchecked` in
      `plugins/yellow-core/tests/plan-commands.bats:47-49`, but exercising
      the full Phase 1/2 table-rendering output, not just the counts). Run
      each fixture scenario from Step 1 through this logic and diff the
      captured stdout against the corresponding
      `plugins/yellow-core/tests/fixtures/plan-status/*.golden.txt` file —
      the test fails on any byte difference. Update the stale "(mirrors
      status.md, case-insensitive for GFM [X])" comment on
      `count_checked` in `plan-commands.bats:47` to point at
      `plugins/yellow-core/skills/plan-status/SKILL.md` instead, since that
      is now where the logic actually lives.

- [x] Step 5: Enable Codex for yellow-core in the catalog source. Edit
      `catalog/plugins/yellow-core.json`'s `targets.codex` block:
      - `"enabled": true`
      - `"interface": {"displayName": "Yellow Core", "category": "Developer Tools"}`
        (required once `enabled: true` per
        `schemas/catalog-plugin.schema.json`; `"Developer Tools"` matches the
        root `catalog/catalog.json` marketplace-wide default — no existing
        per-plugin precedent to match instead, so this is a deliberate,
        documented choice rather than a discovered convention)
      - `"skillAllowlist": ["agent-native-architecture", "agent-native-audit", "plan-status"]`
      - `"componentPaths": {"skills": "./codex/skills"}` — must be explicit
        (see Pattern Survey: not defaulted where `buildCodexPluginManifest`
        reads it)
      - `"description"` stating the three-skill read-only subset per R22,
        e.g. "Three read-only reference and dashboard skills — agent-native
        architecture principles, an agent-native audit checklist, and a
        plan-status dashboard. Excludes all of yellow-core's commands,
        agents, hooks, and other skills."

- [x] Step 6: Regenerate and validate. Run `pnpm generate:manifests` —
      confirms it produces `plugins/yellow-core/.codex-plugin/plugin.json`
      and `plugins/yellow-core/codex/skills/{agent-native-architecture,agent-native-audit,plan-status}/SKILL.md`.
      Run `pnpm validate:codex` and confirm it exits 0 (schema validation +
      exposure lint, including the `slash-command-syntax` check against the
      new skill body). Run the CI baseline gate: `pnpm validate:schemas &&
      pnpm test:unit && pnpm lint && pnpm typecheck`. Run
      `bats plugins/yellow-core/tests/plan-status-parity.bats` and
      `bats plugins/yellow-core/tests/plan-commands.bats` from inside
      `plugins/yellow-core/` per repo bats convention.

- [ ] Step 7: Confirm CI install-verification. After pushing, confirm the
      `CODEX_HOME` install-verification job(s) in
      `.github/workflows/validate-schemas.yml` pass for the now-single-entry
      Codex marketplace (this is CI-side, not locally reproducible — verify
      post-push rather than treating it as a local step).

- [x] Step 8: Update `plugins/yellow-core/CLAUDE.md`'s component inventory —
      bump the Skills count and add a `plan-status` entry to the Skills
      list; note in the `/plan:status` command-list entry that it is now a
      thin wrapper over the `plan-status` skill; add a brief note (new
      subsection or amendment to an existing one) that yellow-core is the
      first Codex-enabled plugin in this repo, with the three-skill
      read-only allowlist. This follows the root `CLAUDE.md` "When you
      change a plugin" step 4 ("Update the plugin's README.md and CLAUDE.md
      if behavior changed").

- [ ] Step 9: Manual Codex-app acceptance (human step, not automatable from
      this session). Install the plugin in a Codex app session and confirm
      exactly three skills are visible — `agent-native-architecture`,
      `agent-native-audit`, `plan-status` — with nothing else exposed (no
      commands, agents, or hooks). Record the evidence (screenshot or notes)
      per R42.

- [x] Step 10: Changeset + delivery. Run `pnpm changeset`, select
      `yellow-core` with a `minor` bump (matches R39's per-plugin-port
      convention), and write a description covering both the plan-status
      skill extraction and the Codex enablement. Commit via `gt modify -c`
      and submit via `gt submit --no-interactive` per repo workflow
      conventions (this is stacked PR three per the shell's original
      Context).

## Verification

- `bats plugins/yellow-core/tests/plan-status-parity.bats` (run from
  `plugins/yellow-core/`) -> expected: all assertions pass, byte-identical
  output vs. the Step 1 golden fixtures for all three scenarios.
- `bats plugins/yellow-core/tests/plan-commands.bats` (run from
  `plugins/yellow-core/`) -> expected: existing tests still pass unchanged
  (only the stale comment moved).
- `pnpm generate:manifests` -> expected: creates/updates
  `plugins/yellow-core/.codex-plugin/plugin.json` and
  `plugins/yellow-core/codex/skills/*/SKILL.md`; re-running produces no diff
  (idempotent).
- `pnpm validate:codex` -> expected: exit 0, output confirms 1 Codex-enabled
  plugin passes artifact validation and the exposure lint.
- `pnpm validate:schemas && pnpm test:unit && pnpm lint && pnpm typecheck`
  -> expected: all green (CI baseline gate).
- Manual: install in a Codex app session, confirm exactly 3 skills visible,
  nothing else exposed (R42).

## Context Files

- `plugins/yellow-core/commands/plan/status.md` — command being converted to
  a thin wrapper; source of the Phase 1/2 bash logic being extracted
- `plugins/yellow-core/skills/agent-native-architecture/SKILL.md`,
  `plugins/yellow-core/skills/agent-native-audit/SKILL.md` — frontmatter and
  three-heading structure convention to match
- `plugins/yellow-core/tests/plan-commands.bats` — existing mirror-style
  bash-logic test convention; comment needs updating in Step 4
- `catalog/plugins/yellow-core.json` — catalog source edited in Step 5
- `schemas/catalog-plugin.schema.json` — `targets.codex.interface` /
  `skillAllowlist` / `componentPaths` field contract (lines ~74-135)
- `scripts/lib/generate/emit-codex.js` — `buildCodexPluginManifest` /
  `buildCodexSkillTree`; the `componentPaths.skills` non-default blocker
  (lines 89-103, 185-204)
- `scripts/validate-codex.js` — exposure lint, `SLASH_COMMAND_PATTERN`
  registry-gated check (lines 217, 275-285)
- `plugins/yellow-review/commands/review/sweep.md` — Skill-tool invocation
  idiom precedent (lines 90, 122-128)
- `.changeset/plan-complete-file-provenance-tier.md` — changeset format
  precedent (via `git show 67c0d212:.changeset/plan-complete-file-provenance-tier.md`)
- `plans/complete/claude-code-codex-plugin-pilot-01-neutral-generation.md`,
  `plans/complete/claude-code-codex-plugin-pilot-02-codex-tooling.md` — prior
  shells this one consumes catalog/generator/emitter/validator work from
