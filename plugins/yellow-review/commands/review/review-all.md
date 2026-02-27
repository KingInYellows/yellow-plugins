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
---

# Review All PRs

Sequentially review multiple PRs with adaptive multi-agent analysis, automatic
fixes, comment resolution, and learning compounding.

## Workflow

### Step 1: Resolve PR List

Parse `$ARGUMENTS` to determine scope:

**scope=stack** (default if empty or "stack"):

```bash
gt log --json 2>/dev/null
```

Extract branch names from Graphite stack output. For each branch:

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

### Step 4: Sequential Review Loop

For each PR in order:

1. **Checkout**: `gt checkout <branch>`
2. **Review**: Run the full `/review:pr` flow (inline, not as command
   invocation):
   - Adaptive agent selection
   - Parallel agent review
   - Fix application
   - Code simplifier pass
   - Commit and push
3. **Resolve**: Fetch unresolved comments → run `/review:resolve` flow if any
   exist
4. **Restack**: If changes were made and this is a stack:
   ```bash
   gt upstack restack
   ```
   If restack conflicts: abort restack, report to user, continue to next PR
5. **Compound**: Handled automatically by the inline `review:pr` flow (Step 9:
   Knowledge Compounding) — no separate spawn needed here. On failure,
   `review:pr` logs the warning and continues.

### Step 5: Final Summary

Present per-PR breakdown:

- PR number, title, branch
- Findings count by severity (P1/P2/P3)
- Changes applied
- Comments resolved
- Restack status

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
