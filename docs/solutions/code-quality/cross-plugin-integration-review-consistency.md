---
title: "Cross-Plugin Integration Review Consistency"
category: code-quality
date: 2026-04-02
tags:
  - credential-redaction
  - cross-plugin
  - claude-md
  - changeset-versioning
  - review-comments
components:
  - plugins/yellow-codex/agents/research/codex-analyst.md
  - plugins/yellow-codex/agents/review/codex-reviewer.md
  - plugins/yellow-codex/agents/workflow/codex-executor.md
  - plugins/yellow-codex/commands/codex/setup.md
  - plugins/yellow-core/CLAUDE.md
  - plugins/yellow-review/CLAUDE.md
  - .changeset/add-yellow-codex.md
pr: "#239"
related:
  - docs/solutions/code-quality/plugin-review-defensive-authoring-patterns.md
  - docs/solutions/code-quality/session-level-review-command-patterns.md
---

# Cross-Plugin Integration Review Consistency

## Problem

PR #239 (yellow-codex plugin) introduced a new plugin with 3 agents and several
commands that wrap the OpenAI Codex CLI. Seven review comments from CodeRabbit
and Devin identified three categories of inconsistency that commonly arise when
a plugin introduces cross-plugin integration points.

## Context

The yellow-codex plugin wraps `codex exec` for code review, rescue (debugging),
and analysis. It integrates with two existing plugins:
- **yellow-review**: `review:pr` optionally spawns `codex-reviewer` for PRs
  with >100 line diffs
- **yellow-core**: `workflows:work` optionally spawns `codex-executor` when
  tests fail

The `codex:review` command already had proper credential redaction using surgical
`awk gsub`, but three agents in the same plugin had either no redaction or
inconsistent format.

## Patterns

### 1. Credential redaction must be consistent across all output paths

When a plugin has a canonical redaction approach (e.g., `awk gsub` with 8
credential patterns in `codex:review`), every agent and command that returns
external tool output must use the same approach. In PR #239:

- `codex-analyst.md` had **no** redaction before returning Codex output
- `codex-reviewer.md` had **no** redaction before fencing findings
- `codex-executor.md` used `sed 's/sk-.*/***REDACTED***/g'` instead of the
  repo-standard `--- redacted credential at line N ---` format

**Fix**: Added `awk gsub` redaction steps to all three agents with the full
8-pattern set (OpenAI keys, project keys, GitHub tokens, PATs, AWS keys, Bearer
tokens, Authorization headers, PEM blocks).

**Detection**: After writing any command that redacts output, grep the plugin
for all output paths: `grep -rn 'REDACTED\|redact\|sanitiz' plugins/<name>/`.
Every hit should use the same format.

### 2. Cross-plugin CLAUDE.md documentation requires bilateral updates

When plugin A spawns an agent from plugin B, **both** plugins' CLAUDE.md files
need updating:

- **Consumer plugin** (the one doing the spawning): Update its cross-plugin
  agent references section to document the new agent, its activation condition,
  and degradation behavior
- **Provider plugin** (the one being spawned from): Update its optional plugin
  dependencies section to document who calls it and what happens without it

In PR #239, `review:pr` (yellow-review) spawns `codex-reviewer` and
`workflows:work` (yellow-core) spawns `codex-executor`, but neither plugin's
CLAUDE.md documented these new integration points.

**Detection**: When a PR adds `Task(subagent_type="<other-plugin>:...")` to any
command, check both plugins' CLAUDE.md for the integration reference.

### 3. Changeset bump types for optional cross-plugin capabilities are minor

Adding an optional capability that silently degrades when a dependency is absent
is still an **additive change** (minor), not a patch. Per CONTRIBUTING.md:
- `minor` = new command, new skill, new agent, or any additive change
- `patch` = bug fix, behavior correction, documentation update

The optional nature of the integration doesn't reduce the bump type. If a user
updates and gains new behavior (even conditionally), that's minor.

### 4. Markdown code blocks in command files need language identifiers

Fenced code blocks containing terminal/display output should use ` ```text `
(not bare ` ``` `). This satisfies MD040 (markdownlint) and helps syntax
highlighters. Three instances in `setup.md` had bare fences.

## Resolution

All 7 comments were resolved by spawning parallel `pr-comment-resolver` agents
(one per thread). All 7 targeted different files, so no merge conflicts arose.
Changes were committed via `gt modify` and pushed via `gt submit
--no-interactive`. All 7 GitHub threads were marked resolved via GraphQL.

## Checklist for Future Cross-Plugin PRs

- [ ] Grep for all credential output paths; verify consistent redaction format
- [ ] Check consumer plugin CLAUDE.md for cross-plugin agent references
- [ ] Check provider plugin CLAUDE.md for optional dependency entry
- [ ] Verify changeset bump type is `minor` for additive capabilities
- [ ] Run `markdownlint` or check for bare fenced code blocks
