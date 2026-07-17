# Claude Code + Codex Plugin Pilot

## Overview

yellow-plugins ships 17 Claude Code plugins from one pnpm monorepo, gated by
schema validators and a Changesets release flow. OpenAI Codex (CLI 0.144.x,
July 2026 plugin contract) now supports installable plugins that distribute
skills, hooks, MCP servers, and assets through `.codex-plugin/plugin.json`
manifests and an `.agents/plugins/marketplace.json` catalog. This project adds
a neutral catalog layer that generates BOTH distribution targets from one
source of truth — the existing Claude artifacts byte-identical at first — and
pilots Codex support on three plugins: a three-skill read-only `yellow-core`
slice, complete `gt-workflow`, and read-mostly `yellow-ci`. Plugin names,
versions, Changesets, and release history are retained. Codex compatibility is
not advertised repo-wide after the pilot.

The pilot uses skills plus Codex's built-in agents (`default`, `worker`,
`explorer`) rather than custom TOML agents, which Codex plugins cannot install
(primary-doc confirmed). Cross-host hooks move to dependency-free Node >=22.22
with shared pure policy functions and per-host entrypoints, gated by
behavioral parity against the existing bash hooks.

## Users

- **Repo maintainer** — authors catalog sources, runs generators/changesets,
  reviews drift CI.
- **Claude Code end user** (17 plugins) — must observe no behavioral change
  through the pilot beyond documented additive surfaces (new skills).
- **Codex end user** (3 pilot plugins) — installs from the Codex marketplace;
  receives skills, hooks, and MCP config; sees accurate scope descriptions.
- **CI bot** — version-packages flow plus drift gates; must not gain a new
  silently-diverging version track.

## Requirements

### Neutral catalog and generation

- **R1.** The repo shall contain `catalog/catalog.json` holding marketplace
  identity, publisher defaults, the exact 17-plugin canonical order, and
  per-target (Claude/Codex) presentation defaults.
- **R2.** Each plugin shall have `catalog/plugins/<name>.json` holding shared
  metadata, per-target enablement, target-specific description/interface
  overrides, component paths, marketplace policy, and the Codex skill
  allowlist.
- **R3.** `plugins/<name>/package.json` shall remain the sole authority for
  plugin `name` and `version`; catalog sources shall carry neither.
- **R4.** When `pnpm generate:manifests` runs with no Codex-enabled plugins,
  the generated `.claude-plugin/marketplace.json` and all 17
  `plugins/*/.claude-plugin/plugin.json` shall be byte-identical to the
  currently committed artifacts, proven by characterization tests captured
  before the generator lands.
- **R5.** The generator shall emit `.agents/plugins/marketplace.json`
  containing only Codex-enabled plugins, ordered by filtering the canonical
  17-plugin order by enablement (deterministic at every intermediate
  enablement state; final order gt-workflow, yellow-core, yellow-ci), with
  name `yellow-plugins`, display name `Yellow Plugins`, and per-entry policy
  `installation: AVAILABLE`, `authentication: ON_INSTALL`, category
  `Developer Tools`, no product gating. Entries carry no version field.
- **R6.** The generator shall emit `plugins/<name>/.codex-plugin/plugin.json`
  for each Codex-enabled plugin with the required `name` and
  `interface.displayName`/`interface.category` fields, `version` sourced from
  `package.json`, and target-specific description overrides from the catalog.
- **R7.** The generator shall emit each Codex-enabled plugin's skill tree at
  the manifest-referenced path `plugins/<name>/codex/skills/` (an explicit
  manifest-relative choice, not an assumed convention), copying only
  allowlisted skills from the canonical `skills/` source with normalized
  frontmatter (`name` + single-line `description` only; Claude-only fields
  stripped) and excluding undeclared skills.
