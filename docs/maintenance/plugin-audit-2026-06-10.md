# Plugin Audit — 2026-06-10

Full-marketplace audit of all 18 plugins: structure correctness, trigger
quality, instruction quality, redundancy, and per-plugin usefulness verdict.

**Method:** `pnpm validate:schemas` (passed clean) + one read-only exploration
agent per plugin + manual verification of every P1 claim against the repo and
the live MCP tool registry. One agent finding was dismissed as a false
positive after verification (`Task` missing from docs:review allowed-tools —
it is present); one finding was larger than reported (stale Linear tool names
span 4 plugins, not 1).

**Remediation:** Batches A, B, C approved 2026-06-10 and staged as the gt
stack based on this commit. yellow-chatprd was dropped from remediation and
removed entirely (owner decision, same date).

## Summary table

| Plugin | Verdict | Top issue |
|---|---|---|
| yellow-linear | OPTIMIZE | [P1] Write path uses stale MCP tool names (`create_issue`/`update_issue`/`create_comment`) that no longer exist on the Linear MCP server |
| yellow-chatprd | REMOVE (owner decision) | Originally OPTIMIZE; owner chose removal — bridge agent duplicated the link-linear command verbatim, stale Linear tool names |
| yellow-debt | OPTIMIZE | [P1-shared] Stale `create_issue` in `debt:sync`; `debt-fixer.md` dangling "see lines 61-91 in original agent" stub where scope-validation bash should be |
| yellow-ci | OPTIMIZE | [P1-shared] Stale Linear names in `report-linear`; commands reference shell functions the LLM cannot execute as written |
| yellow-devin | OPTIMIZE | [P1] `devin:tag` ships self-documented-as-unverified; orchestrator/delegate trigger ambiguity |
| yellow-core | OPTIMIZE | Orphaned agents (`test-coverage-analyst`, `security-lens`); 7 user-invokable skills missing from README; stale counts |
| yellow-docs | OPTIMIZE | `security-lens-reviewer` forks yellow-core `security-lens`; adversarial depth-gate contradiction |
| gt-workflow | OPTIMIZE | 5 of 7 commands lack "Use when..." trigger clauses; audit logic duplicated between smart-submit and gt-amend |
| yellow-browser-test | OPTIMIZE | Circular report-template reference (template exists nowhere); unset `$SERVER_PID` guard |
| yellow-ruvector | OPTIMIZE | ~82 of ~90 MCP tools uncovered; setup.md description violates single-line rule; memory routing vs mempalace undocumented |
| yellow-codex | OPTIMIZE | `codex-analyst` has no confirmed caller; awk redaction block duplicated 6×; freetext executor→rescue handoff |
| yellow-mempalace | OPTIMIZE | Redundant ToolSearch for statically-declared tools; fragile placeholder substitution in mine.md |
| yellow-morph | OPTIMIZE | Morph routing rules in 3 places; status masks invalid keys as HEALTHY |
| yellow-review | KEEP AS-IS | Minor: review-all mirrors review-pr (dual maintenance); 5 conditional personas unlabeled |
| yellow-research | KEEP AS-IS | Doc drift only (exa tools claimed off-by-default; enabled) |
| yellow-council | KEEP AS-IS | Dead docs/spikes refs; bash array lifetime tension council.md Steps 4–6 |
| yellow-semgrep | KEEP AS-IS | P3 polish only |
| yellow-composio | KEEP AS-IS | One stale README transport line |

## Cross-cutting findings

### X1. [P1] Stale Linear MCP tool names — 13 files across 4 plugins

Verified against the live MCP registry. The Linear MCP server exposes
`save_issue` (create+update upsert; pass `id` to update), `save_comment`,
`save_status_update`, `get_status_updates`. The repo had zero references to
`save_issue` and 13 command/agent files calling `create_issue` /
`update_issue` / `create_comment` / `list_initiative_updates` /
`create_initiative_update`:

- yellow-linear: sync.md, sync-all.md, create.md, work.md, triage.md,
  delegate.md, status.md, plan-cycle.md, agents/workflow/linear-pr-linker.md
- yellow-chatprd: link-linear.md, agents/workflow/linear-prd-bridge.md
  (resolved by plugin removal)
- yellow-debt: sync.md
- yellow-ci: report-linear.md

Every Linear write operation failed at runtime with "tool not found"; the
stale names also appeared in `allowed-tools`, so allowlists never matched.

### X2. [P2] Blank descriptions in live sessions = stale installed cache

~17 commands showed no description in a live session skill listing despite
valid single-line frontmatter at repo HEAD. Cause: installed plugin cache
stale relative to repo (see docs/maintenance/catalog-release-gap.md). Action
is a cache refresh/release, not file edits.

### X3. [P2] Plan-level security review exists twice

`yellow-core:review:security-lens` ≈ `yellow-docs:review:security-lens-reviewer`
— near-identical plan-level security reviewers; yellow-core's copy has no
dispatch path. Deferred (Batch D, not yet approved).

### X4. [P2] Devin session creation implemented twice

`yellow-linear:linear:delegate` reimplements the Devin V3 curl +
credential-validation flow owned by `yellow-devin:devin:delegate` (~60
duplicated lines). Deferred (Batch D).

## Per-plugin findings

### yellow-linear — OPTIMIZE
- [P1] X1: entire write path stale (8 commands + linear-pr-linker agent).
  Read path (`get_issue`, `list_*`) unaffected.
- [P2] `linear:sync` vs `linear-pr-linker` trigger overlap ("link to linear").
- [P3] delegate.md Step 8 emits /devin:* follow-ups even without yellow-devin.

