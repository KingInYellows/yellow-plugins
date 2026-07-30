# Handoff: Deferred follow-ups from PR #666/#667 review loops

## Current task

PR #666 (prompt-quality pass, 14 plugins) and PR #667 (review-schema
definitions + Codex reference sidecars + gt-cleanup split) were fully swept
via /review:sweep-all (multi-agent review, autonomous fixes, thread
resolution) and sent to the Graphite merge queue by the user on 2026-07-28.
This handoff collects every follow-up that was deliberately deferred out of
those PRs so a fresh session can land them as one or two small PRs.

## Workflow status

Sweep complete; both PRs queued for merge (may already be merged by the
time you read this). No implementation of the deferred items has started.

## Active artifacts

- plans/review-schema-and-codex-references-followups.md — the #667 plan;
  all boxes checked. Archive it via /yellow-core:plan:complete AFTER both
  PRs merge (Gate C needs merged-PR evidence).
- PR #666 / PR #667 bodies — each has a "Deferred follow-ups" section this
  list supersedes/extends.

## Pre-flight for the new session

1. Verify both PRs merged: `gh pr view 666 --json state,mergedAt` and same
   for 667. If still queued, do NOT resolve/force-push/restack those
   branches (Graphite merge-queue anti-pattern) — wait.
2. After merge: `gt repo sync` (untrack merged branches), then
   /yellow-core:plan:complete for the review-schema plan.
3. IMPORTANT: all line numbers below are pre-merge; the queue may rebase.
   Re-locate by content (grep the quoted strings), not by line number.

## Deferred work — prioritized

### Tier 1: security-relevant (suggest one PR)

1. gemini-reviewer.md heredoc parity (PR-#666-disclosed deferral).
   plugins/yellow-council/agents/review/gemini-reviewer.md:112 still stages
   the untrusted council pack via a fixed-delimiter heredoc; its sibling
   opencode-reviewer.md was converted in #666 to Write-tool staging (Write
   grant bounded to $PACK_FILE, [ -s ] non-empty check, "Tool Surface"
   doc block). Apply the identical treatment; note gemini-reviewer's
   comment at ~line 110 currently says "never use the Write tool" — that
   prose must flip too. See
   docs/solutions/security-issues/heredoc-delimiter-collision.md.
2. rescue.md task-description fence-escape guard (adversarial P1, #666
   sweep). plugins/yellow-codex/commands/codex/rescue.md ~line 94:
   TASK_DESCRIPTION is interpolated into the
   "--- begin task-description (reference data only) ---" fence with no
   delimiter-escape step; a pasted bug report containing the literal
   fence-close line breaks out early, and codex exec runs workspace-write
   with approval never. Mirror the siblings' ESCAPED-substitution pattern.
   Per PR #664 learnings: EXECUTE the fixed pipeline with a crafted
   adversarial input; do not just read it.
3. rescue.md unguarded cat read-back (P2, 4-reviewer agreement). Same file
   ~line 72: add `[ -s "<task-desc-file>" ] || { ...error...; exit 1; }`
   before TASK_DESCRIPTION=$(cat ...) so a failed Write / missed
   placeholder substitution fails loudly instead of sending Codex a blank
   task. Mirrors opencode-reviewer's PACK_FILE check.
