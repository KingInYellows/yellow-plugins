---
name: github-stack:status
description: 'Report GitHub-native stacked-PR provider readiness — tooling state plus a pointer to the authoritative active-provider answer. Use when checking whether gh stack tooling is usable.'
argument-hint: ''
allowed-tools:
  - Bash
  - Skill
---

# github-workflow Status

Read-only readiness report for the `github` provider of the `stacked-pr`
capability group.

Tooling presence and provider activation are separate questions. This
command answers the first; `/stack:status` (yellow-core) answers the second
by reading `claude plugin list --json`. Having `gh` and `github/gh-stack`
installed does not make this the enabled provider.

## Usage

Invoke the `Skill` tool with `skill: "github-stack-status"`.
