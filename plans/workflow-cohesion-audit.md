# Workflow Cohesion Audit: Implementation Plan

## Problem Statement

The yellow-plugins monorepo has 11 plugins that evolved independently. While each
is internally well-designed, cross-plugin integration has inconsistencies:
duplicate review commands, deprecated Graphite syntax, fragile cross-plugin
mandates, hook permission issues, and disconnected workflow handoffs. This plan
addresses all findings from the workflow cohesion brainstorm.

## Current State

- **Workflow gaps**: 5 handoff issues between brainstorm/plan/work/review/submit
- **Agent issues**: 3 naming/scoping concerns (no agents need deletion)
- **Hook issues**: 2 (permission + startup latency)
- **Graphite issues**: 2 (deprecated syntax + missing --no-interactive)
- **Cross-plugin issues**: 2 (fragile review mandate + wrong command reference)
- **Documentation gaps**: 1 (non-git plugins missing disclaimer)
- **Spec-flow additions**: 2 new bugs found (missing argument guard, broken plan
  review option)

## Key Decisions Made

- **D1**: `workflows:work` Phase 4 will delegate to `/smart-submit` for the
  audit-commit-submit cycle
- **D2**: `workflows:review` becomes a thin redirect to `/review:pr`
- **D3**: The review-after-submit step moves into `workflows:work` itself
  (self-contained, graceful degradation if yellow-review not installed)

## Implementation Plan

### Phase 1: Mechanical Fixes (independent, low risk)

These can all be done in a single PR. No cascading effects.

- [ ] 1.1: Replace `gt commit create` with `gt modify -c` in `workflows:work`
  - File: `plugins/yellow-core/commands/workflows/work.md`
  - Lines: 183, 292, 320, 382, 406 (5 occurrences)
  - Also replace in `plugins/gt-workflow/commands/smart-submit.md` lines 66, 229

- [ ] 1.2: Fix `workflows:work` missing argument guard
  - File: `plugins/yellow-core/commands/workflows/work.md`
  - Line ~37: `cat "#$ARGUMENTS"` crashes if no argument provided
  - Add guard: if `$ARGUMENTS` is empty, use `AskUserQuestion` to request plan
    file path (match `gt-stack-plan` pattern)

- [ ] 1.3: Add execute permissions to yellow-ruvector hook scripts
  - Files: `plugins/yellow-ruvector/hooks/scripts/`
    - `user-prompt-submit.sh`
    - `session-start.sh`
    - `post-tool-use.sh`
    - `stop.sh`
  - Run: `chmod +x` on all four scripts
  - Note: `lib/validate.sh` stays at 644 (sourced, not executed)

- [ ] 1.4: Add non-git plugin disclaimers to CLAUDE.md files
  - Files:
    - `plugins/yellow-chatprd/CLAUDE.md`
    - `plugins/yellow-browser-test/CLAUDE.md`
    - `plugins/yellow-research/CLAUDE.md`
  - Add: "This plugin does not perform git operations. Graphite commands and git
    workflows do not apply."

### Phase 2: Retire `workflows:review` (keystone change)

This is the highest-impact change. 5 other fixes depend on it.

- [ ] 2.1: Convert `workflows:review` to a thin redirect
  - File: `plugins/yellow-core/commands/workflows/review.md`
  - Replace body with:
    - Parse `$ARGUMENTS` (PR number, URL, or branch name)
    - Print deprecation notice: "workflows:review is deprecated. Redirecting to
      /review:pr which provides adaptive agent selection and auto-fix."
    - Invoke `/review:pr` with the parsed argument
  - Keep the same frontmatter name so existing references work

- [ ] 2.2: Update yellow-core CLAUDE.md component listing
  - File: `plugins/yellow-core/CLAUDE.md`
  - Update `workflows:review` entry to note it redirects to `review:pr`
  - Add cross-plugin dependency on yellow-review (optional, degrades gracefully)

- [ ] 2.3: Fix `workflows:plan` broken review option
  - File: `plugins/yellow-core/commands/workflows/plan.md`
  - Line 334: Change "Review the plan (/workflows:review plans/<name>.md)" to
    a plan critique option (e.g., run spec-flow-analyzer on the plan) since
    review commands expect PRs, not markdown files
  - Remove the broken `/workflows:review` option for plan files

