---
name: gt-setup
description: "Validate Graphite CLI prerequisites and configure settings for AI agent workflows. Use when first installing the plugin, after Graphite auth changes, or when gt commands fail."
argument-hint: ''
allowed-tools:
  - Bash
  - Read
  - Write
  - AskUserQuestion
  - Skill
---

# Set Up gt-workflow

Validate that Graphite CLI is installed, authenticated, and initialized for the
current repository. Then configure Graphite CLI settings for AI agent workflows
and generate a `.graphite.yml` convention file.

## Usage

Invoke the `Skill` tool with `skill: "gt-setup"`.
