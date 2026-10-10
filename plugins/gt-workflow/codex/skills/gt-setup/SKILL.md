---
name: gt-setup
description: Validate Graphite CLI prerequisites and configure settings for AI agent workflows. Use when first installing the plugin, after Graphite auth changes, or when gt commands fail.
---

## What It Does

Validate Graphite prerequisites, guide AI agent settings, and create the
repository's .graphite.yml convention file and optional PR template.

## When to Use

Use after first install, authentication changes, or when gt commands stop
working in a repository that should be initialized.

## Usage

Resolve references relative to this SKILL.md in both source and installed
plugins. Read each phase's reference when that phase starts.

1. Read [references/prerequisites.md](references/prerequisites.md). Run Phase
   1's prerequisite check and interpret its printed result. Report missing
   tools, authentication, and initialization separately. Report-only requests
   end after this phase. Do not install tools or run interactive gt auth/init on
   the user's behalf without the authority described in that reference.
2. Read [references/agent-settings.md](references/agent-settings.md). Follow
   Phase 2's planned-change preview and branch-prefix/pager prompts before
   applying settings. Preserve existing values when the user chooses skip. Never
   silently replace a prefix or pager.
3. Read [references/convention-files.md](references/convention-files.md). Follow
   Phase 3's existing-file checks, overwrite/skip confirmation, exact convention
   schema, optional PR-template behavior, and final report. .graphite.yml is a
   gt-workflow convention, not Graphite CLI configuration.

Shell blocks run as fresh processes. Bind the prompted or validated values where
each block consumes them; use the complete phase-specific block. Preserve files
and settings outside the selections the user confirmed. This setup workflow does
not authorize commit, push, or PR submission.
