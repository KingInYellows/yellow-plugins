---
name: gt-amend
description: 'Fold working-tree changes into the current branch commit, audit them, and re-submit via Graphite. Use when user says "amend this", "add this to the current PR", "fold this fix in", or has follow-up edits for an already-submitted branch. Not for starting new work — use /smart-submit.'
argument-hint: '[--no-verify] [--no-submit] [--publish]'
allowed-tools:
  - Bash
  - Read
  - Glob
  - Grep
  - Task
  - AskUserQuestion
  - Skill
---

# Quick Amend

A fast path for the most common solo-dev operation: auditing your latest fix and
folding it into the current branch commit via `gt commit amend`.

## Usage

Invoke the `Skill` tool with `skill: "gt-amend"`. Pass the args string
`$ARGUMENTS` (literal — substitute the actual argument text the user
provided after the command name, if any) so flags like `--no-submit` or
`--no-verify` reach the skill.
