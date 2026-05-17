# Brainstorm: library-context Skill Architecture

**Date:** 2026-05-17
**Scope:** SKILL.md architecture only — orchestrator pre-warming is a deferred follow-on
**Research base:** `docs/research/cross-plugin-shared-skill-architecture-f.md`

---

## What We're Building

A single canonical `SKILL.md` at
`plugins/yellow-research/skills/library-context/SKILL.md` that defines:

- Context7 availability detection (via ToolSearch, because context7 is a
  user-level optional MCP since 2026-04)
- A three-step fallback chain: context7 → `mcp__plugin_yellow-research_exa__get_code_context_exa` → built-in WebSearch
- Citation format for library docs retrieved from any level of the chain
- Version-pinning conventions (when to pin, when to use "latest")
- When NOT to call (cached results, query types that context7 does not serve)

Within yellow-research, the two agents that currently duplicate this logic
(`code-researcher.md` and `yellow-core:agents/research/best-practices-researcher.md`)
are refactored to preload the skill via `skills:` frontmatter. For all other
plugins, consumers inline a verbatim copy of the detection + fallback block
(identical to how `security-fencing` propagates across 34 agents in 5 plugins).

The skill itself is layer-agnostic: it does not care whether a coding agent
calls it ad-hoc or an orchestrator pre-warms results before spawning subagents.

---

## Why This Approach

Cross-cutting concerns drift when re-implemented per agent. The two existing
agents already show divergence: `code-researcher.md` routes by query type and
documents seven source categories; `best-practices-researcher.md` uses a
four-phase methodology with a deprecation-check phase. Both embed the same
ToolSearch availability check and the same "context7 is optional since 2026-04"
explanation — prose that will drift independently as context7 evolves.

The `pr-review-workflow` skill in yellow-review is the structural precedent for
cross-agent shared conventions: one canonical file became the single source of
truth for review conventions across multiple reviewers and plugins. The
`security-fencing` skill in yellow-core is the exact operational precedent for
the inline-copy propagation pattern this brainstorm adopts.

Shipping the skill in yellow-research (not yellow-core) is correct because the
EXA fallback — `mcp__plugin_yellow-research_exa__get_code_context_exa` — is a
yellow-research MCP tool. Domain ownership follows tool ownership. yellow-core
would be viable only if the fallback chain terminated at built-in WebSearch
exclusively, but that weakens the fallback quality for within-yellow-research
consumers unnecessarily.

---

## Non-Negotiables (Platform Facts — Not Design Choices)

These were open questions before the research round; they are now resolved facts
that constrain implementation.

