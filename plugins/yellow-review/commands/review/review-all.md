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

<!-- This block must mirror review-pr.md Steps 3a–9b. When updating
     either file, update both. The inline form below enumerates the same
     Wave 2 persona pipeline, learnings pre-pass, confidence-rubric
     aggregation, knowledge compounding, and ruvector remember as
     /review:pr; details remain canonical in review-pr.md. -->

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
   selected agents in parallel except `code-simplifier`. Wave 2 persona
   agents return the structured JSON compact-return schema. Pre-Wave-2
   agents (`pr-test-analyzer`, `comment-analyzer`,
   `type-design-analyzer`, `silent-failure-hunter`, the `code-reviewer`
   deprecation stub, and the cross-plugin reviewers
   `architecture-strategist`, `pattern-recognition-specialist`,
   `code-simplicity-reviewer`, `polyglot-reviewer`) return legacy prose
   format — do NOT drop these as malformed; they are normalized to
   compact-return in Step 8 sub-step 1 before validation. Drop only
   returns that fail validation after normalization; record drop count.

8. **Aggregate findings** (mirrors review-pr.md Step 6): apply the
   confidence-rubric pipeline in this order:
   1. **Normalize legacy prose returns** (mirrors review-pr.md Step 6
      sub-step 0): for each pre-Wave-2 agent return in the prose format
      (`**[P0|P1|P2|P3] category — file:line**` followed by `Finding:` /
      `Fix:` lines), parse severity / category / file / line from the
      bracket prefix, use the `Finding:` line as `title` and the `Fix:`
      line as `suggested_fix` (null when absent), infer defaults
      (`confidence: 75`, `autofix_class: gated_auto`, `owner:
      downstream-resolver`, `requires_verification: true`,
      `pre_existing: false`), and wrap in the top-level envelope
      (`reviewer`, `findings`, `residual_risks`, `testing_gaps`) so it
      enters validation indistinguishable from a structured return.
   2. **Validate** (drop malformed after normalization).
   3. **Dedup** (`normalize(file) + line_bucket(line, ±3) + normalize(title)`);
      on merge keep highest severity, highest anchor, note all reviewers,
      and on `pre_existing` conflict keep `false` (treat as new). Parity
      rule with `review-pr.md` Step 6.2 — `normalize(file)` ensures the
      same finding matches across both pipelines regardless of OS path
      separator.
   4. **Cross-reviewer agreement promotion** (50→75, 75→100).
   5. **Separate pre-existing** into a separate report section.
   6. **Resolve disagreements** (annotate Reviewer column, keep most
      conservative severity / autofix_class / owner).
   7. **Normalize routing** (most conservative `autofix_class` and
      `owner` wins).
   8. **Mode-aware demotion** of testing/maintainability advisory P2/P3
      into `testing_gaps` / `residual_risks`.
   9. **Confidence gate** — suppress below 75 except P0 ≥ 50.
   10. **Partition** into safe_auto / residual / advisory queues.
   11. **Sort** (severity → anchor desc → file path → line).

   Run intent-verification quality gates (line accuracy,
   protected-artifact filter, skim-FP check) before any P0/P1 surfaces.

9. **Apply fixes pass 1** (mirrors review-pr.md Step 7): for surviving
   **P0/P1** findings with `autofix_class: safe_auto → review-fixer` and a
   concrete `suggested_fix`, apply sequentially via Edit. P2/P3 findings
   are not auto-applied here — they go through the resolve-PR flow at
   Step 12 instead. Parity rule with `review-pr.md` Step 7.

10. **Code simplifier pass 2** (mirrors review-pr.md Step 8): launch
    `code-simplifier` on the now-modified code; apply P0/P1
    simplifications.

11. **Commit + submit** (mirrors review-pr.md Step 9):

    Show `git diff --stat` summary. Use `AskUserQuestion` to confirm:
    "Push review fixes for PR #<PR#>?" On approval:

    ```bash
    gt modify -m "fix: address review findings from <reviewer-categories>"
    gt submit --no-interactive
    ```

    If rejected: report changes remain uncommitted for manual review and
    continue to the next PR (do not run Step 12 or Step 13 for this PR).

12. **Resolve**: Fetch unresolved comments → run `/review:resolve` flow if
    any exist.

13. **Restack**: If changes were made and this is a stack:

    ```bash
    gt upstack restack
    ```

    If restack conflicts: abort restack, report to user, continue to next PR.

14. **Knowledge compounding** (mirrors review-pr.md Step 9a + 9b):
    automatic — when P0/P1/P2 findings exist, spawn
    `knowledge-compounder`. When ruvector is available, record per-finding
    using the same tiered-remember rules as `review-pr.md` Step 9b: **auto**
    record P0/P1, **prompted** record P2 (via `AskUserQuestion` with default
    yes), **skip** P3 entirely. Apply proper deduplication. On failure, log
    a warning and continue.

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
