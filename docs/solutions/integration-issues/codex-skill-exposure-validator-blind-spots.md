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

---

## Update — 2026-09-05

### 4. The general shape: a skill's frontmatter and orchestrator are a contract the body doesn't restate — until the skill leaves the host that enforced it

PR #770 (yellow-review's thermonuclear-review skill, exposed to Cursor and
Codex alongside Claude) generalizes findings 1-3 above beyond "Claude-only
tool names" to the full set of guarantees a Claude-only orchestrator or
Claude Code's own frontmatter parser silently supplied and that the skill
body never had to state:

- **Input contract.** On Claude, `review:pr` (or whatever invoked the
  skill) determined "the change set" and handed it to the skill. Standalone
  on Cursor/Codex, nothing defines what "the change set" is, what takes
  precedence if multiple candidates exist, or how a clean-review outcome is
  distinguished from "no input was supplied at all." A skill built for
  orchestrator-fed input needs an explicit Inputs section with precedence
  rules and a named "no input supplied" branch before it ships standalone.
- **Fenced/trusted input.** On Claude, reviewed diff content reaching the
  rubric was implicitly bounded by conventions enforced elsewhere in the
  pipeline. On a host with no such pipeline, a hostile diff reaches the
  rubric unfenced unless the skill body itself states the hardening rules
  inline — including the sharper version of the standard fencing rule: a
  line that merely *looks like* a fence closer is still inside the fence,
  and secrets found in quoted excerpts must never be echoed back.
- **Invocation opt-out.** `user-invocable: false` is a Claude Code
  frontmatter field; PR #770 found the manifest generator strips it for
  other hosts. On a host that selects skills by description text rather
  than an honored opt-out flag, the description is the *only* portable
  control over whether a host applies an opt-in-only rubric implicitly.
  Reword the description for explicit-invocation-only semantics; don't
  rely on a frontmatter field that may not survive generation.
- **Output-field semantics defined only in a file that never ships.**
  `confidence`/`pre_existing`/`requires_verification` in PR #770's output
  schema had their meaning documented only in the Claude-only agent file
  — never distributed to Cursor/Codex. Same failure shape for any
  structured-output-format rule (PR #770's `<file-line-counts>` block):
  if the format is only defined in a file that doesn't ship to the new
  host, the rule is inert there, and — worse — invisibly so, since nothing
  fails loudly when a forged block inside reviewed content satisfies a
  check nobody is actually running.
- **Distributed paths must resolve after install, not just in-repo.** A
  repo-relative path (e.g. into a `RESEARCH/` directory) that resolves
  fine in this repo's checkout dangles once the skill is copied to an
  install target — the same shape as `codex-distribution-pipeline-silent-
  gaps.md`'s sidecar-file constraint, but for path references inside prose
  rather than sidecar files on disk. Use a URL or otherwise
  install-independent reference instead.

**Action:** when a skill is granted a new distribution target, don't audit
only for Claude-only *tool names* (finding 1's original scope). Audit
every place the skill body currently relies on something the removed
host used to supply — input source, fencing/trust boundary, invocation
gating, output-field semantics, structured-format definitions, and
in-repo-relative paths — and restate each explicitly in the body. The
description field is the only one of these controls that reliably
survives generation to every host.

### 5. Enabling a new distribution target has a fixed doc-inventory checklist that no validator covers

Separately from the skill-body audit above, PR #770 found that exposing a
plugin to a new host requires updating a fixed set of documents whose
cross-host inventories otherwise go stale silently: both distribution docs
(`docs/codex-distribution.md`, `docs/cursor-distribution.md`), the root
`README.md`, `AGENTS.md`, and the plugin's own `CLAUDE.md` (every other
Codex/Cursor-enabled plugin documents its exposure there; the omission was
inconsistent with the rest of the repo, not merely undocumented). No
validator scans these two distribution docs for "N plugins support this
host" claims — see `codex-distribution-pipeline-silent-gaps.md` for the
sibling class of generator/CI gaps that share this "invisible until
someone reads the doc" shape. Adding a plugin to a distribution target
without a checklist pass over all five locations reliably produces stale
canonical-count claims ("the three Codex plugins", "sole Cursor-enabled
plugin") that persist until the next unrelated PR happens to notice.

**Action:** treat "enable plugin X for host Y" as touching six things, not
one: the catalog source, and the five doc locations above. Grep for the
plugin-count phrasing in both distribution docs before merging any PR that
changes a `targets.<host>.enabled` value.

### 6. A byte-identity test that strips frontmatter before comparing cannot verify frontmatter normalization

PR #770's cross-host test asserted the skill body was "normalised to
name+description" across hosts by stripping frontmatter from both sides
before comparing — which means the test could not fail no matter what the
generator did to frontmatter, because the field under test was removed
before the assertion ran. The same review pass found the test also left
the parent host directory and the manifest's `agents`/`commands`
absence unchecked, and iterated `readdirSync` results without sorting
first (nondeterministic key order across filesystems). General lesson:
when a test's stated claim is about a transformation of field X, adding a
step that strips or normalizes X before the comparison silently converts
the test into a no-op for that claim — audit what a "normalize before
compare" step actually discards before trusting the test's name.
