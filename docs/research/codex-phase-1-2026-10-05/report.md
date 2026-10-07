# Phase 1: Codex install and discovery evidence

Date: October 5, 2026. Status: Phase 1 runtime acceptance complete. Installed
discovery, hook controls, real-model activation, actual Graphite MCP startup and
separate native authentication/access checks passed. Final validation follows.

## Environment and boundaries

- WSL Ubuntu-24.04; Node 22.22.0; pnpm 8.15.0; pinned Codex CLI 0.157.0.
- Windows desktop package: historical 26.930.3930.0; fresh Get-AppxPackage
  inventory is OpenAI.Codex **26.930.4958.0**. Desktop plugin behavior was not
  exercised by the WSL CLI.
- Source base: `cb7469ffe5d7c5e455c53c65055dac1d0d7e35b0` plus the uncommitted
  implementation in the isolated compatibility-evaluation worktree.
- Historical provider classification: READY_GRAPHITE. Worktree remains detached;
  no branch, commit, push, publication, credential copy or real-profile install
  occurred.
- Main checkout contains unrelated ongoing edits; this work did not touch them.

## Historical installation-stage change and observed behavior

`pnpm smoke:codex` installs the four enabled plugins into an isolated profile,
checks installed manifests/skill resources against source and catalog
allowlists, then verifies the loaded app-server skill and hook inventories. The
receipt records source revision/dirty state and hashes of manifest/skill
content. The real CLI gate remains optional; deterministic subprocess tests run
with the normal integration suite. No production dependency was added.

The initial gate failed correctly: 26 plugin skills were loaded despite 23
selected skills. Unexpected runtime wrappers were:

- `gt-workflow:source-command-gt-merge`
- `gt-workflow:source-command-gt-setup`
- `yellow-core:source-command-plan-status`

The Codex generator now emits `commands: []`, with a repository schema rule,
regression tests and four-plugin patch changeset. Fresh installed discovery
passes with exactly 23 skills. Claude/Cursor generated outputs and the existing
Claude smoke harness are unchanged.

| Plugin        | Installed version | Loaded selected skills |
| ------------- | ----------------- | ---------------------- |
| gt-workflow   | 2.0.6             | 11                     |
| yellow-core   | 2.6.2             | 3                      |
| yellow-review | 3.5.3             | 1                      |
| yellow-ci     | 1.5.6             | 8                      |

Receipts: [before](discovery-before.json), [after](discovery-after.json). Each
identifies the disposable installed paths; the recorded scratch trees were
removed after the runs. The before receipt predates the final harness's
additional resource/hash checks and is retained as the original failure
evidence.

All three expected hooks were discovered as enabled but **untrusted**:
gt-workflow PreToolUse/PostToolUse and yellow-ci SessionStart. This does not
establish that they run or block actions. Installed Graphite MCP declaration
bytes match source and declare `graphite`; connection and authentication remain
untested. A separate source-marketplace `plugin/read` probe returned the
Graphite declaration, but was not accepted as installed runtime registration.

## Historical installation-stage verification

- Initial new harness tests failed because the harness was absent.
- Generator/schema regressions first failed, then passed (91 focused cases).
- Live baseline failed for the three extra migrated wrappers; corrected live
  `node scripts/smoke-codex-plugin-install.js --ci` exited 0.
- New subprocess coverage exercises absent/version-mismatched CLI, profile/env
  isolation, malformed JSON, RPC errors, timeouts, failed server startup,
  unexpected/disabled/missing/duplicate skills, source-path escapes, symlinks,
  changed/extra resources, and unexpected hooks or foreign user skills.
- `pnpm validate:schemas`, `pnpm validate:versions`, `pnpm lint`,
  `pnpm typecheck` and `pnpm lint:plugins` exited 0.
- `pnpm test:unit --maxWorkers=2 --minWorkers=1` exited 0: 787 tests across
  workspace packages and the Cursor, Goal and Jules plugin runtimes.
- Initial full integration had one stale assertion requiring the Codex
  `commands` field to be absent. It now requires an empty list for Codex while
  retaining the Cursor assertion. The corrected full run passed; see the final
  verification summary below.
- The integration suite retains one existing shell-parser skip; a skip is not
  proof of that skipped behavior.

## Continued runtime acceptance

The earlier /tmp hook prototype and receipts were absent when WSL recovered.
They were not accepted as evidence. The reconstructed optional
`scripts/smoke-codex-plugin-lifecycle.js` now runs actual Codex 0.157.0
app-server lifecycle events in disconnected user/mount/PID/network namespaces,
with disposable profiles, a loopback Responses fixture and git/gt/gh stubs.
Source and installed hook/config bytes match; Graphite MCP is disabled during
both hook controls. Only the exact three installed hook hashes are trusted.

| Control   | Push stub | Modify stub | Started/completed hooks |
| --------- | --------- | ----------- | ----------------------- |
| Untrusted | 1         | 1           | 0 / 0                   |
| Trusted   | 0         | 1           | 4 / 4                   |

Trusted events include one completed SessionStart, a **blocked** PreToolUse for
push, an allowed PreToolUse for modify, and a completed PostToolUse carrying the
conventional-commit warning. Actual command execution items and the stub logs
agree. This proves host dispatch and denial, not semantic model selection. The
SessionStart case uses an unauthenticated GitHub stub; it does not prove live CI
data delivery.

A separate no-model-turn probe registers installed `graphite` from
`gt-workflow@yellow-plugins`. It launches actual Graphite CLI **1.7.20**,
observes startup `starting -> ready`, a `connected` runtime, server identity
`gt` 0.0.1, and `run_gt_cmd` / `learn_gt` tools. Git's version/repository
paths/empty refs are synthetic; other Git reads fail. The wrapper permits only
`gt mcp` and no MCP tool is invoked. No credentials or real profiles are
accessed. `authStatus: unsupported` concerns stdio authentication support, not a
signed-in Graphite account.

