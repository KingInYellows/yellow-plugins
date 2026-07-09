# Feature: Audit Remediation Stack (2026-07-09 Full-Marketplace Audit)

## Overview

Execute the remediation of the 2026-07-09 full-marketplace plugin audit as a
sequenced Graphite stack: one cross-cutting Codex CLI fix, four independent
broken-finding fixes, a validator hardening coupled with the sites it newly
flags, and a final doc-drift sweep — followed by two net-new routing-decision
docs. Sequencing and PR boundaries follow
`docs/brainstorms/2026-07-09-audit-resolution-brainstorm.md` (Approach C:
severity waves, PR-per-logical-fix-unit), corrected by research findings
documented inline below.

**Corrections to the brainstorm this plan encodes** (verified during
planning; the brainstorm text is NOT updated retroactively):

1. Wave 0 is a **yellow-codex-only code fix** (+ conditional yellow-council
   doc reword). yellow-review needs no change — `review-pr.md:363` is a
   dispatch-table row; the silent-empty symptom lives in codex-reviewer.md's
   own error handling.
2. Only `codex exec review` is confirmed broken. Plain `codex exec` sites
   (codex-executor.md, rescue.md) must be verified independently before
   touching — do not assume uniformity.
3. `create-agent-skills/SKILL.md` **stays in the Wave 4 sweep** — its three
   headings at lines 47/51/55 are inside the fenced template block opening at
   line 38, not real headings (verified directly; a naive grep is fooled, and
   RULE 15b shares this fenced-content blind spot).
4. Wave 4 is **not dependency-free**: `codex-patterns/SKILL.md` is a fix site
   in both Wave 0 and Wave 4. Wave 4 stacks strictly after Wave 0.
5. The ruvector fix uses **two different hardening patterns** (skip-npx vs
   timeout-wrap), assigned per-file by budget class — not one wrapper.
6. yellow-linear's false claim is restated **twice** in its CLAUDE.md
   (dependencies bullet AND commands-catalog line) — both are fix sites.

## Problem Statement

The audit found 5 broken (🔴) findings — most critically that every
`codex exec review` invocation in yellow-codex fails at argument parse on
codex-cli 0.140.0 and misreports the failure as "authentication failed",
silently emptying the Codex leg of `/review:pr` — plus ~20 quality findings
and 2 coherence gaps. Until Wave 0 lands, every PR reviewed by the pipeline
gets a silently degraded review.

## Proposed Solution

Five severity waves as a Graphite stack (Waves 0→2 sequential; Wave 1's four
PRs are independent siblings in the stack; Wave 3 deferred to follow-up PRs;
Wave 4 last). Every PR: `gt branch create agent/<type>/<slug>`, changeset(s),
`pnpm validate:schemas` + focused validator, `gt stack submit`. Never raw
`git push`/`gh pr create`. Hand-edit only for markdown — **never run Prettier
over `plugins/**.md`** (silently truncates frontmatter descriptions).

### Key design decisions (gap-analysis resolutions)

