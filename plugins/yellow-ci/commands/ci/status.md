---
name: ci:status
description: >
  Show recent CI workflow run status. Use when user asks "CI status", "recent
  builds", "what's running", or needs to find run IDs for diagnosis.
allowed-tools:
  - Bash
model: haiku
---

<!--
Usage: /ci:status
Shows last 5 workflow runs with status, conclusion, branch, and title.
Requires: gh CLI authenticated
-->

# Recent CI Runs

Fetch the last 5 workflow runs:

```bash
gh run list --limit 5 --json databaseId,status,conclusion,headBranch,displayTitle,updatedAt \
  -q '.[] | [.databaseId, .status, (.conclusion // "running"), .headBranch, .displayTitle, .updatedAt] | @tsv'
```

Format as a table with columns: Run ID, Status, Conclusion, Branch, Title,
Updated.

If `gh` fails:

- Check: `gh auth status` — user may need to authenticate
- Check: must be in a GitHub repository with a remote

If no runs found:

> No workflow runs found. This repository may not have GitHub Actions
> configured.