- [ ] 2.4: Update `test-coverage-analyst` description
  - File: `plugins/yellow-core/agents/review/test-coverage-analyst.md`
  - Update description to clarify: "For full test suite audits, not PR reviews.
    For PR-scoped test analysis, see pr-test-analyzer (yellow-review)."
  - This agent keeps its role for standalone `debt:audit` and ad-hoc use

### Phase 3: Rewire `workflows:work` Phase 4 (depends on Phase 2)

- [ ] 3.1: Delegate Phase 4 submit to `/smart-submit`
  - File: `plugins/yellow-core/commands/workflows/work.md`
  - Replace Phase 4 "Ship It" raw `gt stack submit` with invocation of
    `/smart-submit`
  - This gets the 3-agent audit (code-reviewer, security-sentinel,
    silent-failure-hunter) + non-interactive submit in one step
  - Add fallback: if gt-workflow plugin not installed, fall back to
    `gt submit --no-interactive`

- [ ] 3.2: Add review-after-submit step in `workflows:work`
  - File: `plugins/yellow-core/commands/workflows/work.md`
  - After the submit step, add a new Phase 5 "Review":
    - Get the PR URL from `gt submit` output or `gh pr view --json url`
    - Invoke `/review:pr <PR-URL>`
    - Graceful degradation: if yellow-review not installed, skip with note
  - This replaces the fragile ruvector CLAUDE.md injection

- [ ] 3.3: Remove review mandate from yellow-ruvector CLAUDE.md
  - File: `plugins/yellow-ruvector/CLAUDE.md`
  - Lines 124-130: Remove the instruction to invoke `/workflows:review` after
    `gt stack submit` in `/workflows:work`
  - The mandate now lives in `workflows:work` itself (Phase 5)
  - Keep any ruvector-specific enrichment (learning capture, etc.)

### Phase 4: Workflow Handoff Improvements (independent, can parallelize)

- [ ] 4.1: Improve brainstorm->plan handoff (W1)
  - File: `plugins/yellow-core/agents/workflow/brainstorm-orchestrator.md`
  - After writing the brainstorm file, output the exact suggested command:
    `/workflows:plan docs/brainstorms/<date>-<slug>-brainstorm.md`
  - Verify this is already happening (may have been fixed in current session)

- [ ] 4.2: Connect `gt-stack-plan` to `workflows:plan` (W4)
  - File: `plugins/yellow-core/commands/workflows/plan.md`
  - In Phase 5 post-generation options, add:
    "Decompose into stacked PRs (/gt-stack-plan plans/<name>.md)"
  - File: `plugins/gt-workflow/commands/gt-stack-plan.md`
  - Accept a plan file path as optional input alongside feature descriptions
  - When given a plan file, derive stack items from the plan's phases/tasks

- [ ] 4.3: Document submit path differences (W5)
  - File: `plugins/gt-workflow/CLAUDE.md` or a shared skill
  - Add guidance: `/smart-submit` for ad-hoc commits (audit + commit + submit);
    `/workflows:work` for plan-driven implementation (structured phases +
    delegates to smart-submit)

### Phase 5: Agent Clarity Improvements (independent)

- [ ] 5.1: Clarify code-simplifier temporal role (A1)
  - File: `plugins/yellow-review/agents/review/code-simplifier.md`
  - Update description to emphasize it is a "pass-2 post-fix simplification
    check" that runs after other review agents have applied fixes
  - Add note: "For pre-fix complexity analysis, see code-simplicity-reviewer
    (yellow-core)"

- [ ] 5.2: Rename inline agents in gt-workflow (A3)
  - Files:
    - `plugins/gt-workflow/commands/smart-submit.md`
    - `plugins/gt-workflow/commands/gt-amend.md`
  - Rename inline agent descriptions to avoid name collision:
    - "security-sentinel" inline prompt -> "quick-security-scan" (or similar)
    - "silent-failure-hunter" inline prompt -> "quick-error-check"
    - "code-reviewer" inline prompt -> "quick-code-review"
  - These use `subagent_type: general-purpose` so the names are cosmetic, but
    the current naming creates confusion with the real plugin-qualified agents

### Phase 6: Verify and Document

- [ ] 6.1: Verify hook startup latency
  - Manually test: install all 3 SessionStart plugins, measure actual startup
  - Determine if Claude Code runs hooks sequentially or in parallel
  - If sequential and >5s, consider reducing individual timeouts from 3s to 2s

