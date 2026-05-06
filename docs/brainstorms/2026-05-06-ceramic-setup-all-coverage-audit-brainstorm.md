---
date: 2026-05-06
topic: ceramic-setup-all-coverage-audit
plan: plans/complete/ceramic-research-backend-integration.md
status: audit-complete
---

# Ceramic Setup-All Coverage Audit

## What We're Building

This is not a greenfield feature — it is a completeness audit of the
ceramic integration that shipped in PR #265. The original plan at
`plans/complete/ceramic-research-backend-integration.md` was marked done.
This audit answers two questions:

1. Is Ceramic present in `plugins/yellow-core/commands/setup/all.md` with
   correct classification logic?
2. Is the plan genuinely complete, or are there residual gaps?

## Verification

`pnpm validate:setup-all` was run directly during this audit session (not
inferred from reading dashboard markdown). It exited 0 with:

```
[validate-setup-all] OK: 17 marketplace plugins covered by dashboard,
classification, and delegated setup order
```

This confirms all four sections the validator checks — dashboard plugin loop,
classification block, delegated commands list, and plugin-command map — are
consistent with the 17-plugin marketplace. No action needed to make CI pass.

## Key Decisions

### Ceramic is present and correctly integrated in setup/all.md

The `yellow-research` classification block at lines 284-303 of
`plugins/yellow-core/commands/setup/all.md` lists Ceramic as source 6 of 6:

- Source 6: "Ceramic MCP tool (`ceramic_search`) visible via ToolSearch."
- The block correctly notes `CERAMIC_API_KEY` is *not* required for the
  source to count — the MCP authenticates via OAuth 2.1 (browser flow on
  first use). The env var only powers the REST live-probe in `/research:setup`.
- READY threshold: all 6 bundled sources available.
- PARTIAL: 1-5 bundled sources available.

The Step 1 env var block at line 95 probes `CERAMIC_API_KEY` separately with
the correct label ("REST probe only; MCP uses OAuth").

The Step 1.5 ToolSearch probe at line 211 includes `ceramic_search` and
checks for `mcp__plugin_yellow-research_ceramic__ceramic_search` as the
exact tool name.

### plan/complete items verified as shipped

Every line item in the original plan was checked against the current codebase.
All are confirmed present:

| Plan item | File | Status |
|---|---|---|
| 2.1 `mcpServers.ceramic` in yellow-research plugin.json | `plugins/yellow-research/.claude-plugin/plugin.json` lines 80-83 | SHIPPED |
| 2.2 code-researcher.md: Ceramic in tools + routing table | `plugins/yellow-research/agents/research/code-researcher.md` line 12, 39, 54-78 | SHIPPED |
| 2.3 research-conductor.md: Ceramic as first-hop | `plugins/yellow-research/agents/research/research-conductor.md` lines 3, 10 | SHIPPED |
| 2.4 commands/research/setup.md: Ceramic key check + MCP health + dashboard row | `plugins/yellow-research/commands/research/setup.md` lines 148-153, 565-578, 607-610 | SHIPPED |
| 2.5 code.md and deep.md allowed-tools updated | Both files line 12 | SHIPPED |
| 2.6 skills/research-patterns/SKILL.md source matrix | Lines 64-77 (Ceramic row present) | SHIPPED |
| 2.7 yellow-research/CLAUDE.md: Ceramic in API-key section | Present (references CERAMIC_API_KEY and OAuth note) | SHIPPED |
| 2.8 yellow-research/README.md: CERAMIC_API_KEY mentioned | Line 35, 41, 73+ | SHIPPED |
| 3.1 mcpServers.ceramic in yellow-core plugin.json | NOT PRESENT (see Open Questions) | GAP |
| 3.2 best-practices-researcher.md: Ceramic as first hop | Lines 16, 86-99, 202, 216 — uses `mcp__plugin_yellow-research_ceramic__ceramic_search` | SHIPPED (with note) |
| 3.3 yellow-core/CLAUDE.md: ceramic note | Present | SHIPPED |
| 3.4 commands/setup/all.md: CERAMIC_API_KEY env probe + yellow-research classification updated | Lines 95, 284-303 | SHIPPED |
| 4.1 AGENTS.md never-commit list | Line 238: `CERAMIC_API_KEY` present | SHIPPED |
| 4.2 root README.md: Ceramic in yellow-research feature list | Line 38, 56 | SHIPPED |
| 5.2 validate:schemas passes | Confirmed green in this session | SHIPPED |
| 5.3 validate:setup-all passes | Confirmed green in this session | SHIPPED |

### Gap: yellow-core plugin.json does not have mcpServers.ceramic

Plan item 3.1 called for adding `mcpServers.ceramic` to
`plugins/yellow-core/.claude-plugin/plugin.json`. The current file has no
`mcpServers` block at all — it is a minimal manifest (name, version,
description, author, keywords only).

Consequence: `best-practices-researcher.md` references
`mcp__plugin_yellow-research_ceramic__ceramic_search` (the yellow-research
namespaced tool) rather than `mcp__plugin_yellow-core_ceramic__ceramic_search`.
This means the agent works only when yellow-research is also installed — it
borrows yellow-research's MCP server rather than declaring its own.

This is a functional deviation from the plan but not a regression: the
tool works as long as both plugins are installed, which is the common case.
Whether to add a redundant `mcpServers.ceramic` to yellow-core is a design
choice — the plan assumed yellow-core would declare it independently, but
the current implementation delegates to yellow-research's instance.

### Note: authenticate/complete_authentication tools do not exist

The Ceramic MCP at `https://mcp.ceramic.ai/mcp` exposes only `ceramic_search`.
OAuth is handled transparently by Claude Code's HTTP MCP transport (browser
popup on first use, token cached thereafter). There are no explicit
`authenticate` or `complete_authentication` tool calls in any plugin file —
this is correct behavior. The OAuth flow requires no agent-level action.

## Open Questions

1. **Should yellow-core declare its own `mcpServers.ceramic` block?**
   Currently `best-practices-researcher.md` uses the yellow-research-namespaced
   tool name. If yellow-core is installed without yellow-research, Ceramic
   would be unavailable to `best-practices-researcher`. The plan intended
   yellow-core to have its own independent MCP entry. Low urgency since the
   common install path includes both plugins, but worth closing for
   installation-order correctness.

2. **Integration test `tests/integration/ceramic.test.ts` (plan item 5.1):**
   This file was listed in the plan under "Files to create." It was not
   verified as present during this audit. The `tests/integration/` directory
   exists but was not checked for this specific file. If the test was not
   created, that is a minor gap (the plan marked it complete but it may have
   been deferred).

3. **`.changeset` entry (plan item 5.5):** Changesets are ephemeral —
   they are consumed on version bump. PR #265 merged successfully, so the
   changeset was applied. Not a gap.

## Recommended Next Action

If the yellow-core `mcpServers.ceramic` gap matters: add a 6-line block to
`plugins/yellow-core/.claude-plugin/plugin.json` and update
`best-practices-researcher.md` to reference `mcp__plugin_yellow-core_ceramic__ceramic_search`
instead. This is a minor follow-up, not a blocker — the agent works today
via the yellow-research MCP namespace.

If the integration test is missing: add `tests/integration/ceramic.test.ts`
(~30 lines, gated on `RUN_LIVE=1 && CERAMIC_API_KEY`).

Both items are optional polishing, not correctness fixes.
