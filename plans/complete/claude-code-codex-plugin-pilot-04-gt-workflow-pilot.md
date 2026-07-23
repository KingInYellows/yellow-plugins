# Feature: gt-workflow Complete Codex Pilot

## Overview

gt-workflow is the full-surface Codex pilot: all seven workflows become
canonical skills consumable on both hosts, the gt MCP server is declared once
and shared via a file reference, and the plugin's two bash hooks are rewritten
as the first cross-host Node hook runtime — establishing the normalized
envelope, snake_case adapter, and parity-fixture harness that the yellow-ci
shell (`claude-code-codex-plugin-pilot-05-yellow-ci-pilot`) reuses. Claude-side
behavior is preserved through compatibility wrappers and characterization
gates.

**Interpretation note (flag for the approval gate):** the shell's Produces
bullet "Host-specific audit-prompt skill references (Claude Task dispatch,
Codex built-in worker/explorer delegation) replacing output-style contracts"
is read here as covering *two* Claude-only mechanisms that have no Codex
equivalent and must both become skill references: (a) the three audit-agent
Task prompts (`quick-code-review`, `quick-security-scan`, `quick-error-check`)
currently duplicated verbatim in `smart-submit.md` and `gt-amend.md`, and (b)
the two `output-styles/*.md` files, since Codex's manifest has no
`outputStyles` field at all (confirmed against
`docs/solutions/integration-issues/codex-plugin-manifest-and-hook-contract.md`
— the documented optional manifest fields are `version`, `description`,
`author`, `homepage`, `repository`, `license`, `keywords`, and interface
extras only). If this reading is wrong, correct it at the Step 8 approval
gate before the shell file is deleted.

## Origin

- Spec: `plans/specs/claude-code-codex-plugin-pilot.md`
- Covers: R21, R24, R25, R26, R27, R28, R19 (partial: gt-workflow-surfaces),
  R34 (partial: gt-workflow), R35 (partial: gt-workflow), R36 (partial:
  gt-workflow), R37 (partial: gt-workflow), R39 (partial: pr4-delivery), R42
  (partial: gt-workflow-acceptance), R43 (partial: gt-workflow-fake-exec)
- Shell: `claude-code-codex-plugin-pilot-04-gt-workflow-pilot`

## Pattern Survey

