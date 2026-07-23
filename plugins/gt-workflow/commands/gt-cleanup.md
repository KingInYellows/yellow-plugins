---
name: gt-cleanup
description: 'Scan local branches for staleness and divergence, then delete or reconcile them with safeguards. Use when user says "clean up my branches" or "which branches are stale". For deleting branches whose PRs merged — and for pulling trunk or restacking — use /gt-sync.'
argument-hint: '[--stale-days N] [--dry-run]'
allowed-tools:
  - Bash
  - AskUserQuestion
  - Skill
---

# Branch Cleanup and Divergence Reconciliation

Scan all local branches, classify them by state (orphaned, closed PR, stale,
diverged, behind remote, ahead of remote), and offer category-based cleanup
actions. Complements `/gt-sync` which handles merged branches.

## Usage

Invoke the `Skill` tool with `skill: "gt-cleanup"`. Pass the args string
`$ARGUMENTS` (literal — substitute the actual argument text the user
provided after the command name, if any) so flags like `--dry-run` or
`--stale-days N` reach the skill.
