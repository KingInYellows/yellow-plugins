---
name: review:resolve
description: "Parallel resolution of unresolved PR review comments. Use when you want to address all pending review feedback on a PR by spawning parallel resolver agents."
argument-hint: '[PR#]'
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

# Resolve PR Review Comments

Fetch unresolved comments via GraphQL, spawn parallel resolver agents, apply
fixes, mark threads resolved, and push via Graphite.

## Workflow

### Step 1: Resolve PR Number

1. **If `$ARGUMENTS` provided**: Validate numeric, use as PR number
2. **If empty**: Detect from current branch:
   `gh pr view --json number -q .number`

Validate PR exists and is open. If not, report and stop.

### Step 2: Check Working Directory

```bash
git status --porcelain
```

If non-empty: error "Uncommitted changes detected. Please commit or stash before
running resolve." and stop.

### Step 3: Fetch Unresolved Comments

Determine repo from git remote:

```bash
gh repo view --json nameWithOwner -q .nameWithOwner
```

If this fails (not in a git repo, not authenticated, or remote is not GitHub):
report the error and stop.

Run the GraphQL script:

```bash
"${CLAUDE_PLUGIN_ROOT}/skills/pr-review-workflow/scripts/get-pr-comments" "<owner/repo>" "<PR#>"
```

If the script exits non-zero, report its stderr output verbatim and stop. Do not
proceed to Step 4.

If no unresolved comments: report "No unresolved comments found on PR #X." and
exit successfully.

### Step 4: Spawn Parallel Resolvers

For each unresolved comment thread, spawn a `pr-comment-resolver` agent via Task
tool with:

- Comment body (all comments in thread concatenated)
- File path and line number
- PR context (title, description)

Launch all resolvers in parallel. Each agent reads context and edits files
directly. Claude Code serializes concurrent Edit calls, but if multiple agents
target overlapping file regions, later edits may fail. Review the aggregate diff
in Step 5.

### Step 5: Review Changes

Collect all changes from resolver agents. Check for conflicts:

- If multiple agents proposed changes to the same file region, review and
  reconcile manually
- Use `git diff` to inspect all changes before committing

### Step 6: Commit and Push

If changes were made:

1. Show `git diff --stat` summary to the user
2. Use `AskUserQuestion` to confirm: "Push these changes to resolve PR #X
   comments?"
3. On approval:

```bash
gt modify -c -m "fix: resolve PR #<PR#> review comments"
gt submit --no-interactive
```

4. If rejected: report changes remain uncommitted for manual review

### Step 7: Mark Threads Resolved

**Only if the user approved the push in Step 6 AND `gt submit` exited 0.** If
push was rejected or failed, skip this step.

For each comment thread that was addressed, run:

```bash
"${CLAUDE_PLUGIN_ROOT}/skills/pr-review-workflow/scripts/resolve-pr-thread" "<threadId>"
```

If a script exits non-zero, record the threadId as failed and continue to the
next thread. Do not abort the loop. Include all failed threadIds with their
stderr output in the Step 9 report.

### Step 8: Verification Loop

1. Wait 2 seconds
2. Re-fetch comments with `get-pr-comments`:
   - If the re-fetch fails with a 429 (rate limit) error: wait 60 seconds and
     retry once
   - If the re-fetch fails with any other error: mark verification as
     **inconclusive**, capture the stderr output, and skip to Step 9 (do not
     attempt further `resolve-pr-thread` retries)
3. If unresolved threads remain that we attempted to resolve, retry
   `resolve-pr-thread` up to 3 times:
   - Check the exit code on each attempt
   - On a 429 (rate limit) error in stderr: wait 60 seconds before next retry
4. Threads unresolved after 3 retries due to non-zero exit are reported as
   **Errors** (include stderr from the last failed attempt). Other unresolved
   threads are reported as warnings.

### Step 9: Report

Present summary:

- Total comments found
- Successfully resolved count
- Failed/skipped count (with reasons)
- Any remaining unresolved threads
- Push status
- Verification status (if inconclusive, include the error details from Step 8)

## Error Handling

- **PR not found**: "PR #X not found. Verify the number and your repo access."
- **Dirty working directory**: "Uncommitted changes detected. Commit or stash
  first."
- **Script not found**: "GraphQL scripts missing. Verify yellow-review plugin is
  installed."
- **Resolver failures**: Report which comments could not be resolved and why.
- **Push failure**: Report error, suggest `gt stack` to diagnose.

See `pr-review-workflow` skill for full error handling patterns.
