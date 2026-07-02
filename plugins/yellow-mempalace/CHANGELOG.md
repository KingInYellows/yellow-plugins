# yellow-mempalace

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