- **Flag fix default = `-c` config overrides, not drop** (gap #1/P0): on
  `codex exec review`, set posture via `-c 'approval_policy="never"'` and
  `-c 'sandbox_mode="read-only"'` (verified to parse, since `-a`/`-s` do not
  exist on that subcommand) rather than hoisting `-a`/`-s` to top-level
  position; on plain `codex exec`, `-s workspace-write` remains a valid
  top-level flag alongside `-c 'approval_policy="never"'`. "Drop the flags"
  is acceptable ONLY if task 0.1's empirical check proves the subcommand's
  default sandbox is read-only + non-interactive. Never trade broken-but-safe
  for working-but-less-sandboxed.
- **OAuth-stall mitigation joins Wave 0** (gap #5): append
  `-c 'mcp_servers={}'` to `codex exec review` invocations per
  `docs/solutions/.../codex-cli-review-flags-and-mcp-stall.md` — same root
  doc, same files, same PR.
- **Wave 2 adds BOTH checks** (gap #8): colon-hardening of the existing
  `subagent_type` pattern AND a new `Task(bareword):` shorthand check — the
  brainstorm's own red→green rationale applies to both. Both checks must be
  **fence-aware** (gap #7): strip fenced code blocks before matching.
- **mempalace README treatment** (gap #13): fix the count ("Eight"→"Nine")
  and add a one-line footnote under the MCP table noting yellow-mempalace
  bundles an MCP server and is deprecated pending removal (per
  `docs/memory-routing-protocol.md`) — no full table row, avoiding churn the
  removal PR would immediately delete.

## Implementation Plan

### Wave 0 — fix(yellow-codex): codex exec review invocation + error mapping

Branch: `agent/fix/codex-exec-review-flags` (off main, bottom of stack).

- [x] 0.1 Empirical verification (record all outputs in the PR description):
      `codex --version`; `codex exec review --help`; `codex exec --help`;
      top-level `codex --help` (confirm `-a`/`-s` and whether `--ephemeral`
      exists at top level); run `codex exec review` WITHOUT `-a`/`-s` against
      a scratch repo and observe whether it prompts or writes (sandbox
      default check); confirm `codex -a never -s read-only exec review
      --base main --json` parses AND completes end-to-end on a scratch repo.

<!-- deepen-plan: external -->
> **Research:** Flag-surface conflict to resolve during 0.1: GitHub issue
> #6432 ("Add codex exec review: headless code review") describes review
> presets as POSITIONAL args (`codex exec review uncommitted`, `codex exec
> review base-branch main`), while the live 0.140.0 `--help` captured during
> planning showed `--base`/`--uncommitted` flags. Record the installed
> version's `--help` verbatim in the PR and code to it. Also: `--ephemeral`
> is documented as an `exec`-level flag, NOT confirmed at top level — if
> hoisting flags, `--ephemeral` may need to stay after `exec`.
<!-- /deepen-plan -->

- [x] 0.2 Fix the two `codex exec review` invocation sites per 0.1's result
      (default: hoist flags to top-level; handle `--ephemeral` per 0.1):
      `plugins/yellow-codex/commands/codex/review.md:94-110`,
      `plugins/yellow-codex/agents/review/codex-reviewer.md:125-136`.
      Append `-c 'mcp_servers={}'` to both (OAuth-stall mitigation).

<!-- deepen-plan: external -->
> **Research:** Prefer `-c` config overrides as the PRIMARY fix over
> top-level flag hoisting: `-c 'approval_policy="never"'` and
> `-c 'sandbox_mode="read-only"'` use the same generic TOML-override
> mechanism already empirically proven to work on `codex exec review` (via
> `-c 'mcp_servers={}'`), whereas top-level `-a`/`-s` placement before
> `exec review` is documented-but-unverified for this exact subcommand
> path. Note: official docs state `codex exec` defaults to a READ-ONLY
> sandbox — if `exec review` inherits it, the sandbox override may be
> redundant (keep it anyway as an explicit invariant). The MCP-stall's
> primary mitigation is `-c 'mcp_servers={}'`; the `timeout` wrapper is the
> outer safety net (codex may fork MCP child processes that escape a
> process-group kill) — keep both, they are not either/or.
<!-- /deepen-plan -->

- [x] 0.3 Verify plain `codex exec` sites parse on the installed CLI
      (`plugins/yellow-codex/agents/workflow/codex-executor.md:81`,
      `plugins/yellow-codex/commands/codex/rescue.md:80,95`): if they work,
      leave untouched; if broken, apply the same hoist. Record the check.

<!-- deepen-plan: codebase -->
> **Codebase:** The repo's own memory doc
> (`codex-cli-review-flags-and-mcp-stall.md`, PR #601, tested on 0.140.0)
> states `-a`/`-s` "exist only on plain `codex exec`" — so
> `codex-executor.md:81` and `rescue.md:80,95` most likely already work
> as-is. This task's verify-then-leave framing is correct, not overcaution.
<!-- /deepen-plan -->

- [x] 0.4 Update all 3 example blocks in
      `plugins/yellow-codex/skills/codex-patterns/SKILL.md` (lines 18-27,
      36-42, 50-57) to the canonical fixed form — the skill is the source
      every other file copies; fix it first within the PR.
- [x] 0.5 Error-mapping fix: `review.md:113-124` and the SKILL.md exit-code
      table (lines 201-211) — exit 2 handler must check stderr for
      `unexpected argument` (parse error) before reporting "authentication
      failed"; update the table row wording accordingly.
- [x] 0.6 Conditional: re-read
      `plugins/yellow-council/skills/council-patterns/SKILL.md:317-319`
      against the shipped invocation — it names flags without asserting
      position, so edit ONLY if now-inaccurate (gap #15). yellow-council
      changeset only if edited.
- [x] 0.7 Version-floor check (gap #14): yellow-codex CLAUDE.md documents a
      CLI floor (≥0.118); verify the chosen syntax on that floor or bump the
      documented floor with rationale in the same PR.

<!-- deepen-plan: codebase -->
> **Codebase:** The floor is documented at
> `plugins/yellow-codex/CLAUDE.md:17` as `v0.118.0+`.
<!-- /deepen-plan -->

<!-- deepen-plan: external -->
> **Research:** No changelog entry pins when `codex exec review` was
> introduced, so the 0.118→0.140 span cannot be asserted as verified from
> primary sources. Treat 0.140.0 (the empirically tested version) as the
> verified floor — recommended resolution for this task is to BUMP the
> documented floor at CLAUDE.md:17 rather than attempt to verify back to
> 0.118. The subcommand is still present in current docs (~0.143), so
> forward stability holds.
<!-- /deepen-plan -->

- [x] 0.8 AMEND (not duplicate)
      `docs/solutions/**/codex-cli-review-flags-and-mcp-stall.md` with the
      verified fix + sandbox-default finding, via `/workflows:compound
      --in-pr` on the draft PR.
- [x] 0.9 Changeset: yellow-codex `patch` (+ yellow-council `patch` iff 0.6
      edited). Run `pnpm validate:schemas && pnpm validate:agents`. Commit
      via `gt`, submit.

### Wave 1 — four independent small PRs (stacked after Wave 0)

- [x] 1a `agent/fix/doc-auditor-write-deny` — fix(yellow-docs):
      add `disallowedTools: [Write, Edit, MultiEdit]` to
      `plugins/yellow-docs/agents/analysis/doc-auditor.md` (copy field format
      from `plugins/yellow-review/agents/review/comment-analyzer.md:1-15`).
      Because doc-auditor keeps `Bash` in `tools:` (unlike comment-analyzer),
      also adopt the "Documented Bash Exception" pattern from
      `codex-reviewer.md` — enumerate legitimate read-only Bash uses and an
      explicit no-write-via-Bash clause (gap #10; `disallowedTools` alone
      does not stop `bash -c "echo x > file"`). Changeset patch;
      `validate:agents`.
- [x] 1b `agent/docs/linear-delegate-dependency-truth` — docs(yellow-linear):
      fix BOTH restatements in `plugins/yellow-linear/CLAUDE.md` — the
      Cross-Plugin Dependencies bullet (lines 90-92) AND the commands-catalog
      line for `/linear:delegate` (gap #11) — to the env-var framing
      (`DEVIN_SERVICE_USER_TOKEN`/`DEVIN_ORG_ID` required; installing
      yellow-devin is one way to obtain them, not a hard plugin dependency),
      matching `delegate.md:36-38`'s actual behavior. Changeset patch.
- [x] 1c `agent/fix/browser-test-readme-link` — fix(yellow-browser-test):
      `plugins/yellow-browser-test/README.md:15` — replace
      `ArcadeLabsInc/agent-browser` (404) with `vercel-labs/agent-browser`
      (verified live). Changeset patch.
- [x] 1d `agent/fix/ruvector-hook-timeout-budgets` — fix(yellow-ruvector):
      two patterns, per-file by budget class:
      - `hooks/scripts/post-tool-use.sh:32-39` (1s budget): copy the
        **skip-npx** pattern verbatim from `pre-tool-use.sh:31-37` (require
        direct binary or `json_exit`; no fallback).
      - `hooks/scripts/session-start.sh:32-39` (3s budget, THREE sequential
        CLI calls): **timeout-wrap each call** with a designed budget split
        (e.g. 0.9s resume + 0.8s per recall, `--kill-after=0.1`, ~2.7s worst
        case < 3s), with the `timeout`/`gtimeout`/no-wrapper fallback chain
        from `user-prompt-submit.sh:45-70`. This is a design task, not a
        verbatim copy (gap #6).

<!-- deepen-plan: codebase -->
> **Codebase:** Line-cite correction: `session-start.sh:32-39` is only the
> RUVECTOR_CMD npx-fallback resolution (same block as post-tool-use.sh —
> also needs replacing). The THREE calls to timeout-wrap are at
> `session-start.sh:45` (`hooks session-start --resume`), `:50`
> (`hooks recall --top-k 3`), and `:54` (`hooks recall --top-k 2`) — the
> third call is a distinct skill-learnings recall the budget split must
> cover (three slices, not two). Also verified: no shared timeout-wrap
> helper exists in any plugin `lib/` — inlining is correct, there is
> nothing to source.
<!-- /deepen-plan -->

<!-- deepen-plan: external -->
> **Research:** Prefer a DYNAMIC remaining-budget split over fixed per-call
> slices: track elapsed time with bash's builtin `$SECONDS`, clamp each
> call's `timeout` duration to `TOTAL - SECONDS`, and skip remaining calls
> gracefully when the remainder drops below a minimum threshold. Mechanics:
> options precede the duration (`timeout -k 0.1 "$remaining" cmd`); never
> use `--foreground` in hooks (it stops timeout from killing forked
> descendants); exit 124 = soft SIGTERM timeout vs 137 = `--kill-after`
> escalation, distinguishable via `$?`. Portability:
> `TIMEOUT_CMD=$(command -v timeout || command -v gtimeout)` with the
> repo's own PR #544 fallback precedent when neither exists.
<!-- /deepen-plan -->

      - Tests: extend `tests/post-tool-use.bats` (npx-present/binary-absent
        case asserts silent skip) and create **new**
        `tests/session-start.bats` (none exists today) mocking a slow/hanging
        `ruvector` on PATH to prove each timeout fires and
        `{"continue": true}` is still emitted within budget.

<!-- deepen-plan: codebase -->
> **Codebase:** Copy the PATH-stub mocking idiom from the existing suites:
> `mktemp -d` MOCK_BIN with a stub `ruvector` script invoked via
> `PATH="$MOCK_BIN:$PATH"`, plus post-tool-use.bats'
> `run_hook_failing_ruvector` pattern for the fallback case. Note: NO bats
> file in the repo currently simulates a hanging binary (`sleep N` stub) —
> session-start.bats is net-new test infrastructure, not just a new file;
> call that out in the PR description.
<!-- /deepen-plan -->

      - Changeset patch. Recommend a solution doc (two-pattern budget
        nuance) via `--in-pr`.

### Wave 2 — feat(validators): subagent_type reference hardening + newly-red fixes

Branch: `agent/feat/subagent-ref-hardening` (one PR — red→green inside it).

- [x] 2.1 In `scripts/validate-agent-authoring.js`: broaden detection so
      colon-less `subagent_type:` values (invisible to
      `pluginSubagentPattern` at :369-370 today) are captured and **error**.
      Respect the RULE 13 lesson: any membership/allowlist logic must check
      plugin-directory ownership, not just pattern shape.
- [x] 2.2 Add a second check for the `Task(bareword):` shorthand (e.g.
      `/Task\(\s*[a-z0-9-]+\s*\)\s*:/`) → error directing authors to the
      canonical `Task(subagent_type="plugin:dir:name")` form
      (model: `plugins/yellow-core/commands/workflows/work.md:242`).
- [x] 2.3 Make BOTH checks fence-aware: strip fenced code blocks before
      matching (gap #7 — teaching docs show illustrative examples in fences;
      `validateSubagentReferences` at :641-671 currently scans raw content).
      Note in the PR that RULE 15b shares this blind spot; fixing 15b is
      optional same-PR or a named follow-up.

<!-- deepen-plan: codebase -->
> **Codebase:** Do not design fence-stripping from scratch — RULE 15b in
> the SAME file already does it at `scripts/validate-agent-authoring.js:921-923`:
> strip frontmatter (`/^---\r?\n[\s\S]*?\r?\n---\r?\n?/`) then fenced
> blocks (`/^[ \t]{0,3}\x60\x60\x60[^\n]*\r?\n[\s\S]*?^[ \t]{0,3}\x60\x60\x60[ \t]*\r?$/gm`).
> Copy that working, already-reviewed pattern; optionally factor both call
> sites into a shared `stripFencedContent(content)` in this PR (cheap,
> same file). Note the reuse in the PR description so reviewers see it is
> not novel logic.
<!-- /deepen-plan -->

- [x] 2.4 Fix `plugins/yellow-ci/commands/ci/setup-self-hosted.md:300-303`
      → `subagent_type: "yellow-ci:ci:runner-assignment"`.
- [x] 2.5 Fix all 6 yellow-browser-test sites to canonical explicit form:
      `commands/browser-test/setup.md:78` (app-discoverer),
      `test.md:150,158`, `explore.md:139,157`, `report.md:31`
      (test-runner / test-reporter) →
      `yellow-browser-test:testing:{app-discoverer,test-runner,test-reporter}`.
- [x] 2.6 Repo-wide grep for any other newly-red site before submitting; the
      validator must pass green on the full tree in this PR.
- [x] 2.7 Tests: new `tests/integration/validate-agent-authoring-subagent-refs.test.ts`
      following the RULE 16 shape
      (`validate-agent-authoring-memory-protocol-rule.test.ts`, harness
      `writeAgent`/`runValidator`): green case, colon-less red case, bareword
      shorthand red case, fenced-example false-positive case (must pass),
      red-then-fixed case.
- [x] 2.8 PR description: call out the innocent-bystander effect (gap #12) —
      open PRs rebasing onto this will red if they carry the old patterns.
- [ ] 2.9 Changesets: yellow-ci patch + yellow-browser-test patch (the
      validator itself is root `scripts/`, no changeset). Solution doc: yes
      (new rule; RULE 13/16 precedent), via `--in-pr`. CI baseline gate.

### Wave 3 — decision-gated follow-ups (NOT in this stack; recorded defaults)

No tasks here — these ship as their own PRs when the maintainer decides.
Recorded defaults from the brainstorm:

- security-lens pairing: retire `yellow-core/agents/review/security-lens.md`
  in favor of the yellow-docs copy (resolves orphan + duplicate in one
  action); add a cross-ref if kept instead.
- `test-coverage-analyst` / `git-history-analyzer`: wire only if a concrete
  dispatcher is identified in that PR's research; otherwise retire.
- CLI-readiness reviewer pair: retarget dispatch triggers to real CLI source
  paths (default) rather than rewriting methodology.
- mempalace removal: already tracked via `docs/memory-routing-protocol.md`
  follow-ups; nothing bundled here (its own doc-drift explicitly cut).
- agent-browser 0.10.0→0.31.x bump: separate follow-up requiring CLI-surface
  re-verification; out of this stack.

### Wave 4 — docs: audit doc-drift sweep (stacks LAST — after Wave 0)

Branch: `agent/docs/audit-doc-drift-sweep`. Depends on Wave 0 (same-file:
`codex-patterns/SKILL.md`).

- [ ] 4.1 Re-derive the SKILL.md heading roster at execution time via grep
      over `plugins/*/skills/*/SKILL.md` (do NOT trust this list blindly).
      Current verified roster (8): yellow-ci `ci-conventions` +
      `diagnose-ci`, yellow-codex `codex-patterns`, yellow-composio
      `composio-patterns`, yellow-docs `docs-conventions`, yellow-research
      `research-patterns`, yellow-semgrep `semgrep-conventions`, yellow-core
      `create-agent-skills` (headings exist only inside its fenced template —
      add real ones). Add the missing `## What It Does` / `## When to Use` /
      `## Usage` headings to each, restructuring minimally (hand-edit only).
- [ ] 4.2 Root `README.md:45`: "Eight plugins" → "Nine plugins"; add the
      one-line mempalace footnote under the MCP table (decision above).
- [ ] 4.3 Root `README.md:127`: "five MCP servers" → "six"; add Ceramic to
      the prose list at lines 131-148.
- [ ] 4.4 `.claude-plugin/marketplace.json` yellow-research `description`:
      add Ceramic, mirroring `plugins/yellow-research/.claude-plugin/plugin.json:5`
      (README table rows already correct — marketplace.json is the only
      Ceramic gap).
- [ ] 4.5 Verify every prose count touched against a fresh `ls | wc -l` /
      `jq` count — never carry a count forward from the previous file
      version.
- [ ] 4.6 Changeset: one multi-plugin file (patch × ~7 plugins), precedent
      `.changeset/c7-memory-protocol-drift-lint.md`. yellow-codex appearing
      in both Wave 0 and Wave 4 changesets composes fine at
      `changeset version`. No solution doc — covered by
      `multi-doc-schema-rename-drift.md`; note the skip in PR Notes.

<!-- deepen-plan: codebase -->
> **Codebase:** The cited changeset precedent file
> `.changeset/c7-memory-protocol-drift-lint.md` no longer exists on disk —
> it was consumed by the version-packages bot PR (#610) after PR #606
> merged. View it via
> `git show 0058aa3b:.changeset/c7-memory-protocol-drift-lint.md` (or the
> merged PR #606 diff) when authoring Wave 4's multi-plugin changeset.
<!-- /deepen-plan -->

### Post-stack — two routing-decision docs (separate PRs, after Wave 4)

- [ ] 5.1 `docs/review-surface-routing-protocol.md` — model on
      `docs/memory-routing-protocol.md`'s 5-section skeleton (framing with
      "maintainer decision, deliberately NOT decided by the implementer" →
      Decision → trigger-routing table → domain model → Follow-ups).
      Enumerate **seven** entry points (gap #16): smart-submit audit,
      `/review:pr`, `/council`, `/codex:review`, `/devin:review-prs`,
      `/workflows:review`, `/docs:review`. Draft the table structure; leave
      routing decisions to the maintainer.
- [ ] 5.2 `docs/research-connector-overlap.md` — bundled Tavily/EXA vs
      claude.ai native connectors; structural model:
      `plugins/yellow-composio/commands/composio/setup.md:59-73`
      (three-prefix priority list). Cross-link from yellow-research README.

## Technical Details

Files to modify (by wave): W0 — 5 yellow-codex files (+1 conditional
yellow-council), 1 solutions doc; W1 — doc-auditor.md, yellow-linear
CLAUDE.md (×2 sites), browser-test README.md, 2 ruvector hook scripts + 2
bats files (1 new); W2 — validate-agent-authoring.js, 1 new integration test
file, setup-self-hosted.md, 4 browser-test command files; W4 — 8 SKILL.md
files, root README.md, marketplace.json. New files: `tests/session-start.bats`
(yellow-ruvector), `tests/integration/validate-agent-authoring-subagent-refs.test.ts`,
2 post-stack docs.

## Testing Strategy

- W0: empirical CLI runs recorded in the PR (task 0.1/0.3) — this is the
  verification, since command markdown has no unit-test surface.
- W1d: bats — new session-start.bats + extended post-tool-use.bats prove
  budget compliance with mocked slow binaries.
- W2: vitest integration tests (RULE 16 shape); full-tree validator run must
  be green in-PR (red→green proof).
- All waves: `pnpm validate:schemas` + focused validator + CI baseline gate
  (`validate:schemas && test:unit && lint && typecheck`); LF check on any new
  `.sh` files (`sed -i 's/\r$//'`).

## Acceptance Criteria

1. `codex exec review` invocations in yellow-codex parse AND complete
   end-to-end on codex-cli 0.140.0, with sandbox posture no weaker than
   before (verified per task 0.1, evidence in PR description).
2. Exit-2 parse errors are no longer reported as authentication failures.
3. All five hook scripts in yellow-ruvector provably complete within their
   declared hooks.json budgets on the npx-fallback path (bats-verified).
4. doc-auditor cannot write via tools OR Bash (frontmatter + documented
   exception pattern both present).
5. `pnpm validate:agents` errors on colon-less `subagent_type` values and
   `Task(bareword):` shorthand anywhere under `plugins/`, EXCEPT inside
   fenced code blocks; full tree green in the same PR.
6. No prose count in touched docs disagrees with a mechanical count; Ceramic
   appears in the marketplace.json description; README MCP count says nine
   with the mempalace footnote.
7. Every PR touching `plugins/` carries its changeset(s); `validate:versions`
   stays green through the whole stack.

## Edge Cases

- codex CLI version differs on another machine → task 0.7 pins/bumps the
  documented floor; invocation sites keep the `timeout` wrapper as a backstop.
- `timeout`/`gtimeout` absent on a host → session-start.sh falls back to
  unwrapped calls (documented risk, same as user-prompt-submit.sh today).
- Open PRs red after Wave 2 lands → called out in the PR description; fix is
  a rebase + mechanical reference update.
- Wave 4 grep roster drift (a skill added/fixed between planning and
  execution) → task 4.1 re-derives the list; count attached to PR description.

## References

- `docs/brainstorms/2026-07-09-audit-resolution-brainstorm.md` (sequencing
  rationale; Open Questions with defaults)
- `docs/solutions/**/codex-cli-review-flags-and-mcp-stall.md` (W0 amend
  target)
- `docs/solutions/code-quality/subagent-frontmatter-field-catalog.md`
  (memory: auto-grant behavior), `multi-doc-schema-rename-drift.md`,
  `frontmatter-sweep-and-canonical-skill-drift.md`,
  `prettier-description-wrap-silent-truncation.md`
- `docs/memory-routing-protocol.md` (template for post-stack docs)
- `tests/integration/validate-agent-authoring-memory-protocol-rule.test.ts`
  (W2 test shape) + `tests/integration/helpers/validator-harness.ts`
- `docs/maintenance/plugin-audit-2026-06-10.md` (prior audit-stack precedent)
