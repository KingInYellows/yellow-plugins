---
name: github-stack:cleanup
description: 'Remove stack tracking via gh stack unstack, optionally deleting local branches. Use when user says "clean up my stack" or "untrack this stack" on the github stacked-PR provider.'
argument-hint: '[--local]'
allowed-tools:
  - Bash
  - AskUserQuestion
  - Skill
---

# github-workflow Cleanup

Remove stack tracking via `gh stack unstack`, and optionally delete the
local branches. Always destructive — requires confirmation.

## Usage

Invoke the `Skill` tool with `skill: "github-stack-cleanup"`. Pass the
args string `$ARGUMENTS` (literal — substitute the actual argument text
the user provided after the command name, if any) so a flag like
`--local` reaches the skill.
