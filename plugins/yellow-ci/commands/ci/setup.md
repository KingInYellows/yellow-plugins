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
new config is written there. Enforce input validation with the executed shell
gate, not just the skill's prose: source
`${CLAUDE_PLUGIN_ROOT}/hooks/scripts/lib/validate.sh` and **invoke
`validate_ssh_host` and `validate_ssh_key_path` via Bash on every collected host
and key path before accepting it** — reject and re-prompt on a non-zero exit
(this preserves the pre-conversion `|| exit 1` gate; the skill's regex prose is
the host-neutral fallback for Codex, where the lib is unavailable).

## Usage

Invoke the `Skill` tool with `skill: "ci-setup"`, treating
`.claude/yellow-ci.local.md` as the runner SSH config path. Pass the args string
`$ARGUMENTS` (literal — substitute the actual argument text the user provided
after the command name, if any) so it reaches the skill.
