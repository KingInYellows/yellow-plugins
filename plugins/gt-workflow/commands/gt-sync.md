---
name: gt-sync
description: 'Pull latest trunk, restack all tracked branches, and untrack branches whose PRs merged. Use when user says "sync with main", "rebase my stack", or "pull latest", after PRs merge, or when gt reports "needs restack". Not for deleting stale local-only branches — use /gt-cleanup.'
argument-hint: '[--no-delete | --force]'
allowed-tools:
  - Bash
  - Skill
---

# Graphite Sync

One-command repo sync: pull latest from trunk, restack your branches, and clean
up merged PRs.

## Usage

Invoke the `Skill` tool with `skill: "gt-sync"`. Pass the args string
`$ARGUMENTS` (literal — substitute the actual argument text the user
provided after the command name, if any) so flags like `--no-delete` or
`--force` reach the skill.
