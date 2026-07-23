# Feature: yellow-ci Read-Mostly Codex Pilot and Close-Out

## Overview

yellow-ci is the read-mostly pilot and the close-out shell (PR 5 of 5). It
exposes eight skills to Codex (six operational plus the two existing reference
skills marked non-implicit), folds `failure-analyst`/`runner-diagnostics`
instructions into skill references with built-in Codex delegation (the agents
themselves stay Claude-only), ports the `SessionStart` hook onto the Node
runtime pattern established by the gt-workflow shell, relocates cache writes
under plugin data directories with a read-only legacy fallback, and finalizes
the pilot's documentation — the canonical distribution doc, the cross-host
hook-envelope solution write-up, and the explicit non-advertising of repo-wide
Codex support.

This is the third plugin to enable Codex (after yellow-core and gt-workflow),
producing the final canonical three-plugin Codex marketplace: `gt-workflow`,
`yellow-core`, `yellow-ci`.

## Origin

- Spec: `plans/specs/claude-code-codex-plugin-pilot.md`
- Covers: R29, R30, R31, R32, R33, R38, R40, R41; partial R19
  (yellow-ci Claude-visible surfaces reassert byte-identity), R34/R35/R36/R37
  (yellow-ci SessionStart slice of the cross-host hook work), R39 (PR-5
  delivery), R42 (yellow-ci manual acceptance), R43 (yellow-ci fake-exec tests)
- Shell: `claude-code-codex-plugin-pilot-05-yellow-ci-pilot`
- Depends on (all archived in `plans/complete/`): shells 01 (neutral
  generation), 02 (Codex tooling), 03 (yellow-core pilot), 04 (gt-workflow
  pilot)

## Design Decision — R31↔R15 resolution (host-neutral skill bodies)

Expansion surfaced a verified conflict between three requirements this PR must
satisfy simultaneously. It was escalated, researched against current Codex +
Claude Code documentation, and resolved as follows. This replaces the shell's
"Open Questions: None".

**The conflict (verified against `scripts/validate-codex.js`):**

- R29 mandates all six operational skills be Codex-exposed.
- R31 mandates retaining the existing `.claude/`-rooted config paths
  (`.claude/yellow-ci-runner-targets.yaml`, `.claude/yellow-ci.local.md`) with
  no config migration.
- R15's exposure lint (`DIRECT_CHECKS`, `scripts/validate-codex.js:167-204`)
  UNCONDITIONALLY rejects any literal `.claude/` substring
  (`/\.claude\//g`, line 175) and any `CLAUDE_(PLUGIN_ROOT|PLUGIN_DATA|…)`
  reference (line 201) in Codex-exposed skill/manifest content.

`ci-setup`, `ci-setup-runner-targets`, and `ci-runner-health` source
`${CLAUDE_PLUGIN_ROOT}/hooks/scripts/lib/*.sh` and read/write `.claude/` config
as their core function — so flipping `codex.enabled: true` runs the lint
against every allowlisted skill at once and fails the whole PR.

**Resolution: host-neutral skill bodies (no spec amendment).** Research
(official Codex docs at `learn.chatgpt.com/docs/build-skills`, the
`openai/codex` source via DeepWiki, and a Perplexity deep-research synthesis)
confirms Codex never reads `.claude/` — it uses `~/.codex/`, `CODEX_HOME`, and
`.codex/skills`/`.agents/skills`, and its published cross-host guidance is
explicitly: *avoid naming `.claude/` or `${CLAUDE_PLUGIN_ROOT}` in SKILL.md;
describe behavior host-neutrally; let plugin hooks/wrappers resolve host paths
via env vars.* Therefore:

- R31 means "do not migrate the Claude-side config location," NOT "the shared
  skill body must literally name `.claude/`." Naming `.claude/` in Codex
  content would instruct the model to touch a directory that does not exist in
  a Codex session.
- The **exposure lint only scans the manifest + generated `codex/skills/**`**
  (`collectCodexExposedFiles`, `validate-codex.js:366-435`). It does NOT scan
  `hooks/scripts/*.js`, `hooks/codex-hooks.json`, `hooks/scripts/lib/*.sh`, or
  command wrappers (`commands/**`). So all Claude-only infrastructure that
  actually retains `.claude/` behavior stays untouched and unlinted.

Concretely:

