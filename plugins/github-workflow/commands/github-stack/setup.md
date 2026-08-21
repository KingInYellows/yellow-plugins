---
name: github-stack:setup
description: 'Check GitHub-native stacked-PR prerequisites — gh CLI, authentication, and the official github/gh-stack extension. Use when first installing the plugin or when github stacked-PR tooling is unavailable.'
argument-hint: ''
allowed-tools:
  - Skill
---

# Set Up github-workflow

Verify this machine can act as the `github` provider of the `stacked-pr`
capability group: `gh` installed and authenticated, and the **official**
`github/gh-stack` extension present (verified by owner, since third-party
extensions expose the same `gh stack` command name).

This command checks prerequisites only. It performs no stack operation,
never disables Graphite, and never switches the active provider — use
`/stack:select` (yellow-core) for that.

## Usage

Invoke the `Skill` tool with `skill: "github-stack-setup"`.
