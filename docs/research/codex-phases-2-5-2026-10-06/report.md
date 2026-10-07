# Codex compatibility: Phases 2–5 acceptance

Completed October 6, 2026 in the existing detached WSL worktree:
`/home/kinginyellow/workspaces/yellow-harness_workspace/worktrees/yellow-plugins/codex-compatibility-evaluation-2026-10-04`.
Base revision: `cb7469ffe5d7c5e455c53c65055dac1d0d7e35b0`. Changes remain
uncommitted; changesets are present and unapplied. No blocker remains within the
authorized local implementation and acceptance scope.

The final generated marketplace installs **nine plugins / exactly 29 skills**.
All **32 expansion model cases plus three plan-status regression cases** pass
using native authenticated Codex 0.157.0 / gpt-6-astra in disposable profiles.
This is scoped acceptance of the selected workflows, not a claim that all
exposed plugin functionality or every host has been exercised.

## Implemented scope

Phase 2 carries shared author/license/keywords and justified presentation
identity from existing metadata; distinguishes runtime parsing, presentation and
optional public submission requirements; and supports only a tightly validated
`agents/openai.yaml` invocation-policy sidecar. Directory/leaf traversal,
symlink escapes, unknown keys, aliases, malformed YAML and undeclared policy
resources are rejected. Codex copies the sidecar; Cursor validates and omits it.
Stale policy resources are detected and removed only by generation. Two
consecutive generation runs yield identical bytes. New scripts/assets resource
kinds were unnecessary for the selected workflows. The installed Cursor runtime
already ships as a tracked executable, and the debt snapshot program resides in
a flat Markdown reference.

The thermonuclear policy uses `allow_implicit_invocation: false`. A real
explicit invocation loads the installed skill and completes its read-only
report; ordinary implicit review and an unrelated task do not load it.
[Phase 2 contract evidence](phase2.md), [policy receipt](policy-final.json),
[generation determinism](generation-determinism.json) and
[installed/source provenance](provenance-final.json).

Phase 3 replaces the two large CI entrypoints and Graphite setup with concise
shared-source skills plus three flat references each. All original fenced shell
bodies remain byte-identical. Redaction, validation, report contracts and
approval boundaries are preserved. The cohesive 414-line thermonuclear rubric
remains intact with attribution. Representative before/after installed tasks
pass, and 32 regression tests execute the moved CI/setup shell blocks under bash
and zsh. [Phase 3 report](phase3.md), [source sizes](phase3-sizes.json) and
[task metrics](task-metrics.json).

Phase 4 adds one concrete workflow per wave. Candidate installed gates passed
before their catalog targets were enabled.

| Wave                      | Selected workflow                    | Acceptance and limits                                                                                                                                                                                                                                 |
| ------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Developer                 | yellow-core/worktree-inventory       | Actual native Git inventory; missing Git and unrelated controls; no worktree or stack mutation, dirty status unknown                                                                                                                                  |
| Review/docs               | yellow-docs/docs-audit               | Sequential current-checkout audit catches a concrete fixture mismatch with evidence, score and coverage; missing reads and unrelated controls; findings only                                                                                          |
| Local analysis            | yellow-debt/debt-complexity-scan     | Installed-reference Python snapshot executes on bounded source; model reports heuristic complexity; unsafe paths/missing Python/unrelated controls; no fixes or issue/state writes                                                                    |
| Integration               | yellow-research/research-public-repo | Actual public DeepWiki question for modelcontextprotocol/python-sdk using the advertised current tool; unavailable, authentication-error, private-repository and unrelated controls; no private uploads                                               |
| Remote agents/memory      | yellow-cursor/cursor-plan            | Actual installed Cursor CLI offline dry run with no credentials, SDK, siblings or dependency tree; missing runtime and unrelated controls; no remote launch or auth claim                                                                             |
| Specialized orchestration | yellow-codex/codex-readiness         | Actual native CLI version and privately captured/sanitized login-status classification; installed-reference native empty-profile auth absence, missing CLI and unrelated controls; no recursive model request, credential inspection or memory access |

The worktree skill uses the existing read-only Git behavior. Documentation audit
uses a sequential host fallback. Debt ports the existing scanner's output fields
and heuristic anchors. DeepWiki is the existing public no-auth HTTP integration,
mapped explicitly for Codex with a narrow tool allowlist. Cursor reuses its
tracked dry-run runtime. Codex ports its local readiness procedure with a
bounded probe. No new mutation-capable stack workflow is exported. Other plugin
components remain excluded or outside runtime acceptance.

Contracts and evidence: [waves 1–2](waves1-2.md), [waves 3–4](waves3-4.md),
[waves 5–6](waves5-6.md), [final runtime index](runtime-final-index.json). The
root README, affected plugin README/CLAUDE files, canonical support/security
docs, generated manifests and five new changesets were updated together.

Phase 5 keeps this repository and `.agents/plugins/marketplace.json` as the
private/local source of truth. Pinned WSL install/list and same-version cache
refresh are documented. Repeated add and remove/add both refresh staged source
bytes in actual disposable CLI profiles. Windows desktop differences are
documented; desktop installation, activation and hook trust are untested. Public
publication is deliberately deferred. A portable root manifest and a second
generated distribution repository are not applicable without a demonstrated
need. [Distribution decisions](phase5.md),
[cache-refresh receipt](cache-refresh.json) and
[canonical operator instructions](../../codex-distribution.md).

