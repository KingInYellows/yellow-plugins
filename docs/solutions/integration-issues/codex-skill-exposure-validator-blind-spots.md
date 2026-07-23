---
title: 'Codex-Exposed Skills Assume Claude-Only Capabilities With No Validator Coverage'
date: 2026-07-22
category: integration-issues
track: knowledge
problem: 'Codex-exposed skills use AskUserQuestion and host-unreachable skill refs; exposure-lint catches neither'
tags:
  - codex
  - cross-host
  - exposure-lint
  - skillAllowlist
  - mcp-servers
  - validator-gap
components:
  - scripts/validate-codex.js
  - plugins/gt-workflow/codex/skills
  - plugins/gt-workflow/skills/gt-stack-plan/SKILL.md
  - plugins/gt-workflow/skills/stack-decomposition-format/SKILL.md
---

# Codex-Exposed Skills Assume Claude-Only Capabilities With No Validator Coverage

> **Canonical distribution doc:** see [Codex Distribution](../../codex-distribution.md)
> for the overall neutral-catalog model this fits into.

## Context

PR #661 converted gt-workflow into a full Claude Code + OpenAI Codex
dual-host plugin, allowlisting **all ten** skills for Codex (contrast
yellow-core, which excludes 17 of its 20 skills — see
`plugins/gt-workflow/CLAUDE.md`'s "Codex Distribution" section). A
20-persona review surfaced three related gaps, all in the same family:
Codex-exposed skill content assumes a capability or cross-plugin reference
that doesn't resolve on Codex, and `scripts/validate-codex.js`'s
exposure-lint catches none of them because it checks manifest/frontmatter
shape, not skill-body semantics.

## Guidance

### 1. Claude-only tools used as the sole confirmation gate (P1, corroborated by codex-reviewer + agent-cli-readiness-reviewer)

`AskUserQuestion` is a Claude Code tool with no documented Codex
equivalent (see the "Scope limitation" note in
`plugins/gt-workflow/CLAUDE.md`'s Testing section: confirmation gates are
"interpreted by an LLM reading the markdown ... cannot be exercised in
bats", and no Codex verification exists). PR #661 shipped 6 of gt-workflow's
10 Codex-exposed skills (`gt-cleanup` and five others) with `AskUserQuestion`
as their *sole* confirmation gate — 23 call sites total — with zero
verification of what happens when a Codex session reaches that point, and
zero validator coverage flagging a Claude-only tool name inside a
Codex-allowlisted skill body.

### 2. Advisory text pointing at a skill excluded from the target host's allowlist (P2, project-standards-reviewer)

`gt-stack-plan/SKILL.md` and `stack-decomposition-format/SKILL.md` both
reference yellow-core's `workflows:work` skill as a next step — but
yellow-core's Codex `skillAllowlist` excludes `workflows:work` (see
`docs/solutions/integration-issues/codex-distribution-pipeline-silent-gaps.md`
for yellow-core's narrow allowlist rationale). Not a broken `Skill` tool
*invocation* (it's prose, not a call) — but a Codex user following that
advisory hits a skill their host can't reach.

### 3. Exposure-lint's own MCP-tool registry silently narrows for the pattern this PR introduced (P2, codex-reviewer)

`buildMcpToolNameRegistry` (`scripts/validate-codex.js`) skips any plugin
whose `mcpServers` field is a file-pointer string — exactly the
shared-`.mcp.json` pattern gt-workflow's own `plugin.json` uses (see
`plugins/gt-workflow/CLAUDE.md`'s MCP Server section: `mcpServers` points at
`"./.mcp.json"` rather than inlining the server def). The registry only
resolves inline `mcpServers` objects, so any plugin adopting the new
shared-file convention drops out of the exposure-lint's MCP-tool-name
coverage without any error or warning.

## Why This Matters

All three gaps pass every automated gate (`pnpm validate:codex`,
`pnpm generate:manifests`, schema validation) — they surfaced only through
multi-agent review, not CI. gt-workflow's decision to allowlist its entire
skill surface (rather than yellow-core's narrow read-only slice) is what
made gap #1 visible at scale (23 call sites vs. yellow-core's near-zero
exposure); a plugin with a narrower Codex allowlist could carry the same
defect invisibly for a long time.

## When to Apply

Before allowlisting a skill for Codex (`targets.codex.skillAllowlist` in
`catalog/plugins/<name>.json`):

- Grep the skill body for Claude-only tool names (`AskUserQuestion`, `Task`
  used for cross-plugin Claude-agent dispatch) — there is no automated
  check for this today; it is a manual review step.
- If the skill's prose references another plugin's skill by name, confirm
  that skill is in the *target* plugin's own `skillAllowlist`, not just that
  it exists.
- If the plugin declares `mcpServers` as a file pointer (`"./.mcp.json"`)
  rather than an inline object, verify manually that its MCP tool names are
  actually covered by `pnpm validate:codex`'s exposure-lint — as of this
  writing, `buildMcpToolNameRegistry` does not resolve file pointers.

## Related Documentation

- `docs/solutions/integration-issues/codex-plugin-manifest-and-hook-contract.md`
  — primary-source facts about Codex's plugin/hook contract (this doc is
  about review-discovered gaps in how a specific plugin used that contract,
  not the contract's own facts)
- `docs/solutions/integration-issues/codex-distribution-pipeline-silent-gaps.md`
  — a sibling set of silent generator/validator gaps found during
  yellow-core's Codex onboarding (skillAllowlist/componentPaths asymmetry,
  sidecar-file rejection)
