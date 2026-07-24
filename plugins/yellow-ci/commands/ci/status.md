---
name: ci:status
description: "Show recent CI workflow run status. Use when user asks \"CI status\", \"recent builds\", \"what's running\", or needs to find run IDs for diagnosis."
allowed-tools:
  - Bash
  - Skill
model: haiku
---

# Recent CI Runs

Show the most recent CI workflow runs for this repository.

## Usage

Invoke the `Skill` tool with `skill: "ci-status"`. Pass the args string
`$ARGUMENTS` (literal — substitute the actual argument text the user provided
after the command name, if any) so it reaches the skill.