**Commands (`plugins/gt-workflow/commands/*.md`).** Seven un-namespaced
commands (`plugins/gt-workflow/CLAUDE.md`'s "Namespace exception" section
forbids renaming without a concrete collision trigger — do not add a
namespace prefix). Current `allowed-tools` per command (must be preserved,
not narrowed to `[Skill]` — see `docs/solutions/code-quality/`
anti-pattern #28: a wrapper invoking a Skill whose body runs Bash still needs
`Bash` on the wrapper's own frontmatter or the grant is lost):

| Command | Current `allowed-tools` |
|---|---|
| `gt-setup.md` | Bash, Read, Write, AskUserQuestion |
| `gt-nav.md` | Bash, AskUserQuestion |
| `gt-stack-plan.md` | Bash, Read, Write, Edit, Glob, Grep, Task, AskUserQuestion |
| `gt-sync.md` | Bash |
| `smart-submit.md` | Bash, Read, Glob, Grep, Task, AskUserQuestion |
| `gt-amend.md` | Bash, Read, Glob, Grep, Task, AskUserQuestion |
| `gt-cleanup.md` | Bash, AskUserQuestion, Skill (already invokes yellow-core's `worktree:cleanup`) |

None use `${CLAUDE_PLUGIN_ROOT}` in their bodies (only the manifest/hooks
reference it). `smart-submit.md` and `gt-amend.md` each embed three identical
Task-agent prompts (`quick-code-review`, `quick-security-scan`,
`quick-error-check`, all `subagent_type: general-purpose`) — this
duplication is the audit-prompt content to consolidate.

**Wrapper + canonical-skill precedent (shell 03, already implemented).**
`plugins/yellow-core/commands/plan/status.md` → kept `name`,
`argument-hint`, `description` unchanged, changed `allowed-tools` from
`[Bash]` to `[Skill]` (yellow-core's original command used ONLY Bash, so
`[Skill]` alone was sufficient there — gt-workflow's commands use more tools
and Skill must be *added*, not substituted), body replaced with "Invoke the
`Skill` tool with `skill: "plan-status"`." Canonical skill at
`plugins/yellow-core/skills/plan-status/SKILL.md` — three-heading body
(`## What It Does` / `## When to Use` / `## Usage`), bash blocks moved
verbatim, frontmatter `user-invokable: false`. Codex mirror at
`plugins/yellow-core/codex/skills/plan-status/SKILL.md` is
generator-produced (`buildCodexSkillTree` in
`scripts/lib/generate/emit-codex.js`), not hand-authored — do not hand-write
files under `codex/skills/`. Parity gate at
`plugins/yellow-core/tests/plan-status-parity.bats` + golden fixtures at
`plugins/yellow-core/tests/fixtures/plan-status/*.golden.txt`, captured
**before** editing the command — this before/after-golden-fixture pattern
(not a live dual-implementation) is reused below for the hook migration.

**Manifests and catalog source.**
`plugins/gt-workflow/.claude-plugin/plugin.json` and
`catalog/plugins/gt-workflow.json` currently carry byte-identical `hooks` and
inline `mcpServers.graphite: {command: "gt", args: ["mcp"]}` blocks; the
catalog file additionally carries `marketplace` and
`targets: {claude: true, codex: {enabled: false}}`.
`catalog/plugins/gt-workflow.json` is the generation SOURCE — both
`.claude-plugin/plugin.json` and (once created) `.codex-plugin/plugin.json`
are regenerated from it via `pnpm generate:manifests`
(`scripts/generate-manifests.js`); never hand-edit the two generated files
directly. `catalog/plugins/yellow-core.json`'s populated `targets.codex`
block (`enabled`, `includeHooks`, `interface.{displayName,category}`,
`description`, `skillAllowlist`, `componentPaths.skills`) is the only
existing precedent, but it is skills-only (`includeHooks: false`, no MCP
servers) — gt-workflow's entry is the first to need both hooks and an MCP
declaration.

**`scripts/lib/generate/emit-codex.js` generator contract.**
`buildCodexPluginManifest(source, pkg, hookConfig)` only sets
`manifest.skills` when `componentPaths.skills` AND a non-empty
`skillAllowlist` both exist, and only sets `manifest.hooks =
'./hooks/codex-hooks.json'` when `hookConfig !== null`.
`buildCodexHookConfig(source)` translates the catalog source's inline
`hooks` block into `hooks/codex-hooks.json`'s shape, returning `null` when
`targets.codex.includeHooks === false` or there are no hooks; it currently
does NOT emit a `commandWindows` field per hook entry — needs a small
addition (see Step 6). `buildCodexSkillTree(rootDir, name, source)` copies
only `SKILL.md` per allowlisted skill into `componentPaths.skills`
(`./codex/skills` by default), hard-rejects sidecar files and symlinks, and
requires `parsed.name === skillName` — every new canonical skill must be a
single self-contained `SKILL.md` with matching `name:` frontmatter.

**Codex hook/MCP platform facts (primary-source verified,
`docs/research/2026-07-16-codex-plugin-contract-spike.md` +
`docs/solutions/integration-issues/codex-plugin-manifest-and-hook-contract.md`,
codex-cli 0.144.1).**
- Hook stdin is snake_case (`hook_event_name`, `tool_name`, `tool_input`,
  `tool_response`, `cwd`, `session_id`); hook OUTPUT is camelCase
  (`hookSpecificOutput.permissionDecision`). Claude's envelope is camelCase
  both ways — the case-transform is needed on the Codex leg only.
- PreToolUse deny shape on Codex:
  `{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": "..."}}`.
  Claude's existing `check-git-push.sh` instead uses `exit 2` + a stderr
  message — no JSON envelope at all. This is a different *mechanism*, not
  just a field-name difference; each entrypoint must emit its own host's
  shape.
- `continue: false` is ignored on Codex's PreToolUse/PermissionRequest (and
  silently ignored on SubagentStart too) but DOES halt processing on
  PostToolUse (among others) — so the existing warn-only
  `{"continue": true, "systemMessage": "..."}` shape from
  `check-commit-message.sh` (a PostToolUse hook) needs no host-specific
  change.
- `commandWindows` (JSON key, camelCase) / `command_windows` (TOML) is
  Codex's own Windows-command-override field on a hook entry. Genuinely
  unpopulated anywhere in this repo today.
- **Hook execution is currently inert on Codex**: `plugin_hooks` is a
  `removed`-stage feature on codex-cli 0.144.1 (spike finding (d)) — a
  manifest `"hooks"` pointer is accepted at install time but no hook ever
  fires. The Codex entrypoint and `hooks/codex-hooks.json` output must be
  schema/unit-tested for correctness; live Codex-side hook *execution*
  cannot be verified end-to-end right now and must not block delivery.
  Re-check `codex features list | grep plugin_hooks` before assuming this
  has changed.
- Codex plugins distribute MCP servers via a `.mcp.json` file at the plugin
  root (same doc, "Manifest and marketplace" section) — this is presented as
  a default/auto-discovered artifact the same way `hooks/hooks.json` is the
  default (overridable) hooks path, with no explicit manifest field shown
  for it. Treat auto-discovery as the primary hypothesis; if
  `.codex-plugin/plugin.json` needs an explicit pointer, `buildCodexPluginManifest`
  will need a small mirrored addition — verify empirically (schema
  validation / any available Codex docs) before Step 4.
- Hook trust is keyed to a **hash of the hook definition** — any generator
  output must stay deterministic (fixed key order, no timestamps), which the
  existing `JSON.stringify(obj, null, 2) + '\n'` generator convention already
  satisfies as long as new code follows the same pattern.

**Local schema policy (`schemas/plugin.schema.json`).** `mcpServers`
(line 187-190) already accepts a relative-file-path string OR an inline
object (`fileFilesOrInline` definition) — no schema change needed to switch
gt-workflow's `mcpServers` to a file reference. `hooks` (line 191-194,
`inlineHooks` definition) is **inline-object-only by explicit local policy**
— even though the 2026-07-16 spike found Claude Code's live validator now
accepts a hooks file-path string, this repo's schema still forbids it.
Hooks stay inline in `.claude-plugin/plugin.json`; only the `command` string
inside each hook entry changes (from `bash .../check-git-push.sh` to a
`node .../entrypoint-claude.js ...` invocation).

