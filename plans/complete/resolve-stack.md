# Feature: `/review:resolve-stack` — Autonomous Stack-Wide Comment Resolution

## Problem Statement

A reviewer leaves comments across a multi-PR Graphite stack. Today the author
must `gt checkout` each branch and run `/review:resolve` by hand, PR by PR,
answering the per-PR confirmation gates each time. For a 5-PR stack that is 5
manual checkouts and 10+ interactive prompts.

`/review:resolve-stack` walks the current Graphite stack bottom-up and runs the
comment-resolution flow on every open PR **unattended** — no gates, pushing and
restacking as it goes — so the author runs one command and comes back to a
fully-resolved, fully-submitted stack plus a summary of anything that needs
human attention.

Beneficiaries: yellow-plugins contributors (and any `yellow-review` user) who
work in Graphite stacks and accumulate review comments across them.

## Current State

`plugins/yellow-review/` ships three relevant commands:

- **`/review:resolve`** (`commands/review/resolve-pr.md`, frontmatter
  `name: review:resolve`) — 9-step single-PR resolver. Fetches comments, applies
  a 7-pattern actionability filter, clusters by file+region, dispatches parallel
  `pr-comment-resolver` agents, commits, submits. Contains two mandatory
  `AskUserQuestion` gates: Step 4 (M3 spawn-cap, before dispatch) and Step 6
  (push-confirmation, before `gt modify` + `gt submit`).
- **`/review:all`** (`commands/review/review-all.md`, `name: review:all`) —
  walks a Graphite stack bottom-up running the full review pipeline per PR. The
  stack-traversal logic lives in Steps 1–3 + Step 4 sub-steps 1 & 13. It
  carries a mirror-comment (lines ~75–79) flagging the duplicated review-pr
  pipeline as copy-sync debt.
- **`/review:sweep`** (`commands/review/sweep.md`, `name: review:sweep`) —
  composes `review:pr` then `review:resolve` via the `Skill` tool, with an
  `AskUserQuestion` failure-boundary gate between them because the `Skill` tool
  returns no machine-readable exit status.

There is no stack-wide resolve command. The Graphite stack-walk in
`review-all.md` is the only implementation of that traversal and is not shared.
The plugin has one skill, `pr-review-workflow` (`user-invokable: false`), used
as a shared reference/convention document — not executed via the `Skill` tool.

## Proposed Solution

Add `/review:resolve-stack` plus a shared `stack-traversal` reference skill, and
add a `--non-interactive` mode to `/review:resolve`.

**Autonomy model (owner decision).** `resolve-stack` runs the entire stack
without pausing. It invokes `/review:resolve` per PR via the `Skill` tool in a
new `--non-interactive` mode that suppresses both of `resolve-pr`'s internal
`AskUserQuestion` gates and auto-runs `gt submit`. Errors are logged and the
walk continues; everything needing human attention is collected into a final
summary. This deliberately diverges from the per-PR human-in-the-loop push gate
that `resolve-pr` keeps for interactive use and from MEMORY.md's
"confirm before pushing LLM-generated code" guidance — see **Risks**. The
divergence is scoped: `resolve-pr`'s default (no flag) remains fully gated.

**Key design decisions:**

1. **Two sibling commands, not a mode flag** (from brainstorm). New file
   `commands/review/resolve-stack.md`, `name: review:resolve-stack`.
2. **`stack-traversal` skill is a shared reference document**, not executed via
   the `Skill` tool — same pattern as `pr-review-workflow`. Both `review-all`
   and `resolve-stack` inline the traversal steps and cite the skill as the
   canonical source of truth via mirror-comments. (Resolves brainstorm open
   question A.)
3. **`resolve-stack` invokes `resolve-pr` via the `Skill` tool** in
   `--non-interactive` mode — no prose duplication of the resolve pipeline.
   (Resolves brainstorm open question B, honoring the chosen approach.)

<!-- deepen-plan: codebase -->
> **Codebase:** Confirmed — the `Skill` tool `args:` mechanism works exactly as
> the plan assumes. `sweep.md` lines 93 & 131 invoke `skill: "review:resolve"`
> with `args: "<PR#>"`, and that string becomes `$ARGUMENTS` in the callee. So
> `args: "<PR#> --non-interactive"` is structurally valid. **Critical naming
> rule** (`sweep.md` line 131): the skill name must be `review:resolve` (the
> `name:` frontmatter value), NOT the filename `resolve-pr` — using the filename
> silently fails. Skill-in-a-loop is also an established pattern:
> `plugins/yellow-core/commands/setup/all.md` lines 744–797 iterate N plugins
> invoking each via `Skill` sequentially with log-and-continue error handling —
> the exact structural pattern Phase 3.4 needs.
<!-- /deepen-plan -->

