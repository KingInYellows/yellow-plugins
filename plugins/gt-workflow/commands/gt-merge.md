---
name: gt-merge
description: 'Merge the current stack''s pull requests, from trunk up to the current branch, via Graphite. Use when the user says "merge my stack" or "land these PRs" and the stack is fully reviewed and ready.'
argument-hint: ''
allowed-tools:
  - Bash
  - Skill
  - AskUserQuestion
---

# Graphite Merge

Merge the pull requests associated with every branch from trunk up to the
current branch, via `gt merge`.

## Usage

Invoke the `Skill` tool with `skill: "gt-merge"`.