- **R8.** Apply mode shall write deterministic two-space-indented JSON with LF
  endings and trailing newline via the existing atomic-write and
  path-containment protections, and generated output shall be hash-stable
  across repeated runs on identical sources (no timestamps or
  environment-dependent content) — required because Codex hook trust is keyed
  to a hash of the hook definition and unstable output causes spurious
  re-trust prompts.
- **R9.** `--check` shall perform no writes and exit nonzero on any drift
  between sources and committed artifacts; `--dry-run` shall report
  differences and exit zero; `pnpm apply:changesets` shall continue to version
  packages and regenerate both targets.

### Validation, versioning, and CI

- **R10.** `pnpm validate:generated` (drift via `--check`) and
  `pnpm validate:codex` (Codex artifact + exposure rules) shall exist and be
  wired into `validate:schemas` and `release:check`.
- **R11.** Repository-pinned JSON Schemas shall exist for the catalog sources
  and for Codex manifest, marketplace, hooks, and MCP shapes, each labeled as
  repository schemas derived from the July 2026 Codex contract, not official
  OpenAI schemas.
- **R12.** Version validation shall be target-aware: Claude requires
  package.json = plugin.json = marketplace entry; Codex requires package.json
  = Codex manifest version; Codex marketplace entries are validated separately
  for membership, name, order, and path (they carry no version).
- **R13.** The foundation PR shall close gap Q3 of
  `docs/maintenance/catalog-release-gap.md`: CI shall fail when plugin
  versions are bumped by the release flow without the root catalog version
  track advancing, so the pilot introduces no fourth unguarded version track
  and the existing third one is guarded.
- **R14.** `ERROR-DIST-001` through `ERROR-DIST-008` shall be defined in a
  single plain-JSON registry consumed by both the TypeScript (`packages/domain`,
  ESM import) and CommonJS (`scripts/*.js`, `readFileSync`) stacks — replacing,
  for these codes, the hand-reassembled string pattern — with a registry-level
  lint asserting category prefixes are unique and never substring-collide
  (explicitly: DIST vs existing DISC).
- **R15.** A Codex-exposure lint shall reject, in any Codex-exposed skill or
  manifest: Claude-only tool names, slash-command syntax, `$ARGUMENTS`,
  `.claude/` writes, sibling-plugin paths, hard-coded `mcp__plugin_*` names,
  `userConfig`, output styles, agent references, and undeclared
  executables/MCP dependencies. These checks shall registry-gate against the
  actual per-target generated output (never token shape) and shall scan raw
  file content including fenced blocks.
- **R16.** From the foundation PR, the main `validate-schemas.yml` matrix
  shall gain Ubuntu and Windows Codex jobs using temporary `CODEX_HOME`
  directories that add the local marketplace, assert only enabled pilots are
  listed, install each enabled plugin, and verify its exact skill allowlist,
  manifest, hooks, and optional MCP configuration — including paths containing
  spaces, backslashes, and WSL/UNC forms. These jobs shall install the latest
  generally-available Codex CLI at run time (no pinned version), so drift
  against new CLI releases surfaces in CI, and may carry their own timeout
  budget distinct from the existing 2-minute SLO entries.
- **R17.** The foundation PR shall include a live Codex CLI (>=0.144.x) spike
  that empirically records: (a) whether/how arguments pass into Codex skills
  (no `$ARGUMENTS` primitive is documented), (b) the scriptable plugin-list
  surface (`codex plugin list --available --json` is undocumented), (c) the
  exact `agents/openai.yaml` field for non-implicit skill invocation, (d)
  manifest hook-path override acceptance for `./hooks/codex-hooks.json`, (e)
  `claude plugin validate` + clean-install acceptance of a file-referenced
  `mcpServers` entry, and (f) whether Claude Code's validator now accepts a
  string file path for `hooks` (re-testing the Feb 2026 inline-only finding
  against current behavior). Findings shall be committed as a repo doc that
  records the Codex CLI version the artifacts were verified against (for
  provenance only — the supported target is the latest / currently installed
  Codex CLI, not a pinned floor); plugin-port PRs consume the recorded
  findings rather than re-deriving them.