## Final validation

Repository commands ran only in Ubuntu-24.04 with Node 22.22.0 and pnpm 8.15.0.
Graphite remains 1.7.20; no runtime upgrades or production dependencies were
added.

| Check                                                            | Final result                                                                                                                 |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| pnpm validate:schemas                                            | Exit 0; includes agent authoring, generated drift, Codex exposure, marketplace/plugin/setup and shell compatibility gates    |
| pnpm validate:versions                                           | Exit 0                                                                                                                       |
| pnpm validate:generated                                          | Exit 0; all 85 generated files match sources                                                                                 |
| pnpm test:unit --maxWorkers=2 --minWorkers=1                     | Exit 0; 787 passed                                                                                                           |
| pnpm test:integration --maxWorkers=2 --minWorkers=1              | Exit 0 on full rerun; 1,876 passed, one existing skip                                                                        |
| pnpm lint / pnpm typecheck                                       | Exit 0; one nonfatal return-type warning in a complexity fixture                                                             |
| pnpm lint:plugins                                                | Exit 0                                                                                                                       |
| pnpm validate:shell-compat                                       | Exit 0                                                                                                                       |
| SHELL_COMPAT_REQUIRE_ZSH=1 pnpm check:shell-parse                | Exit 0 with zsh available; not a missing-tool skip                                                                           |
| pnpm test:shell-compat                                           | Exit 0; 21 cases, no skips                                                                                                   |
| bats plugins/yellow-ci/tests/                                    | Exit 0; 286 cases, one historical orchestration skip                                                                         |
| bats plugins/gt-workflow/tests/                                  | Exit 0; 107 cases, one historical jq-only skip                                                                               |
| bats plugins/yellow-review/tests/                                | Exit 0; 1,151 cases, two existing skips                                                                                      |
| git diff --check                                                 | Exit 0                                                                                                                       |
| Final documentation formatting and dirty solution-doc validation | See validation-completion.json; dirty docs explicitly supplied because the normal solution validator compares committed refs |

[Integrated command receipts](validation-final.json),
[resolved full rerun](validation-postfix.json),
[intermediate failures and resolutions](intermediate-checks.json), and
[completion checks](validation-completion.json) retain commands, exits and
sanitized evidence. The first broad integration run failed three old assertions
that froze the original four-plugin/23-skill inventory. Tests and the fake CLI
now derive intended exposure from the catalog; the full rerun passes. Failed
runtime attempts are retained: fixture containment/output mismatches were
resolved, and a public MCP tool approval rejection was resolved through the
supported narrow disposable tool policy without changing owner policy.

## Runtime proof and practical limits

[Discovery](discovery-final.json) independently proves installed inventory and
three enabled but untrusted hook definitions. [Lifecycle](lifecycle-final.json)
proves exact-hash disposable trusted/untrusted controls and actual Graphite MCP
startup. Its internally recorded remaining semantic/auth gates are completed by
separate [plan activation](plan-activation-final.json) and
[native Graphite authentication](graphite-auth-final.json) receipts. Loopback
Responses used for deterministic hook delivery are not semantic skill evidence;
the 35 final semantic cases use the native real provider.

Every final expansion receipt records installed skill/reference reads, tool
events, immutable fixture/plugin hashes and unchanged owner-auth metadata.
Native callbacks execute the Git inventory, Cursor CLI, Python source snapshot
and sanitized Codex readiness probes. An additional native login probe executes
the exact installed reference in an empty profile and returns only missing auth;
the installed model case then consumes that sanitized evidence
([native receipt](codex-absent-auth-native.json),
[model receipt](codex-missing-auth-final.json)). DeepWiki Q&A is a real
connected server response. CI logs/prerequisites, missing-tool/auth controls and
refusal scenarios are declared fixtures. They do not establish live CI API or
runner SSH health. Native login classification is local readiness evidence, not
a new model/access claim. Cursor planning does not establish authenticated
remote execution.

Task metrics contain actual provider notifications and tool/read counts. Smaller
entrypoints are not measured runtime savings. CI before/after totals are
single-run observations affected by cache state and tool trajectories;
Graphite's one-skill baseline versus eleven-skill final exposure prevents a
controlled efficiency comparison. No causal token-cost savings claim is made.

## Preservation and handoff

All 54 hashed historical evaluation/Phase 1 evidence files and prior changesets
match their initial baseline. Credential stores were read-only mounted for the
native runtimes, never copied or read into reports. The harness verifies owner
authentication/configuration metadata afterward. The original checkout, other
worktrees and Windows checkout were preserved.

No commit, push, PR submission/merge, public publication, owner-profile plugin
installation/trust, credential change, real remote mutation, destructive
cleanup, history rewrite or service restart occurred. Changesets were not
applied. [Acceptance audit](acceptance-audit.json) records evidence by gate;
[changed-file inventory](changed-files.json) records the review surface;
[completion checkpoint](continuation.md) preserves exact paths and boundaries.
