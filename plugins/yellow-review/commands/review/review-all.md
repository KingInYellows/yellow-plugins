---
name: review:all
description: 'Sequential review of multiple PRs — your Graphite stack, all open PRs, or a single PR. Use when you want to review an entire stack in dependency order or batch-review all your open PRs.'
argument-hint: '[scope: stack|all|PR#]'
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
  - Edit
  - Write
  - Task
  - AskUserQuestion
  - ToolSearch
  - mcp__plugin_yellow-ruvector_ruvector__hooks_recall
  - mcp__plugin_yellow-ruvector_ruvector__hooks_capabilities
  - mcp__plugin_yellow-ruvector_ruvector__hooks_remember
---

# Review All PRs

Sequentially review multiple PRs with adaptive multi-agent analysis, automatic
fixes, comment resolution, and learning compounding.

## Workflow

### Step 1: Resolve PR List

Parse `$ARGUMENTS` to determine scope:

**scope=stack** (default if empty or "stack"):

```bash
gt log short --no-interactive 2>/dev/null
```

Parse branch names from Graphite stack output (one branch per line, strip
leading graph characters). For each branch:

```bash
gh pr view <branch> --json number,state -q '{number: .number, state: .state}'
```

Filter to open PRs only. Order base → tip (bottom of stack first).

**scope=all**:

```bash
gh pr list --author @me --state open --json number,headRefName,isDraft
```

Filter out drafts (`isDraft == false`) via jq. Order by PR number ascending.

**scope=PR#** (numeric argument): Single PR — convenience alias. Behaves like
`/review:pr <PR#>` plus resolve and compound.

### Step 2: Validate

- If no PRs found: report "No open PRs found for scope '<scope>'." and exit.
- Check working directory is clean: `git status --porcelain`
- If dirty: error "Uncommitted changes detected. Commit or stash first."

### Step 3: Adopt Non-Graphite PRs

For each PR not already tracked by Graphite:

```bash
gh pr checkout <PR#>
gt track
```

If `gt track` fails: warn "PR #X could not be adopted by Graphite. Proceeding
with raw git." Continue in degraded mode.

<!-- This block must mirror review-pr.md Steps 3a–6. When updating either
     file, update both. The inline form below enumerates the same Wave 2
     persona pipeline, learnings pre-pass, and confidence-rubric aggregation
     as /review:pr; details remain canonical in review-pr.md. -->

### Step 4: Sequential Review Loop

For each PR in order, run the full Wave 2 review pipeline inline (not as a
command invocation, so each PR's review uses the freshly-fetched base
branch and its own learnings pre-pass result). The sub-steps below mirror
`review-pr.md` Steps 3 → 9 — when the persona set, dispatch table, or
aggregation rules change there, propagate the same change here.

1. **Checkout**: `gt checkout <branch>`

2. **Fetch PR metadata + base branch** (mirrors review-pr.md Step 3 + 3a):

   ```bash
   gh pr view <PR#> --json files,additions,deletions,body,title,headRefName,baseRefName
   git fetch origin "<baseRefName>" --no-tags
   ```

   Use `origin/<baseRefName>` as the diff base for this PR's reviewers. On
   fetch failure, warn but continue.

3. **Optional ruvector recall** (mirrors review-pr.md Step 3b): when
   `.ruvector/` exists, build the recall query from PR body/title and
   inject the fenced advisory block into the
   `project-compliance-reviewer`, `correctness-reviewer`, and
   `security-reviewer` Task prompts only.

4. **Optional morph WarpGrep discovery** (mirrors review-pr.md Step 3c):
   when ToolSearch finds it, note availability for the four agents listed
   in review-pr.md.

5. **Learnings pre-pass** (mirrors review-pr.md Step 3d): always spawn
   `learnings-researcher` (via
   `Task(subagent_type: "yellow-core:learnings-researcher", ...)`) with a
   `<work-context>` block built from PR title, files, body, and inferred
   domains. If the agent returns the literal `NO_PRIOR_LEARNINGS` token,
   skip injection. Otherwise build the
   `--- begin learnings-context (reference only) ---` fenced block and
   prepend to **every** reviewer's Task prompt for this PR.

6. **Tiered persona dispatch** (mirrors review-pr.md Step 4): always-on
   personas + conditional personas + graceful-degradation guard. Read
   `yellow-plugins.local.md` for `review_pipeline`, `review_depth`,
   `focus_areas`, `reviewer_set.{include,exclude}` overrides. Never abort
   on a missing persona — log to stderr and continue.

7. **Compact-return pass 1** (mirrors review-pr.md Step 5): launch all
   selected agents in parallel except `code-simplifier`. Each persona
   returns the structured JSON compact-return schema. Drop malformed
   returns; record drop count.

8. **Aggregate findings** (mirrors review-pr.md Step 6): apply the
   confidence-rubric pipeline — validate, dedup
   (`file + line_bucket(line, ±3) + normalize(title)`), cross-reviewer
   agreement promotion (50→75, 75→100), separate pre-existing, normalize
   routing (most conservative wins), mode-aware demotion of
   testing/maintainability advisory P2-P3, **confidence gate (suppress
   below 75 except P0 ≥ 50)**, partition into safe_auto / residual /
   advisory queues, sort. Run intent-verification quality gates (line
   accuracy, protected-artifact filter, skim-FP check) before any P0/P1
   surfaces.

9. **Apply fixes pass 1** (mirrors review-pr.md Step 7): apply only
   `safe_auto → review-fixer` findings with concrete `suggested_fix`
   sequentially via Edit.

10. **Code simplifier pass 2** (mirrors review-pr.md Step 8): launch
    `code-simplifier` on the now-modified code; apply P0/P1
    simplifications.

11. **Commit + submit** (mirrors review-pr.md Step 9):

    ```bash
    gt modify -m "fix: address review findings from <reviewer-categories>"
    gt submit --no-interactive
    ```

12. **Resolve**: Fetch unresolved comments → run `/review:resolve` flow if
    any exist.

13. **Restack**: If changes were made and this is a stack:

    ```bash
    gt upstack restack
    ```

    If restack conflicts: abort restack, report to user, continue to next PR.

14. **Knowledge compounding** (mirrors review-pr.md Step 9a + 9b):
    automatic — when P0/P1/P2 findings exist, spawn
    `knowledge-compounder` and (when ruvector is available) record the
    learning with proper deduplication. On failure, log a warning and
    continue.

### Step 5: Final Summary

Present per-PR breakdown:

- PR number, title, branch
- Findings count by severity (P0/P1/P2/P3)
- Confidence-gated suppression count
- Changes applied
- Comments resolved
- Restack status
- Reviewers skipped via graceful degradation (with reasons)

And aggregate summary:

- Total PRs reviewed
- Total findings across all PRs
- Total changes applied
- Learnings compounded (new docs/memory entries created)

## Error Handling

- **No PRs found**: Report scope-specific message and exit
- **Dirty working directory**: Error and stop before starting any reviews
- **Individual PR failure**: Log error, continue to next PR in list
- **Restack conflict**: Abort restack for this PR, warn user, continue
- **gt track failure**: Proceed with raw git for that PR (degraded mode)

See `pr-review-workflow` skill for full error handling patterns.