### Claude-behavior preservation

- **R18.** Stage 1 shall prove byte-identity for all generated Claude
  artifacts (R4) before any Codex enablement merges.
- **R19.** Every subsequent PR that changes a Claude-visible surface (command
  wrappers, MCP declaration, hooks) shall ship behavioral characterization
  gates: command-wrapper output parity, hook stdin/stdout fixture parity
  against the replaced bash hook, and MCP tool-availability checks. Purely
  additive surfaces (new skills) are exempt from parity but documented.
- **R20.** Claude hook configuration shall remain authoritative as inline
  `plugin.json` entries (the repo schema's empirical inline-only constraint
  stands until the PR1 spike proves otherwise). The generator shall never
  treat a reference-only `hooks/hooks.json` mirror (yellow-ci's documented
  pattern) as an authoritative target; `hooks/codex-hooks.json` is emitted for
  Codex only.
- **R21.** The gt MCP server shall be declared once in the catalog and emitted
  as a shared `.mcp.json`; Claude's `plugin.json` references it by path
  (documented-supported) gated by R17(e); if the remote validator rejects the
  file reference, the generator shall fall back to emitting inline Claude
  config from the same catalog source without any catalog change.

### yellow-core pilot (skills-only slice)

- **R22.** yellow-core's Codex exposure shall be exactly three skills:
  `agent-native-architecture`, `agent-native-audit`, and a new `plan-status`
  skill. All other components (21 agents, both hooks, background compounding,
  `setup:all`, statusline setup, MCP helpers, `lib/` executables, remaining
  skills) are excluded, and the Codex-facing description states clearly that
  this is a three-skill read-only subset.
- **R23.** `plan-status` shall be authored as a canonical skill under
  `plugins/yellow-core/skills/plan-status/`; the existing Claude
  `/plan:status` command becomes a thin wrapper over it with a behavior parity
  gate against current output.

### gt-workflow pilot (complete)

- **R24.** All seven workflows (`gt-setup`, `gt-nav`, `gt-stack-plan`,
  `gt-sync`, `smart-submit`, `gt-amend`, `gt-cleanup`) shall exist as
  canonical skills under `plugins/gt-workflow/skills/`, with the Claude
  commands retained as compatibility wrappers preserving their current command
  names and allowed tools.
- **R25.** Canonical-skill/wrapper drift shall be machine-checkable: Codex
  skill trees are generated from the canonical `skills/` source (one source of
  truth), and a CI check asserts each Claude wrapper references its canonical
  skill.
- **R26.** Codex-exposed gt skills shall remain fully usable when `gt mcp`
  startup or authentication fails (CLI-first with MCP as enhancement), and the
  `.graphite.yml` read path shall be preserved on both hosts.
- **R27.** Output-style contracts shall be converted to skill references; the
  smart-submit/amend audit prompts shall live in host-specific skill
  references, with Codex delegating to built-in agents (`worker`/`explorer`)
  and Claude continuing to use `Task`.
- **R28.** Ported workflows shall preserve named-file staging, dry-run
  behavior, critical-finding confirmation, conflict stops, and both gt-cleanup
  confirmations; gt-cleanup on Codex shall not invoke the unported yellow-core
  worktree-cleanup workflow.

### yellow-ci pilot (read-mostly)

- **R29.** yellow-ci's Codex exposure shall be the operational skills
  `ci-setup`, `ci-setup-runner-targets`, `ci-status`, `ci-diagnose`,
  `ci-lint-workflows`, `ci-runner-health` plus the existing `ci-conventions`
  and `diagnose-ci`. The R17(c) spike found `agents/openai.yaml` is not
  parsed from plugins at all on codex-cli 0.144.1 (even invalid YAML
  produces no error), so no functioning non-implicit-invocation mechanism
  exists today. Until a future CLI parses the file (re-verify via a live
  spike, e.g. `codex features list`, before implementing), the two
  reference-oriented skills shall rely on SKILL.md description phrasing as
  the interim lever to discourage implicit invocation; the
  `agents/openai.yaml` field marking is deferred pending upstream support.
