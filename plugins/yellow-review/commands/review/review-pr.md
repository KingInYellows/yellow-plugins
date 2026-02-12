---
name: review:pr
description: >
  Adaptive multi-agent review of a single PR. Use when you want comprehensive
  code review with automatic agent selection based on PR size and content.
argument-hint: "[PR# | URL | branch]"
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
  - Edit
  - Write
  - Task
  - AskUserQuestion
---

# Multi-Agent PR Review

Run adaptive multi-agent review on a single PR, apply P1/P2 fixes, and push via Graphite.

## Workflow

### Step 1: Resolve PR

Determine the target PR from `$ARGUMENTS`:

1. **If numeric**: Use directly as PR number
2. **If URL** (contains `github.com` and `/pull/`): Extract PR number from URL path
3. **If branch name**: `gh pr view "$ARGUMENTS" --json number -q .number`
4. **If empty**: Detect from current branch: `gh pr view --json number -q .number`

Validate the PR exists and is open:
```bash
gh pr view <PR#> --json state -q .state
```
If not "OPEN", report and stop.

### Step 2: Check Working Directory

```bash
git status --porcelain
```
If output is non-empty: error "Uncommitted changes detected. Please commit or stash before running review." and stop.

### Step 3: Fetch PR Metadata

```bash
gh pr view <PR#> --json files,additions,deletions,body,title,headRefName,baseRefName
```

Calculate gross line count (additions + deletions). Checkout the PR branch:
```bash
gt checkout <headRefName>
```
If `gt checkout` fails, try `gh pr checkout <PR#>` then `gt track`.

### Step 4: Adaptive Agent Selection

Apply selection rules from `pr-review-workflow` skill:
- Analyze `git diff --stat` and `git diff` output against trigger heuristics
- Always include: `code-reviewer`
- Conditionally include: `pr-test-analyzer`, `comment-analyzer`, `type-design-analyzer`, `silent-failure-hunter`
- Cross-plugin (via Task tool) when conditions match: `security-sentinel`, `architecture-strategist`, `performance-oracle`, `pattern-recognition-specialist`, `agent-native-reviewer`

### Step 5: Pass 1 — Parallel Agent Review

Launch all selected agents EXCEPT `code-simplifier` in parallel via Task tool. Each agent receives:
- The PR diff (`git diff <baseRefName>...HEAD`)
- PR title and body
- Changed file list
- CLAUDE.md contents

Wait for all agents. Collect findings. Log any failed agents with error reason.

If zero agents succeed, abort with error.

### Step 6: Aggregate and Apply Fixes

1. Sort findings by severity: P1 → P2 → P3
2. For P1 and P2 findings with concrete fix suggestions: apply sequentially using Edit tool
3. Review each change for correctness before proceeding to next

### Step 7: Pass 2 — Code Simplifier

Launch `code-simplifier` agent on the now-modified code to review applied fixes for simplification opportunities. Apply any P1/P2 simplifications.

### Step 8: Commit and Push

If any changes were made:
```bash
gt modify -c -m "fix: address review findings from <comma-separated-agent-names>"
gt submit --no-interactive
```

### Step 9: Report

Present summary:
- Findings table grouped by severity (P1, P2, P3)
- Changes applied vs. P3 suggestions left for manual review
- Failed agents (if any)
- Push status

## Error Handling

- **PR not found**: "PR #X not found. Verify the number and your repo access."
- **Dirty working directory**: "Uncommitted changes detected. Commit or stash first."
- **Agent failures**: Use partial results. List failed agents in report.
- **Push failure**: Report error, suggest `gt stack` to diagnose.

See `pr-review-workflow` skill for full error handling patterns.
