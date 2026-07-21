---
name: smart-submit
description: 'Stage, audit, commit, and submit uncommitted changes via Graphite, with parallel code-review agents. Use when user says "submit this", "ship it", or "commit and push", or has uncommitted work to turn into a PR. Requires uncommitted changes — a clean, already-committed branch needs only gt submit; amending an already-submitted branch is /gt-amend.'
allowed-tools:
  - Bash
  - Read
  - Glob
  - Grep
  - Task
  - AskUserQuestion
  - Skill
---

# Smart Submit (Graphite Edition)

Conducts a systematic code quality audit of all uncommitted changes using
specialized agents, then creates a conventional commit and submits via Graphite.
Ensures no anti-patterns, secrets, or silent failures enter the codebase.

## Usage

Invoke the `Skill` tool with `skill: "smart-submit"`.
