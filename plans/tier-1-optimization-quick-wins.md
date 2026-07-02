# Feature: Tier 1 Optimization Quick Wins (C1–C5)

Source: `docs/optimization/analysis.md` §4 Tier 1 (approved 2026-07-01).
Detail level: STANDARD. Doc-only changes — no scripts, hooks, schemas, or CI
behavior change. Every item below is independently revertible.

## Problem Statement

The Phase 1 benchmark against compound-engineering-plugin (CE) and turbo found
five low-risk defects in the plugin system's self-description layer: weak or
boilerplate skill descriptions, missing disambiguation between confusable
surfaces, two stale skill catalogs, a skill that violates its own size rule,
and a false validator-enforcement claim in root CLAUDE.md. All are fixable
without structural change.

## Current State (verified, with citations)

- **C1.** 5 `user-invokable: false` skills have weak descriptions: no "Use
  when" clause (`plugins/yellow-core/skills/security-fencing/SKILL.md:3`,
  `plugins/yellow-research/skills/research-patterns/SKILL.md:4`) or generic
  "…need X integration context" boilerplate + topic-enumeration WHAT clauses
  (`plugins/yellow-codex/skills/codex-patterns/SKILL.md:3`,
  `plugins/yellow-composio/skills/composio-patterns/SKILL.md:3`,
  `plugins/yellow-mempalace/skills/mempalace-conventions/SKILL.md:3`).
- **C2.** Confusable sibling surfaces lack negative-disambiguation clauses.
  Verified colliding pairs: `optimize` ↔ `/workflows:review`; `debugging`
  ("stuck after failed fix attempts") ↔ `/codex:rescue` ("stuck on a bug");
  `session-history` ↔ `memory-query` (yellow-ruvector); `/ruvector:memory`
  ("what do we know about X") ↔ `/mempalace:search` ("recalling past
  decisions, facts, or context"). `ideation` ↔ `brainstorming` is already
  disambiguated (`ideation/SKILL.md:3`) — no edit.
- **C3.** Two stale catalogs in yellow-core: `plugins/yellow-core/CLAUDE.md:134`
  says "### Skills (13)" (18 exist; missing `mcp-health-probe`,
  `memory-recall-pattern`, `memory-remember-pattern`, `morph-discovery-pattern`,
  `multi-host-fleet`); `plugins/yellow-core/README.md` Skills table lists only
  9 of 18. Plus a stale integration claim:
  `plugins/yellow-core/agents/research/learnings-researcher.md:294-300` lists
  `/workflows:plan` and `/workflows:brainstorm` as invokers — neither
  dispatches it (plan.md uses ruvector `hooks_recall` at
  `commands/workflows/plan.md:52-58`; brainstorm has no learnings step).
- **C4.** `plugins/yellow-core/skills/create-agent-skills/SKILL.md` is 513
  lines, over the 500-line ceiling it states at its own line 131. Largest
  self-contained section: `## Subagent Failure Convention` (lines 243–411,
  168 lines). Live consumers cite it **by heading name**:
  `plugins/yellow-core/commands/workflows/work.md:479` and
  `plugins/yellow-review/commands/review/review-pr.md:415-417` (the latter
  also cites the `### When the convention applies` subsection).
- **C5.** Root `CLAUDE.md:180-191`: the "Plugin authoring" block's lead-in
  claims the rules below are "enforced by `validate-agent-authoring.js`", but
  that script never opens SKILL.md files — `validateAgentFile()` runs only on
  the `agents/` path set (`scripts/validate-agent-authoring.js:716-757`). The
  three-heading rule, the single-line-description rule, and the
  `user-invokable` spelling rule are all prose-only for skills.

## Governing conventions (must hold for every edit)

- `description:` stays a single-line double-quoted scalar; no folded scalars
  (AGENTS.md rule; **no validator catches skill violations** — hand-verify).
- **No enumerated trigger-phrase lists** — CONTRIBUTING.md:534-539 classifies
  them as dead weight. Do NOT import turbo's quoted-phrase pattern into skill
  descriptions. (Agent descriptions may keep existing phrase lists.)
- Negative-disambiguation clauses are the protected kind of content
  (CONTRIBUTING.md:529-533); model wording on `ideation/SKILL.md:3`'s
  existing "…or `/workflows:brainstorm` narrows too quickly" clause.
- All 5 C1 targets are `user-invokable: false`: rationale is selection clarity
  for agent preloading + PR #507 consistency (see
  `plans/complete/skill-description-audit.md:259-280`), not the ~250-char
  positional budget (exempt per CONTRIBUTING.md:554-562).
- Never run `pnpm format` over `plugins/**/*.md` (Prettier refolds long
  single-line descriptions into silently-truncated multi-line form).
