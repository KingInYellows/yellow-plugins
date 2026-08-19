---
name: github-stack:sync
description: 'Sync the local stack with trunk via gh stack sync, optionally pruning merged branches. Use when user says "sync with main" or "pull latest" on the github stacked-PR provider.'
argument-hint: '[--prune]'
allowed-tools:
  - Bash
  - AskUserQuestion
  - Skill
---

# github-workflow Sync

Pull the latest trunk and sync the local stack via `gh stack sync`.
Pruning merged local branches is destructive and requires confirmation.

## Usage

Invoke the `Skill` tool with `skill: "github-stack-sync"`. Pass the args
string `$ARGUMENTS` (literal — substitute the actual argument text the
user provided after the command name, if any) so a flag like `--prune`
reaches the skill.
