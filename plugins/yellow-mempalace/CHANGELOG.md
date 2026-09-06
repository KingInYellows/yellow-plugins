# yellow-mempalace

## 1.1.8

### Patch Changes

- [`e239b34`](https://github.com/KingInYellows/yellow-plugins/commit/e239b3462d7c65e866d87dc27197b0167dc0e0d7)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Rename the
  skill frontmatter key `user-invokable` to `user-invocable` in every SKILL.md.
  Claude Code (verified against 2.1.259) parses only `user-invocable`; the `k`
  spelling this repo standardised on was silently ignored, so every internal
  skill declared `user-invokable: false` still appeared in the `/` menu. The
  validator gains RULE 20 (error tier) rejecting the old key so it cannot creep
  back through stale templates.

## 1.1.7

### Patch Changes

- [#716](https://github.com/KingInYellows/yellow-plugins/pull/716)
  [`d422f55`](https://github.com/KingInYellows/yellow-plugins/commit/d422f55472f16bc14503236d7b64de5e9de4b15f)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Reword
  CLAUDE.md's submission convention to point at the resolved active stacked-PR
  provider (`/stack:status`) instead of naming `gt submit` specifically. No
  functional change.

## 1.1.6

### Patch Changes

- [#671](https://github.com/KingInYellows/yellow-plugins/pull/671)
  [`4b35a76`](https://github.com/KingInYellows/yellow-plugins/commit/4b35a760a354e06ab3b845a19ce0e2ba878e3b20)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Correctness,
  contract-wording, and sweep-completeness follow-ups deferred from the PR
  #666/#667 review loops
  - yellow-ruvector: memory-manager queue rewrite retains entries whose
    processing failed (failed `file_change` re-index included), not only failed
    `hooks_remember` stores.
  - yellow-semgrep: `/semgrep:fix` verify-outcome language aligned with
    scan-verifier's findings-at-modified-lines WARNING contract.
  - yellow-ci: runner-diagnostics SSH rule now covers its own Step 3
    connectivity check ("Steps 3 and 4").
  - yellow-mempalace: `/mempalace:kg` closet definition moved out of the render
    placeholder into prose.
  - yellow-devin: devin-orchestrator documents the non-interactive default for
    the `max_acu_limit` question; devin-workflows tier table points at the
    in-file M3 definition.
  - yellow-debt / yellow-linear: bare "(M3)" jargon rewritten to
    confirmation-gate plain language (same class as the PR #666 sweep).
  - yellow-core: `/plan:complete` states rules inline instead of citing the
    maintainer-local MEMORY.md; the AskUserQuestion `Other`-label rule is
    standardized to one canonical phrasing across `decompose`, `expand-shell`,
    `spec`, and `work`, with expand-shell's `Other` option moved last to match
    its siblings.

## 1.1.5

### Patch Changes

- [#666](https://github.com/KingInYellows/yellow-plugins/pull/666)
  [`5a0b9c5`](https://github.com/KingInYellows/yellow-plugins/commit/5a0b9c5190885e45927aa9afd63a779e69bacd67)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Prompt-quality
  correctness pass across instructional markdown, driven by the updated
  prompting-guidance research (docs/research/best-practices/
  gpt-claude-latest-model-prompting-guidance.md and its 2026-07-27 addendum).

  Fixes fall into four classes: (1) dangling or stale references — archived plan
  paths, a nonexistent MCP tool name, "MEMORY.md" citations that do not resolve
  for installed users, undefined jargon like "(M3)" and "the keystone"; (2)
  contradictions between paired files — dedup-threshold drift (0.85 vs the
  canonical 0.82), revert/retry option mismatches, doc claims the referenced
  code disproves; (3) ambiguous or unactionable instructions — AskUserQuestion
  free-text options not labeled `Other`, undefined shell variables in
  illustrative bash, branches with no specified check; (4) Codex-exposed
  gt-workflow skills assuming Claude-only primitives (AskUserQuestion, the Skill
  tool) with no host branch — each now carries an "On Codex" fallback, with
  generated codex/ artifacts regenerated. No command interfaces changed.

## 1.1.4

### Patch Changes

- [#609](https://github.com/KingInYellows/yellow-plugins/pull/609)
  [`00f60b5`](https://github.com/KingInYellows/yellow-plugins/commit/00f60b54e761770665cb8683a4754ecc984521f1)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Memory-router
  decision (Tier 2 C11, maintainer-decided): yellow-ruvector is the standard
  memory system; yellow-mempalace is deprecated pending removal. Generic trigger
  phrases ("remember this", "record a decision", "add a fact", generic recall)
  no longer auto-route to mempalace — `memory-archivist`, `/mempalace:search`,
  `/mempalace:navigate`, `/mempalace:kg`, and `palace-navigator` descriptions
  are narrowed to explicit `/mempalace:*` / palace / KG invocation, and
  `/ruvector:learn`'s description reciprocally claims "record a decision" /
  "save a memory" / "add a fact" so those phrases route somewhere. The full
  routing table and rationale are recorded in `docs/memory-routing-protocol.md`;
  mempalace's CLAUDE.md and README carry deprecation banners. Actual plugin
  removal and palace-data migration are a follow-up plan; explicit mempalace
  commands keep working until then.

## 1.1.3

### Patch Changes

- [#601](https://github.com/KingInYellows/yellow-plugins/pull/601)
  [`128149b`](https://github.com/KingInYellows/yellow-plugins/commit/128149b5188fbd0367f8045c799aa3c59e03c727)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! -
  docs(optimization): Tier 1 quick wins C1-C4 — self-description layer fixes.

  C1: rewrite 5 weak `user-invokable: false` skill descriptions
  (security-fencing, research-patterns, codex-patterns, composio-patterns,
  mempalace-conventions) with concrete "Use when" triggers, removing topic
  enumeration and "integration context" boilerplate.

  C2: add one negative-disambiguation clause each to 5 confusable surfaces:
  optimize vs /workflows:review, debugging vs /codex:rescue, session-history vs
  ruvector recall, and /ruvector:memory <-> /mempalace:search pointing at each
  other. Additive only — no existing trigger removed.

  C3: fix stale yellow-core catalogs — CLAUDE.md Skills (13)→(18), README.md
  Skills table 9→18 rows, learnings-researcher.md Integration section corrected
  to the real dispatch sites (/review:pr, /review:review-all, /docs:review).

  C4: split the 168-line Subagent Failure Convention section out of
  create-agent-skills/SKILL.md (513 lines, over its own 500-line ceiling) into
  references/subagent-failure-convention.md behind a load stub that preserves
  the section heading. SKILL.md is now 365 lines.

  Review follow-up: review-pr.md's Step 5 citation now points at the new
  references/subagent-failure-convention.md for the "When the convention
  applies" subsection (the C4 move relocated it out of SKILL.md).

  Doc-only; no scripts, hooks, schemas, or CI behavior change. Root CLAUDE.md
  (C5) and root README recounts ship in the same PR without a changeset (outside
  plugins/).

## 1.1.2

### Patch Changes

- [`c3cdfdb`](https://github.com/KingInYellows/yellow-plugins/commit/c3cdfdb5a2c0d260e32096a524c4712fe277d019)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add `$schema`
  pointer to all remaining plugin manifests:
  `https://json.schemastore.org/claude-code-plugin-manifest.json`

  Per https://code.claude.com/docs/en/plugins-reference, Claude Code's plugin
  loader ignores this field at load time, but editors and IDEs use it for
  autocomplete and inline validation against the official remote validator
  schema. yellow-core received the pointer earlier in the stack as a
  single-plugin probe; this PR extends it to the other 17.

  Also documents local vs remote validator divergence in CONTRIBUTING.md with a
  recipe for empirical install testing (`claude plugin validate`,
  `claude --plugin-url`, fresh-install probe). The `claude plugin validate` CI
  integration is deferred to a follow-up PR pending CI runtime evaluation.

## 1.1.1

### Patch Changes

- [`0293bec`](https://github.com/KingInYellows/yellow-plugins/commit/0293bec6276e9e371b9fd3aa3dcf3a8f62f6fa3e)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Harden 11
  prompt-injection fences across 7 plugin files against literal-delimiter
  breakout. Each fence now carries the canonical two-part hardening from PR
  #254: a pre-insertion substitution instruction (replace closing delimiter with
  `[ESCAPED]` form) and a post-close `Resume normal agent behavior.` sentinel.
  Affected files: `agents/mempalace/memory-archivist.md`,
  `agents/mempalace/palace-navigator.md`,
  `commands/mempalace/{kg,navigate,search,mine,status,setup}.md`. Reference:
  `docs/solutions/security-issues/prompt-injection-fence-breakout-literal-delimiter.md`.

## 1.1.0

### Minor Changes

- [`62d5d88`](https://github.com/KingInYellows/yellow-plugins/commit/62d5d889802144c6c73e21d0bcd04b9b316b246e)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add
  yellow-mempalace plugin wrapping MemPalace MCP server for structured long-term
  memory with temporal knowledge graph. Patch yellow-core to add mempalace to
  setup:all dashboard, classification, and delegated commands.
