---
title: 'Automated Bot Review False Positives: Skills Preloading and Tooling Misconceptions'
category: code-quality
date: 2026-03-08
tags:
  - automated-review
  - false-positives
  - bot-review
  - skills-preloading
  - claude-code
  - agent-authoring
  - graphite
components:
  - plugins/*/agents/*.md
  - plugins/*/skills/*/SKILL.md
pr: '#139'
related:
  - docs/solutions/code-quality/multi-agent-re-review-false-positive-patterns.md
  - docs/solutions/code-quality/skill-frontmatter-attribute-and-format-requirements.md
---

# Automated Bot Review False Positives: Skills Preloading and Tooling Misconceptions

## Problem

During the review of PR #139 (84 files, 642+/237-), 10 automated review
comments from 4 different bots (coderabbitai, codex-connector, devin-ai,
greptile-apps) made incorrect suggestions. The most prevalent false positive
(raised independently by 3 of the 4 bots) concerned the `skills:` vs `Skill`
tool relationship in Claude Code agent frontmatter.

This is distinct from the internal re-review false positive patterns documented
in `multi-agent-re-review-false-positive-patterns.md` — those are produced by
our own review agents in successive rounds. This document covers false positives
from external automated review bots that lack project-specific context.

## False Positive Patterns

### FP1: "Skill tool must be in tools: when skills: preloading is used" (3 bots)

**What 3 bots flagged:** Agent files that had `skills:` in frontmatter but did
not list `Skill` in `tools:`. The bots claimed the `Skill` tool was required to
load the skills at runtime.

**Why it's wrong:** `skills:` frontmatter preloading and the `Skill` tool are
two different mechanisms:

- `skills:` in frontmatter injects skill content at agent startup time. The
  skill body is available to the agent without any runtime tool call.
- `Skill` tool is a runtime tool that dynamically loads a skill on demand during
  execution.

When `skills:` preloading is present, including `Skill` in `tools:` is
**redundant** — the skill content is already injected. In fact, PR #139
specifically removed `Skill` from `tools:` on agents that use `skills:`
preloading, because the redundancy was identified as a cleanup target.

**Detection rule:** When a bot flags missing `Skill` in `tools:`, check whether
the agent has `skills:` in its frontmatter. If yes, the bot is wrong — dismiss
the comment.

### FP2: "gt log --json is the recommended approach" (1 bot)

**What the bot flagged:** Suggested using `gt log --json` for structured output
instead of parsing text from `gt log short --no-interactive`.

**Why it's wrong:** `gt log --json` does not exist. The `--json` flag was never
implemented in Graphite CLI. This is documented in MEMORY.md and was a known
false claim from a previous review cycle.

**Detection rule:** Any suggestion referencing `gt log --json` is automatically
a false positive. The canonical approach is `gt log short --no-interactive` with
text parsing.

### FP3: Backward compatibility warnings for internal-only CLI output

**What bots flagged:** Changes to CLI output format (table layouts, column
headers) were flagged as breaking changes requiring backward compatibility.

**Why it's wrong:** The CLI output in question is internal tooling consumed only
by human operators within this project. There are no external consumers, no
published API contract, and no semver obligation on CLI output format.

**Detection rule:** Check whether the output is consumed by external tools or
users. Internal CLI output format changes are not breaking changes.

### FP4: Informational analysis presented as actionable findings

**What bots flagged:** Several bots produced "analysis" comments that restated
what the code does without identifying any actual problem. These comments
were structured as review findings but contained no actionable suggestion.

**Detection rule:** If a bot comment describes what code does without stating
what is wrong or what should change, it is informational noise, not a finding.

## Root Cause

External automated review bots operate without project-specific context:

1. **No access to MEMORY.md** — Project conventions (like `skills:` preloading
   semantics or `gt log` limitations) are invisible to bots.
2. **No access to previous review history** — Bots cannot learn that a pattern
   was already discussed and resolved in prior PRs.
3. **Generic heuristics** — Bots apply general "best practice" rules that
   conflict with project-specific architecture decisions.
4. **Training data lag** — Bot models may not reflect recent Claude Code
   features like `skills:` frontmatter preloading.

## Impact

In PR #139, 10 of the bot comments were false positives. If acted upon:
- Re-adding `Skill` to `tools:` would have reintroduced the redundancy that
  the PR specifically cleaned up.
- Attempting `gt log --json` would have caused a runtime error.
- Adding backward compatibility shims for internal output would have added
  unnecessary complexity.

## Prevention

### Triage Protocol for Automated Bot Reviews

When reviewing bot comments on PRs that touch agent/skill files:

1. **Check `skills:` preloading first.** If the agent has `skills:` in
   frontmatter and a bot says `Skill` is missing from `tools:`, dismiss.
2. **Cross-reference MEMORY.md.** If a bot suggests a tool flag or command
   that contradicts MEMORY.md, trust MEMORY.md.
3. **Verify API/CLI existence.** Before accepting a bot suggestion to use a
   specific flag or subcommand, verify it exists (`--help`, docs, or test run).
4. **Assess consumer scope.** "Breaking change" warnings are only valid if
   there are external consumers. Internal tooling output is not a public API.
5. **Require actionable content.** Dismiss bot comments that describe what
   code does without identifying what is wrong.

### Known Bot Blind Spots (as of 2026-03)

| Topic | Bot Misconception | Reality |
| --- | --- | --- |
| `skills:` preloading | Requires `Skill` in `tools:` | `skills:` injects at startup; `Skill` tool is redundant |
| `gt log --json` | Exists and is preferred | Flag was never implemented |
| `tools:` vs `allowed-tools:` | Interchangeable | `tools:` is for agents (post-migration); `allowed-tools:` is for commands |
| Internal CLI output | Requires backward compatibility | No external consumers; format is not a contract |

## Related Documentation

- `docs/solutions/code-quality/multi-agent-re-review-false-positive-patterns.md` —
  False positives from internal review agents (different source, similar triage approach)
- `docs/solutions/code-quality/skill-frontmatter-attribute-and-format-requirements.md` —
  Canonical reference for frontmatter format rules
- `docs/solutions/code-quality/claude-code-command-authoring-anti-patterns.md` —
  ToolSearch requirements for deferred MCP tools (related but distinct from `skills:` preloading)

**MEMORY.md sections:**
- "Agent Frontmatter" — `tools:` vs `allowed-tools:` migration, `skills:` preloading rule
- "Git Workflow" — `gt log --json` does not exist
