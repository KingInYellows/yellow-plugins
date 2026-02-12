---
name: review:resolve
description: >
  Parallel resolution of unresolved PR review comments. Use when you want to
  address all pending review feedback on a PR by spawning parallel resolver agents.
argument-hint: "[PR#]"
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

Fetch unresolved comments via GraphQL, spawn parallel resolver agents, apply fixes, mark threads resolved, and push via Graphite.

## Workflow

### Step 1: Resolve PR Number

1. **If `$ARGUMENTS` provided**: Validate numeric, use as PR number
2. **If empty**: Detect from current branch: `gh pr view --json number -q .number`

Validate PR exists and is open. If not, report and stop.

### Step 2: Check Working Directory

```bash
git status --porcelain
```
If non-empty: error "Uncommitted changes detected. Please commit or stash before running resolve." and stop.

### Step 3: Fetch Unresolved Comments

Determine repo from git remote:
```bash
gh repo view --json nameWithOwner -q .nameWithOwner
```

Run the GraphQL script:
```bash
plugins/yellow-review/skills/pr-review-workflow/scripts/get-pr-comments "<owner/repo>" "<PR#>"
```

If no unresolved comments: report "No unresolved comments found on PR #X." and exit successfully.

### Step 4: Spawn Parallel Resolvers

For each unresolved comment thread, spawn a `pr-comment-resolver` agent via Task tool with:
- Comment body (all comments in thread concatenated)
- File path and line number
- PR context (title, description)

Launch all resolvers in parallel to generate proposed changes, then apply fixes sequentially to avoid conflicts.

### Step 5: Review Changes

Collect all changes from resolver agents. Check for conflicts:
- If multiple agents proposed changes to the same file region, review and reconcile manually
- Use `git diff` to inspect all changes before committing

### Step 6: Commit and Push

If changes were made:
1. Show `git diff --stat` summary to the user
2. Use `AskUserQuestion` to confirm: "Push these changes to resolve PR #X comments?"
3. On approval:
```bash
gt modify -c -m "fix: resolve PR #<PR#> review comments"
gt submit --no-interactive
```
4. If rejected: report changes remain uncommitted for manual review

### Step 7: Mark Threads Resolved

For each comment thread that was addressed, run:
```bash
plugins/yellow-review/skills/pr-review-workflow/scripts/resolve-pr-thread "<threadId>"
```

### Step 8: Verification Loop

1. Wait 2 seconds
2. Re-fetch comments with `get-pr-comments`
3. If unresolved threads remain that we attempted to resolve, retry `resolve-pr-thread` up to 3 times
4. Report any threads that remain unresolved after retries as warnings

### Step 9: Report

Present summary:
- Total comments found
- Successfully resolved count
- Failed/skipped count (with reasons)
- Any remaining unresolved threads
- Push status

## Error Handling

- **PR not found**: "PR #X not found. Verify the number and your repo access."
- **Dirty working directory**: "Uncommitted changes detected. Commit or stash first."
- **Script not found**: "GraphQL scripts missing. Verify yellow-review plugin is installed."
- **Resolver failures**: Report which comments could not be resolved and why.
- **Push failure**: Report error, suggest `gt stack` to diagnose.

See `pr-review-workflow` skill for full error handling patterns.