1. The six shared SKILL.md bodies (which become both the Claude
   implementation and the copied Codex tree) are authored host-neutral:
   anchor on the existing host-neutral global config
   `~/.config/yellow-ci/runner-targets.yaml` (XDG, lint-safe, works on both
   hosts); describe any per-repo override in prose without the literal
   `.claude/`; inline the needed validation as prose (the `ci-conventions`
   precedent) instead of `source ${CLAUDE_PLUGIN_ROOT}/...lib.sh`.
2. The Claude-only specifics — the per-repo `.claude/` override, the
   lib-based precedence resolution in
   `hooks/scripts/lib/resolve-runner-targets.sh`, and cache env vars — stay in
   the non-linted layer (the hook Node runtime + the bash libs + the command
   wrappers), which R31 keeps unchanged. R38's cache relocation lives in the
   Node hook, where `CLAUDE_PLUGIN_DATA` is permitted (not exposure-linted) and
   is even set by Codex for plugin-hook compat.

This satisfies R29 (all six exposed), R31 (Claude config retained, nothing
migrated), and R15 (lint clean) with no spec change, and is correct design
rather than a cosmetic substring dodge — the Codex content points at what
actually works on Codex.

**Two research follow-ups carried as re-verify steps** (per R29's own
"re-verify via a live spike before implementing" clause; the 2026-07-16 spike
found these unparsed/inert on codex-cli 0.144.1, but current Codex docs
describe them as supported — version skew):

- `agents/openai.yaml` `allow_implicit_invocation: false` is the documented
  non-implicit mechanism. Re-run the spike on the current target CLI; if
  honored, ship `agents/openai.yaml` for the two reference skills instead of
  relying only on SKILL.md description phrasing.
- Plugin-shipped `SessionStart` hook execution — re-confirm status; keep the
  "carried but possibly inert" framing if still `removed`.

## Pattern Survey

Grounded against the live repo and the gt-workflow (shell 04) / yellow-core
(shell 03) precedents.

