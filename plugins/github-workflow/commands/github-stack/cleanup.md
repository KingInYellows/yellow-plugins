---
name: github-stack:cleanup
description: 'Remove local stack tracking, and by default also remote-unstack every PR via the GitHub API (--local skips the remote call). Use when user says "clean up my stack" or "untrack this stack" on the github stacked-PR provider.'
argument-hint: '[--local]'
allowed-tools:
  - Bash
  - AskUserQuestion
  - Skill
---

# github-workflow Cleanup

Remove local stack tracking via `gh stack unstack`. By default this ALSO
remote-unstacks every PR in the stack via the GitHub API — pass `--local`
to skip that and only remove local tracking. Neither form deletes local
git branches. Always destructive — requires confirmation.

## Usage

Invoke the `Skill` tool with `skill: "github-stack-cleanup"`. Pass the
args string `$ARGUMENTS` (literal — substitute the actual argument text
the user provided after the command name, if any) so a flag like
`--local` reaches the skill.
