---
name: ci:lint-workflows
description: "Lint GitHub Actions workflows for self-hosted runner issues. Use when user wants to check workflows before pushing, asks \"lint CI\", \"check workflows\", or wants to find common pitfalls in their GitHub Actions configuration."
argument-hint: '[workflow-file.yml]'
allowed-tools:
  - Bash
  - Read
  - Glob
  - Grep
  - Edit
  - AskUserQuestion
  - Skill
---

# Lint GitHub Actions Workflows

Lint `.github/workflows/` files for self-hosted-runner pitfalls (W01-W14),
with a preview-and-confirm gate before any auto-fix.

## Usage

Invoke the `Skill` tool with `skill: "ci-lint-workflows"`. Pass the args string
`$ARGUMENTS` (literal — substitute the actual argument text the user provided
after the command name, if any) so an optional workflow-file path reaches the
skill.