- [ ] 6.2: Update README agent/command counts
  - Files: root `README.md`, all plugin `README.md` and `CLAUDE.md` files
  - Ensure counts reflect any changes made in Phases 1-5

- [ ] 6.3: Run validation suite
  - `pnpm validate:schemas` to verify all manifests still valid
  - Manual smoke test of the full pipeline:
    brainstorm -> plan -> work -> smart-submit -> review:pr

## Technical Details

### Files to Modify

| File | Phase | Changes |
|------|-------|---------|
| `plugins/yellow-core/commands/workflows/work.md` | 1.1, 1.2, 3.1, 3.2 | gt syntax, argument guard, smart-submit delegation, review step |
| `plugins/yellow-core/commands/workflows/review.md` | 2.1 | Thin redirect to review:pr |
| `plugins/yellow-core/commands/workflows/plan.md` | 2.3, 4.2 | Fix broken review option, add stack-plan option |
| `plugins/yellow-core/CLAUDE.md` | 2.2 | Update component listing |
| `plugins/yellow-core/agents/review/test-coverage-analyst.md` | 2.4 | Clarify scope |
| `plugins/yellow-core/agents/workflow/brainstorm-orchestrator.md` | 4.1 | Verify handoff path output |
| `plugins/yellow-review/agents/review/code-simplifier.md` | 5.1 | Clarify temporal role |
| `plugins/yellow-ruvector/CLAUDE.md` | 3.3 | Remove review mandate |
| `plugins/yellow-ruvector/hooks/scripts/*.sh` | 1.3 | chmod +x |
| `plugins/gt-workflow/commands/smart-submit.md` | 1.1, 5.2 | gt syntax, rename inline agents |
| `plugins/gt-workflow/commands/gt-amend.md` | 5.2 | Rename inline agents |
| `plugins/gt-workflow/commands/gt-stack-plan.md` | 4.2 | Accept plan file input |
| `plugins/yellow-chatprd/CLAUDE.md` | 1.4 | Non-git disclaimer |
| `plugins/yellow-browser-test/CLAUDE.md` | 1.4 | Non-git disclaimer |
| `plugins/yellow-research/CLAUDE.md` | 1.4 | Non-git disclaimer |

### No Files to Create

All changes modify existing files. No new files needed.

## Acceptance Criteria

1. `gt commit create` appears nowhere in the codebase (replaced by `gt modify -c`)
2. All ruvector hook scripts have 755 permissions
3. `/workflows:review` redirects to `/review:pr` with deprecation notice
4. `/workflows:work` delegates submit to `/smart-submit` and runs review:pr after
5. `/workflows:work` handles missing `$ARGUMENTS` gracefully
6. `/workflows:plan` does not offer PR review for plan markdown files
7. No cross-plugin CLAUDE.md mandates exist for workflow behavior
8. Three non-git plugins have CLAUDE.md disclaimers
9. `pnpm validate:schemas` passes
10. Full pipeline smoke test succeeds: brainstorm -> plan -> work -> submit -> review

## Edge Cases

- **yellow-review not installed**: `workflows:work` Phase 5 skips review with a
  note suggesting manual review
- **gt-workflow not installed**: `workflows:work` Phase 4 falls back to
  `gt submit --no-interactive` directly
- **Multiple brainstorm files**: `workflows:plan` reads the one passed as
  `$ARGUMENTS`; does not auto-discover
- **Empty plan phases**: `gt-stack-plan` handles plans with no clear phase
  structure by falling back to single-PR mode

## Stacking Strategy

Recommended PR stack (bottom to top):

1. **Phase 1**: Mechanical fixes (gt syntax, chmod, disclaimers, argument guard)
2. **Phase 2**: Retire workflows:review (thin redirect + reference updates)
3. **Phase 3**: Rewire workflows:work Phase 4 (smart-submit + review step)
4. **Phase 4**: Workflow handoff improvements (brainstorm, stack-plan, docs)
5. **Phase 5**: Agent clarity (descriptions, inline agent renames)
6. **Phase 6**: Verification and count updates

## References

- Brainstorm: `docs/brainstorms/2026-03-01-workflow-cohesion-audit-brainstorm.md`
- gt-workflow CLAUDE.md deprecated syntax table: line 20
- ruvector CLAUDE.md review mandate: lines 124-130
- workflows:work Phase 4: lines 330-420
- workflows:plan post-generation: lines 330-345
- smart-submit audit agents: lines 107-130