### yellow-debt — OPTIMIZE
- [P1-shared] Stale `create_issue` in debt/sync.md.
- [P2] debt-fixer.md:67 dangling stub — scope-validation bash absent.
- [P2] fix.md:116 2-segment `yellow-debt:debt-fixer`; canonical is
  `yellow-debt:remediation:debt-fixer`.
- Scanner-vs-reviewer overlap with yellow-core holds (audit vs PR-review axis).

### yellow-ci — OPTIMIZE
- [P1-shared] Stale Linear names in report-linear.md.
- [P2] setup.md / setup-runner-targets.md tell the LLM to "validate using
  `validate_ssh_host` from lib/validate.sh" without an executable snippet.
- runner-cleanup `disable-model-invocation: true` verified intentional
  (blocks model auto-invocation of a destructive command); not a bug.
- [P3] /ci:status is a thin `gh run list` wrapper (kept: feeds diagnose).

### yellow-devin — OPTIMIZE
- [P1] devin:tag primary operation unverified (V3 endpoint TBD) — deferred.
- [P1] devin-orchestrator vs devin:delegate routing ambiguity (Batch C).
- [P2] devin:wiki body contradicts frontmatter on ToolSearch discovery (C).
- [P2] X4. [P3] archive/cancel/tag merge candidate (Batch D).
- [P3] devin_org_id marked sensitive — needless keychain prompting.

### yellow-core — OPTIMIZE (Batch D/E — deferred)
- [P2] Orphaned agents: test-coverage-analyst, security-lens (no dispatch path).
- [P2] README omits 7 user-invokable skills; CLAUDE.md says "Skills (13)" of 18.
- [P2] Research agents lack output-schema contracts for /workflows:plan.
- [P3] git-history-analyzer unwired.

### yellow-docs — OPTIMIZE
- Dismissed FP: `Task` IS in docs:review allowed-tools.
- [P2] Adversarial gate can dispatch depth="quick" for docs the agent's own
  Quick predicate rejects (Batch B).
- [P2] docs:review description is what-it-IS, not when-to-use (Batch C).
- [P2] X3 security-lens fork (Batch D).

### gt-workflow — OPTIMIZE
- [P2] 5 of 7 descriptions lack "Use when..." (Batch C).
- [P2] smart-submit --amend-on-trunk undefined (deferred).
- [P3] Phase-0 yq + audit dispatch duplicated between smart-submit/gt-amend.

### yellow-browser-test — OPTIMIZE
- [P2] Report template circular reference — no template exists (Batch B).
- [P2] explore.md references server-start logic that only exists in test.md.
- [P2] test-runner `kill -0 $SERVER_PID` passes silently when PID unset.
- [P3] agent-browser pinned 0.10.0 with TODO.

### yellow-ruvector — OPTIMIZE
- [P2] ~8 of ~90 MCP tools documented; brain_*/workers_*/rvlite_*/decompile_*
  subsystems invisible (deferred).
- [P2] setup.md multi-line single-quoted description (Batch B).
- [P2] No co-install routing policy vs yellow-mempalace/native memory.
- [P3] memory-manager queue-flush requires Write (verify tools list, Batch B);
  double recall injection on turn 1; fixed recall queries.

### yellow-codex — OPTIMIZE (Batch D/E — deferred)
- [P2] codex-analyst no confirmed caller; executor→rescue freetext handoff;
  missing $schema pointer. [P3] redaction block duplicated 6×.

### yellow-mempalace — OPTIMIZE (deferred)
- [P2] status/navigate/search run redundant ToolSearch; mine.md placeholder
  substitution fragile; navigate-vs-agent boundary unspecified.

### yellow-morph — OPTIMIZE (deferred)
- [P2] Routing rules triplicated (2 yellow-core skills + own CLAUDE.md).
- [P3] status HEALTHY-probe-skipped masks invalid keys.

### yellow-review — KEEP AS-IS
- [P2] review-all Step 4 mirrors review-pr Steps 3a–9b (acknowledged DRY
  debt); Step 4.12 ambiguous about --non-interactive.
- [P2] 5 conditional personas unlabeled (Batch C).
- [P3] pr-review-workflow SKILL.md stub.

### yellow-research — KEEP AS-IS
- [P2] CLAUDE.md exa off-by-default claim vs start-exa.sh enabling all 7.
- [P3] workflows: namespace squat documented one-sided.

### yellow-council — KEEP AS-IS
- [P2] council.md Steps 4–6 associative-array lifetime across subprocess
  boundary (Batch B). [P2] Dead docs/spikes/* references.

### yellow-semgrep — KEEP AS-IS (P3 polish only)

### yellow-composio — KEEP AS-IS
- [P3] README says `type: http`; transport is stdio since v1.3.0.

## Remediation batches

- **A (approved):** Linear tool-name migration — yellow-linear, yellow-debt,
  yellow-ci (yellow-chatprd resolved by removal).
- **B (approved):** debt-fixer stub + ref; browser-test template/SERVER_PID/
  explore; yellow-ci executable validation snippets; docs adversarial gate;
  council array lifetime; ruvector setup description + Write tool.
- **C (approved):** gt-workflow ×5 triggers; devin orchestrator/delegate/wiki;
  docs:review description; yellow-review conditional-persona labels.
- **D (not approved):** dedup/consolidation items — morph routing rules,
  yellow-core orphans, codex-analyst, devin command merge, linear:delegate
  dedup, codex redaction canonicalization, security-lens consolidation.
- **E (not approved):** doc-truth one-liners — yellow-core README/counts,
  research exa drift, composio transport line, codex $schema.
- **Removal (approved):** yellow-chatprd.
