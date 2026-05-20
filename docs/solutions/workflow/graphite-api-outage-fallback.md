---
title: 'Graphite API outage fallback: git push --force-with-lease per branch'
date: 2026-05-20
category: workflow
track: knowledge
problem: 'Graphite API returns persistent 503s independent of GitHub availability; gt submit fails but PRs can still be pushed and merged through GitHub directly'
tags:
  - graphite
  - git
  - workflow
  - outage
  - fallback
  - push
components:
  - workflow
---

# Graphite API outage fallback

## Context

Graphite (`gt`) is the mandatory branch and PR management tool for this repo
(see CLAUDE.md "Graphite is mandatory"). However, the Graphite API and the
GitHub API are independent services. During the compound-staging stack
submission (PRs #540–#547), `gt submit` returned persistent 503s from the
Graphite API while `gh api` calls and all GitHub PR operations (CI, merge
queue, checks) worked normally.

## Guidance

### What fails vs what still works during a Graphite API outage

| Operation | Status during Graphite 503 |
|---|---|
| `gt submit` (stack submission / PR update) | Fails — calls Graphite API |
| `gt restack` / `gt upstack restack` | Works — pure local git operation |
| `git push --force-with-lease origin <branch>` | Works — direct GitHub |
| `gh pr create` / `gh pr view` | Works — GitHub API, unaffected |
| GitHub Actions CI | Works — triggered by push |
| GitHub merge queue | Works — GitHub-native |

### Fallback pattern

When `gt submit` 503s persistently (not a transient network blip — wait 30s
and retry once before concluding it is an outage):

1. Complete any local restack first. `gt upstack restack` is a local operation
   and works regardless of Graphite API status:

   ```bash
   gt upstack restack   # rebase the stack locally — no API call
   ```

2. Push each branch individually with `--force-with-lease`:

   ```bash
   # For each branch in the stack, from bottom to top:
   git push --force-with-lease origin <branch-name>
   ```

   `--force-with-lease` is safe here because `gt restack` just completed — the
   remote tip is the pre-restack commit and the local tip is the post-restack
   commit. The lease check correctly rejects any concurrent push that happened
   after your restack.

3. If PRs do not yet exist, create them via `gh pr create`:

   ```bash
   gh pr create --title "..." --body "..." --base <parent-branch>
   ```

   This is the only legitimate use-case for `gh pr create` in this repo
   (Graphite API unavailable and PR does not already exist).

4. Existing PRs auto-update on push — GitHub picks up the new commits and
   re-triggers CI without any Graphite involvement.

### What Graphite API failure does NOT affect

- PR review status, comments, approvals — all stored on GitHub
- Merge queue position — GitHub-native
- CI results — GitHub Actions
- The local `gt` graph (`~/.graphite/...`) — updated by `gt restack` locally

After the Graphite API recovers, `gt repo sync` will reconcile the local graph
with the remote state. No manual repair is needed.

### Diagnosing a Graphite API outage vs a local issue

```bash
# Check Graphite status page
curl -s https://graphitestatus.com/api/v2/status.json | jq '.status.description'

# Confirm GitHub is reachable
gh api rate_limit --jq '.rate.remaining'

# Confirm gt restack works (local op, no API)
gt upstack restack --dry-run 2>&1 | head -5
```

If `gh api` succeeds and `gt submit` 503s, it is a Graphite API outage. Apply
the fallback pattern above.

## When to apply

- `gt submit` fails with HTTP 503 or connection timeout after retrying.
- `gh api rate_limit` succeeds, confirming GitHub is reachable.
- PRs already exist on GitHub (common case for stack updates).

## Sources

- Compound-staging stack submission session, 2026-05-19
- PRs #540–#547: pushed via `git push --force-with-lease` during Graphite API
  outage; CI passed and PRs merged normally