- **R30.** `failure-analyst` and relevant `runner-diagnostics` instructions
  shall be folded into skill references consumed via built-in Codex
  delegation; the agents themselves stay Claude-only.
- **R31.** Existing configuration paths and precedence shall be retained
  during the pilot, including `.claude/yellow-ci-runner-targets.yaml`; no
  config migration.
- **R32.** Codex-exposed yellow-ci skills shall require preview and explicit
  confirmation before SSH/config writes or workflow lint fixes, and shall skip
  Windows/macOS remote runner probes with a clear message (Linux runner
  targets only).
- **R33.** Deferred and absent from the Codex surface: `ci-runner-cleanup`,
  `ci-setup-self-hosted`, `ci-report-linear`, runner assignment, workflow
  optimization, and Linear/RuVector/Morph integration.

### Cross-host hooks

- **R34.** Hook logic for gt-workflow and yellow-ci shall be dependency-free
  Node >=22.22 modules: pure policy functions shared within each plugin plus
  platform-specific Claude/Codex entrypoints. No cross-plugin (sibling-path)
  imports in anything Codex-exposed.
- **R35.** Hook input shall be normalized internally to
  `{ host, event, cwd, toolName, toolInput, toolResponse }`; the Codex
  entrypoint shall transform Codex's snake_case stdin
  (`hook_event_name`, `tool_name`, `tool_input`, `tool_response`) to the
  envelope and emit camelCase output.
- **R36.** Codex `PreToolUse` denial shall emit
  `hookSpecificOutput.permissionDecision: "deny"` with a reason and shall
  never emit `continue` on PreToolUse/PermissionRequest; SessionStart shall
  keep emitting `{"continue": true}` (supported on both hosts). Every Codex
  hook shall declare `commandWindows`.
- **R37.** Parity fixtures shall exercise, on both hosts: blocking direct and
  chained `git push` while allowing Graphite submission; successful, failed,
  missing, and malformed post-tool responses; no echo of untrusted commands,
  commit content, logs, or credentials; yellow-ci SessionStart always emitting
  valid JSON, honoring its 3-second/60-second cache contracts, and degrading
  safely without `gh` or network.
- **R38.** New cache writes shall use `PLUGIN_DATA`/`CLAUDE_PLUGIN_DATA`
  locations with read-only fallback to legacy yellow-ci cache paths.

### Release, documentation, and process

- **R39.** Delivery shall be five Graphite PRs — neutral generation, Codex
  tooling, yellow-core, gt-workflow, yellow-ci — with a minor changeset in
  each plugin PR; adapter-only follow-up fixes are patches. The plan notes
  that sequentially merging PRs accumulate into a single Version Packages PR
  unless release cycles complete between merges.
- **R40.** Root and plugin documentation, `AGENTS.md`, and security guidance
  shall be updated; the neutral-catalog/distribution concept shall have
  exactly one canonical doc with all other docs cross-referencing it; a
  solution write-up shall capture the cross-host hook-envelope pattern.
- **R41.** Repo docs shall not advertise repository-wide Codex compatibility;
  unsupported plugins stay absent from the Codex marketplace until their own
  compatibility tests pass.
- **R42.** Each plugin-port PR shall pass a manual Codex-app acceptance gate
  for hook review/trust (plugin hooks are skipped until explicitly trusted),
  in addition to the automated per-PR gates: `validate:schemas`,
  `validate:versions`, `validate:generated`, `validate:codex`,
  unit/integration tests, lint, typecheck, formatting checks, plugin lint, and
  affected Bats suites.
