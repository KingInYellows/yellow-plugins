---
name: github-stack:submit
description: 'Stage, commit, and submit uncommitted changes as a GitHub-native stacked PR. Use when user says "submit this" or "ship it" on the github stacked-PR provider and has uncommitted work to turn into a PR.'
argument-hint: '[--open]'
allowed-tools:
  - Skill
---

# github-workflow Submit

Stage specific changed files, create a conventional commit, and submit the
branch via `gh stack submit` (draft by default).

## Usage

Invoke the `Skill` tool with `skill: "github-stack-submit"`. Pass the args
string `$ARGUMENTS` (literal — substitute the actual argument text the user
provided after the command name, if any) so a flag like `--open` reaches
the skill.