**Repo-wide Node hook precedent.** No `.js`/`.mjs`/`.cjs` hook script exists
anywhere under `plugins/*/hooks/` today — this is the first one. The closest
structural analogue in the repo is `scripts/lib/generate/emit-claude.js` +
`emit-codex.js` sitting side by side as host-agnostic-core /
host-adapter siblings (do not force this into the `packages/domain →
infrastructure → cli` layering — that's a different concern, schema
validation, not host adapters). `hooks/scripts/` is the dominant
plugin-hooks subfolder name across the repo (yellow-core, yellow-ci,
yellow-debt, yellow-ruvector all use it; yellow-ci and yellow-ruvector
additionally nest `hooks/scripts/lib/` for shared helpers — gt-workflow
should follow that nested form since it needs shared policy modules). No
"envelope" or "adapter" naming precedent exists elsewhere in the repo — free
to name these modules. `plugins/gt-workflow/hooks/hooks.json` (and every
other plugin's `hooks.json`) is marked `"_comment": "REFERENCE ONLY — not
loaded by Claude Code. Authoritative hook config is in
.claude-plugin/plugin.json."` — the generated `.claude-plugin/plugin.json`
(via `catalog/plugins/gt-workflow.json`) is the real source to edit; update
`hooks/hooks.json` afterward only as a human-readable mirror.

**Fake-executable test precedent.** No `.bats` file exists anywhere under
`plugins/gt-workflow/` today (zero test coverage). The closest stub-mock
pattern is `plugins/yellow-review/tests/mocks/gh` — a shell script that
pattern-matches on `"$*"` and `cat`s canned fixture JSON, PATH-prepended in
each bats file's `setup()`
(`export PATH="${BATS_TEST_DIRNAME}/mocks:${PATH}"`). Mirror this for
`mocks/git` and `mocks/gt`.

**Delivery precedent.** `.changeset/plan-complete-file-provenance-tier.md`
(shell 03's changeset): single `'plugin-name': bump-type` frontmatter line,
one prose paragraph, trailing `<!-- markdownlint-disable-file MD041 -->`.
gt-workflow's `package.json` is at `1.5.4`; this shell's scope (new skills,
new hook runtime, new manifest target) is `minor`. Shell 03 delivered via
`gt modify -c` + `gt submit --no-interactive`.

**CI.** `.github/workflows/validate-schemas.yml`'s
`codex-install-verification` job (advisory, ubuntu+windows matrix) already
does a named-membership check of `codex plugin list --available --json`
against `isCodexEnabled()`-filtered catalog plugins — enabling gt-workflow's
`targets.codex.enabled` automatically extends this job's coverage with no
workflow-file edits needed. The same workflow's `codex` matrix target runs
`node scripts/validate-codex.js` (schema + exposure lint) as a blocking gate.

## Implementation

- [x] Step 1: Capture the hook-behavior baseline **before** touching
  `check-git-push.sh` or `check-commit-message.sh`. Create
  `plugins/gt-workflow/tests/fixtures/hooks/` with one stdin-payload file
  per representative case: git-push plain block, git-push via `;`/`&&`/`$(...)`
  metacharacter forms, git-push allowed (non-push Bash command), missing
  `jq`, malformed JSON; commit-message conventional prefix (allow, silent),
  non-conventional prefix (warn), multi `-m` flags (first-only checked, no
  false positive), single- vs double-quoted `-m` value, non-zero
  `tool_result.exit_code` (skip validation), missing `tool_result.exit_code`
  (validate — see the `check-commit-message.sh` comment on why this
  "fail-closed" case runs the check rather than skipping it). For each
  fixture, run the CURRENT bash script against it and save stdout + exit
  code as a golden file (`<case>.golden.txt` — stdout on one line, exit code
  on the next, mirroring `plugins/yellow-core/tests/fixtures/plan-status/`'s
  golden-fixture shape). These goldens are the parity harness's comparison
  target in Step 7 — no need to keep the old bash scripts running in
  parallel indefinitely.
- [x] Step 2: Write the host-agnostic policy modules. Create
  `plugins/gt-workflow/hooks/scripts/lib/policy-check-git-push.js` and
  `plugins/gt-workflow/hooks/scripts/lib/policy-check-commit-message.js`,
  each exporting a pure function `(camelCaseEnvelope) => { decision:
  'allow'|'deny'|'warn', message: string|null }` that reproduces the exact
  logic of the corresponding bash script (git-push regex match across
  `;`/`&`/`(`/`)`/`|`/`$`/backtick/whitespace boundaries; conventional-commit
  prefix regex `^(feat|fix|refactor|docs|test|chore|perf|ci|build|revert)(\(.+\))?!?:`;
  first-`-m`-flag extraction trying double-quoted then single-quoted; the
  `EXIT_CODE` default-to-run-validation-on-parse-failure behavior). No I/O,
  no `console.*` — pure functions, matching `emit-codex.js`'s
  "no I/O, no timestamps" convention (module header comment) so the parity
  harness can call them directly as well as through the entrypoints.
- [x] Step 3: Write the envelope adapter and entrypoints. Create
  `plugins/gt-workflow/hooks/scripts/lib/envelope.js` exporting a
  `snakeToCamelEnvelope(rawJson)` transform (only used on the Codex leg —
  Claude's stdin is already camelCase) plus per-host output formatters:
  `formatClaudeOutput(hookEvent, result)` (PreToolUse deny → `process.exitCode
  = 2` + `process.stderr.write(message)`; PostToolUse warn →
  `{"continue": true, "systemMessage": message}` on stdout, or
  `{"continue": true}` when `message` is null) and
  `formatCodexOutput(hookEvent, result)` (PreToolUse deny →
  `{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision":
  "deny", "permissionDecisionReason": message}}`; PostToolUse warn → the same
  `{"continue": true, "systemMessage": ...}` shape, since PostToolUse
  `continue` is honored on both hosts per the Pattern Survey). Create
  `plugins/gt-workflow/hooks/scripts/entrypoint-claude.js` and
  `entrypoint-codex.js`, each reading stdin, taking a `--hook
  check-git-push|check-commit-message` CLI arg to select the policy module,
  parsing input (camelCase passthrough for Claude, `snakeToCamelEnvelope` for
  Codex), calling the policy module, and calling the matching host formatter.
  Both entrypoints must preserve the fail-open/fail-closed direction documented
  inline in the original scripts (`check-git-push.sh`: malformed JSON → allow
  through / exit 0; `check-commit-message.sh`: malformed JSON or missing `jq`
  → skip validation / `{"continue": true}`) — do not unify these into one
  blanket rule, they differ intentionally per hook.
- [x] Step 4: Windows command variants. In
  `plugins/gt-workflow/hooks/scripts/lib/envelope.js` or a small sibling
  module, confirm (or add) that the Node entrypoints require no
  platform-specific branching — `node <path> --hook <name>` is
  platform-uniform, unlike the old direct-bash invocation which never worked
  on Windows. Note this explicitly in a comment at the top of
  `entrypoint-claude.js`/`entrypoint-codex.js` so Step 6's generator change
  (populating `commandWindows` with the same command string) has a documented
  rationale.
- [x] Step 5: Point `catalog/plugins/gt-workflow.json`'s `hooks` block at the
  new Node entrypoints — replace `"command": "bash
  ${CLAUDE_PLUGIN_ROOT}/hooks/check-git-push.sh"` with `"command": "node
  ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/entrypoint-claude.js --hook
  check-git-push"` (and the commit-message equivalent), keeping the block
  fully inline per `schemas/plugin.schema.json`'s `inlineHooks`
  local-policy constraint (do NOT switch `hooks` to a file-path string).
  Run `pnpm generate:manifests` so `.claude-plugin/plugin.json` picks up the
  change, then `pnpm validate:generated` to confirm byte-identity.
- [x] Step 6: Add `commandWindows` emission to `buildCodexHookConfig` in
  `scripts/lib/generate/emit-codex.js` — for each translated hook entry, set
  `commandWindows` to the same command string as `command` (per Step 4's
  platform-uniformity rationale), keeping output deterministic
  (`JSON.stringify(obj, null, 2) + '\n'`, no timestamps) so hook-trust hashes
  stay stable across regenerations. Add or update a focused unit test near
  the existing `emit-codex.js` tests (search `find packages -iname
  "*emit-codex*"` or `packages/*/test*` for the existing suite) covering the
  new field.
- [x] Step 7: Write the parity harness at
  `plugins/gt-workflow/tests/hook-parity.bats`. For each fixture in
  `plugins/gt-workflow/tests/fixtures/hooks/`, pipe its stdin into `node
  ${PLUGIN_ROOT}/hooks/scripts/entrypoint-claude.js --hook <policy>` and
  assert stdout + exit code match the Step 1 golden file exactly. This
  proves bash-vs-Node behavioral equivalence via the before/after-golden
  pattern (shell 03 precedent) rather than keeping two live
  implementations. Once parity passes, delete
  `plugins/gt-workflow/hooks/check-git-push.sh` and
  `plugins/gt-workflow/hooks/check-commit-message.sh` (fully superseded —
  matches the shell's "rewritten" framing) and update
  `plugins/gt-workflow/hooks/hooks.json`'s `_comment` mirror to reference the
  new Node commands.
- [x] Step 8: Add a generic wrapper→canonical-skill drift check as RULE 17 in
  `scripts/validate-agent-authoring.js` (RULE 16 is the current highest,
  confirmed via `grep -n "RULE 1[0-9]" scripts/validate-agent-authoring.js`):
  for every command markdown file whose body contains `skill: "<name>"`
  (the shell-03 wrapper idiom), verify a `skills/<name>/SKILL.md` exists in
  the same plugin, and verify the command's `allowed-tools` frontmatter
  includes `Skill`. Generic (not gt-workflow-specific) so it also covers
  `plugins/yellow-core/commands/plan/status.md`. Add/update the corresponding
  fixture case in whatever test file exercises
  `validate-agent-authoring.js`'s existing RULE 16 (same file, same pattern).
- [x] Step 9: Convert all seven commands into canonical skills. For each of
  `gt-setup`, `gt-nav`, `gt-stack-plan`, `gt-sync`, `smart-submit`,
  `gt-amend`, `gt-cleanup`: create
  `plugins/gt-workflow/skills/<name>/SKILL.md` with the three standard
  headings (`## What It Does` / `## When to Use` / `## Usage`), moving the
  command body's logic in verbatim (including `gt-stack-plan`'s and
  `smart-submit`'s `.graphite.yml`-reading Bash blocks, and `gt-cleanup`'s
  cross-plugin `Skill` call to `worktree:cleanup`). Since Codex has no
  `$ARGUMENTS` primitive (spike finding (a)), rephrase any `#$ARGUMENTS`
  reference in `gt-nav.md`, `gt-stack-plan.md`, `gt-sync.md`, `gt-cleanup.md`
  as prose ("the argument text provided after the skill name") so the same
  SKILL.md body reads correctly on both hosts. Then rewrite each source
  command file to keep its `name`, `argument-hint`, `description`
  frontmatter unchanged, ADD `Skill` to `allowed-tools` alongside the
  original tools listed in the Pattern Survey table above (do not drop
  Bash/Read/Write/etc.), and replace the body with "Invoke the `Skill` tool
  with `skill: "<name>"`." per the shell-03 idiom.
- [x] Step 10: Consolidate the audit-agent prompts. Create
  `plugins/gt-workflow/skills/audit-review/SKILL.md` containing the
  `quick-code-review`, `quick-security-scan`, `quick-error-check` prompt
  text currently duplicated in `smart-submit.md` and `gt-amend.md`
  (read both files' exact prompt bodies before consolidating — confirm they
  are truly identical, not just similar), with a "## Usage" split into a
  Claude section (dispatch via the `Task` tool, `subagent_type:
  general-purpose`, parallel single-message launch per the current 1-3
  agent selection logic) and a Codex section (delegate to the built-in
  `worker`/`explorer` agent — Codex plugins cannot ship custom TOML agents
  per the Pattern Survey; verify the exact delegation syntax against
  `docs/solutions/integration-issues/codex-plugin-manifest-and-hook-contract.md`'s
  "Skills" section or upstream Codex docs at implementation time and flag if
  it differs from this description). Update `smart-submit`'s and
  `gt-amend`'s new canonical skills (Step 9) to invoke this skill instead of
  inlining the three prompts.
- [x] Step 11: Port the two output-styles into cross-host skills. Create
  `plugins/gt-workflow/skills/stack-decomposition-format/SKILL.md` from
  `output-styles/stack-decomposition.md`'s content (the machine-readable
  `## Stack Decomposition` section contract) and
  `plugins/gt-workflow/skills/stack-plan-style/SKILL.md` from
  `output-styles/stack-plan.md`'s content (display guidance), preserving
  `stack-plan.md`'s existing cross-reference to the decomposition format.
  Update the new `gt-stack-plan` canonical skill (Step 9) to reference both
  by name instead of relying on Claude's `outputStyles` auto-load (Codex has
  no equivalent manifest field). Leave
  `plugins/gt-workflow/.claude-plugin/plugin.json`'s `outputStyles:
  "./output-styles"` field and the two source files in place — Claude still
  benefits from the native output-style mechanism; the new skills are the
  Codex-reachable copy, not a replacement of the Claude-side feature.
- [x] Step 12: Shared MCP declaration. Create
  `plugins/gt-workflow/.mcp.json` containing the server definition currently
  inline in the manifest (`{"graphite": {"command": "gt", "args":
  ["mcp"]}}` — confirm the exact top-level shape, bare server-map vs.
  `{"mcpServers": {...}}` wrapper, against a fresh read of
  `docs/research/2026-07-16-codex-plugin-contract-spike.md` finding (e)
  before committing to one; the doc's wording — "server defs in the
  referenced file" — points to the bare form). Update
  `catalog/plugins/gt-workflow.json`'s `mcpServers` field from the inline
  object to the string `"./.mcp.json"` (already schema-valid per the
  `fileFilesOrInline` definition — no schema change). Run `pnpm
  generate:manifests` so `.claude-plugin/plugin.json` emits
  `"mcpServers": "./.mcp.json"` (pass-through, `emit-claude.js`'s
  `OPTIONAL_MANIFEST_KEYS` already handles this generically). If
  `.codex-plugin/plugin.json` (created in Step 13) needs an explicit
  `mcpServers` pointer rather than relying on Codex's default `.mcp.json`
  auto-discovery, add that field to `buildCodexPluginManifest` in
  `scripts/lib/generate/emit-codex.js` at this step — verify which is
  correct before writing the code (see the Pattern Survey's flagged
  uncertainty).
- [x] Step 13: Enable Codex in the catalog source. Add a `targets.codex`
  block to `catalog/plugins/gt-workflow.json` mirroring
  `catalog/plugins/yellow-core.json`'s shape: `enabled: true`,
  `interface: {displayName: "Graphite Workflow", category: "..."}` (pick a
  category consistent with the existing `marketplace.category:
  "development"`), a `description` if the top-level one needs Codex-specific
  trimming, `skillAllowlist` listing all ten new skills from Steps 9-11
  (`gt-setup`, `gt-nav`, `gt-stack-plan`, `gt-sync`, `smart-submit`,
  `gt-amend`, `gt-cleanup`, `audit-review`, `stack-decomposition-format`,
  `stack-plan-style`), and `componentPaths: {skills: "./codex/skills"}`.
  Leave `includeHooks` unset/default (true) — unlike yellow-core, gt-workflow
  DOES want its hooks carried into the generated Codex config (even though
  execution is currently inert, per Pattern Survey). Run `pnpm
  generate:manifests` — this produces `plugins/gt-workflow/.codex-plugin/plugin.json`,
  `plugins/gt-workflow/hooks/codex-hooks.json`, and
  `plugins/gt-workflow/codex/skills/*/SKILL.md` (ten dirs, generator-copied,
  do not hand-author). Run `pnpm validate:generated` and `pnpm
  validate:codex` to confirm.
- [x] Step 14: Fake-executable tests. Create
  `plugins/gt-workflow/tests/mocks/git` and `plugins/gt-workflow/tests/mocks/gt`
  following `plugins/yellow-review/tests/mocks/gh`'s pattern-match-on-`"$*"`
  + canned-fixture-JSON shape, with fixtures under
  `plugins/gt-workflow/tests/fixtures/`. Write bats files covering the
  behaviors named in the shell's Produces: `plugins/gt-workflow/tests/gt-cleanup.bats`
  (staging + conflict-stop paths), `plugins/gt-workflow/tests/smart-submit.bats`
  and `gt-amend.bats` (dry-run and confirmation-gate paths via
  `AskUserQuestion` — assert the skill body reaches the confirmation point
  without executing `gt submit`, not full end-to-end submission). Wire these
  into a `plugins/gt-workflow/CLAUDE.md` note (or root `CLAUDE.md`'s bats
  list) so `bats tests/` from inside the plugin directory picks them up,
  matching the existing yellow-ci/yellow-debt/yellow-review/yellow-ruvector
  convention.
- [x] Step 15: Documentation close-out for this shell.
  Update `plugins/gt-workflow/CLAUDE.md`: replace the bash-hooks description
  under `## Hooks` with the Node-runtime description (policy modules +
  entrypoints + envelope), add a "Codex Distribution" subsection mirroring
  `plugins/yellow-core/CLAUDE.md`'s pattern (list the ten allowlisted
  skills, note hooks are carried but currently inert on Codex per the spike),
  and add the new `tests/` bats files to any component inventory list.
  Confirm `AGENTS.md`'s Command/Agent/Skill Authoring section needs no edits
  (it already covers `user-invokable`, single-line `description:`, the
  three-heading rule, `${CLAUDE_PLUGIN_ROOT}`) — if the audit-review skill's
  host-specific delegation syntax (Step 10) turns out to need a new
  authoring rule, add it here.
- [x] Step 16: Manual Codex-app acceptance evidence. Document (in the PR
  description, not a repo file) the checks performed: `codex plugin add`
  installs cleanly from the local marketplace; the ten skills are visible
  and their `SKILL.md` content matches; hook config passes manifest
  validation and appears correctly in `/hooks` review/trust UI (execution
  itself is expected to be a no-op per the spike — do not treat a
  non-firing hook as a failure); the `.mcp.json`-declared `graphite` server
  is discoverable (or explicitly note if it is not, per Step 12's
  uncertainty). This is a human step, not automatable from this repo.
- [x] Step 17: Delivery. Run `pnpm validate:schemas`, `pnpm test:unit`,
  `pnpm lint`, `pnpm typecheck`, and `bats tests/` from inside
  `plugins/gt-workflow/`. Run `pnpm changeset`, select `gt-workflow: minor`,
  write a summary covering the Codex skill/hook/MCP pilot. Commit via `gt
  modify -c` and submit via `gt submit --no-interactive` (per root
  `CLAUDE.md`'s mandatory Graphite workflow — never raw `git push`).

## Verification

- `bats plugins/gt-workflow/tests/hook-parity.bats` → expected: every fixture
  case's Node-entrypoint output matches its Step 1 golden file exactly (exit
  code + stdout).
- `bats plugins/gt-workflow/tests/*.bats` (full suite, run from inside the
  plugin directory) → expected: all pass, including the new fake-executable
  staging/dry-run/confirmation/conflict-stop cases.
- `pnpm generate:manifests && pnpm validate:generated` → expected: no diff
  (generator output is byte-identical to committed
  `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`,
  `hooks/codex-hooks.json`, and `codex/skills/*`).
- `pnpm validate:schemas` (schemas + marketplace + plugins + setup-all +
  agent-authoring + error-codes + snippets + solutions + generated + codex)
  → expected: all pass, including the new RULE 17 wrapper-drift check firing
  clean against all seven gt-workflow wrappers and `plan/status.md`.
- `pnpm validate:codex` → expected: gt-workflow's `.codex-plugin/plugin.json`
  and skill tree pass schema validation and the R15 exposure lint.
- `pnpm typecheck && pnpm lint && pnpm test:unit` → expected: all pass
  (release:check baseline gate).

## Context Files

- `plugins/gt-workflow/commands/*.md` — the seven commands being converted to
  wrappers.
- `plugins/gt-workflow/hooks/check-git-push.sh`,
  `check-commit-message.sh`, `hooks.json` — the bash hooks being replaced and
  their reference-only mirror.
- `plugins/gt-workflow/.claude-plugin/plugin.json`,
  `catalog/plugins/gt-workflow.json` — manifest + generation source needing
  the hook-command, `mcpServers`, and `targets.codex` edits.
- `catalog/plugins/yellow-core.json`,
  `plugins/yellow-core/skills/plan-status/SKILL.md`,
  `plugins/yellow-core/commands/plan/status.md`,
  `plugins/yellow-core/tests/plan-status-parity.bats` — the shell-03
  wrapper/skill/parity precedent this shell generalizes to seven commands.
- `scripts/lib/generate/emit-codex.js`,
  `scripts/lib/generate/emit-claude.js` — the generator functions needing the
  `commandWindows` addition and (possibly) an `mcpServers` pointer addition.
- `scripts/validate-agent-authoring.js` — RULE 16 precedent for the new RULE
  17 wrapper-drift check.
- `docs/research/2026-07-16-codex-plugin-contract-spike.md`,
  `docs/solutions/integration-issues/codex-plugin-manifest-and-hook-contract.md`
  — the primary-source facts governing hook envelope shape, Codex hook
  inertness, and the `.mcp.json` file-reference mechanism.
- `plugins/yellow-review/tests/mocks/gh`,
  `plugins/yellow-review/tests/resolve-pr-thread.bats` — the fake-executable
  mock pattern to mirror for `git`/`gt`.
- `plugins/gt-workflow/CLAUDE.md` — component inventory, `.graphite.yml`
  contract, and hooks description needing updates.