- **R43.** Generator tests shall cover inventory/order, target enablement,
  deterministic output, path traversal, symlinks, malformed sources, stale
  artifacts, four-way version drift (Claude plugin, Codex plugin, catalog
  track, marketplace snapshot), and non-mutating `--check`; fake `git`, `gt`,
  `gh`, and SSH executables (existing PATH-stub bats pattern) shall verify
  staging, dry-run, cleanup confirmations, failure diagnosis, redaction, rate
  limits, malformed responses, runner-target validation, and non-Linux probe
  rejection without external writes.
- **R44.** The two existing untracked files in the working tree shall remain
  untouched throughout implementation.

### Cleanup

- **R45.** The legacy TypeScript marketplace validation path shall be retired
  in the Codex-tooling PR: remove `validateMarketplace()` from
  `packages/infrastructure` and its `packages/cli` caller, delete the unused
  nested-shape `schemas/marketplace.schema.json`, and update the affected
  tests — `scripts/validate-marketplace.js` plus the official schema remain
  the sole marketplace gates.

## Design

### Architecture

```text
catalog/catalog.json ─┐
catalog/plugins/*.json ┼─> scripts/lib/generate/ (pure CJS helpers)
plugins/*/package.json ┘        │
                    ┌───────────┴────────────┐
        Claude emitter                Codex emitter
  .claude-plugin/marketplace.json   .agents/plugins/marketplace.json
  plugins/*/.claude-plugin/         plugins/<p>/.codex-plugin/plugin.json
    plugin.json                     plugins/<p>/codex/skills/** (from skills/)
                                    plugins/<p>/hooks/codex-hooks.json
                                    plugins/<p>/.mcp.json (gt-workflow)
```

- **Generator home: `scripts/lib/generate/` (CJS), entry
  `scripts/generate-manifests.js`** — not `packages/` — because `packages/`
  is ESM-only and CJS validators cannot `require()` it; this follows
  CONTRIBUTING's split-validation architecture. `sync-manifests.js` is
  refactored to consume the same pure helpers (traces: R4–R9).
- **Modes**: apply (default), `--check`, `--dry-run` per R9. All writes go
  through the existing `atomicWrite` + `assertWithinRoot` implementations
  lifted from `sync-manifests.js`. Serialization is exactly
  `JSON.stringify(obj, null, 2) + '\n'` to avoid whitespace-only drift, and
  emitted files carry no timestamps (R8).
- **Codex marketplace order** is computed, not stored: filter
  `catalog.json`'s canonical order by `targets.codex.enabled` (R5).
- **Skill tree generation** copies from canonical `plugins/<p>/skills/<s>/`
  into `plugins/<p>/codex/skills/<s>/`, rewriting frontmatter to
  `name` + `description` only, refusing symlinks and path-escaping names
  (R7, R43). Generated trees are committed; `--check` guards drift (R25).
- **Error registry**: `packages/domain/src/validation/error-codes.json` —
  plain JSON; `errorCatalog.ts` imports and re-exports typed constants; CJS
  scripts `readFileSync` the same file. New DIST block (R14):
  DIST-001 malformed catalog source; DIST-002 inventory/order mismatch;
  DIST-003 generated-artifact drift; DIST-004 invalid generated manifest;
  DIST-005 unsupported surface exposed to Codex; DIST-006 hook contract
  violation; DIST-007 Windows/path portability failure; DIST-008 MCP/auth
  configuration failure. Migration of pre-existing categories into the JSON
  registry is out of pilot scope.
- **Version model** (R12, R13): package.json → Claude plugin.json →
  Claude marketplace entry (existing three-way) plus package.json → Codex
  manifest (new two-way). Codex marketplace snapshot has no version; the root
  catalog track gains the Q3 guard in `validate-versions.js` or a sibling
  check invoked by `release:check` and the version-packages workflow.