4. **`resolve-pr` gets a `--non-interactive` flag.** When present: skip the
   Step 4 M3 `AskUserQuestion` (replaced by a hard cluster cap — see
   Edge Cases), skip the Step 6 push `AskUserQuestion` (auto `gt modify` +
   `gt submit --no-interactive`). Backward-compatible: absent flag = today's
   behavior.

<!-- deepen-plan: codebase -->
> **Codebase:** Confirmed — `resolve-pr.md` Step 4 (line 162) is the M3
> `AskUserQuestion` spawn-cap gate, Step 5 (line 217) surfaces `CONFLICT:`
> sentinels via `AskUserQuestion`, Step 6 (line 229) is the push-confirmation
> `AskUserQuestion`. The plan's "suppress in non-interactive mode" scoping
> matches the actual step boundaries. **No `--non-interactive` flag precedent
> exists anywhere in the plugin corpus** — the closest analog is
> `plugins/yellow-linear/commands/linear/sync.md` (`--after-submit`, line 120),
> a boolean presence-check flag parsed from `$ARGUMENTS`. This is a novel
> pattern; follow `sync.md`'s presence-check approach.
<!-- /deepen-plan -->

5. **No exit status from `Skill` → `resolve-stack` self-verifies.** After each
   PR's resolve invocation, `resolve-stack` re-runs `get-pr-comments` to count
   remaining unresolved threads. That count is the per-PR status — it does not
   depend on `resolve-pr`'s (unavailable) exit code.
6. **Error policy: log-and-continue, never prompt.** Restack conflict → log,
   abort that PR's restack, continue. `gt submit` failure → log, continue.
   Residual unresolved comments after a PR's pass → recorded in the summary.
   The brainstorm's "abort + AskUserQuestion on restack conflict" is replaced
   by log-and-continue to honor the unattended requirement.
7. **Cascade detection deferred to v2** (from brainstorm). v1 relies on
   `pr-comment-resolver`'s ±20-line anchor search and "context not found" skip.

## Current State → Target State (data flow)

```
resolve-stack:
  pre-flight (gt, gh auth, graphite repo, clean tree)
    → [stack-traversal] gt log short → open-PR filter → base-to-tip order → gt track adoption
    → for each PR bottom-up:
        gt checkout <branch>
        Skill(review:resolve, "<PR#> --non-interactive")   # resolves, commits, gt submit
        get-pr-comments <repo> <PR#>  → remaining unresolved count   # self-verify
        [stack-traversal] gt upstack restack (log + skip on conflict)
        record row for summary
    → final aggregate summary + "needs manual attention" section
```

## Implementation Plan

### Phase 1: Shared `stack-traversal` skill

- [ ] **1.1** Create `plugins/yellow-review/skills/stack-traversal/SKILL.md`.
  Frontmatter: `name: stack-traversal`, single-line double-quoted
  `description:` with a "Use when..." clause, `user-invokable: false`. Three
  mandatory headings (`## What It Does`, `## When to Use`, `## Usage`);
  `###` subsections inside `## Usage`.
- [ ] **1.2** Document the canonical traversal in the skill, lifting the prose
  from `review-all.md` Steps 1–3 + Step 4 sub-steps 1 & 13: `gt log short
  --no-interactive` parsing (strip graph chars), `gh pr view <branch> --json
  number,state` open-PR filter, base-to-tip ordering, `gt track` adoption with
  degraded-mode fallback, `git status --porcelain` clean check, `gt checkout
  <branch>` per PR, `gt upstack restack` after each PR's action with
  conflict handling, and the "no PRs found" exit. Explicitly mark which parts
  are traversal (shared) vs. per-command action (not shared).
- [ ] **1.3** Update `review-all.md` to cite the skill as the source of truth
  for the traversal steps — add a mirror-comment referencing
  `skills/stack-traversal/SKILL.md` section headers. **Keep `review-all.md`'s
  behavior byte-for-byte equivalent** — this is a documentation/reference
  change, not a logic change (see Risks). Preserve the existing review-pr
  pipeline mirror-comment untouched.

