---
name: github-stack:amend
description: 'Fold working-tree changes into the current branch commit and re-submit via gh stack. Use when user says "amend this" or "add this to the current PR" on the github stacked-PR provider.'
argument-hint: ''
allowed-tools:
  - Bash
  - AskUserQuestion
  - Skill
---

# github-workflow Amend

Amend the current branch's commit with working-tree changes, then
re-submit via `gh stack submit` to push the update.

## Usage

Invoke the `Skill` tool with `skill: "github-stack-amend"`. Pass the args
string `$ARGUMENTS` (literal — substitute the actual argument text the
user provided after the command name, if any).
