# Session continuity acceptance and evaluation plan

**Status:** Proposed test contract. These are cases to implement and run, not
completed test results. Nothing here has been executed; no scenario is `passed`.
**Adopted:** 2026-09-17 into `docs/testing/` from the external
session-continuity packet (ACCEPTANCE-TESTS.md sha256 `babde9fc…`). Scenario IDs
`T01`–`T32` are stable and map to the requirement IDs in the
[PRD](../prds/session-continuity.md); evidence conventions come from the
[research ledger](../research/session-continuity-2026-09-17.md); the execution
sequence is in the
[build playbook](../development/session-continuity-playbook.md). **Foundation
scope:** the first milestone implements only the `F` rows (T01–T12). `E`, `P`
and `B` rows are engine-owned or gated on a released engine capability and are
listed so the plugin spec cannot silently claim them.

## Coverage matrix

| ID  | Stage / PRD   | Scenario                                               | Required observable behavior                                                                 |
| --- | ------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| T01 | F / R1,R2     | Two handoffs; unrelated one is newer                   | Explicit reference wins; no newest-file fallback                                             |
| T02 | F / R2,R6     | Same remote and branch, different clone/worktree       | Identity mismatch is reported; no silent resume                                              |
| T03 | F / R3,R4     | A model says tests passed but evidence is missing      | Claim remains unverified; measured fields are not overwritten                                |
| T04 | F / R5        | Termination during artifact write                      | Old complete or new complete artifact only; partial is not resumable                         |
| T05 | F / R5        | Collision, traversal, symlink escape, hostile filename | No overwrite/escape/code execution; explicit bounded error                                   |
| T06 | F / R5,R16    | Secrets and instruction injection in narrative/source  | No planted secret in tracked output; no additional authority granted                         |
| T07 | F / R6,R17    | HEAD/index/dirty state changes after capture           | Mismatch blocks or requires explicit reconciliation                                          |
| T08 | F / R6,R23    | Task was already solved at handoff                     | Recognize completion; do not start unnecessary edits                                         |
| T09 | F / R7        | Null, stale, malformed, wrong-session context sample   | Unknown, never interpreted as exhausted context                                              |
| T10 | F / R8,R20    | Repeated/canceled observer and duplicate delivery      | No partial observation, spawn, model call or duplicate action                                |
| T11 | F / R1,R8     | Existing custom statusline and native compaction       | No silent replacement or compaction disablement                                              |
| T12 | F / R20,R24   | Installed cached plugin differs from checkout          | Report loaded source/version and verify intended plugin; no duplicate install                |
| T13 | E / R9,R10    | Duplicate rotation requests / stale generation         | One transition; stale event cannot mutate active run                                         |
| T14 | E / R9        | Bootstrap prompt already crosses watermark             | Bounded pause or normal continuation; never a rotation storm                                 |
| T15 | E / R11       | Long-running tool is active                            | Drain defers new work; timeout/cancel is explicit, not assumed stopped                       |
| T16 | E,P / R11,R17 | Parent exits; child or stop hook still writes          | Successor write access remains blocked; final fingerprint revalidated                        |
| T17 | E / R12       | Crash at each persisted transition                     | Recover one owner or visibly pause; retain checkpoint and pending state                      |
| T18 | E / R12,R15   | External effect succeeds; receipt is lost              | Mark uncertain; reconcile, no blind resend                                                   |
| T19 | E / R12,R13   | Launch accepted; reply lost                            | Find/reconcile exact launch operation; no second blind launch                                |
| T20 | E,P / R13     | Resume/respawn used instead of fresh creation          | Capability/test fails; no false clean-context result                                         |
| T21 | E / R14,R16   | Narrative tries to mint a grant or reset cost          | Engine authority/cumulative budget unchanged                                                 |
| T22 | E,P / R14     | Cancellation at every boundary                         | Cancel wins; no new work becomes active afterward                                            |
| T23 | E / R15       | Delivered-but-unapplied vs applied work                | Unapplied work retained; applied controlled effect not repeated                              |
| T24 | E,P / R11,R13 | Host cannot prove writer exclusion                     | Unsupported/recoverable pause; no fabricated enforcement                                     |
| T25 | B / R18       | Engine absent, wrong version/hash/capability           | Readable unsupported result; no real executor fallback                                       |
| T26 | B / R19       | Dry run with an otherwise executable task              | Zero launch/stop/mutating provider requests                                                  |
| T27 | B / R20       | Spaced plugin path and real hook envelopes             | Correct entrypoint/payload; exactly one registration in configured profile                   |
| T28 | E,B / R21     | Disable/restart while rotation is pending              | No new auto-rotation; existing transition reconciles or visibly pauses                       |
| T29 | All / R22     | Zero matching tests / skipped host                     | Report not exercised, never passed; retain actual test counts                                |
| T30 | All / R24     | Unrelated project has lower-numbered shell             | Explicit shell selection stays on this feature; no foreign dependency markers                |
| T31 | P,B / R14,R22 | Live Fable request might bill usage credits            | Require separately authorized model/billing/run budget before execution                      |
| T32 | P / R22,R23   | Normal real continuation path                          | Worker actually resumes useful authorized work in a new session, not only refuses everything |

