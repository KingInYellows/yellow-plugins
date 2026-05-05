# Changelog

All notable changes to this plugin are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [2.0.0] - 2026-04-17

### Major Changes

- **Breaking:** all three API keys (`PERPLEXITY_API_KEY`,
  `TAVILY_API_KEY`, `EXA_API_KEY`) migrated to `userConfig`. The
  perplexity, tavily, and exa MCP servers now read their API keys from
  Claude Code's `userConfig` (sensitive, keychain-backed) instead of
  shell env vars. The three keys are declared **optional** — the plugin
  degrades gracefully when any are missing, so skipping the prompts is
  valid for users who only want a subset of research sources.

  Empirically verified behavior (MCP stdio probe, 2026-04-17): perplexity
  hard-fails at startup without `PERPLEXITY_API_KEY` (so its tools
  disappear entirely); tavily and exa start without their keys but return
  runtime errors on tool invocation. Either way, `/research:deep` and
  `/research:code` continue to operate with whichever sources are
  available.

### Migration (existing users)

- Run `claude plugin update yellow-research@yellow-plugins`. Claude Code
  prompts for each key at plugin-enable time; dismiss any you don't want
  stored. Answering preserves the keychain-backed experience; skipping
  leaves the old shell-env path broken for that MCP (since plugin.json
  now references `${user_config.*}`, not `${*_API_KEY}` shell vars).