Initial MCP fixture failures were caused by incomplete synthetic Git responses
(version, repository path shape, then empty ref reads). Those fixture defects
were corrected without changing plugin MCP declarations, hook policy, or real
Git/Graphite state. The final startup receipt uses the real installed Graphite
CLI code with bounded synthetic Git collaborators.

Fresh receipts: [installed discovery](discovery-final.json),
[lifecycle + MCP summary](lifecycle-after.json), and individual event/trust/stub
receipts in [runtime/](runtime/). The CLI installed cache paths/hashes are
recorded. Runtime scratch is retained for inspection and is disposable; the
repository receipts survive /tmp loss. The reusable harness is optional, with 11
integration cases rejecting false-pass controls. Exit 0 means those host checks
passed; `phase1Acceptance: partial` describes this fixture alone. The
separate real-model and account receipts below satisfy the remaining gates.

## Real-model activation and account prerequisites

The user selected the existing Codex CLI in WSL. The optional
`smoke:codex:activation --use-existing-login` harness uses Codex 0.157.0, its
bundled code-mode host and native OpenAI provider (observed model
`gpt-6-astra`). Existing CLI auth is read-only mounted into disposable state;
credential bytes are never copied or read by the harness. Shell, apps, browser,
web search and delegation are disabled. Only exact allowlisted dynamic read/list
handlers return fixture or installed-skill files. Fresh threads use read-only
sandboxes with model-tool networking disabled; the CLI retains provider network
access for inference. This is separate from disconnected mocked hook dispatch.

The first direct attempt failed because the bundled code-mode host was disabled;
the model reported that inability instead of inventing progress. The failure is
preserved in activation-initial-failure.json. Enabling the existing bundled host
repaired the fixture without dependencies or plugin logic changes.

| Case      | Installed activation                                            | Output          |
| --------- | --------------------------------------------------------------- | --------------- |
| Direct    | Installed skill attached and read by the model                  | Exact dashboard |
| Indirect  | No attachment/skill mention; model requested installed SKILL.md | Exact dashboard |
| Unrelated | No skill or fixture reads                                       | 4               |

Both dashboard cases read all four fixture files: open in-flight 1/3, ready 2/2,
research 0/0, archived shipped 1/1, archived count 1. Only open ready 2/2 is
ready to archive. [activation-after.json](activation-after.json) records
installed identity/path, typed reads, output, fresh threads and before/after
hashes. Fixture/plugin bytes and owner auth metadata stayed unchanged. This is
bounded three-case evidence on the pinned WSL runtime, not Windows desktop or
general model/skill compatibility proof.

Separate `smoke:codex:graphite-auth --use-existing-login` runs Graphite 1.7.20
`internal-only check-auth` against read-only repository and existing native
config mounts. It retains only classified status, never credential or account
identity. [graphite-auth.json](graphite-auth.json) records `ok`: account
authenticated and repository access both true. Owner config metadata stayed
unchanged. This is distinct from MCP registration/startup/tool discovery and
stdio `authStatus: unsupported`. No mutation MCP tool or PR/branch operation
ran.

No real-profile install/trust, credential copy, branch mutation, commit, push,
publication or disruptive restart occurred. Intermittent WSL 0x8007274c
transport failures recovered through bounded read-only health checks. Other
worktrees and Windows checkout are preserved. Phases 2–5 remain untouched.

## Historical installation-stage final verification

The final integrated source state passed 55 integration files: **1,769 tests
passed, one existing test skipped**. The 29 new smoke tests all passed. The
final real CLI gate exited 0 with four installed plugins, exactly 23 loaded
plugin skills and three untrusted hooks. Generated drift and diff whitespace
checks exited 0. At that installation-only checkpoint, model/hook/MCP runtime
states remained untested.

## Fresh integrated validation

See [validation.json](validation.json) for current commands, timestamps, exit
codes and counts. The original installation-stage summary is retained as
[validation-initial.json](validation-initial.json). These fresh checks cover the
final integrated uncommitted implementation; historical passes above are
checkpoints, not a substitute for them.

## Final Phase 1 completion

Final frozen harness receipts match the current script SHA-256 values. Installed
discovery passed with exactly 23 skills using the supported 60-second deadline;
the earlier 20-second timeout under WSL load is retained as discovery-timeout.json.
Hook/MCP controls passed again in lifecycle-final.json. Direct, indirect and
negative real-model cases passed against the final activation harness; native
Graphite check-auth separately returned ok with unchanged owner metadata.

The activation rerun exposed strict rejection of relative fixture paths. The
handler now resolves only exact allowlisted relative plan filenames, rejecting
traversal and credential paths. The failed guard run is retained in
activation-path-guard-failure.json. Import-order lint findings were repaired.
Post-fix regression checks passed (11 activation, 5 authentication cases).

Final verification: 1,796 integration tests passed, one existing parser skip;
787 unit tests passed. Schemas/generated drift, versions, typecheck, lint,
plugin lint and whitespace checks passed. The prior 393 relevant Bats tests
remain applicable: hook/plugin source has not changed since that verified run.
Intermediate failures and the post-fix results are both recorded in validation.json.

Phase 1 is complete. No required acceptance blocker remains. Changes are still
uncommitted in the existing isolated detached worktree. Phases 2–5 were not begun.

Changed files for this continuation: scripts/smoke-codex-skill-activation.js,
scripts/smoke-codex-graphite-auth.js, their two integration suites, the activation
corpus status, package.json script entries, the Phase 1 plan, runtime/distribution /
security docs, and durable evidence. Earlier discovery/generator fixes, hook
fixture, plugin docs and changesets are preserved.