Foundation fixture inputs that already exist in this repository (2026-09-17):
the two legacy handoffs
`plans/handoff/2026-07-28-pr666-667-deferred-review-followups.md` and
`plans/handoff/2026-07-29-sweep-all-670-672-close-out.md` (T01, T11
legacy-readability half of R1); the installed statusline script's null handling
(`context_window.used_percentage` → `ctx:--`) as the baseline T09 must not
regress; `plugins/yellow-core/tests/pre-compact-hook.bats` as the hook-test
convention; PR #802's
`tests/fixtures/hooks/check-git-push/real-host-envelope.stdin` as the pattern
for real-envelope fixtures (T10, T27). T12's "installed cached plugin differs
from checkout" baseline on the adoption date was _no difference_ (cache 2.3.1 at
`4192ea57` vs checkout 2.3.1); the test must still be written because the cache
lags `main` whenever a plugin version is bumped.

No fixture should contain real credentials or customer/private repository
content. Use synthetic adversarial strings and local temporary worktrees.
Include unusual Git paths, staged plus unstaged edits, untracked files and
renames. Do not assume a remote URL and branch uniquely identify a workspace.

## Test layers

**Unit:** pure decision policy, reference parsing, metadata validation, format
readers, error/status mapping, state transitions and budget arithmetic. Use fake
clocks and deterministic generators where useful.

**Integration:** filesystem publication, interrupted writes, process adapter
with fake executors, catalog generation, plugin packaging, run journal recovery
and consumer contract fixtures. Test actual consumers, not just schema or
Markdown-string presence.

**Host-contract smoke:** capture sanitized real supported-client payloads and
assert actual routing, cancellation and fresh-start semantics. Prove which
installed plugin copy runs. Do not infer success from the checked-out source
alone.

**Live model evaluation:** opt-in, separately authorized model, billing mode,
total spend/usage limits, task scope and stop conditions. Normal CI makes no
paid model calls. Stop tests when the authorization or cost telemetry is
insufficient.

## Verification commands

In yellow-plugins, inspect current package scripts and plugin test layout first.
All of the root entries below were confirmed present in `package.json` on `main`
`3812fc66` (2026-09-17); none were executed by the readiness pass:

```bash
pnpm validate:schemas
pnpm validate:generated
pnpm validate:versions
pnpm validate:doc-counts
pnpm build
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm lint:plugins
```

Additional gates confirmed on the same revision and required for the foundation:

```bash
pnpm validate:agents            # after any plugin Markdown edit (with pnpm lint:plugins)
pnpm validate:plans             # PR-diff-scoped archived-plan checkbox rule
pnpm generate:manifests         # only when catalog/ changes; then refresh
pnpm vitest run tests/integration/generate-manifests-characterization.test.ts -u
cd plugins/yellow-core && bats tests/ && bats skills/git-worktree/tests/   # yellow-core behaviour is bats-only
```

`pnpm test:unit` covers `packages/`, `yellow-cursor` and `yellow-goal` only; it
exercises nothing in yellow-core, so a foundation PR whose only test evidence is
`test:unit` has zero coverage of the feature (T29). `session-handoff` currently
has no bats file; the foundation must add one. Plugin file changes need a
changeset (`pnpm changeset`).

Run applicable plan validation using its documented base/diff contract. Run the
actual changed plugin's Bash/Bats or other behavioral suite; root test commands
alone are insufficient coverage evidence. Generate manifests from catalog
sources before validating generated output when the scope changes catalog data.
Discover and report exact entrypoints, counts and results.

In yellow-goal, follow the repository's current instructions; its inspected
README lists `npm test`, `npm run eval:planner` and `npm run typecheck` from
`goal-gen/`. These are not a substitute for adding and executing
lifecycle-specific tests.

Do not install missing tooling or launch paid probes implicitly. Report baseline
environment failures separately from regressions. A known baseline issue is not
an unqualified green release result.

## Comparison experiment

Pre-register the same representative task set for four arms: native
continuation; checkpoint-assisted native continuation; fixed-50% rotation;
adaptive safe-boundary rotation. Include investigation, bounded implementation,
a failing-test repair, and an already-solved takeover. Preserve starting
snapshots and constraints. Randomize execution order where feasible and use
repeated trials within the approved budget.

Record actual model ID, client version, plugin/engine versions, policy
configuration, checkpoint size, input/output usage, pricing assumptions or
measured charges, elapsed time, completed acceptance checks, repeated
searches/reads and failures. If a subscription exposes no reliable per-run
dollar cost, report measured usage and mark dollars unknown rather than
inventing savings.

Use a side-effect-free hidden marker in the old synthetic conversation to help
distinguish fresh context from history replay, combined with native session
lineage evidence. The marker alone is not proof: models may omit remembered
text. Do not place the marker in the handoff or repository.

The policy decision is not based on a model saying its handoff was clear.
Require no critical invariant violations, inspect completion non-regression and
total-cost trade-offs, and report variance and sample size. Reduced rediscovery
is valuable even without a solved-rate increase. A small smoke study supports
only a bounded pilot; default-on remains a separate owner decision.

## Required result format

For each gate report: requirement IDs, test IDs, exact command, actual test
count, result (`passed`, `failed`, `not-run`, `unsupported`), evidence path, and
remaining limitation. For host tests include actual native session/model IDs
with sensitive values omitted from public artifacts.
