---
name: ci-status
description: Show recent CI workflow run status. Use when the user asks for CI status, recent builds, what is running, or needs to find a run ID for diagnosis.
---

## What It Does

Fetches and displays the most recent GitHub Actions workflow runs for the
current repository — run ID, status, conclusion, branch, title, and last
update time — so you can see what is running or find a run ID to diagnose.

## When to Use

- The user asks for "CI status", "recent builds", or "what is running".
- You need a run ID to hand to CI failure diagnosis.
- Not for diagnosing a specific failure — use the CI diagnosis skill for that.

## Usage

The argument text provided after the skill name (if any) is available as
context for this invocation. This skill takes no arguments; it lists the five
most recent runs.

### 1. Fetch Recent Runs

Fetch the last 5 workflow runs:

```bash
gh run list --limit 5 --json databaseId,status,conclusion,headBranch,displayTitle,updatedAt \
  -q '.[] | [.databaseId, .status, (.conclusion // "running"), .headBranch, .displayTitle, .updatedAt] | @tsv'
```

Format the result as a table with columns: Run ID, Status, Conclusion, Branch,
Title, Updated.

### 2. Handle Failures

If `gh` fails:

- Check `gh auth status` — the user may need to authenticate.
- Confirm you are inside a GitHub repository with a remote.

If no runs are found:

> No workflow runs found. This repository may not have GitHub Actions
> configured.

### Success Criteria

- The five most recent runs are shown in a readable table, or a clear message
  explains why none could be listed.
