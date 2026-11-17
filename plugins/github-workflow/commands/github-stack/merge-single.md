---
name: github-stack:merge-single
description: 'Merge one ordinary, unstacked pull request. Use when the user says "merge this PR" or "land PR 123" on the github stacked-PR provider and the pull request is not part of a stack.'
argument-hint: '<pr-number> [--merge-method <merge|squash|rebase>]'
allowed-tools:
  - Skill
---

# github-workflow Merge Single

Merge one ordinary pull request. Refuses a pull request that belongs to a
stack (use `/github-stack:merge` for those). Always destructive — requires
a pull request number, a merge method and confirmation.

## Usage

Invoke the `Skill` tool with `skill: "github-stack-merge-single"`. Pass the
args string `$ARGUMENTS` (literal — substitute the actual argument text the
user provided after the command name, if any) so the pull request number
and any `--merge-method` flag reach the skill.
