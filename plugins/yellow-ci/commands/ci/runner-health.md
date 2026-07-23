---
name: ci:runner-health
description: "Check self-hosted runner health via SSH. Use when user asks \"runner status\", \"is runner healthy\", \"check runner\", or wants to verify infrastructure before diagnosing CI failures."
argument-hint: '[runner-name]'
allowed-tools:
  - Bash
  - Read
  - AskUserQuestion
  - Skill
---

# Runner Health Check

SSH-probe self-hosted runners for disk, memory, Docker, agent, and network
health, with deep diagnostics folded in.

## Host binding (Claude Code)

On Claude Code, the runner SSH config file is `.claude/yellow-ci.local.md`
(repo-local). Read runner details (`name`, `host`, `user`, `ssh_key`) from it; if
it is missing, point the user at the setup workflow to create it.

## Usage

Invoke the `Skill` tool with `skill: "ci-runner-health"`, treating
`.claude/yellow-ci.local.md` as the runner SSH config path. Pass the args string
`$ARGUMENTS` (literal — substitute the actual argument text the user provided
after the command name, if any) so an optional runner name reaches the skill.
