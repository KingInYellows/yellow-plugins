---
name: gt-nav
description: 'Visualize your Graphite stack and navigate between its branches. Use when user says "show my stack", "where am I in the stack", "go up/down a branch", or "checkout the top of the stack". Not for restacking, syncing, or cleanup — use /gt-sync or /gt-cleanup.'
argument-hint: '[--pr | --top | --bottom]'
allowed-tools:
  - Bash
  - AskUserQuestion
  - Skill
---

# Stack Navigator

Visualize your current Graphite stack and quickly navigate between branches.

## Usage

Invoke the `Skill` tool with `skill: "gt-nav"`.