<!-- deepen-plan: codebase -->
> **Codebase:** Confirmed — the extraction is clean. `review-all.md` traversal
> lives in Step 1 (lines 27–56), Step 2 (58–62), Step 3 (64–72), Step 4.1
> (line 89), Step 4.13 (242–248). The only state shared between traversal and
> the review pipeline is the ordered list of PR branches+numbers — no deep
> entanglement. `review-all.md` already references the `pr-review-workflow`
> skill via **prose citation only** (line 291: "See pr-review-workflow skill
> for..."), never via the `Skill` tool — the same prose-citation pattern this
> plan uses for `stack-traversal`. Note: Step 1 also handles `scope=all` and
> `scope=PR#`, which are `review-all`-specific and must NOT move into the
> shared skill. The existing mirror-comment at lines 75–79 is for the
> `review-pr` pipeline — leave it untouched.
<!-- /deepen-plan -->


### Phase 2: `resolve-pr` non-interactive mode

- [ ] **2.1** Add `--non-interactive` to `resolve-pr.md`'s `argument-hint` and
  Step 1 argument parsing (`$ARGUMENTS` may now be `<PR#>` or
  `<PR#> --non-interactive`; validate the flag token explicitly).

<!-- deepen-plan: codebase -->
> **Codebase:** `resolve-pr.md` Step 1 (lines 30–34) currently does only
> "validate numeric, use as PR number" — it will **reject `"123
> --non-interactive"` outright** as non-numeric. The rewrite must split
> `$ARGUMENTS` on whitespace, validate the first token numeric, and validate
> the second token (if present) is exactly `--non-interactive`. Preserve the
> existing empty-`$ARGUMENTS` branch-detection path (line 32) for interactive
> use — `resolve-stack` always passes a non-empty arg string, so that path is
> simply bypassed when called from the stack walk.
<!-- /deepen-plan -->

- [ ] **2.2** Step 4: when `--non-interactive`, skip the M3 `AskUserQuestion`
  and instead apply a hard cluster cap — if cluster count exceeds the cap
  (default 20), dispatch the first 20 and record the rest as
  `skipped (cluster cap)` for the caller's summary. Document the cap.
- [ ] **2.3** Step 6: when `--non-interactive`, skip the push `AskUserQuestion`
  and run `gt modify -m "fix: resolve PR #<PR#> review comments"` +
  `gt submit --no-interactive` directly.

<!-- deepen-plan: codebase -->
> **Codebase:** `resolve-pr.md` Step 7 (lines 244–259, mark threads resolved)
> is currently guarded on "the user approved the push in Step 6 AND `gt submit`
> exited 0". With the Step 6 `AskUserQuestion` removed in non-interactive mode,
> the user-approval half of that guard is gone — Phase 2.3 (or a new 2.6) must
> explicitly rewrite Step 7's guard to "only if `gt submit` exited 0" for the
> non-interactive path. Step 8 (verification loop, lines 266–282) has no gates
> and needs no change.
<!-- /deepen-plan -->

- [ ] **2.4** Confirm no other step branches on interactivity; the CONFLICT
  sentinel surfacing in Step 5 stays (logged, not prompted, in non-interactive
  mode — see 2.5).
- [ ] **2.5** Step 5: when `--non-interactive`, a `CONFLICT:` sentinel from a
  resolver is logged to the report (not surfaced via `AskUserQuestion`); the
  conflicting cluster's threads are left unresolved for the summary.

### Phase 3: `resolve-stack` command

- [ ] **3.1** Create `plugins/yellow-review/commands/review/resolve-stack.md`.
  Frontmatter: `name: review:resolve-stack`, `argument-hint: ''` (always the
  current stack — no scope argument), single-line double-quoted `description:`
  with a "Use when..." clause. `allowed-tools`: `Bash, Read, Grep, Glob, Edit,
  Write, Task, TaskList, TaskOutput, Skill, ToolSearch,
  mcp__plugin_yellow-ruvector_ruvector__hooks_recall,
  mcp__plugin_yellow-ruvector_ruvector__hooks_capabilities`. (`AskUserQuestion`
  is intentionally **not** listed — the command is gateless.)

<!-- deepen-plan: codebase -->
> **Codebase:** `resolve-stack` does not directly spawn agents — `resolve-pr`
> (the callee) does. `Task`/`TaskList`/`TaskOutput` are therefore only needed
> by the callee, not the caller; they can be dropped from `resolve-stack`'s
> `allowed-tools` (unused entries are harmless but misleading). Same for
> `Edit`/`Write` — `resolve-stack` delegates all file editing to `resolve-pr`.
> A minimal correct list is `Bash, Read, Grep, Glob, Skill, ToolSearch` + the
> two ruvector MCP tools. Compare: `sweep.md` (also a pure delegator) declares
> only `Bash, Skill, AskUserQuestion`. Keep the list minimal or add a one-line
> comment explaining any retained-but-unused entry.
<!-- /deepen-plan -->

- [ ] **3.2** Step 1 — Pre-flight, fail fast with clear messages:
  `command -v gt`, `command -v gh` + `gh auth status`, confirm a Graphite stack
  exists (`gt log short --no-interactive` returns >0 branches), `git status
  --porcelain` clean check. As executable steps, not prose.
- [ ] **3.3** Step 2 — Build the PR list using the `stack-traversal` skill's
  documented procedure (inline the steps, cite the skill). Open-PR filter,
  base-to-tip order, `gt track` adoption. Skip branches with no associated open
  PR (log one line each). Skip draft PRs (log one line each).
- [ ] **3.4** Step 3 — Walk loop, per PR bottom-up: `gt checkout <branch>` →
  `Skill(skill: "review:resolve", args: "<PR#> --non-interactive")` → re-run
  `${CLAUDE_PLUGIN_ROOT}/skills/pr-review-workflow/scripts/get-pr-comments
  "<owner/repo>" "<PR#>"` to count remaining unresolved threads → `gt upstack
  restack` (log + skip on conflict) → append a summary row. No pauses anywhere.

<!-- deepen-plan: codebase -->
> **Codebase:** `get-pr-comments` (path confirmed, signature `get-pr-comments
> <owner/repo> <pr-number>`) emits a **JSON array** on stdout — each element is
> a thread `{threadId, path, line, startLine, comments[]}`, and the script
> already filters to `isResolved == false AND isOutdated == false`. So the
> self-verify count is just `get-pr-comments ... | jq 'length'`: `0` = fully
> resolved, `>0` = residual. Make this explicit in 3.5's "remaining unresolved"
> column — `0` → "complete", `>0` → flag into "Needs manual attention".
<!-- /deepen-plan -->

- [ ] **3.5** Step 4 — Final aggregate summary: a table of `PR# | comments
  found | clusters resolved | remaining unresolved | push status | restack
  status`, totals, and a **"Needs manual attention"** section listing PRs with
  residual unresolved comments, restack conflicts, `gt submit` failures, or
  cluster-cap skips.
- [ ] **3.6** Optional ruvector recall at the top of Step 1 (best-effort,
  guarded, mirrors `resolve-pr.md` Step 3b) — skip silently if `.ruvector/`
  absent or MCP warmup fails.

### Phase 4: Docs, validation, submit

- [ ] **4.1** Update `plugins/yellow-review/CLAUDE.md`: bump "Commands (5)" →
  "(6)" and add the `/review:resolve-stack` entry; bump "Skills (1)" → "(2)"
  and add the `stack-traversal` entry; add a "When to Use What" bullet
  distinguishing `resolve-stack` (resolve-only, whole stack, autonomous) from
  `review:all` (review+resolve per PR) and `review:resolve` (single PR,
  interactive).
- [ ] **4.2** Update `plugins/yellow-review/README.md`: add a Commands-table
  row for `/review:resolve-stack` and a Skills row for `stack-traversal`.
- [ ] **4.3** Normalize line endings on every new/modified file:
  `sed -i 's/\r$//' <file>` (WSL2 CRLF gotcha).
- [ ] **4.4** Run the validation gate:
  `pnpm validate:agents && pnpm validate:plugins && pnpm validate:schemas &&
  pnpm validate:versions && pnpm lint:plugins`, then the CI baseline
  `pnpm lint && pnpm typecheck && pnpm test:unit`. From inside
  `plugins/yellow-review/`, run `bats tests/` to confirm no script regressions.
- [ ] **4.5** `pnpm changeset` — select `yellow-review`, **`minor`** bump (new
  command + new skill = additive). Body in conventional-commit style:
  `feat(yellow-review): resolve-stack command + stack-traversal skill`.
- [ ] **4.6** `gt branch create feat/review-resolve-stack` (or work in the
  existing `feat+resolve-stack` worktree branch), `gt commit create`, `gt stack
  submit`.

## Technical Details

### Files to create

- `plugins/yellow-review/skills/stack-traversal/SKILL.md` — shared traversal
  reference (`user-invokable: false`).
- `plugins/yellow-review/commands/review/resolve-stack.md` — the command.

### Files to modify

- `plugins/yellow-review/commands/review/resolve-pr.md` — add `--non-interactive`
  mode (Steps 1, 4, 5, 6 + `argument-hint`).
- `plugins/yellow-review/commands/review/review-all.md` — cite the new skill via
  a mirror-comment; **no logic change**.
- `plugins/yellow-review/CLAUDE.md`, `plugins/yellow-review/README.md` — catalog
  updates.

### No changes needed

- `plugins/yellow-review/.claude-plugin/plugin.json` — commands and skills are
  auto-discovered; only the `version` bump (via changeset / `sync-manifests.js`).
- `.claude-plugin/marketplace.json` — version bump only, via `sync-manifests.js`.
- `plugins/yellow-review/agents/workflow/pr-comment-resolver.md` — reused as-is.
- `plugins/yellow-review/skills/pr-review-workflow/scripts/*` — reused as-is.

### Authoring constraints (CI gates)

- `allowed-tools:` (commands) not `tools:`; `description:` single-line,
  double-quoted, with a "Use when..." clause.
- `ToolSearch` must be in `allowed-tools` because ruvector MCP tools are
  deferred; MCP tools named `mcp__plugin_yellow-ruvector_ruvector__<tool>`.
- `$ARGUMENTS` placeholder, never hardcoded values.
- No `BASH_SOURCE` — use `${CLAUDE_PLUGIN_ROOT}` for plugin-local script paths.
- `subagent_type` strings (none introduced here, but `resolve-pr` uses
  `yellow-review:workflow:pr-comment-resolver`) must be 3-segment and literal.
- SKILL.md: `user-invokable: false`, three mandatory headings, `###`
  subsections inside `## Usage`.
- All files LF line endings.
- Graphite (`gt`) for all branch/commit/submit; never raw `git push` /
  `gh pr create`.

## Acceptance Criteria

1. Running `/review:resolve-stack` in a Graphite stack of N open PRs walks all N
   in base-to-tip order with **zero `AskUserQuestion` prompts**.
2. Each PR with unresolved comments has them resolved, committed, and submitted
   via `gt` before the walk moves up.
3. Each PR with no unresolved comments is a silent no-op (one log line, no
   resolver dispatch, no `gt submit`).
4. A second run on the same stack produces no state changes (idempotent).
5. If a PR's restack or `gt submit` fails, the walk continues; the failure
   appears in the final summary's "Needs manual attention" section.
6. The final summary distinguishes "completed all N PRs", per-PR residual
   unresolved counts, and infrastructure failures.
7. `/review:resolve <PR#>` with no flag behaves exactly as before (gates intact);
   `/review:resolve <PR#> --non-interactive` suppresses both gates and
   auto-submits.
8. `review-all` behaves identically to pre-change (verified by diffing its
   resolved behavior, not just its text).
9. `pnpm validate:schemas && pnpm validate:versions && pnpm lint && pnpm
   typecheck && pnpm test:unit` all pass; `bats tests/` in `yellow-review`
   passes.
10. A `.changeset/*.md` with a `minor` bump for `yellow-review` is committed.

## Edge Cases

- **Empty stack / not in a Graphite stack** → pre-flight (3.2) reports "No open
  PRs found in current Graphite stack." and exits 0.
- **Single-PR stack** → loop runs once; valid.
- **`gt` / `gh` not installed, `gh` not authed** → pre-flight fails fast with a
  named error before any walk begins.
- **Dirty working tree at start** → pre-flight `git status --porcelain` check
  stops the command before the walk.
- **Push-declined mid-walk** → not possible; `--non-interactive` mode
  auto-submits, there is no decline path.
- **`gt checkout` fails mid-walk** → log `[resolve-stack] checkout failed for
  <branch>; skipping`, record the PR as skipped, continue to the next PR.
- **PR merged/closed between stack-build and walk** → `resolve-pr` Step 1
  detects non-open and reports; `resolve-stack` records it skipped, continues.
- **Draft PR in the stack** → skipped with a log line (3.3).
- **Branch in `gt log short` with no associated open PR** → filtered out in
  3.3 with a log line.
- **Restack conflict after a PR's resolve** → `gt upstack restack` aborts for
  that PR; logged; walk continues. Downstream PRs may rest on an unrestacked
  base — surfaced in the summary so the user restacks manually.
- **More than 20 clusters on one PR** → `--non-interactive` hard cap dispatches
  20, records the remainder as `skipped (cluster cap)` in the summary
  (replaces the M3 prompt's safety role).
- **`CONFLICT:` sentinel from a resolver** → logged to that PR's report, the
  cluster's threads left unresolved, surfaced in the summary.
- **ruvector MCP unavailable** → recall is best-effort and skipped silently.
- **Partial-walk interruption (process killed)** → re-run is safe: already
  resolved+pushed PRs are silent no-ops; the interrupted PR re-resolves.

## Testing Strategy

- **Static**: the full validation gate in 4.4 — `validate:agents` catches
  frontmatter / `BASH_SOURCE` / `subagent_type` issues, `validate:plugins`
  catches manifest issues, `lint:plugins` catches convention drift.
- **`bats tests/`** in `yellow-review` — confirms `get-pr-comments` /
  `resolve-pr-thread` script behavior is unaffected.
- **Manual e2e** (document as a checklist in the PR description, since the
  command's effect is on live PRs and not unit-testable here):
  1. 2-PR stack, both with actionable comments → both resolved, both submitted,
     summary shows 2/2, zero prompts.
  2. 3-PR stack, middle PR has no comments → middle PR silent no-op.
  3. Re-run case 1 immediately → all no-ops, idempotent.
  4. Induce a restack conflict on PR 2 of 3 → walk completes, summary flags PR 2.
  5. `/review:resolve <PR#>` with no flag → both gates still fire (regression
     check on the default path).
  6. `review-all` on a stack → behaves as before (regression check on the
     extraction).

## Risks

- **Autonomous push diverges from project policy.** MEMORY.md records
  "commands that push LLM-generated code must `AskUserQuestion` before `gt
  submit`". `resolve-stack` intentionally does not — per the explicit owner
  decision that it run unattended. Mitigations: the divergence is opt-in (the
  user runs `resolve-stack` knowing it is autonomous); `resolve-pr`'s default
  path keeps both gates; the final summary makes every push and every failure
  visible; the cluster cap preserves the M3 gate's safety intent. Document the
  divergence in the command's `## What It Does` and in `CLAUDE.md`.
- **`review-all` regression from the extraction.** Phase 1.3 must be a pure
  reference/documentation change. De-risk: do not edit `review-all`'s executable
  steps at all in this PR — only add a citing mirror-comment. The behavioral
  regression check is acceptance criterion 8 + manual test 6.
- **`resolve-pr` regression from the new flag.** De-risk: the flag is purely
  additive; absent-flag path is untouched. Acceptance criterion 7 + manual
  test 5 guard it.
- **No machine-readable status from the `Skill` tool.** Mitigated by
  self-verification (3.4 re-runs `get-pr-comments`) — `resolve-stack` never
  depends on `resolve-pr`'s exit code.

## References

- `docs/brainstorms/2026-05-13-resolve-stack-brainstorm.md` — source brainstorm
  (note: open questions A and B resolved here; decisions 2 and 6 amended for the
  autonomous model).
- `plugins/yellow-review/commands/review/review-all.md` — traversal source,
  Steps 1–3 + Step 4.1/4.13; existing mirror-comment precedent (~lines 75–79).
- `plugins/yellow-review/commands/review/resolve-pr.md` — per-PR resolve
  pipeline; Steps 4 & 6 gates to make conditional.
- `plugins/yellow-review/commands/review/sweep.md` — `Skill`-tool composition +
  failure-boundary-gate precedent.
- `plugins/yellow-review/skills/pr-review-workflow/SKILL.md` — template for the
  new `stack-traversal` skill (`user-invokable: false`, three headings).
- `plugins/yellow-review/agents/workflow/pr-comment-resolver.md` — reused
  resolver; ±20-line anchor search, 50-line scope cap, CONFLICT sentinel.
- `AGENTS.md` "Critical Agent Authoring Rules"; `scripts/validate-agent-authoring.js`.
- `docs/solutions/code-quality/claude-code-command-authoring-anti-patterns.md`,
  `docs/solutions/code-quality/skill-frontmatter-attribute-and-format-requirements.md`,
  `docs/solutions/workflow/wsl2-crlf-pr-merge-unblocking.md`.