**Skill/wrapper idiom (RULE 17).** Each converted command keeps its
`name`/`argument-hint`/`description`, ADDS `Skill` to its existing
`allowed-tools` (never a replacing `[Skill]` list — anti-pattern #28), and its
body becomes a thin invocation with an explicit `$ARGUMENTS` passthrough
sentence (anti-pattern #29). The canonical implementation moves into
`skills/<name>/SKILL.md` with `user-invokable: false`, a single-line
`description`, and the three headings `## What It Does` / `## When to Use` /
`## Usage`. Precedent: `plugins/gt-workflow/commands/gt-nav.md` +
`plugins/gt-workflow/skills/gt-nav/SKILL.md`. `validate-agent-authoring.js`
RULE 17 auto-covers the new wrappers (any command body containing
`skill: "<name>"`).

**Exact `allowed-tools` to preserve on conversion** (existing ∪ `{Skill}`):
- `commands/ci/status.md`: `Bash` (+ `model: haiku`) → add `Skill`
- `commands/ci/diagnose.md`: `Bash, Read, Grep, Glob, AskUserQuestion, Task`
  (+ `model: sonnet`) → add `Skill` (keep `Task` for R30 Claude-side
  delegation)
- `commands/ci/lint-workflows.md`: `Bash, Read, Glob, Grep, Edit,
  AskUserQuestion` → add `Skill`
- `commands/ci/runner-health.md`: `Bash, Read, AskUserQuestion` → add `Skill`
- `commands/ci/setup.md`: `Bash, Read, Write, AskUserQuestion` → add `Skill`
- `commands/ci/setup-runner-targets.md`: `Bash, Read, Write, AskUserQuestion`
  (+ `model: sonnet`) → add `Skill`

**`user-invokable: false` for all six new skills** — matches the gt-workflow
precedent (a command wrapper is each skill's Claude-side user surface; Codex
reaches them directly). A naïve AGENTS.md read would wrongly set `true`; this
is the highest drift risk.

**Naming collision (spec-mandated, not a bug).** `ci-diagnose` (new,
operational) sits beside `diagnose-ci` (existing, reference) — R29 names both.
Disambiguate via description phrasing: `ci-diagnose` = run diagnosis now;
`diagnose-ci` = reference workflow guide.

**Node hook runtime (gt-workflow shape, replicated per-plugin — R34 forbids
cross-plugin imports).** `plugins/gt-workflow/hooks/scripts/` provides:
`lib/envelope.js` (`snakeToCamelEnvelope`; Claude & Codex stdin are both
snake_case), `lib/run-hook.js` (`runHook`; 64KB stdin bound via
`MAX_STDIN_BYTES`, `JSON.parse('null')` guard), thin
`entrypoint-claude.js`/`entrypoint-codex.js`. Structural gap: gt-workflow's
policies are pure `envelope → decision`; yellow-ci's `SessionStart` is
I/O-heavy (fs, `gh` subprocess). The SessionStart output shape is the shared
`{"continue": true[, "systemMessage"]}` on both hosts (R36), so no
PreToolUse-deny branch is needed. Golden-fixture parity harness:
`plugins/gt-workflow/tests/hook-parity.bats` + `tests/fixtures/hooks/`
(`<case>.stdin` + `<case>.golden.txt`).

**Current hook (`plugins/yellow-ci/hooks/scripts/session-start.sh`).** Reads
`${HOME}/.cache/yellow-ci/routing-summary.txt` (head -c 500) before any `gh`
check; early-exits without `.github/workflows`; degrades to routing-summary
only when `gh` is missing/unauthed; 60s-TTL cache at
`${HOME}/.cache/yellow-ci/last-check-<md5(PWD)>`; `timeout 2 gh run list`;
parses via `jq`; always emits `{"continue": true}` optionally with
`systemMessage`. `set -uo pipefail` (never `-e`). Authoritative Claude hook
config is INLINE in `catalog/plugins/yellow-ci.json` `hooks` (R20);
`hooks/hooks.json` is a non-authoritative mirror.

**Cache paths today (all under `${HOME}/.cache/yellow-ci/`).**
`session-start.sh` (`routing-summary.txt` read, `last-check-<hash>` r/w);
`hooks/scripts/lib/resolve-runner-targets.sh` (`rt_cache_dir()`,
`routing-summary.txt` + `runner-targets-merged.json` writes via
`rt_atomic_write()`). No `PLUGIN_DATA`/`CLAUDE_PLUGIN_DATA` usage and no
read-only-legacy-fallback pattern exist anywhere yet — R38 is greenfield
design.

**Catalog enablement.** `catalog/plugins/yellow-ci.json` currently
`"targets": {"claude": true, "codex": {"enabled": false}}`. Target shape to add
mirrors `catalog/plugins/gt-workflow.json` (`enabled: true` + `interface` +
`description` + `skillAllowlist` + `componentPaths: {skills: "./codex/skills"}`)
but keeps `includeHooks` at its default `true` (like gt-workflow, unlike
yellow-core's opt-out) so the SessionStart hook carries to Codex. Codex
marketplace order is COMPUTED (filter `catalog/catalog.json` `pluginOrder` by
`targets.codex.enabled`), so flipping yellow-ci yields
`[gt-workflow, yellow-core, yellow-ci]` automatically (R5). Serialization is
`JSON.stringify(obj, null, 2) + '\n'`; `codex/skills/**`, `.codex-plugin/`, and
`hooks/codex-hooks.json` are generation targets — never hand-edit.
`hooks/codex-hooks.json` carries `commandWindows` (R36) — see
`plugins/gt-workflow/hooks/codex-hooks.json`.

**Deferred/absent from Codex (R33), confirmed against `commands/ci/`.**
`runner-cleanup.md`, `setup-self-hosted.md`, `report-linear.md` stay
non-wrapped Claude-only commands, absent from the allowlist; the
`runner-assignment` and `workflow-optimizer` agents (which back
`setup-self-hosted`) and the yellow-linear/ruvector/morph integrations remain
Claude-only.

**subagent_type (fully-qualified).** `yellow-ci:ci:failure-analyst`,
`yellow-ci:maintenance:runner-diagnostics`,
`yellow-ci:ci:workflow-optimizer`, `yellow-ci:ci:runner-assignment`.
`agents/ci/failure-analyst.md:159` currently uses a bare `runner-diagnostics`
Task reference — any new Claude-side delegation text should use the
3-segment form. `subagent_type` is banned in exposed skill bodies (DIRECT_CHECK
line 190), so R30's fold describes worker/explorer delegation in prose (the
`audit-review` precedent), not a Task dispatch.

**Docs baseline.** No single canonical distribution doc exists yet (candidates:
`docs/solutions/integration-issues/codex-plugin-manifest-and-hook-contract.md`,
`.../codex-distribution-pipeline-silent-gaps.md`). No dedicated cross-host
hook-envelope solution doc exists (the pattern is documented only inline in
gt-workflow's CLAUDE.md) — R40's write-up lands entirely here. AGENTS.md is
already Codex-aware (lines 18, 72-77, 158, 281). `docs/security.md` hooks table
(~124-129) lists yellow-ci's SessionStart hook. `README.md` (lines 27, 269)
lists yellow-ci without a Codex-support claim — correct for R41; keep it that
way.

**Delivery.** `plugins/yellow-ci/package.json` = `1.4.6`; no pending
changesets. New skills are additive → `minor` (R39). Manual-acceptance
precedent: gt-workflow's CLAUDE.md "Codex Distribution" section documents a real
`codex plugin add` round-trip with byte-identity confirmation and an explicit
unverified-gap note (R42).

## Implementation

### Phase A — Operational skills + reference-skill non-implicit marking (R29, R31, R32, R33)

- [x] Author `plugins/yellow-ci/skills/ci-status/SKILL.md` from
  `commands/ci/status.md` (cleanest — no `.claude/`/`$ARGUMENTS`/slash refs):
  `user-invokable: false`, single-line description, three headings, host-neutral
  body. Then convert `commands/ci/status.md` to a thin wrapper — `allowed-tools:
  [Bash, Skill]`, keep `model: haiku`, body invokes `Skill` with
  `skill: "ci-status"` and the literal `$ARGUMENTS` passthrough sentence.
- [x] Author `plugins/yellow-ci/skills/ci-lint-workflows/SKILL.md` from
  `commands/ci/lint-workflows.md`: reword its `$ARGUMENTS` to
  "the argument text after the skill name" prose; keep W01-W14 lint logic; add
  an R32 preview-and-confirm gate before any `Edit`-based workflow lint fix.
  Convert `commands/ci/lint-workflows.md` to a wrapper (`allowed-tools:
  [Bash, Read, Glob, Grep, Edit, AskUserQuestion, Skill]`, `$ARGUMENTS`
  passthrough).
- [x] Author `plugins/yellow-ci/skills/ci-diagnose/SKILL.md` from
  `commands/ci/diagnose.md`: reword `$ARGUMENTS`; replace the `/ci:status`
  slash-ref with prose; FOLD the `failure-analyst` F01-F12 diagnosis inline as
  host-neutral prose with a built-in Codex worker/explorer delegation section
  (R30, `audit-review` precedent) — NO `subagent_type` in the shared body;
  route all CI-log excerpts through `redact_secrets()` + `--- begin/end
  ci-log ---` fencing. Description disambiguates from `diagnose-ci`. Convert
  `commands/ci/diagnose.md` to a wrapper keeping `Task` (Claude-side
  failure-analyst delegation) + `model: sonnet`: `allowed-tools:
  [Bash, Read, Grep, Glob, AskUserQuestion, Task, Skill]`, `$ARGUMENTS`
  passthrough.
- [x] Author `plugins/yellow-ci/skills/ci-setup/SKILL.md` from
  `commands/ci/setup.md`: host-neutral body — no literal `.claude/`, no
  `${CLAUDE_PLUGIN_ROOT}` sourcing; inline prerequisite/SSH-config validation
  as prose; reference the global `~/.config/yellow-ci/` config; describe the
  per-repo override generically; R32 preview-and-confirm before any SSH/config
  write; skip Windows/macOS remote runner probes with a clear "Linux runner
  targets only" message. Convert `commands/ci/setup.md` to a wrapper
  (`allowed-tools: [Bash, Read, Write, AskUserQuestion, Skill]`, `$ARGUMENTS`
  passthrough).
- [x] Author `plugins/yellow-ci/skills/ci-setup-runner-targets/SKILL.md` from
  `commands/ci/setup-runner-targets.md`: host-neutral body operating on the
  global `~/.config/yellow-ci/runner-targets.yaml`; per-repo override described
  in prose (no literal `.claude/`); inline schema validation
  (`schemas/runner-targets.schema.json` rules) as prose; R32 preview-and-confirm
  before config writes. Convert `commands/ci/setup-runner-targets.md` to a
  wrapper (`allowed-tools: [Bash, Read, Write, AskUserQuestion, Skill]`, keep
  `model: sonnet`, `$ARGUMENTS` passthrough).
- [x] Author `plugins/yellow-ci/skills/ci-runner-health/SKILL.md` from
  `commands/ci/runner-health.md`: host-neutral body — read runner SSH config
  host-neutrally (no literal `.claude/`); remove the `/ci:runner-cleanup`
  slash-ref (R33-deferred, Codex-unavailable) → prose; FOLD the relevant
  `runner-diagnostics` deep-investigation instructions inline as host-neutral
  prose with a built-in Codex worker/explorer delegation section (R30,
  `audit-review` precedent) — NO `subagent_type` in the shared body; R32 SSH
  preview + non-Linux probe skip message; retain the SSH-safety contract
  (`StrictHostKeyChecking=accept-new`, `BatchMode=yes`, key-only, no `-A`).
  Convert `commands/ci/runner-health.md` to a wrapper (`allowed-tools:
  [Bash, Read, AskUserQuestion, Skill]`, `$ARGUMENTS` passthrough).
- [x] Reword `plugins/yellow-ci/skills/diagnose-ci/SKILL.md` (reference skill):
  remove ALL literal slash-command syntax (`/ci:status`, `/ci:diagnose`,
  `/ci:runner-health`, `/ci:runner-cleanup`, `/ci:lint-workflows`,
  `/ci:setup-self-hosted`) → host-neutral prose that stops recommending
  R33-deferred/Codex-unavailable commands; reword `description:` to discourage
  implicit invocation (R29 interim lever — "reference guide, not an executable
  action").
- [x] Reword `plugins/yellow-ci/skills/ci-conventions/SKILL.md` `description:`
  for the same non-implicit lever (already reference-phrased; light touch).
  NOTE (deviation): the task text said "light touch (description only)", but the
  body also carried lint-fatal `.claude/` paths (per-repo override, error-catalog
  E04/E05) and `/ci:*` slash-commands ("When This Skill Loads"). R15 + the plan's
  own Verification grep require zero `.claude/`/slash leaks in every exposed
  skill, so the body was host-neutralized too (config path/cache described
  generically; error-catalog paths generalized; consumers named in prose).
- [x] R29 openai.yaml re-verification: run a live spike on the CURRENT target
  codex-cli (`codex features list`; a fixture skill with
  `agents/openai.yaml` `allow_implicit_invocation: false`). If honored, add
  `plugins/yellow-ci/agents/openai.yaml` marking `ci-conventions` and
  `diagnose-ci` non-implicit and record the CLI version; if still unparsed,
  keep the description-phrasing lever and document the deferral in the plugin
  CLAUDE.md. Update `docs/solutions/integration-issues/codex-plugin-manifest-and-hook-contract.md`
  with the re-verified finding.
  RESULT (0.144.6): `allow_implicit_invocation` IS now honored (reverses the
  0.144.1 finding) — the binary validates `policy.allow_implicit_invocation`,
  and real plugins (zoom) ship it per-skill at `skills/<name>/agents/openai.yaml`.
  But shipping it is blocked by OUR generator (`emit-codex.js` copies SKILL.md
  only and rejects sidecars), not by Codex — so the marking stays deferred with a
  CORRECTED reason; the description-phrasing lever (A7/A8) is retained.
  `plugin_hooks` still `removed`. Contract doc updated ("Update — 2026-07-23 (b)").
  Plugin CLAUDE.md deferral note lands in F3. Discovered prerequisite (see the
  A9-prime item below): `ci-conventions` had a `references/` sidecar that the same
  generator guard rejects, so it must be relocated before D2.

- [x] A9-prime (discovered prerequisite for D2, not in the original shell):
  `ci-conventions` is R29-mandated for Codex exposure but its `skills/ci-conventions/references/`
  sidecar dir trips `emit-codex.js`'s SKILL.md-only guard. Relocate the three
  reference files out of the skill dir to a plugin-level `references/` path (the
  contained fix; no shared-generator change), and repoint the Claude-only
  `failure-analyst`/`runner-diagnostics` agents and the `ci-conventions` body at
  the new location so the skill dir is SKILL.md-only and generator-clean.

### Phase B — SessionStart Node runtime port (R34, R35, R36, R37)

- [x] Capture golden fixtures from the CURRENT `session-start.sh` behavior
  (before any deletion) under
  `plugins/yellow-ci/tests/fixtures/hooks/`: `no-workflows`,
  `routing-summary-present`, `routing-summary-absent`, `gh-missing`,
  `gh-unauthed`, `cache-hit`, `cache-miss-failures`, `malformed-gh-json`,
  `rate-limited-gh` — each `<case>.stdin` + `<case>.golden.txt`.
- [x] Author yellow-ci's own Node runtime under
  `plugins/yellow-ci/hooks/scripts/` (dependency-free Node >=22.22; no
  cross-plugin import — R34): `lib/envelope.js`
  (SessionStart `formatOutput` → `{"continue": true[, "systemMessage"]}` on both
  hosts; `snakeToCamelEnvelope` for stdin normalization — R35);
  `lib/session-start-core.js` (I/O module replicating `session-start.sh`:
  `.github/workflows` gate, routing-summary read, `gh` auth/`gh run list` via
  `child_process`, JSON via `JSON.parse` — NO `jq`, 60s TTL, output assembly,
  safe degradation without `gh`/network); `lib/run-hook.js` (64KB stdin bound,
  `JSON.parse('null')` guard, guaranteed-JSON fail-open); thin
  `entrypoint-claude.js` + `entrypoint-codex.js`. Normalize LF endings
  (`sed -i 's/\r$//'`).
- [x] Point the authoritative Claude hook config at the Node entrypoint: edit
  `catalog/plugins/yellow-ci.json` `hooks.SessionStart[0].hooks[0].command` to
  `node ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/entrypoint-claude.js` (keep
  `timeout: 3`). Update `plugins/yellow-ci/hooks/hooks.json` non-authoritative
  mirror to match.
- [x] Verify the generated `plugins/yellow-ci/hooks/codex-hooks.json` declares
  `SessionStart` → `entrypoint-codex.js` WITH a `commandWindows` twin (R36) and
  emits `{"continue": true}` (never a PreToolUse-style `continue` omission).
  Verified after D2 generation: command + commandWindows both
  `node ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/entrypoint-codex.js`, timeout 3.
- [x] Delete `plugins/yellow-ci/hooks/scripts/session-start.sh` only after the
  parity harness (Phase E) is green. (Done after E2 hook-parity.bats went green;
  CLAUDE.md Hooks listing updated to the Node runtime.)

### Phase C — Cache relocation (R38)

- [x] Relocate the Node hook's cache writes to a plugin-data location with a
  read-only legacy fallback: write under
  `${CLAUDE_PLUGIN_DATA:-${XDG_DATA_HOME:-$HOME/.local/share}/yellow-ci}/…`
  (env vars live in the non-linted hook layer; Codex sets `CLAUDE_PLUGIN_DATA`
  for plugin-hook compat); on read, prefer the new path and fall back
  READ-ONLY to the legacy `${HOME}/.cache/yellow-ci/…` (never write the legacy
  path again). Preserve the bounded `md5(PWD)` cache-key logic. Define the
  exact path shape once in `session-start-core.js` and reuse.
- [x] Apply the same new-write / legacy-read-fallback relocation to
  `hooks/scripts/lib/resolve-runner-targets.sh` (`rt_cache_dir()`,
  `routing-summary.txt`, `runner-targets-merged.json`) so the routing-summary
  the Node hook reads is produced at the new location. Keep `.claude/`
  per-repo override reads intact (R31; this lib is not exposure-linted).
- [x] Document the cache locations + fallback in `plugins/yellow-ci/CLAUDE.md`
  and `skills/ci-conventions/SKILL.md` (host-neutral phrasing).
  (ci-conventions body was made host-neutral in A8; CLAUDE.md gets a "Cache
  Locations (R38)" subsection here.)

### Phase D — Catalog enablement + regenerate (R39, R5, R19)

- [x] Edit `catalog/plugins/yellow-ci.json` `targets.codex`: set
  `enabled: true`; add `interface: {displayName: "Yellow CI", category:
  "Developer Tools"}`, a `description`, `skillAllowlist: [ci-setup,
  ci-setup-runner-targets, ci-status, ci-diagnose, ci-lint-workflows,
  ci-runner-health, ci-conventions, diagnose-ci]`, and
  `componentPaths: {skills: "./codex/skills"}`. Leave `includeHooks` at its
  default `true`.
- [x] Run `pnpm generate:manifests` to regenerate
  `plugins/yellow-ci/.codex-plugin/plugin.json`,
  `plugins/yellow-ci/hooks/codex-hooks.json`, and
  `plugins/yellow-ci/codex/skills/<8>/SKILL.md` (frontmatter normalized to
  `name` + single-line `description`). Never hand-edit these.
- [x] Confirm `.agents/plugins/marketplace.json` lists the Codex plugins in
  canonical order `[gt-workflow, yellow-core, yellow-ci]` (computed from
  `catalog.json` `pluginOrder`). Verified: `[gt-workflow, yellow-core, yellow-ci]`.

### Phase E — Fake-executable + parity tests (R43, R37)

- [x] Add PATH-stub fake executables under `plugins/yellow-ci/tests/mocks/`:
  `gh` and `ssh` (yellow-review/gt-workflow shape — `#!/bin/sh`, `set -eu`,
  log to `${MOCK_<NAME>_LOG:-/dev/null}`, `case "$*"` pattern match, canned
  output incl. rate-limit + malformed-JSON responses, fall through to an
  explicit `unhandled arguments` error + exit 1).
- [x] Add `plugins/yellow-ci/tests/hook-parity.bats` — pipe each fixture stdin
  through the Node entrypoints (`entrypoint-claude.js` and
  `entrypoint-codex.js`) and diff stdout + exit code against the goldens
  (JSON-semantic where output is JSON).
- [x] Add bats coverage for the R43 fake-exec matrix (using the `gh`/`ssh`
  mocks, no external writes): failure diagnosis, rate limits, malformed
  responses, runner-target validation, and non-Linux probe rejection. Keep
  `tests/redaction.bats` (redaction of the 13+ `redact.sh` patterns) and
  `tests/resolve-runner-targets.bats` passing after the cache relocation.
  `fake-exec.bats` covers the SSH-safety contract shape + connection-failure
  categorization + runner-target validation; the gh-driven failure/rate-limit/
  malformed cases are covered end-to-end by `hook-parity.bats`; the SSH probe
  ORCHESTRATION + non-Linux skip are markdown-scoped (documented skip, gt-workflow
  precedent). DISCOVERED + FIXED a pre-existing `redact.sh` bug (unrelated to this
  PR): the generic key/value catch-all clobbered specific `[REDACTED:<label>]`
  redactions back to a bare `[REDACTED]` (4 redaction.bats cases had been failing
  on main); fixed by excluding already-`[`-prefixed values — no secret leak (the
  secret was always redacted; only the label was lost).
- [x] Run `bats tests/` from `plugins/yellow-ci/` — all suites green. (166 pass,
  0 fail, 1 documented skip after the redact.sh fix.)

### Phase F — Documentation close-out (R40, R41)

- [x] Establish exactly ONE canonical neutral-catalog/distribution doc (R40):
  create `docs/codex-distribution.md` (or promote
  `docs/solutions/integration-issues/codex-distribution-pipeline-silent-gaps.md`
  with canonical framing), and add cross-references to it from every other
  Codex doc (`codex-plugin-manifest-and-hook-contract.md`, the spike doc, the
  new hook-envelope write-up).
- [x] Author the cross-host hook-envelope solution write-up under
  `docs/solutions/integration-issues/` (R40 — currently only inline in
  gt-workflow CLAUDE.md): the snake_case→camel envelope, the shared
  `run-hook`/entrypoint split, SessionStart `{"continue": true}` on both hosts,
  the 64KB bound + `JSON.parse('null')` guard, and the host-neutral-skill-body
  vs non-linted-hook-layer split from the Design Decision above.
- [ ] Update `plugins/yellow-ci/CLAUDE.md` (add a "Codex Distribution" section:
  8 allowlisted skills, Node hook port, cache relocation, R33 deferrals, R30
  fold, host-neutral config note), `AGENTS.md` (yellow-ci as the third
  Codex-enabled plugin), and `docs/security.md` hooks table (Node port + cache
  relocation + Codex-hook-inertness note).
- [ ] No-advertising sweep (R41): grep root `README.md` and docs for any
  repository-wide Codex compatibility claim; confirm yellow-ci carries no
  blanket "Codex-compatible" badge and that unsupported plugins remain absent
  from the Codex marketplace. Confirm R44 — the two untracked working-tree
  files are never touched.

### Phase G — Delivery (R39, R42)

- [ ] `pnpm changeset` → `'yellow-ci': minor` with a one-paragraph summary and
  the trailing `<!-- markdownlint-disable-file MD041 -->`.
- [ ] Run the full per-PR gate: `pnpm validate:schemas`, `pnpm
  validate:versions`, `pnpm validate:generated`, `pnpm validate:codex`,
  `pnpm test:unit`, `pnpm test:integration`, `pnpm lint`, `pnpm typecheck`, and
  `bats tests/` in `plugins/yellow-ci/`. All green.
- [ ] Manual Codex-app acceptance (R42): `codex plugin add` round-trip in an
  isolated `CODEX_HOME` — install clean, exactly the 8 allowlisted skills
  visible (nothing else), `.codex-plugin/plugin.json` +
  `codex/skills/**` byte-identical to committed generated artifacts,
  `codex-hooks.json` references `entrypoint-codex.js` (execution expected inert
  on the target CLI, not a failure), hook review/trust exercised. Record
  evidence and any in-environment-unverifiable gaps in the PR description.
- [ ] Submit as stacked PR 5 via Graphite (`gt`), bottom of the pilot stack.

## Verification

- `pnpm validate:codex` → exit 0 — proves all 8 exposed skills + manifest pass
  the R15 exposure lint (no `.claude/`, `${CLAUDE_PLUGIN_ROOT}`, `$ARGUMENTS`,
  `subagent_type`, or real slash-command leaks in `codex/skills/**`).
- Focused grep guard: `grep -rEn '\.claude/|CLAUDE_PLUGIN_(ROOT|DATA)|\$ARGUMENTS|subagent_type' plugins/yellow-ci/codex/skills/`
  → no matches.
- `pnpm generate:manifests && pnpm validate:generated` → exit 0 — byte-identity
  drift check clean (R19); `.agents/plugins/marketplace.json` shows
  `[gt-workflow, yellow-core, yellow-ci]` (R5).
- `bats tests/` in `plugins/yellow-ci/` → all pass, incl. `hook-parity.bats`
  (Node port reproduces `session-start.sh` goldens on both entrypoints) and the
  fake-exec matrix (R37, R43).
- `pnpm validate:schemas && pnpm validate:versions && pnpm test:unit && pnpm
  lint && pnpm typecheck` → all exit 0 (R42 automated gates).
- `pnpm validate:agents` → exit 0 — RULE 17 wrapper↔skill drift clean; the six
  wrappers each carry `Skill` + preserved tools + `$ARGUMENTS` passthrough.
- Manual: `codex plugin add` round-trip shows exactly 8 skills; generated files
  byte-identical at the installed path (R42).

## Context Files

- `plans/specs/claude-code-codex-plugin-pilot.md` — R29-R44 requirement text
- `plugins/yellow-ci/commands/ci/{setup,setup-runner-targets,status,diagnose,lint-workflows,runner-health}.md`
  — the six commands to convert (source logic → skills, bodies → wrappers)
- `plugins/yellow-ci/skills/{ci-conventions,diagnose-ci}/SKILL.md` — existing
  reference skills to reword for non-implicit exposure
- `plugins/yellow-ci/hooks/scripts/session-start.sh` +
  `plugins/yellow-ci/hooks/hooks.json` — the hook to port + its mirror
- `plugins/yellow-ci/hooks/scripts/lib/{resolve-runner-targets,redact,validate}.sh`
  — non-linted libs; cache relocation + retained `.claude/` reads
- `plugins/gt-workflow/hooks/scripts/{entrypoint-claude,entrypoint-codex}.js`,
  `lib/{envelope,run-hook}.js` — the Node runtime pattern to replicate
- `plugins/gt-workflow/tests/hook-parity.bats`,
  `plugins/gt-workflow/tests/mocks/{git,gt}` — parity + fake-exec test shape
- `catalog/plugins/{yellow-ci,gt-workflow,yellow-core}.json` — enablement shape
  to add vs. the two precedents
- `scripts/validate-codex.js` — the R15 exposure lint the skill bodies must pass
- `plugins/yellow-ci/agents/ci/failure-analyst.md`,
  `plugins/yellow-ci/agents/maintenance/runner-diagnostics.md` — R30 fold
  sources (agents stay Claude-only)
- `plugins/yellow-ci/CLAUDE.md`, `AGENTS.md`, `docs/security.md`, `README.md` —
  docs close-out targets (R40, R41)
- `docs/solutions/integration-issues/codex-plugin-manifest-and-hook-contract.md`,
  `docs/research/2026-07-16-codex-plugin-contract-spike.md` — Codex contract +
  spike findings to update/cross-reference