**1. Cross-plugin `skills:` frontmatter is a closed non-starter.**
`anthropics/claude-code#15944` was closed "not planned." The skill resolver is
intentionally plugin-scoped. This resolves the original open question ("yellow-research
vs yellow-core") differently than expected: the home choice does NOT affect
cross-plugin consumers — they all must inline regardless. The home only affects
within-plugin consumers (i.e., agents inside yellow-research itself).

**2. The security-fencing pattern is the precedent to follow exactly.**
Canonical SKILL.md + inlined verbatim copies in consumer agents + machine-
verifiable drift detection via `rg`. Defer `skills:` injection until
`anthropics/claude-code#21891` (skill dedup in parallel spawns) resolves.
Do not migrate consumers to frontmatter preload until that issue closes.

**3. Do not re-bundle context7 in any plugin.json.**
CE PR #486 (2026-04-29) removed the yellow-core context7 bundle specifically to
fix OAuth dual-registration pop-ups on install. Re-bundling recreates that
regression. Context7 must remain user-level only: `context7@upstash` installed
once globally. The skill must document this and must NOT add context7 to any
plugin's `mcpServers` block.

**4. The fallback chain terminator must be a built-in tool.**
Cross-plugin consumers (yellow-debt, yellow-semgrep, yellow-codex, etc.) may not
have yellow-research installed. The safe chain terminator is built-in `WebSearch`
— always available regardless of plugin installation. `mcp__plugin_yellow-research_perplexity__*`
and other yellow-research MCP tools must NOT appear in the inlined block that
cross-plugin consumers copy. Within yellow-research, the full EXA chain is fine;
the inlined cross-plugin excerpt must use WebSearch as the terminal fallback.

**5. Context7 tool name must be verified post-install via ToolSearch.**
`code-researcher.md` uses `mcp__context7__query-docs`. Glama.ai documentation
describes `get-library-docs`. The names differ. The SKILL.md must document the
verified tool name AND instruct consumers to confirm via ToolSearch before
hardcoding in their `tools:` list. The skill should use ToolSearch at runtime
rather than assuming the name, and document both candidate names.

**6. yellow-research is the correct home. Decision is final.**
Rationale above (tool ownership). The skill lives at
`plugins/yellow-research/skills/library-context/SKILL.md`.
Within yellow-research, consumers load it via `skills: [library-context]`.
All other plugins inline the fallback block verbatim.

---

## Key Decisions

### Decision 1: Inline propagation, not `skills:` frontmatter for cross-plugin

**Chosen:** Verbatim inline copy in each consumer agent, matching the
security-fencing pattern.

**Rejected:** Cross-plugin `skills:` — platform closed this (finding #1).
**Rejected:** Prose reference only ("see library-context skill") — provides no
runtime guidance to the agent; the block must be present in the agent's context.

**Drift detection requirement:** Every consumer agent's inlined block must
contain the exact phrase:

```
context7 unavailable — falling back to
```

This phrase is detectable by:

```bash
rg "context7 unavailable — falling back to" plugins/
```

Any agent that inlines the block but edits this phrase will fail the grep.
Future follow-up: promote this to a `validate-agent-authoring.js` rule (RULE 13
or similar) so CI enforces it. This is not in scope for the initial SKILL.md PR
but should be noted as a tracking item.

### Decision 2: Fallback chain has two published forms

**Within yellow-research (full chain):**
context7 →
`mcp__plugin_yellow-research_exa__get_code_context_exa` →
`mcp__plugin_yellow-research_exa__web_search_exa` →
built-in WebSearch

**Cross-plugin inlined excerpt (safe chain):**
context7 → built-in WebSearch

The SKILL.md documents both forms explicitly. The "Cross-plugin consumer" section
specifies which block to copy verbatim. This prevents consumers from accidentally
copying the EXA step into a plugin that does not have yellow-research installed.

### Decision 3: user-invokable: true

The skill is user-invokable (`user-invokable: true`) so users can call
`/skill library-context` directly to run a one-off library lookup. Internal
helper behavior coexists with user-facing invocability — the skill description
must clearly convey both uses in a single line (AGENTS.md constraint: no
multi-line descriptions).

### Decision 4: Caching hook is out of scope but the design leaves room

The Approach B that scored second in ideation — SessionStart hook + warm cache
at `.claude/context7-cache.json` — was not selected for this PR. However,
the fallback chain in the SKILL.md should be written so the first step can later
become "check cache, then call context7" without restructuring the chain. Concretely:
do not hard-code `resolve-library-id` as step 1; write it as "query context7
(or cache if available)" so the hook can be dropped in later.

### Decision 5: Refactor scope for initial PR

Initial PR refactors exactly these two agents to use `skills: [library-context]`
via frontmatter (within-plugin consumers):
- `plugins/yellow-research/agents/research/code-researcher.md`
- `plugins/yellow-core/agents/research/best-practices-researcher.md`
  (note: lives in yellow-core, must inline — cannot use frontmatter preload)

All other plugins (yellow-debt, yellow-semgrep, yellow-codex, yellow-docs,
yellow-review, yellow-council, yellow-devin, yellow-browser-test) are opt-in
and tracked as follow-up issues. The brainstorm does not prescribe their
adoption timeline.

---

## Open Questions

1. **Context7 canonical tool name.** Verify post-install: is the query tool
   `mcp__context7__query-docs` or `mcp__context7__get-library-docs`? The SKILL.md
   should document both candidate names and instruct consumers to run ToolSearch.
   Owner: whoever writes the SKILL.md — run a real install to confirm before
   merging.

2. **validate-agent-authoring.js RULE 13 — drift detection lint.**
   Should the `rg "context7 unavailable — falling back to"` check be promoted to
   a CI rule that fails if any agent file names context7 in its `tools:` list but
   lacks the sentinel phrase? This would prevent silent drift without requiring
   manual audit. Deferred — file as a separate issue after the SKILL.md lands.

3. **best-practices-researcher.md home conflict.**
   This agent lives in yellow-core but the skill lives in yellow-research.
   Cross-plugin `skills:` is closed, so the agent must inline the block.
   Confirm: does yellow-core's best-practices-researcher need the full EXA chain
   or the safe (WebSearch-terminal) chain? Answer depends on whether yellow-research
   is a declared dependency of yellow-core. Current evidence: no explicit
   inter-plugin dependency mechanism exists in plugin.json. Default to safe chain.

4. **Citation format standardization.**
   The two existing agents cite sources differently. The SKILL.md should define
   a single citation format (e.g., `[library@version via context7]`,
   `[exa: <url>]`, `[web: <url>]`). Propose a format in the SKILL.md PR and
   treat it as a convention, not a validator rule.

---

## Out of Scope / Future Work

**Orchestrator pre-warming (deferred follow-on brainstorm).**
During ideation, three models for which agent layer calls context7 were
identified:

- Model A: Coding agents call directly (current pattern — ad-hoc, just-in-time)
- Model B: Orchestrator pre-resolves library IDs once, injects syntax into all
  spawned subagents (one resolve per workflow, consistent context)
- Model C: Hybrid — orchestrator pre-warms common deps; spawned agents retain
  the inlined skill for ad-hoc lookup

The skill itself is layer-agnostic and works correctly regardless of which model
is adopted. Orchestrator pre-warming design is deferred to a follow-on brainstorm
targeting `/workflows:work` (yellow-core), `/codex:rescue` (yellow-codex), and
the Devin orchestrator commands in yellow-devin. No current workflow orchestrator
in this repo pre-warms library context; Model A is the only active pattern today.

**Approach B — SessionStart cache hook.**
Scored second in the ideation pass. Not in scope for this PR. The fallback chain
is written cache-compatible (see Decision 4) so this can be layered on later.

**Opt-in adoption for 8 additional plugins.**
yellow-codex, yellow-debt, yellow-docs, yellow-review, yellow-semgrep,
yellow-devin, yellow-council, yellow-browser-test all have agents that could
benefit. Adoption is tracked as follow-up; this PR ships the SKILL.md and
refactors the two agents with duplicated logic.
