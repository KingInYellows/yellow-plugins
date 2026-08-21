---
name: github-stack:nav
description: 'Check out a stack target — stack number, PR number, PR URL, or branch. Use when user says "go to PR 42" or "show my stack and let me pick" on the github stacked-PR provider.'
argument-hint: '[target]'
allowed-tools:
  - Skill
---

# github-workflow Nav

Check out a specific stack target via `gh stack checkout`. Lists the
current stack and asks which target when none is given.

## Usage

Invoke the `Skill` tool with `skill: "github-stack-nav"`. Pass the args
string `$ARGUMENTS` (literal — substitute the actual argument text the
user provided after the command name, if any) as the target.