- LF endings on all touched files (`sed -i 's/\r$//'` before commit).
- Bodies of C1 skills are NOT in scope — codex-patterns and
  mempalace-conventions bodies are preloaded verbatim by 5 agents.

## Implementation Plan

### Phase 1: C1 — description rewrites (5 files)

- [ ] 1.1 `security-fencing/SKILL.md:3` — keep the WHAT clause; replace the
      "agents typically include this content inline…" aside with a "Use
      when…" trigger distilled from the body's own `## When to Use` (line 38).
- [ ] 1.2 `research-patterns/SKILL.md:4` — replace the 6-topic enumeration
      with a lookup-reference WHAT clause + "Use when…" trigger (authoring or
      modifying yellow-research commands/agents that write research output).
- [ ] 1.3 `codex-patterns/SKILL.md:3` — replace topic enumeration + vacuous
      WHEN with concrete trigger (authoring agents/commands that shell out to
      the `codex` CLI: invocation, parsing, approval modes).
- [ ] 1.4 `composio-patterns/SKILL.md:3` — same treatment (batch workflows via
      Composio MCP: Workbench, Multi-Execute, usage tracking).
- [ ] 1.5 `mempalace-conventions/SKILL.md:3` — lightest touch: lead with a
      real WHAT clause, keep the existing WHEN, drop the topic list.

### Phase 2: C2 — negative-disambiguation clauses (invokable side only)

- [ ] 2.1 `optimize/SKILL.md:3` — append clause distinguishing from
      `/workflows:review` (rubric-scored variant comparison vs. session-level
      plan-adherence review).
- [ ] 2.2 `debugging/SKILL.md:3` — append "…for delegating a stuck
      investigation to an independent Codex session, use `/codex:rescue`."
- [ ] 2.3 `session-history/SKILL.md:3` — append clause vs. ruvector recall
      (raw prior-session transcripts vs. distilled learnings in ruvector).
- [ ] 2.4 `plugins/yellow-ruvector/commands/ruvector/memory.md:3` and
      `plugins/yellow-mempalace/commands/mempalace/search.md:3` — one clause
      each pointing at the other (ruvector = per-project learned
      patterns/reflexions; mempalace = structured palace/knowledge-graph
      memory). Keep each clause to one sentence.
- [ ] 2.5 Confirm no file appears in both Phase 1 and Phase 2 edit sets (the
      mempalace C2 target is the `search` command, not the conventions skill).

### Phase 3: C3 — catalog + integration drift (yellow-core)

- [ ] 3.1 `plugins/yellow-core/CLAUDE.md:134` — "Skills (13)" → "Skills (18)";
      insert the 5 missing entries alphabetically (slots verified: after
      `local-config` line 148 / before-and-after `mcp-integration-patterns`
      line 149 / before `optimize` line 150), one-line summaries derived from
      each skill's own `description:` frontmatter.
- [ ] 3.2 `plugins/yellow-core/README.md` Skills table (~lines 79-92) — add
      the 9 missing rows (brainstorming, local-config, mcp-health-probe,
      mcp-integration-patterns, memory-recall-pattern, memory-remember-pattern,
      morph-discovery-pattern, multi-host-fleet, security-fencing), same
      source of truth.
- [ ] 3.3 `learnings-researcher.md:294-300` — remove the `/workflows:plan` and
      `/workflows:brainstorm` bullets (re-verify first:
      `grep -rn "learnings-researcher" plugins/yellow-core/commands/workflows/`
      must return no dispatch); keep `/review:pr` and standalone-Task bullets;
      add the two real extra dispatch sites (`/review:review-all`,
      `/docs:review`) if kept as a list.
- [ ] 3.4 Root `README.md:30` and `:267` — yellow-core row/tree say "17
      agents, 16 commands, 7 skills"; actual is 21 agents, 16 commands, 18
      skills (verified 2026-07-01). Recount every plugin row against disk
      while there (yellow-ci row says 8 commands; 9 exist). Root README is
      outside `plugins/` — no changeset for this file.

### Phase 4: C4 — create-agent-skills split

- [ ] 4.1 Create
      `plugins/yellow-core/skills/create-agent-skills/references/subagent-failure-convention.md`
      containing lines 243–411 verbatim (headings unchanged, including
      `### When the convention applies`).
- [ ] 4.2 Replace the section in SKILL.md with a CE-style load stub that (a)
      keeps the `## Subagent Failure Convention` heading, (b) states what the
      reference contains and the failure mode of skipping it, (c) instructs
      "Read `references/subagent-failure-convention.md`", and (d) keeps no
      improvisable detail. Result must be < 500 lines.
