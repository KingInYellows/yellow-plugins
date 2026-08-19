---
name: github-stack:merge
description: 'Merge a stacked PR via gh stack merge. Use when the user says "merge my stack" or "land this PR" on the github stacked-PR provider and the target is fully reviewed and ready.'
argument-hint: '[target] [--merge-method <merge|squash|rebase>]'
allowed-tools:
  - Bash
  - AskUserQuestion
  - Skill
---

# github-workflow Merge

Merge a stacked pull request via `gh stack merge`. Always destructive —
requires an explicit target and confirmation before landing anything.

## Usage

Invoke the `Skill` tool with `skill: "github-stack-merge"`. Pass the args
string `$ARGUMENTS` (literal — substitute the actual argument text the
user provided after the command name, if any) so the target and any
`--merge-method` flag reach the skill.