- Power users who prefer shell env vars can add a thin wrapper script
  per MCP (see yellow-morph's `bin/start-morph.sh` for a pattern), but
  for most users answering the userConfig prompt is the recommended
  path.

---

## 1.4.0

### Minor Changes

- [`b441164`](https://github.com/KingInYellows/yellow-plugins/commit/b441164550b346b20b73bf466bcbc3e33e823b74)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Fix ast-grep
  MCP Python 3.13 gate with uv-managed Python

  Add `--python 3.13` to uvx args so uv auto-downloads Python 3.13 without
  touching the system Python. Auto-install uv and pre-warm Python 3.13 in the
  install script. Remove Python 3.13 system requirement from setup commands. Fix
  sg/ast-grep binary check inconsistency in setup:all dashboard.

- [#265](https://github.com/KingInYellows/yellow-plugins/pull/265)
  [`635f58d`](https://github.com/KingInYellows/yellow-plugins/commit/635f58d254b22a733f57f72fa15681c56d3f6e86)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add Ceramic.ai
  as the default first-hop research backend across yellow-research and
  yellow-core.
  - yellow-research: bundle a 6th MCP server entry pointing at
    `https://mcp.ceramic.ai/mcp` (OAuth 2.1; same shape as the existing Parallel
    Task block). The `code-researcher` and `research-conductor` agents prefer
    `ceramic_search` for general-web and Simple/Moderate triage tiers, with
    explicit fall-through to the existing Perplexity/Tavily/EXA stack when
    Ceramic is unavailable or returns no useful results. Both agents are
    instructed to rewrite topics into concise keyword form before calling
    Ceramic, since it is a lexical (not semantic) search engine.
    `/research:setup` gains a `CERAMIC_API_KEY` format check, REST live-probe,
    and dashboard row; `CERAMIC_API_KEY` powers the REST probe only — the MCP
    authenticates via OAuth.
  - yellow-core: bundle the same Ceramic MCP entry as a second `mcpServers`
    alongside `context7`. The `best-practices-researcher` agent leads its Phase
    2 web-search step with `ceramic_search`, falling back to built-in
    `WebSearch`. `WebFetch` stays primary for single-URL content fetches
    (Ceramic has no fetch endpoint).

  Pricing: $0.05 per 1,000 queries (vs. tens of $/month per provider in the
  prior stack). Rate limits: 20 QPS pay-as-you-go; 50 QPS Pro.

  No prior backend is removed. Roll back by deleting the `mcpServers.ceramic`
  block from either plugin's `plugin.json`.

- [#290](https://github.com/KingInYellows/yellow-plugins/pull/290)
  [`65e2938`](https://github.com/KingInYellows/yellow-plugins/commit/65e29382c2df760ef62efca337c1fc6160193245)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Fix
  `subagent_type` 2-segment → 3-segment format across the `review:pr` keystone
  and other command files. Claude Code's Task registry resolves agents by the
  literal `plugin:directory:agent-name` triple from frontmatter — the 2-segment
  `plugin:agent-name` form silently mismatches and causes the
  graceful-degradation guard to skip every cross-plugin persona spawn.

  Also updates `scripts/validate-agent-authoring.js` to register both 2-segment
  and 3-segment forms (transitional — the 2-segment form remains accepted by the
  validator so non-keystone callers fail loudly only on the runtime mismatch,
  not on CI). New code should always emit the 3-segment form.

  `yellow-review` (MINOR — keystone behavior fix, no API change):
  - `commands/review/review-pr.md` — Step 3d `learnings-researcher` dispatch
    (`yellow-core:research:learnings-researcher`), the entire always-on /
    conditional / supplementary persona dispatch table (17 entries: 4 always-on
    plus 12 conditional plus 1 supplementary — `yellow-review:review:*` for the
    10 in-plugin personas, `yellow-core:review:*` for the 6 security / perf /
    architecture / pattern / simplicity / polyglot personas,
    `yellow-codex:review:codex-reviewer` for the optional supplementary), Step 8
    `yellow-review:review:code-simplifier`, and Step 9a
    `yellow-core:workflow:knowledge-compounder` all corrected to the
    three-segment registry form.
  - `commands/review/review-all.md` — `learnings-researcher` Task example in the
    inlined per-PR pipeline corrected to
    `yellow-core:research:learnings-researcher`.
  - `skills/pr-review-workflow/SKILL.md` — Cross-Plugin Agent References
    examples corrected to `yellow-core:review:security-sentinel` and
    `yellow-codex:review:codex-reviewer`; pattern hint expanded from
    `yellow-core:<agent-name>` to `yellow-core:<dir>:<agent-name>` so future
    authors copy the right form.
  - `agents/review/code-reviewer.md` — Deprecation stub frontmatter and body
    migration prose updated to spell out the three-segment form
    (`yellow-review:review:code-reviewer` →
    `yellow-review:review:project-compliance-reviewer`); the stub's
    residual_risks JSON also corrected so any caller still landing on the stub
    gets a copy-pasteable replacement string.
  - `CLAUDE.md` Cross-Plugin Agent References — Both intro paragraphs updated to
    specify the three-segment form with a concrete example.

  `yellow-core` (MINOR — self-reference fix on Wave 2 keystone agent and core
  workflow commands):
  - `agents/research/learnings-researcher.md` Integration section — Standalone
    invocation example corrected to `yellow-core:research:learnings-researcher`.
  - `commands/workflows/compound.md` — `knowledge-compounder` dispatch corrected
    to `yellow-core:workflow:knowledge-compounder`.
  - `commands/workflows/work.md` — Codex rescue dispatch corrected to
    `yellow-codex:workflow:codex-executor`.

  `yellow-docs` (MINOR — every cross-agent dispatch was 2-segment):
  - `commands/docs/audit.md` — `doc-auditor` →
    `yellow-docs:analysis:doc-auditor`.
  - `commands/docs/diagram.md` — `diagram-architect` →
    `yellow-docs:generation:diagram-architect`.
  - `commands/docs/generate.md` — `doc-generator` →
    `yellow-docs:generation:doc-generator`.
  - `commands/docs/refresh.md` — both `doc-auditor` and `doc-generator`
    references updated as above.

  `yellow-research` (MINOR — deepen-plan dispatch was 2-segment):
  - `commands/workflows/deepen-plan.md` — `repo-research-analyst` →
    `yellow-core:research:repo-research-analyst`; `research-conductor` →
    `yellow-research:research:research-conductor`.

  Triggers a marketplace release so consumers' plugin caches refresh; the
  keystone is otherwise dispatch-blocked end-to-end.

### Patch Changes

- [`e00b53e`](https://github.com/KingInYellows/yellow-plugins/commit/e00b53e874fe3d053c9f683b2eb86d1e6fe99dff)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Unbundle
  context7 MCP from yellow-core; repoint yellow-research callers to user-level

  Remove the bundled `mcpServers.context7` entry from
  `plugins/yellow-core/.claude-plugin/plugin.json` to avoid the
  dual-OAuth-pop-up issue when users have context7 installed both at user level
  and bundled inside yellow-core (the namespace collision pattern documented in
  `docs/solutions/integration-issues/duplicate-mcp-url-double-oauth.md`). Per CE
  PR #486 (compound-engineering v2.62.0, 2026-04-03) parity.
  - **yellow-core:** `mcpServers` block removed from `plugin.json`;
    `best-practices-researcher` agent's tool list updated to user-level
    `mcp__context7__*` names; CLAUDE.md/README.md updated to recommend
    user-level install; statusline/setup.md no longer lists yellow-core as
    having an MCP.
  - **yellow-research:** `code-researcher` agent, `/research:code` command,
    `/research:setup` command, `research-patterns` skill, CLAUDE.md, and
    README.md all repointed from `mcp__plugin_yellow-core_context7__*` to
    user-level `mcp__context7__*`. ToolSearch availability check + EXA fallback
    preserved (existing prose).

  **User action:** install context7 at user level via
  `/plugin install context7@upstash` (or via Claude Code MCP settings UI). The
  user-level context7 server registers tools as
  `mcp__context7__resolve-library-id` and `mcp__context7__query-docs`.
  yellow-research's `code-researcher` falls back to EXA `get_code_context_exa`
  if user-level context7 is not detected by ToolSearch — no behavior change for
  users without context7.

  Roll back by re-adding the `mcpServers.context7` block to
  `plugins/yellow-core/.claude-plugin/plugin.json` and reverting the tool-name
---

## [1.3.0] - 2026-03-10

### Minor Changes

- [`1c183f3`](https://github.com/KingInYellows/yellow-plugins/commit/1c183f3529250822df87180b5c9e69dadc2830a0)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add
  auto-install with confirmation for semgrep CLI and ast-grep binary in setup
  commands

### Patch Changes

- [`69d84c8`](https://github.com/KingInYellows/yellow-plugins/commit/69d84c8f17a23da89979765c434d4e2c0c683935)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Expand
  marketplace setup coverage with dedicated setup commands, repository-root
  aware setup checks, and stricter setup validation guardrails.

---

## [1.2.0] - 2026-03-06

### Minor Changes

- [`eb5c43c`](https://github.com/KingInYellows/yellow-plugins/commit/eb5c43c88c810c1452d3d6a034e6bf2e8ea18ee1)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add ast-grep
  MCP server for AST-based structural code search. Bundles 4 new tools
  (find_code, find_code_by_rule, dump_syntax_tree, test_match_code_rule) via
  uvx. Adds health checks for ast-grep and Parallel Task MCP to /research:setup.

---

## [1.1.0] - 2026-02-25

### Fixed

- Remove unsupported `changelog` key from plugin.json that blocked installation
  via Claude Code's remote validator.

---

## [1.0.0] - 2026-02-23

### Added

- Initial release — bundled research MCP servers: Perplexity, Tavily, EXA, and
  Parallel Task for multi-source deep research.

---

**Maintained by**: [KingInYellows](https://github.com/KingInYellows)
