---
name: gt-stack-plan
description: "Decompose a feature into stacked PRs, ordered by dependency (plan-only). Use when breaking a feature into reviewable stacked PRs."
argument-hint: '[feature-description or plan-file-path]'
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - Task
  - AskUserQuestion
  - Skill
---

# Stack Plan

Given a feature description, break it into a plan of stacked PRs ordered by
dependency. Each PR in the stack builds on the previous one, keeping changes
small and reviewable.

## Usage

Invoke the `Skill` tool with `skill: "gt-stack-plan"`.