- **Schemas** (R11): new `schemas/catalog.schema.json`,
  `schemas/catalog-plugin.schema.json`, `schemas/codex-plugin.schema.json`,
  `schemas/codex-marketplace.schema.json`, `schemas/codex-hooks.schema.json`,
  each with a `$comment` marking them repo-derived from the July 2026
  contract. New `validate-schemas.yml` matrix entries `codex` and `generated`.
  The legacy `schemas/marketplace.schema.json` (nested shape, still loaded by
  `packages/infrastructure/src/validation/validator.ts:81`) is retired
  outright in PR2 together with its `validateMarketplace()` consumer (R45);
  the new generator and validators never route through it.

### Hook runtime

Per affected plugin (gt-workflow, yellow-ci):

```text
plugins/<p>/hooks/
  node/
    policy.mjs          # pure functions: decide(envelope) -> decision (R34)
    claude-entry.mjs    # Claude stdin/stdout contract (camelCase both ways)
    codex-entry.mjs     # snake_case stdin -> envelope -> camelCase output (R35)
  codex-hooks.json      # generated, Codex-only, commandWindows on every hook (R36)
  scripts/*.sh          # existing bash, retained until parity gates pass (R19)
```

Claude keeps inline `plugin.json` hook declarations pointing at the new Node
entrypoints once parity fixtures pass (R19, R20, R37). yellow-ci's
reference-only `hooks/hooks.json` mirror is left as-is or regenerated in
lockstep with the inline config — never treated as authoritative (R20). Cache
writes move under `PLUGIN_DATA`/`CLAUDE_PLUGIN_DATA` with read-only legacy
fallback (R38). If any hook ever spawns a child `claude`/`codex` session, it
must carry the env-var-sentinel recursion guard at the top of every hook
script (existing repo pattern).

### Skills and delegation

Canonical skills live in each plugin's `skills/` directory (Claude-visible;
additive minor change). Claude commands become wrappers that invoke the
canonical skill; Codex consumes the generated normalized copy (R23, R24, R25).
Role prompts formerly in output styles/agents move to skill reference files
with host-specific sections: Claude adapters dispatch via `Task`, Codex
adapters instruct delegation to built-in `worker`/`explorer` (R27, R30).
Argument passing on Codex follows the R17(a) spike finding (fallback pattern:
skill body instructs reading arguments from the prompt text).

### MVP staging

Five PRs, dependency-ordered (R39):

1. **PR1 — neutral generation**: catalog sources for all 17 plugins,
   generator + refactored sync, byte-identity characterization, Q3 guard,
   Codex spike doc (R1–R4, R8–R9, R13, R17, R18).
2. **PR2 — Codex tooling**: Codex schemas, validate:codex/validate:generated,
   ERROR-DIST registry, exposure lint, CI matrix incl. Windows, empty Codex
   marketplace, retirement of the legacy TS marketplace validation path
   (R5 empty-state, R10–R12, R14–R16, R45).
3. **PR3 — yellow-core**: first Codex-enabled plugin, three skills,
   plan-status wrapper conversion (R22–R23).
4. **PR4 — gt-workflow**: seven canonical skills + wrappers, .mcp.json, hook
   runtime for gt-workflow (R21, R24–R28, R34–R37 for gt hooks).
5. **PR5 — yellow-ci**: read-mostly skills, openai.yaml marking, yellow-ci
   hook runtime + cache relocation, docs + solution write-up close-out
   (R29–R33, R34–R38 for yellow-ci, R40–R42).

## Resolved During Drafting

All open questions were resolved in spec dialogue: the legacy TS marketplace
validation path is retired in PR2 (R45); the Claude hooks file-path
restriction is re-tested in the PR1 spike with the inline-only constraint
standing for the pilot regardless (R17(f), R20); Codex compatibility targets
the latest / currently installed Codex CLI — CI installs latest at run time
and the PR1 spike findings doc records the verified version for provenance
only, not as a pinned floor (R16, R17).
