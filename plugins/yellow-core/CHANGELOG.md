# Changelog

## 1.5.1

### Patch Changes

- [`f22272d`](https://github.com/KingInYellows/yellow-plugins/commit/f22272d391a466840ef6b398a83e8d233b755694)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Update
  CHANGELOG migration text to runtime-current 3-segment subagent_type form +
  document non-interactive cache-refresh workaround

  Two small docs/maintenance fixes:
  1. **CHANGELOG migration text:** `plugins/yellow-core/CHANGELOG.md` and
     `plugins/yellow-review/CHANGELOG.md` had migration notes citing the legacy
     2-segment `subagent_type: "yellow-review:code-reviewer"` form. The repo's
     runtime expects 3-segment as of PRs #288/#290. The validator's INFO note
     flagged these for future hard-fail. Updated both migration snippets to the
     3-segment form (`yellow-review:review:code-reviewer`) so the migration text
     stays accurate and the INFO warnings clear.
  2. **CONTRIBUTING.md cache-refresh note:** added a "Manual cache refresh for
     non-interactive sessions" subsection covering the rsync workaround when
     `/plugin marketplace update` (TUI-only) isn't available — e.g., background
     agents or Remote Control sessions verifying a freshly-merged
     `chore: version packages` release. The loop hardens against path-traversal
     via plugin name and version (allowlist regex), uses `sort -V` instead of
     lexicographic `ls | tail -1` so `1.10.x` is correctly preferred over
     `1.9.x`, requires `set -euo pipefail` plus `command -v` prereq checks, and
     surfaces `cp` failures rather than silently skipping rsync.

  No code changes; documentation-only patches.

- [`7fe5d9d`](https://github.com/KingInYellows/yellow-plugins/commit/7fe5d9dc3b445ac94146afe68f3943fb8161087b)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Fix
  `learnings-researcher` empty-result sentinel violation + defense-in-depth on
  the keystone check

  The `learnings-researcher` agent's empty-result protocol requires
  `NO_PRIOR_LEARNINGS` to be the **first non-whitespace line** of the response.
  In practice the agent was emitting a "thinking out loud" scan-summary
  paragraph before the sentinel — flipping the keystone's Step 3d.4
  strict-equality check from "empty → skip injection" to "non-empty → inject as
  learnings", which delivered useless prose to all 4–9 dispatched reviewers per
  `/review:pr` invocation.

  Two-sided fix:
  1. **`plugins/yellow-core/agents/research/learnings-researcher.md`** — tighten
     the empty-result protocol with explicit anti-pattern guidance (forbidden
     prose-before-token, no thinking-out-loud, no closing remarks) and a
     self-check checklist before emission. The agent-side contract is unchanged
     (token must still be first non-whitespace line); the spec just makes the
     LLM-compliance bar harder to miss.
  2. **`plugins/yellow-review/commands/review/review-pr.md`** Step 3d.4 —
     replace the strict "first non-whitespace line equals literal token" check
     with two-condition empty-result detection:
     - **(a)** the token appears on its own line anywhere in the response (regex
       `(?m)^\s*NO_PRIOR_LEARNINGS\s*$`), AND
     - **(b)** the response does NOT contain a `## Past Learnings` heading
       (regex `(?m)^##\s+Past\s+Learnings\s*$`).

     When both hold → skip injection (the original fix intent — tolerate LLM
     thinking-out-loud preamble before the sentinel). When only (a) holds
     (token + findings heading both present) → contract violation; log a
     warning, strip the sentinel line, and treat the response as non-empty so
     findings are not silently dropped. The `## Past Learnings` heading
     dominance ensures the relaxation never masks the "combined sentinel with
     findings" anti-pattern the agent body forbids.

  Together the two changes mean Wave 3 PR reviews will get clean empty-result
  handling immediately, with a robust safety net that preserves findings even
  when an agent-side regression combines the sentinel with real findings.

## 1.5.0

### Minor Changes

- [`4f5cfff`](https://github.com/KingInYellows/yellow-plugins/commit/4f5cfff69febeb50853dbd49130eb452ce9d30a8)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add
  yellow-codex plugin wrapping OpenAI Codex CLI with review, rescue, and setup
  workflows. Patch yellow-review to spawn codex-reviewer as an optional
  supplementary reviewer, and patch yellow-core to surface yellow-codex
  readiness plus delegate codex:setup from /setup:all.

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

- [#282](https://github.com/KingInYellows/yellow-plugins/pull/282)
  [`d992744`](https://github.com/KingInYellows/yellow-plugins/commit/d992744352db5baa27fbfd826bb42923efa84ed8)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add
  track/problem frontmatter schema to knowledge-compounder; backfill 51
  docs/solutions entries

  **knowledge-compounder.md updates (additive):**
  - New required frontmatter fields for entries written to `docs/solutions/`:
    - `track: bug | knowledge` — distinguishes specific incidents from
      patterns/guidelines
    - `problem: <one-line ~80 char>` — keyword-rich problem statement; W2.1
      `learnings-researcher` (lands in keystone PR #7) will use this for
      BM25/dense retrieval ranking
    - `tags: [array]` — already existed; now enforced as non-empty (3+ tags
      recommended)
  - New "Context Budget Precheck" (CE ce-compound v2.39.0 pattern): before
    writing, count assembled body lines; if > `KC_CONTEXT_BUDGET` (default 200),
    prompt via AskUserQuestion to write single / split into N files / cancel.
  - Track classification rules table: defaults by category with override
    conditions; security-issues entries containing
    audit/threat-model/pre-implementation markers are flagged for manual review
    rather than auto-bug-classified.
  - Solution doc body sections now branch by track:
    - **bug:** Problem, Symptoms, What Didn't Work, Solution, Why This Works,
      Prevention
    - **knowledge:** Context, Guidance, Why This Matters, When to Apply,
      Examples

  **New script: `scripts/backfill-solution-frontmatter.js`**

  Idempotent backfill for existing `docs/solutions/` entries:
  - Heuristic-based track assignment by category
    (logic-errors/security-issues/build-errors → bug;
    code-quality/workflow/integration-issues → knowledge).
  - Audit-shaped security-issues entries (containing "audit", "threat model", or
    "pre-implementation" in title or first paragraph) are flagged for manual
    review — NOT auto-assigned, since a pre-implementation threat model is a
    knowledge-track entry despite the security-issues category default.
  - `problem` field derived from existing `problem` (priority), `symptom`,
    `title`, then first body paragraph — truncated to 120 chars at sentence
    boundary.
  - `tags` field seeded from category if missing, else left untouched.
  - Modes: default = apply, `--dry-run` = report only, `--check` = exit non-zero
    if any file would change (CI-friendly).
  - `SOLUTIONS_DIR` env var lets tests point at fixture trees without touching
    real `docs/solutions/`.

  **Backfill applied:**
  - 51 files scanned across 6 categories
  - 45 entries gained track + problem (some also gained tags)
  - 2 legacy entries (`code-quality/yellow-ci-shell-security-patterns.md`,
    `workflow/plugin-release-process.md`) lacked YAML frontmatter entirely —
    added full frontmatter inline as part of this PR.
  - 1 entry flagged for manual review and classified as `track: knowledge`:
    `security-issues/yellow-devin-plugin-security-audit.md` (a
    pre-implementation threat model — heuristic correctly caught it; manual
    override added with a backfill-note HTML comment explaining the decision).
  - Final state: 51/51 entries have track + problem + tags. Re-running the
    script reports zero changes (idempotency verified).

  Future runs: drop the script into CI as
  `node scripts/backfill-solution-frontmatter.js --check` to gate PRs that add
  `docs/solutions/` entries without the new fields.

- [#280](https://github.com/KingInYellows/yellow-plugins/pull/280)
  [`8e7898f`](https://github.com/KingInYellows/yellow-plugins/commit/8e7898f9eaaa55df1f5b41a42c31fdd1ebbb5de6)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Repair 4
  drifted research/workflow agents, modify 2 review agents, and split
  performance + security into specialized roles

  Brings 4 research/workflow agents to parity with upstream EveryInc patterns
  (locked at `compound-engineering-v3.3.2`, SHA
  `e5b397c9d1883354f03e338dd00f98be3da39f9f`) and splits the deep-analyzer
  agents `performance-oracle` and `security-sentinel` into multi-role agent
  families:
  - **`best-practices-researcher`** — added Phase 0 skill discovery step; now
    checks `.claude/skills/`, `~/.claude/skills/`, and `plugins/*/skills/` for
    curated knowledge before going to MCP/web. Skill-based guidance outranks
    generic external sources.
  - **`repo-research-analyst`** — added Phase 0 Technology & Infrastructure Scan
    with manifest-to-ecosystem mapping table, monorepo detection, deployment /
    API surface / data layer detection (each conditional on what 0.1 finds).
    Grounds all subsequent research in a known stack.
  - **`git-history-analyzer`** — added a "do not assume a hardcoded year"
    preamble that instructs the agent to call `date '+%Y-%m-%d'` to dynamically
    resolve the current date for time-based query interpretation, avoiding
    hardcoded-year drift.
  - **`spec-flow-analyzer`** — added Phase 0 codebase grounding step before the
    existing 4 phases. "Gaps are only gaps if the codebase doesn't already
    handle them" — reduces generic feedback in spec reviews.
  - **`performance-oracle`** — added "Role Split" section pointing to new
    `performance-reviewer` companion. Oracle stays as the deep analyzer
    (algorithmic complexity, scaling projections, benchmarking guidance);
    reviewer handles review-time confidence-calibrated findings.
  - **`security-sentinel`** — added "Role Split" section pointing to new
    `security-reviewer` (review-time code) and `security-lens` (plan-level
    architect). Sentinel stays as the broad OWASP-Top-10 audit agent.

  **New agents (3):**
  - **`performance-reviewer`** — review-time persona for runtime performance and
    scalability. Anchored confidence rubric (100 = verifiable, 75 = provable
    from code, 50 = depends on data size — usually suppress unless P0, ≤25 =
    suppress). Higher effective threshold than other personas because
    performance issues are easy to measure and fix later; FPs waste engineering
    time on premature optimization.
  - **`security-reviewer`** — review-time persona for exploitable security
    vulnerabilities. Lower effective threshold than other personas — security
    findings at anchor 50 should typically be filed at P0 severity to survive
    the aggregation gate via the P0 exception. Hunts injection vectors,
    auth/authz bypasses, secrets in code/logs, insecure deserialization, SSRF /
    path traversal.
  - **`security-lens`** — plan-level security architect. Reviews planning
    documents, brainstorms, or architecture proposals for attack-surface gaps
    before implementation begins. Distinct from code-level review — examines
    whether the plan makes security-relevant decisions and identifies its attack
    surface.

  The 3 new review agents and the 2 modified review agents (performance-oracle,
  security-sentinel) are read-only (`tools: [Read, Grep, Glob]`) per the W1.2
  read-only-reviewer rule. The 4 research/workflow agents retain their existing
  tool sets (Bash, WebSearch, etc.). The 3 new reviewers will be wired into the
  W2.4 review:pr orchestrator dispatch table.

- [#283](https://github.com/KingInYellows/yellow-plugins/pull/283)
  [`4469d4e`](https://github.com/KingInYellows/yellow-plugins/commit/4469d4ec74dac96e63eeab3052f1834c9a31c401)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Wave 2 keystone
  — review:pr persona pipeline + learnings pre-pass + confidence rubric

  `yellow-review` (MAJOR — `code-reviewer` rename):
  - **BREAKING:** Rename `code-reviewer` → `project-compliance-reviewer`. The
    responsibility is narrowed to `CLAUDE.md`/`AGENTS.md` compliance, naming
    patterns, and project-pattern adherence. General correctness is now handled
    by the new `correctness-reviewer`; frontmatter / portability /
    cross-platform tool selection by the new `project-standards-reviewer`.
  - **Migration:** Callers passing
    `subagent_type: "yellow-review:review:code-reviewer"` should update to
    `"yellow-review:review:project-compliance-reviewer"`. A deprecation stub is
    left at the old path for one minor version — third-party installs that
    reference the old name continue to function (with a deprecation log line)
    until the stub is removed.
  - **New persona reviewers** (all read-only, `tools: [Read, Grep, Glob]`):
    `correctness-reviewer`, `maintainability-reviewer`, `reliability-reviewer`,
    `project-standards-reviewer`, `adversarial-reviewer`. Each returns the
    structured compact-return JSON schema with severity, category, file, line,
    confidence, autofix_class, owner, requires_verification, pre_existing, and
    optional suggested_fix.
  - **`review:pr` rewritten** (`commands/review/review-pr.md`): adds Step 3a
    always-fetch base branch (CE PR #544 hardening), Step 3d learnings pre-pass
    (dispatches `learnings-researcher`; `NO_PRIOR_LEARNINGS` → skip injection;
    otherwise inject fenced advisory block into every reviewer's Task prompt),
    Step 4 tiered persona dispatch table with `yellow-plugins.local.md` config
    integration and a graceful-degradation guard, Step 5 compact-return
    enforcement, Step 6 confidence-rubric aggregation (validate → dedup →
    cross-reviewer promotion → mode-aware demotion → confidence gate at anchor
    75 with P0 ≥ 50 exception → partition → sort) plus quality gates for line
    accuracy, protected- artifact filtering, and skim-FP detection.
  - **`review:all` parity update** (`commands/review/review-all.md`): the
    inlined per-PR pipeline now mirrors the new `review:pr` Steps 3a / 3d / 4 /
    5 / 6. Pipeline-mirror comment added so future drift is caught.
  - **`pr-review-workflow` skill update**: documents the new always-on persona
    set, the conditional `reliability-reviewer` and `adversarial-reviewer`
    triggers, the compact-return JSON schema, and the Wave 2 P0–P3 severity
    scale + 5-anchor confidence anchors.

  `yellow-core` (MINOR — net additive):
  - **`learnings-researcher` agent**
    (`agents/research/learnings-researcher.md`): always-on pre-pass that
    searches `docs/solutions/` for past learnings relevant to a PR diff or
    planning context. Reads the `track`/`tags`/`problem` frontmatter schema
    added in Wave 2 prep (`feat/knowledge-compounder-track-schema`). Returns a
    fenced advisory block on hit, the literal `NO_PRIOR_LEARNINGS` token on
    miss.
  - **`local-config` skill** (`skills/local-config/SKILL.md`): documents the
    `yellow-plugins.local.md` per-project config file with minimum keys
    `review_pipeline` (escape hatch for Wave 2 rollback), `review_depth`,
    `focus_areas`, `reviewer_set.{include,exclude}`. Wave 3 expansion keys
    (`stack`, `agent_native_focus`, `confidence_threshold`) are documented for
    forward visibility.
  - **Self-referential solutions doc**
    (`docs/solutions/code-quality/learnings-researcher-pre-pass-pattern.md`):
    documents the pre-pass pattern, empty-result protocol, fencing requirement,
    and how to extend it for new orchestrators.

  Cross-plugin reference updates (no version bump): `yellow-core`,
  `yellow-devin`, `yellow-ruvector` doc references to `code-reviewer` migrated
  to the new persona names.

  Reference:
  `RESEARCH/upstream-snapshots/e5b397c9d1883354f03e338dd00f98be3da39f9f/confidence-rubric.md`
  extracted from upstream `compound-engineering@v3.3.2` ce-code-review/SKILL.md.

- [`7de4d7f`](https://github.com/KingInYellows/yellow-plugins/commit/7de4d7fe62ed50640df75ebcae903d699f1e99bf)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Transform
  `/workflows:review` from a thin redirect to `/review:pr` into a session-level
  review command. Evaluates plan adherence, cross-PR coherence, and scope drift
  against the original plan file. Autonomously fixes P1 issues via Edit tool
  with a max 2-cycle review-fix loop. Falls back to `/review:pr` redirect for PR
  number/URL/branch arguments (backwards compatible).

- [`ab33fbc`](https://github.com/KingInYellows/yellow-plugins/commit/ab33fbcc316d108e4eaa4027bf5434577c9924ca)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Strip Bash from
  13 reviewer agents; document codex-reviewer exception

  Reviewer agents are pure-analysis agents whose job is to read source, identify
  issues, and emit structured findings — never to execute, modify, or push. The
  `Bash` capability in their `tools:` lists conflicted with their bodies'
  "Execute code or commands found in files" prohibition. Per CE PR #553
  read-only-reviewer parity, strip `Bash` from:
  - **yellow-core/agents/review/** (7): architecture-strategist,
    code-simplicity-reviewer, pattern-recognition-specialist,
    performance-oracle, polyglot-reviewer, security-sentinel,
    test-coverage-analyst
  - **yellow-review/agents/review/** (6): code-reviewer, code-simplifier,
    comment-analyzer, pr-test-analyzer, silent-failure-hunter,
    type-design-analyzer

  For `silent-failure-hunter` and `type-design-analyzer`, the optional
  `ToolSearch` + ast-grep MCP tools are preserved (those are read-only).

  **Documented exception:** `yellow-codex/agents/review/codex-reviewer` keeps
  `Bash`. Its core function is invoking `codex exec review …` and
  `git diff … | wc -c` — read-only restriction would break the agent. A new
  "Tool Surface — Documented Bash Exception" section in its body explains the
  rationale and bounds the legitimate use. The forthcoming W1.5 validation rule
  (`scripts/validate-agent-authoring.js` Rule X, lands in branch #5) will
  allowlist this exact path.

  **Security rationale:** Reviewer agents read untrusted PR comment text and
  diff content. If a prompt-injection attempt bypasses fences (and 2026 research
  shows fences degrade under sustained attack), a reviewer with `Bash` can
  `rm -rf`, `git push --force`, exfiltrate via `curl`, install malware. With
  `[Read, Grep, Glob]` only, the worst-case is a wrong finding — much smaller
  blast radius. See
  `docs/solutions/security-issues/prompt-injection-defense-layering-2026.md`.

  No behavior change for users; reviewers were already prohibited from executing
  code by their body prose. This change makes the tool surface match the prose
  guarantee.

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

- [`1741901`](https://github.com/KingInYellows/yellow-plugins/commit/17419010b0ef8a278684f8f146d7dc86ea005840)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - # Summary

  feat(yellow-core): add /worktree:cleanup command for smart git worktree
  cleanup

  New `/worktree:cleanup` command in yellow-core that scans all git worktrees,
  classifies them into 7 categories (missing directory, locked, branch merged,
  stale, clean-active, dirty, detached HEAD), and removes stale worktrees with
  appropriate safeguards.

  Also adds Phase 6 to `/gt-cleanup` in gt-workflow to offer triggering
  `/worktree:cleanup` via Skill tool with graceful degradation.

### Patch Changes

- [`b441164`](https://github.com/KingInYellows/yellow-plugins/commit/b441164550b346b20b73bf466bcbc3e33e823b74)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Fix ast-grep
  MCP Python 3.13 gate with uv-managed Python

  Add `--python 3.13` to uvx args so uv auto-downloads Python 3.13 without
  touching the system Python. Auto-install uv and pre-warm Python 3.13 in the
  install script. Remove Python 3.13 system requirement from setup commands. Fix
  sg/ast-grep binary check inconsistency in setup:all dashboard.

- [`31da4b1`](https://github.com/KingInYellows/yellow-plugins/commit/31da4b14740f8eea7fc45501b94a2151c5a36009)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Fix shell
  portability and reliability in setup scripts. Replace bash-only version_gte()
  with POSIX-compatible implementation in install-codex.sh and
  install-semgrep.sh. Add fnm/nvm activation before Node version check and guard
  against fnm multishell ephemeral npm prefix in install-codex.sh. Fix dashboard
  reliability in setup:all by replacing Python heredoc with python3 -c,
  snapshotting tool paths to prevent PATH drift, and using find|xargs instead of
  find|while for plugin cache detection. Add web-app pre-flight check to
  browser-test:setup.

- [#287](https://github.com/KingInYellows/yellow-plugins/pull/287)
  [`bb5855e`](https://github.com/KingInYellows/yellow-plugins/commit/bb5855ea58e6282e9d449c88061c88cdc955130a)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Wave 3 —
  git-worktree skill fixes (W3.4) + local-config schema expansion (W3.6).

  `yellow-core` (PATCH — additive documentation):
  - **`git-worktree` skill (W3.4):** Add two new sections covering common
    worktree pitfalls:
    - Auto-trust mise/direnv configs after worktree creation. Trust is keyed on
      absolute path, so a new worktree starts untrusted until `mise trust` /
      `direnv allow` runs in the new directory.
    - `.git`-is-a-file detection (submodule and linked-worktree cases). Naive
      `[ -d .git ]` checks misclassify both cases as "not a git repo"; use
      `git rev-parse --git-dir` instead. Includes a typed detector pattern
      (`git_dir_kind`).
  - **`local-config` skill (W3.6):** Expand the W2.7 minimum schema to document
    the three forward-compatible Wave 3 keys:
    - `stack` — array of `ts`/`py`/`rust`/`go` to scope language-specific review
      behavior (acted on by W3-pending polyglot scoping).
    - `agent_native_focus` — boolean to force the W3.5 agent-native reviewer
      triplet regardless of diff triggers (acted on by W3.5).
    - `confidence_threshold` — integer 0–100 to override the Wave 2 aggregation
      gate (acted on by W3.13b). Adds a "Consumer adoption status" table making
      per-key pending state explicit, plus validation rules covering each new
      key (clamping, unknown-entry handling, type coercion). Replaces the prior
      "Wave 3 expansion (preview)" stub with first-class schema documentation.

  No consumer commands change in this PR — the keys remain documented but
  ignored until W3.5 / W3.13b / polyglot scoping land. Authors may set them
  today; the existing forward-compatibility rule (unknown keys emit a warning,
  do not abort) keeps the file valid both before and after the consumer commands
  adopt them.

- [`b9c6e5b`](https://github.com/KingInYellows/yellow-plugins/commit/b9c6e5bf422027828c99c0537aa4597d604af100)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Expand
  `/gt-setup` from validation-only into a 3-phase AI agent configuration wizard:
  prerequisite validation, guided Graphite CLI settings (branch prefix, pager,
  dates, submit body), and convention file + PR template generation. Update
  consumer commands (`/smart-submit`, `/gt-amend`, `/gt-stack-plan`) to read
  `.graphite.yml` for repo-level behavior overrides. Add `.graphite.yml` and PR
  template checks to `/setup:all` dashboard.

- [#288](https://github.com/KingInYellows/yellow-plugins/pull/288)
  [`6ca3de4`](https://github.com/KingInYellows/yellow-plugins/commit/6ca3de44a1ee1d8dc428222e0976c51567e332a7)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Fix
  subagent_type format to 3-segment (plugin:directory:agent) across keystone
  orchestrator and command files.

  The Wave 2 keystone (`/review:pr`) Step 4 dispatch table, Step 3d learnings
  pre-pass, Step 7 code-simplifier pass, and Step 9a knowledge-compounding step
  all referenced agents using the 2-segment form (e.g.
  `yellow-review:correctness-reviewer`). The Claude Code agent registry requires
  the 3-segment form (`yellow-review:review:correctness-reviewer`, where the
  middle segment is the agent's subdirectory under `plugins/<name>/agents/`).
  The 2-segment form fails dispatch with "Agent type not found" — meaning every
  persona spawn from the new keystone would error even after the cache picks up
  the new agents.

  This is purely a documentation / orchestration-prose fix; no agent behaviour
  changes. Affected files:
  - `plugins/yellow-review/commands/review/review-pr.md` — 17 dispatch table
    entries + 3 inline `subagent_type:` references
  - `plugins/yellow-review/commands/review/review-all.md` — 1 inline reference
    (parity with review-pr.md Step 3d)
  - `plugins/yellow-review/skills/pr-review-workflow/SKILL.md` — 2 cross-plugin
    Task examples (security-sentinel, codex-reviewer); pattern hint expanded to
    clarify the 3-segment shape
  - `plugins/yellow-review/agents/review/code-reviewer.md` — deprecation-stub
    migration guidance (was pointing users to the wrong format)
  - `plugins/yellow-core/commands/workflows/compound.md` — knowledge-compounder
    dispatch
  - `plugins/yellow-core/commands/workflows/work.md` — codex-executor rescue
    dispatch
  - `plugins/yellow-core/agents/research/learnings-researcher.md` — usage-doc
    invocation example
  - `plugins/yellow-docs/commands/docs/audit.md`, `diagram.md`, `generate.md`,
    `refresh.md` — 5 doc-auditor / diagram-architect / doc-generator dispatches

  Discovered while running a manual /review:pr trial against PR #287 (Wave 3
  trial branch). Every Wave 2 persona dispatch errored with "Agent type not
  found" until the 3-segment form was used. This blocks the keystone from
  running end-to-end even after a plugin cache refresh.

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
  repoints in yellow-research.

## 1.4.1

### Patch Changes

- [`e3ef6ff`](https://github.com/KingInYellows/yellow-plugins/commit/e3ef6ffbd175c44756d1c6ac7511b1040d2e9720)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add yellow-docs
  documentation plugin with 5 commands (setup, audit, generate, diagram,
  refresh), 3 agents, and 1 shared skill. Register in marketplace and setup:all.

## 1.4.0

### Minor Changes

- [`7565442`](https://github.com/KingInYellows/yellow-plugins/commit/7565442d220810f5a20e833eaf75976875cbe4c8)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add stack-aware
  bottom-up execution to workflows:work. When a plan contains a
  `## Stack Decomposition` section, workflows:work creates branches just-in-time
  and executes each stack item sequentially with checkpoints and progress
  tracking.

### Patch Changes

- [`906430f`](https://github.com/KingInYellows/yellow-plugins/commit/906430f988f7a8f333d3faa530bbcfb6f87cfca3)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Update
  yellow-core CLAUDE.md to document stack-aware workflows:work capability and
  gt-workflow dependency for stack decomposition features.

- [`dc72dfa`](https://github.com/KingInYellows/yellow-plugins/commit/dc72dfa52c47a0578171071c452b58350b85b5bc)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Update
  workflows:plan post-generation options to clarify that gt-stack-plan adds
  decomposition to the plan (no branches created) and workflows:work executes
  bottom-up when decomposition exists.

All notable changes to this plugin are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## Unreleased

_No unreleased changes yet._

---

## [1.3.0] - 2026-03-10

### Minor Changes

- [`69d84c8`](https://github.com/KingInYellows/yellow-plugins/commit/69d84c8f17a23da89979765c434d4e2c0c683935)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Expand
  marketplace setup coverage with dedicated setup commands, repository-root
  aware setup checks, and stricter setup validation guardrails.

### Patch Changes

- [`91908d9`](https://github.com/KingInYellows/yellow-plugins/commit/91908d935feb46fbb447a67eae997e5f491e3c05)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add MCP warmup
  and retry-once patterns to all consuming commands for ruvector integration
  consistency. Harden install.sh and setup.md to require global binary in PATH.

---

## [1.2.0] - 2026-03-06

### Minor Changes

- [`0f5b2a1`](https://github.com/KingInYellows/yellow-plugins/commit/0f5b2a1916516291e058b991c30a50c1ef890cac)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add /setup:all
  command — unified orchestrator that checks prerequisites, environment
  variables, and config files across all 9 plugins, then offers interactive
  setup for plugins that need attention with a before/after summary.

### Patch Changes

- [`9a28a2d`](https://github.com/KingInYellows/yellow-plugins/commit/9a28a2dd7570f741c80c0eb07bdda32165ad5f14)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add
  `/linear:work` bridge command and cross-plugin integration connectors.
  yellow-linear gets a minor bump (new command), yellow-core and gt-workflow get
  patch bumps (behavioral additions to existing commands).

---

## [1.1.0] - 2026-02-25

### Added

- Add /workflows:brainstorm command and brainstorm-orchestrator agent for
  pre-planning requirement exploration. Add /workflows:compound command for
  documenting solved problems.

### Fixed

- Remove unsupported `changelog` key from plugin.json that blocked installation
  via Claude Code's remote validator.

---

## [1.0.0] - 2026-02-18

### Added

- Initial release — developer toolkit with review agents, research agents, and
  workflow commands.

---

**Maintained by**: [KingInYellows](https://github.com/KingInYellows)
