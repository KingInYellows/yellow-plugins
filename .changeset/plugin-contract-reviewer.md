---
"yellow-review": minor
---

Add `plugin-contract-reviewer` agent to detect breaking changes to plugin
public surface

Introduces `plugins/yellow-review/agents/review/plugin-contract-reviewer.md`
— a Wave 3 conditional persona reviewer (per W3.15) that flags breaking changes to a
plugin's contract: `subagent_type` renames, command/skill name renames,
MCP tool renames (the `mcp__plugin_<plugin>_<server>__<tool>` formula),
`plugin.json` schema field changes, hook output contract changes, and
frontmatter field renames or semantics changes.

Wired into `review:pr`'s Step 4 conditional dispatch table with
auto-detection on `plugins/*/.claude-plugin/plugin.json`,
`plugins/*/agents/**/*.md`, `plugins/*/commands/**/*.md`,
`plugins/*/skills/**/SKILL.md`, and `plugins/*/hooks/`. Sister to
`pattern-recognition-specialist` (yellow-core): pattern-rec catches new
convention drift; plugin-contract catches breaks to existing public
surface.

The agent extends the Wave 2 compact-return schema with two optional
per-finding fields:

- `breaking_change_class`: `name-rename | signature-change | removal |
  semantics-change`
- `migration_path`: concrete remediation string (deprecation stub,
  backwards-compat shim, version bump, etc.) or `null` when no migration
  is feasible

The keystone validator in Step 6.1 accepts these as optional extensions;
other reviewers omit them. Step 10 surfaces them in a new "Plugin
Contract Changes" section when present.

Read-only tools (`Read`, `Grep`, `Glob`) per Wave 1 reviewer rule.
Adapted from upstream `EveryInc/compound-engineering-plugin`'s
`ce-api-contract-reviewer` (snapshotted at locked SHA
`e5b397c9d1883354f03e338dd00f98be3da39f9f`) — preserves the breaking-change
classification framework, drops REST-API examples, adds plugin-specific
detection rules.

Note: README.md and the plugin CLAUDE.md "Agents (N)" line had not been
caught up to the Wave 2 persona additions (was 7, should have been 13);
this PR brings both to 14 in lockstep with the new agent.
