---
name: ci:diagnose
description: "Diagnose CI failure and suggest fixes. Use when user wants to analyze a failed GitHub Actions run, understand why CI broke, or get actionable fix suggestions."
argument-hint: '[run-id] [--repo owner/name]'
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
  - AskUserQuestion
  - Task
  - Skill
model: sonnet
---

# Diagnose CI Failure

Fetch a failed GitHub Actions run, redact and match its logs against the
F01-F12 pattern library, and report root cause with fixes.

## Usage

Invoke the `Skill` tool with `skill: "ci-diagnose"`. Pass the args string
`$ARGUMENTS` (literal — substitute the actual argument text the user provided
after the command name, if any) so an optional run ID and `--repo owner/name`
override reach the skill.