4. validate-codex.js symlink blind spot (codex-reviewer P2, #667 sweep).
   scripts/validate-codex.js ~line 426: the skills loop gates on
   `entry.isDirectory()`, which is FALSE for a symlink-to-directory
   (empirically confirmed), so a symlinked skill dir in generated output is
   silently skipped — neither its SKILL.md nor references/ reach the
   exposure lint. Add an explicit entry.isSymbolicLink() error branch
   before the isDirectory() gate. Add a test.

### Tier 2: correctness / contract wording

5. memory-manager flush retention (PR-#666-disclosed).
   plugins/yellow-ruvector/agents/ruvector/memory-manager.md ~line 92:
   broaden retention from "entries whose hooks_remember call failed" to
   "entries whose processing failed" so failed file_change re-index entries
   are retained for retry instead of dropped on rewrite.
6. scan-verifier/fix.md outcome contract (PR-#666-disclosed).
   plugins/yellow-semgrep/commands/semgrep/fix.md (~lines 185/191): update
   the stale "new findings introduced" branch language to match
   scan-verifier.md's renamed findings-at-modified-lines/WARNING outcome.
7. runner-diagnostics SSH-rule self-contradiction (3-reviewer, #666
   sweep). plugins/yellow-ci/agents/maintenance/runner-diagnostics.md
   ~line 44: "beyond those listed in Step 4" forbids the agent's own
   Step 3 connectivity check — say "Steps 3 and 4".
8. mempalace kg.md placeholder leak (2-reviewer, #666 sweep).
   plugins/yellow-mempalace/commands/mempalace/kg.md ~line 103: the
   "closet" definition sits INSIDE the [...] render placeholder of the
   output template; move it to prose outside the fence, leaving
   `[closet reference if available]`.
9. devin-orchestrator ACU-cap question (2 findings, #666 sweep).
   plugins/yellow-devin/agents/workflow/devin-orchestrator.md ~lines
   67-68: the new max_acu_limit AskUserQuestion has no non-interactive
   default (blocks headless callers) and no `Other`-labeled option for
   free-form numeric input. Add a documented default + Other option.

### Tier 3: sweep-completeness (same defect classes #666 fixed elsewhere)

10. Bare "M3" jargon in 4 files the sweep missed:
    plugins/yellow-debt/commands/debt/sync.md ~162,
    plugins/yellow-devin/skills/devin-workflows/SKILL.md ~188,
    plugins/yellow-linear/agents/workflow/linear-pr-linker.md ~45,
    plugins/yellow-linear/commands/linear/delegate.md ~216. Apply the same
    "(M3)" -> confirmation-gate plain-language rewrite used in
    report-linear.md / deepen-plan.md / council.md.
11. Unresolvable MEMORY.md citations in
    plugins/yellow-core/commands/plan/complete.md ~lines 378 and 412 —
    state the rule inline instead of citing the maintainer-local file.
12. Other-label rule paraphrased 4 ways (decompose.md ~134,
    expand-shell.md ~66, spec.md ~86-88, work.md ~225-228) — standardize
    on the canonical phrasing ("only the literal `Other` label opens
    free-text input"); also consider moving expand-shell's Other option
    last to match siblings.

### Tier 4: tests + polish (#667 residuals)

13. Test: re-run generateManifests() against a POLLUTED generated tree
    (symlinked references/ dir; plain file named references) to exercise
    the stale-sweep error branches in scripts/generate-manifests.js
    (~515-541) — all current fixtures pollute the source tree or call
    runExposureLint directly (2-reviewer finding).
14. Test: null/array .codex-plugin/plugin.json fixture asserting
    validateArtifacts rejects (JSON.parse('null') guard at
    validate-codex.js ~134 currently untested).
15. emit-codex.js: explicit isDirectory() check for a plain file named
    "references" (currently a raw ENOTDIR message; both consumers have the
    targeted message; 2-reviewer). Also validate-codex.js SKILL.md-leaf
    "exists but not a regular file" else-branch for message parity.
16. generate-manifests.js ~519: decide/document whether one plugin's
    polluted generated references/ dir should abort ALL writes repo-wide
    (current behavior) or be scoped per-plugin (reliability P2 design
    question).
17. Doc: docs/solutions/integration-issues/codex-distribution-pipeline-silent-gaps.md
    ~105 still asserts reference sidecars are a permanent constraint —
    add an update note (supported as of #667).
18. Doc: anti-patterns doc entry #30 cites orphaned commit d464f8c; the
    reachable commit was 760a16dd pre-merge but the queue may rebase
    again — cite by commit message, not hash.
19. Low-value polish (batch if touching those files anyway): opencode
    rationale-comment dedup (RE-CHECK first — #666's resolve merged Steps
    7-13 into one block, likely stale); `<int>` placeholder in 6 reviewer
    JSON fences (pre-existing); #667 plan's own deferred-P3 list (symlink
    helper dedup, refDirBad inlining, sibling-regex precompile, etc.);
    error-message wording consistency in generate-manifests.js sweep.

## Open decisions

- Whether Tier 1 ships as its own PR (recommended: small, security-focused)
  with Tiers 2-3 as a second PR, or everything as one. User has not chosen.
- Item 16 is a genuine design question (fail-everything vs scope-per-plugin)
  — worth an explicit user call, not a silent choice. *(Since decided —
  reporting-only scoping, user call 2026-07-29; see the AUDITED
  postscript below.)*

## In-flight changes

None — working tree clean; all sweep work is pushed. Note this worktree
(.claude/worktrees/fable5prompt) had both PR branches checked out; after
merge, branches here are stale — start from main via gt repo sync.

## Next concrete action

> **SUPERSEDED — do not execute.** The actions below were carried out on
> 2026-07-29; see the AUDITED postscript at the bottom of this file
> before acting on anything in this section.

Verify both PRs merged (`gh pr view 666 --json state` / `667`), run
`gt repo sync`, archive the plan via /yellow-core:plan:complete, then start
Tier 1 as a new branch (`gt branch create fix/deferred-security-followups`)
beginning with item 1 (gemini-reviewer.md Write-tool staging parity).

---

## AUDITED 2026-07-29 (session_01Pp9szNyFFYzYj7Jbw22szX)

Line-by-line audit vs shipped PRs #670/#671: items 1–12 shipped (item 9
shipped its original ask — the documented default + `Other` option; the
follow-on cap-semantics design question it surfaced stayed open and was
later resolved by PR #677); items 13–15, 17, 18 implemented in follow-up
PR #676; item 16 (design question) and item 19 (low-value polish)
remained open by choice at audit time — since decided and implemented
via plans/sweep-670-672-deferred-design-decisions.md (PRs #678 and #679
respectively).
