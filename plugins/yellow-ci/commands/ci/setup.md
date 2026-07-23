---
name: ci:setup
description: "Check CI prerequisites and configure self-hosted runner SSH config. Use when first installing the plugin, after adding runners, or when ci commands fail with auth or connectivity errors."
argument-hint: ''
allowed-tools:
  - Bash
  - Read
  - Write
  - AskUserQuestion
  - Skill
---

# Set Up yellow-ci

Verify prerequisites and optionally configure the self-hosted runner SSH config.

## Host binding (Claude Code)

On Claude Code, the plugin's runner SSH config file is
`.claude/yellow-ci.local.md` (repo-local). Existing-config detection reads it;
new config is written there. The stricter shell validators live in
`${CLAUDE_PLUGIN_ROOT}/hooks/scripts/lib/validate.sh` (`validate_ssh_host`,
`validate_ssh_key_path`, …) and may be sourced to double-check collected inputs.

## Usage

Invoke the `Skill` tool with `skill: "ci-setup"`, treating
`.claude/yellow-ci.local.md` as the runner SSH config path. Pass the args string
`$ARGUMENTS` (literal — substitute the actual argument text the user provided
after the command name, if any) so it reaches the skill.
