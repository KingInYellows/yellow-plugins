---
name: github-stack:plan
description: 'Report the current GitHub-native stack structure (read-only). Use when checking what branches/PRs are in the stack before submitting or merging.'
argument-hint: ''
allowed-tools:
  - Skill
---

# github-workflow Plan

Read-only stack view for the `github` provider of the `stacked-pr`
capability group — reports the current stack structure without making any
changes.

## Usage

Invoke the `Skill` tool with `skill: "github-stack-plan"`.