- [ ] 4.3 Verify both live citations still resolve: `work.md:479` and
      `review-pr.md:415-417` reference the section by name — heading is
      preserved in the stub; no edits needed there unless wording says "in
      this file".

### Phase 5: C5 — root CLAUDE.md enforcement claim

- [ ] 5.1 Rewrite `CLAUDE.md:180-181` lead-in as a per-surface enforcement
      matrix: agent frontmatter rules → CI-enforced by
      `validate-agent-authoring.js`; SKILL.md rules (three headings,
      single-line description, `user-invokable` spelling) → convention,
      enforced by review only. Do NOT add the missing validator check here
      (that is Tier 2 C10).

### Phase 6: Validation + ship

- [ ] 6.1 Hand-check: `grep -rE '^description: [>|]' plugins/*/skills/*/SKILL.md`
      returns empty; every edited description is one physical line.
- [ ] 6.2 `wc -l plugins/yellow-core/skills/create-agent-skills/SKILL.md` < 500.
- [ ] 6.3 CI baseline: `pnpm validate:schemas && pnpm test:unit && pnpm lint
      && pnpm typecheck`.
- [ ] 6.4 One combined changeset, all patch (PR #507 template, `git show
      0cae8920`): yellow-core, yellow-research, yellow-codex, yellow-composio,
      yellow-mempalace, yellow-ruvector. Root CLAUDE.md (C5) needs no
      changeset.
- [ ] 6.5 LF normalize, single PR via `gt` (`gt branch create` +
      `gt modify -c` + `gt submit --no-interactive`).

## Technical Details

Files to modify (13): the 5 C1 SKILL.md files; `optimize/SKILL.md`,
`debugging/SKILL.md`, `session-history/SKILL.md`,
`yellow-ruvector/commands/ruvector/memory.md`,
`yellow-mempalace/commands/mempalace/search.md` (C2);
`yellow-core/CLAUDE.md`, `yellow-core/README.md`,
`yellow-core/agents/research/learnings-researcher.md` (C3);
`create-agent-skills/SKILL.md` (C4); root `CLAUDE.md` (C5).
Files to create (1): `create-agent-skills/references/subagent-failure-convention.md`.

Per-item effort/risk: C1 S/low · C2 S/low (bounded: additive clause modeled on
proven `ideation` wording; worst case over-suppression of a legitimate
invocation) · C3 S/none · C4 M/low (citation-integrity risk only — mitigated
by verbatim heading copy + 4.3 check) · C5 S/none.

## Acceptance Criteria (binary)

1. All 5 C1 descriptions contain a "Use when" clause and no topic enumeration
   or "integration context" boilerplate; each is a single-line scalar.
2. Each C2 target contains exactly one added disambiguation clause naming its
   sibling surface; `grep -c 'Use when'` count unchanged (no trigger removed).
3. `grep -o 'Skills (18)' plugins/yellow-core/CLAUDE.md` hits; grep for each of
   the 18 skill names in both CLAUDE.md and README.md catalogs → 18/18 present;
   root `README.md` per-plugin counts match `fd`-derived disk counts for every
   row (spot-check script in task 3.4).
4. `learnings-researcher.md` Integration section no longer names
   `/workflows:plan` or `/workflows:brainstorm`.
5. `create-agent-skills/SKILL.md` < 500 lines AND
   `grep -n '## Subagent Failure Convention' SKILL.md` still hits AND
   `grep -n 'When the convention applies' references/subagent-failure-convention.md` hits.
6. Root CLAUDE.md no longer claims validator enforcement for any SKILL.md rule.
7. CI baseline green; changeset lists exactly the 6 touched plugins as patch.

## Edge Cases

- C2 clause phrasing must not remove or weaken existing positive triggers —
  additive only, appended after the current "Use when" clause.
- C4: if trimming the stub leaves SKILL.md at 499-500 lines, also move the
  `## Quick Reference and Plugin Settings` pointer content (line 509+) into
  the existing `references/quick-reference.md` rather than cutting prose.
- C3.3: `/review:review-all` and `/docs:review` dispatch sites should be
  re-verified by grep at implementation time before being written in.
- `docs/optimization/analysis.md` cites pre-fix line numbers; it is a
  point-in-time report — do not update it.

## References

- `docs/optimization/analysis.md` §3.1, §3.4, §4 (C1–C5 evidence)
- `plans/complete/skill-description-audit.md` (PR #507 precedent + checklist)
- `CONTRIBUTING.md:515-562` (Skill Description Budget policy)
- CE patterns: load stub (CE `CONCEPTS.md:65-67`), negative disambiguation
  (CE `skills/ce-plan/SKILL.md:3`)
- `docs/solutions/code-quality/prettier-description-wrap-silent-truncation.md`
