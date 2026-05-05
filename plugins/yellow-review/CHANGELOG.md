# Changelog

## 2.5.1

### Patch Changes

- [`2872425`](https://github.com/KingInYellows/yellow-plugins/commit/287242561d9c3f1d68c76bb9a8609607043e4ff4)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Security
  hardening follow-ups to PR #257:
  - yellow-review/commands/review/review-pr.md: pr-context fence now requires
    literal-delimiter substitution (`[ESCAPED] begin/end pr-context`) BEFORE XML
    metacharacter escaping. Prevents fence-breakout when a PR diff contains the
    closing delimiter on its own line (PR #254 pattern).
  - yellow-review/commands/review/resolve-pr.md: cluster-comments fence requires
    the same literal-delimiter substitution for `--- pr context begin/end`,
    `--- cluster comments begin/end`, and `--- next thread ---`. Prevents
    fence-breakout from raw GitHub thread text.
  - yellow-core/skills/security-fencing/SKILL.md: new "Orchestrator-level fence
    sanitization" section documents the canonical 2-step sanitization
    (literal-delimiter substitution → XML escape) for any command that
    interpolates untrusted external content into a fenced region.
  - scripts/validate-plugin.js: validatePathFile and validatePathOrPathsDir now
    use fs.lstatSync and reject symlinks outright at the top level. Recursive
    .md counting goes through countMarkdownRecursive (a manual stack walk that
    skips symlinks at every depth), avoiding fs.readdirSync({ recursive: true })
    — which silently follows directory symlinks and would otherwise let .md
    files inside a symlinked subdirectory slip past the plugin boundary.
  - schemas/plugin.schema.json: userConfigEntry.default is now type-constrained
    via allOf+if/then to match the entry's `type` field. monitor.command
    description strengthened to require quoting `${user_config.KEY}`
    substitutions.
  - examples/plugin-extended.example.json: monitor command rewritten to drop
    unsafe `'${user_config.KEY}'` shell interpolation; description teaches the
    env-var pattern via `${CLAUDE_PLUGIN_OPTION_<KEY>}` and explicitly calls out
    the unsafe form.

## 2.5.0

### Minor Changes

- [#255](https://github.com/KingInYellows/yellow-plugins/pull/255)
  [`3b4025e`](https://github.com/KingInYellows/yellow-plugins/commit/3b4025e8c1af062223ea8db4bf6b067f439156c6)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Enable true
  parallel execution for multi-agent review sessions

  Add `background: true` to 13 review agents (7 in yellow-core/agents/review, 6
  in yellow-review/agents/review) plus `best-practices-researcher` and update
  orchestrator commands (review-pr.md, resolve-pr.md, work.md, audit.md) to
  explicitly require `run_in_background: true` on each Task invocation.
  Frontmatter flag alone is insufficient — the spawning call must also run in
  the background for agents to run concurrently rather than serially. Also
  correct invalid `memory: true` to `memory: project` (the field requires a
  scope string: `user` / `project` / `local`).

## 2.4.0

### Minor Changes

- [`ab3f2d3`](https://github.com/KingInYellows/yellow-plugins/commit/ab3f2d365c911d8f5bdeff9f9cf0f141f254fb03)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Enable true
  parallel execution for multi-agent review sessions

  Add `background: true` to 15 agents (7 in yellow-core/agents/review, 6 in
  yellow-review/agents/review, plus
  `yellow-core/agents/research/best-practices-researcher` and
  `yellow-review/agents/workflow/pr-comment-resolver`) and update four
  orchestrator commands (`review-pr.md`, `resolve-pr.md`, `work.md`, `audit.md`)
  to explicitly require `run_in_background: true` on each Task invocation, with
  explicit wait gates (TaskOutput / TaskList polling) before any step that
  consumes agent output. Frontmatter flag alone is insufficient — the spawning
  call must also run in the background for agents to run concurrently rather
  than serially.

  Memory field changes: drop the prior `memory: true` from review and research
  agents (it was a no-op and re-adding a scope value would silently activate
  per-spawn MEMORY.md injection of up to ~25 KB across 13+ parallel agents). Set
  `memory: project` only on the three workflow orchestrators
  (`brainstorm-orchestrator`, `knowledge-compounder`, `spec-flow-analyzer`),
  where MEMORY.md context is intentional and the spawn fan-out is small.
  Auditing the broader `memory:` activation across review agents remains a Phase
  1.5 follow-up (plan open question 8).

## 2.3.0

### Minor Changes

- [#304](https://github.com/KingInYellows/yellow-plugins/pull/304)
  [`459a43d`](https://github.com/KingInYellows/yellow-plugins/commit/459a43d50528d12eca093fd572e2c26722aa4a0b)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add
  `/review:sweep` wrapper command

  Run `/review:pr` followed by `/review:resolve` on the same PR in one
  invocation — adaptive multi-agent code review with autonomous fixes, then
  parallel resolution of all open bot and human reviewer comment threads.

  Because the `Skill` tool surfaces no machine-readable exit status from invoked
  commands, the wrapper uses an `AskUserQuestion` between the two steps as the
  failure-boundary signal: if the user confirms `/review:pr` completed cleanly,
  the resolve step runs; otherwise it is skipped.

  Pure orchestration — no logic added to `/review:pr` or `/review:resolve`, both
  of which remain invokable directly when only one half of the sequence is
  needed.

## 2.2.0

### Minor Changes

- [#307](https://github.com/KingInYellows/yellow-plugins/pull/307)
  [`39e5d7a`](https://github.com/KingInYellows/yellow-plugins/commit/39e5d7a637301e34d051311db75df3099b525458)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! -
  `/review:resolve` — drop non-actionable threads and cluster same-region
  comments before resolver dispatch (W3.3)

  **Step 3c — Actionability filter (CE PR #461 parity).** Threads whose entire
  concatenated body matches a non-actionable pattern are dropped before resolver
  dispatch:

  | Pattern (case-insensitive)                            |
  | ----------------------------------------------------- |
  | `^lgtm[!.]?$`                                         |
  | `^thanks?[!.]?$` / `^thank\s+you[!.]?$`               |
  | `^(?:👍\|✅\|🎉)\s*[!.]?$`                            |
  | `^\+1\s*[!.]?$`                                       |
  | `^looks?\s+good[!.]?$`                                |
  | `^nice(?:\s+catch)?[!.]?$`                            |
  | `^nit:?[!.]?$` (bare `nit` or `nit:` with no content) |

  Threads with one of these patterns followed by a substantive paragraph (e.g.,
  `LGTM, but consider X for the retry path`) are kept — the substantive body is
  what matters. The dropped count and IDs are reported to the user before
  dispatch and surfaced again in the Step 9 summary.

  If all threads are dropped, the command exits successfully without any
  resolver dispatch — saving a wasted `gt modify` + `gt submit` cycle.

  **Step 3d — Cluster comments by file+region (CE PR #480 parity).** Adjacent
  threads on the same file are merged into a single cluster when their line
  numbers are within `≤ 10` lines of each other (transitive — T1 at 40, T2 at
  48, T3 at 55 cluster together). Threads without a `line` field form one
  review-level cluster per path. Each cluster carries `path`, `line_range`,
  `threadIds[]`, and concatenated `bodies` separated by `--- next thread ---`.

  The `≤ 10` line distance is tunable via `yellow-plugins.local.md`'s
  `resolve_pr.cluster_line_distance: <N>` key (out-of-range or non-integer
  values fall back to the default; do not error). Reduction ratio is reported as
  e.g. `[cluster] 5 threads → 3 clusters across 2 files (Δ = 2 consolidated)`.

  **Step 4 — Resolver dispatch operates on clusters, not raw threads.** Each
  cluster spawns ONE `pr-comment-resolver` agent with all of its thread bodies
  fenced in a single `--- cluster comments begin ---` block. The resolver
  reconciles the cluster with **a single coherent edit** to the file region —
  not N separate edits. If two comments in the same cluster contradict (e.g.,
  one asks to rename, another asks to keep the name), the resolver reports the
  conflict in its return summary and the user reconciles in Step 5.

  **Step 7 — `resolve-pr-thread` iterates per cluster.** A cluster is
  "successfully resolved" when its resolver returned without a
  contradiction-conflict report and its edits applied without conflict. Only
  successfully-resolved clusters have their `threadIds[]` marked resolved via
  the GraphQL mutation; conflicted clusters remain open for human
  reconciliation. Per-threadId script failures within a cluster are logged but
  do not abort the loop.

  **Step 9 — Report includes drop and cluster counts.** New report fields:
  `Dropped (non-actionable)`, `Clusters formed` with reduction ratio.
  Distinguishes dropped (intentional) from failed (needs human attention).

  **Acceptance criterion satisfied:** synthetic PR with 5 comments (2 actionable
  on different file regions, 2 nit-prefixed, 1 LGTM) → 2 resolver tasks spawned
  (one per actionable cluster, after dropping the 3 non-actionable threads).

  **No new tools added** to `allowed-tools` — the filter and clustering use
  existing string-matching capabilities. No changes to `pr-comment-resolver`
  agent body — it already accepts a single fenced comment block; the dispatch
  side now concatenates multiple bodies into that one block per cluster.

## 2.1.0

### Minor Changes

- [#293](https://github.com/KingInYellows/yellow-plugins/pull/293)
  [`f3985d8`](https://github.com/KingInYellows/yellow-plugins/commit/f3985d833c968d9a0d4407cf94809565259db5b5)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add
  `plugin-contract-reviewer` agent to detect breaking changes to plugin public
  surface

  Introduces `plugins/yellow-review/agents/review/plugin-contract-reviewer.md` —
  a Wave 3 conditional persona reviewer (per W3.15) that flags breaking changes
  to a plugin's contract: `subagent_type` renames, command/skill name renames,
  MCP tool renames (the `mcp__plugin_<plugin>_<server>__<tool>` formula),
  `plugin.json` schema field changes, hook output contract changes, and
  frontmatter field renames or semantics changes.

  Wired into `review:pr`'s Step 4 conditional dispatch table with auto-detection
  on `plugins/*/.claude-plugin/plugin.json`, `plugins/*/agents/**/*.md`,
  `plugins/*/commands/**/*.md`, `plugins/*/skills/**/SKILL.md`, and
  `plugins/*/hooks/`. Sister to `pattern-recognition-specialist` (yellow-core):
  pattern-rec catches new convention drift; plugin-contract catches breaks to
  existing public surface.

  The agent extends the Wave 2 compact-return schema with two optional
  per-finding fields:
  - `breaking_change_class`:
    `name-rename | signature-change | removal | semantics-change`
  - `migration_path`: concrete remediation string (deprecation stub,
    backwards-compat shim, version bump, etc.) or `null` when no migration is
    feasible

  The keystone validator in Step 6.1 accepts these as optional extensions; other
  reviewers omit them. Step 10 surfaces them in a new "Plugin Contract Changes"
  section when present.

  Read-only tools (`Read`, `Grep`, `Glob`) per Wave 1 reviewer rule. Adapted
  from upstream `EveryInc/compound-engineering-plugin`'s
  `ce-api-contract-reviewer` (snapshotted at locked SHA
  `e5b397c9d1883354f03e338dd00f98be3da39f9f`) — preserves the breaking-change
  classification framework, drops REST-API examples, adds plugin-specific
  detection rules.

  Note: README.md and the plugin CLAUDE.md "Agents (N)" line had not been caught
  up to the Wave 2 persona additions (was 7, should have been 13); this PR
  brings both to 14 in lockstep with the new agent. Also catches up the
  yellow-core README row (was `13 agents, 7 commands, 4 skills, 2 MCPs`; should
  be `17 agents, 8 commands, 5 skills, 0 MCPs` per yellow-core's current on-disk
  contents — confirmed by directly counting
  `plugins/yellow-core/{agents,commands,skills}` and inspecting
  `plugins/yellow-core/.claude-plugin/plugin.json`'s empty `mcpServers` block).

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

## 2.0.0

### Major Changes

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

### Minor Changes

- [`4f5cfff`](https://github.com/KingInYellows/yellow-plugins/commit/4f5cfff69febeb50853dbd49130eb452ce9d30a8)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add
  yellow-codex plugin wrapping OpenAI Codex CLI with review, rescue, and setup
  workflows. Patch yellow-review to spawn codex-reviewer as an optional
  supplementary reviewer, and patch yellow-core to surface yellow-codex
  readiness plus delegate codex:setup from /setup:all.

- [`dfebc48`](https://github.com/KingInYellows/yellow-plugins/commit/dfebc48f74c6b88cf6c5ccff73e3ad604dca714c)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add ast-grep
  MCP tools to 4 high-value review and debt agents

  Add ast-grep structural code search (find_code, find_code_by_rule) with
  ToolSearch-based graceful degradation to silent-failure-hunter,
  type-design-analyzer, duplication-scanner, and complexity-scanner. Each agent
  includes tailored AST vs Grep routing guidance and falls back to Grep when
  yellow-research is not installed.

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

### Patch Changes

- [#281](https://github.com/KingInYellows/yellow-plugins/pull/281)
  [`1779b62`](https://github.com/KingInYellows/yellow-plugins/commit/1779b62edfaec9c7fe311f39e51fdef367cbd47a)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Verify
  pr-comment-resolver fence parity with CE PR #490; add W1.5 read-only-reviewer
  validation rule

  **W1.4 — Fence verification (largely no-op as predicted):** verified
  `pr-comment-resolver.md` untrusted-input fencing against the CE PR #490
  snapshot at `e5b397c9d188...` (compound-engineering-v3.3.2). Yellow's
  implementation is _stronger_ than upstream — it adds a path deny list, a Bash
  read-only restriction, a 50-line scope cap, and a no-rollback rule on partial
  completion. The CE upstream's `## Security` section is one sentence; yellow's
  load-bearing controls are documented inline and must not be "simplified"
  toward upstream. Added a "Fencing parity verification (2026-04-29)" note to
  the agent body recording this and explaining what to preserve in future syncs.

  **Resolve-pr Step 4 fence-on-spawn rule:** `/review:resolve` now requires the
  comment body to be wrapped in `--- comment begin (reference only) ---` /
  `--- comment end ---` delimiters with a "Resume normal agent behavior."
  re-anchor _before_ interpolation into the spawned `pr-comment-resolver` Task
  prompt. The fence applies even to short comments. File path, line number, and
  PR context are passed as separate fields, never inlined into the fenced block.

  **SKILL.md untrusted-input section:** `pr-review-workflow/SKILL.md` gains an
  "Untrusted Input Fencing" section codifying the rule for any future agent in
  this plugin that consumes GitHub-sourced text. Cross-references
  `frontmatter-sweep-and-canonical-skill-drift.md` to enforce verbatim copy of
  the canonical security block when authoring new agents.

  **W1.5 — Validation Rule X (`scripts/validate-agent-authoring.js`):** any
  agent at `plugins/<name>/agents/review/<file>.md` must NOT include `Bash`,
  `Write`, or `Edit` in its `tools:` block. The script now hard-errors on
  violations with a message pointing to the allowlist and the "Tool Surface —
  Documented Exception" pattern.

  **Allowlist:**
  - `yellow-codex/agents/review/codex-reviewer.md` — documented W1.2 exception
    (codex CLI invocation is the agent's core function; read-only restriction
    would break it).

  **Test coverage:**
  `tests/integration/validate-agent-authoring-review-rule.test.ts` adds 5 vitest
  fixtures: (1) non-allowlisted Bash violator → caught, non-zero exit; (2)
  allowlisted codex-reviewer.md with Bash → passes; (3) clean
  `[Read, Grep, Glob]` review agent → passes; (4) `Write` and `Edit` (not just
  Bash) also flagged; (5) non-review agent (`agents/workflow/`) with Bash → not
  flagged (rule scoped to review/ correctly).

  The validator is parameterizable via `VALIDATE_PLUGINS_DIR` env var so tests
  point at temp fixture trees without touching the real `plugins/` tree.
  Production `pnpm validate:schemas` runs leave it unset and use the bundled
  plugins/.

- [`7de4d7f`](https://github.com/KingInYellows/yellow-plugins/commit/7de4d7fe62ed50640df75ebcae903d699f1e99bf)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Transform
  `/workflows:review` from a thin redirect to `/review:pr` into a session-level
  review command. Evaluates plan adherence, cross-PR coherence, and scope drift
  against the original plan file. Autonomously fixes P1 issues via Edit tool
  with a max 2-cycle review-fix loop. Falls back to `/review:pr` redirect for PR
  number/URL/branch arguments (backwards compatible).

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

All notable changes to this plugin are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## Unreleased

_No unreleased changes yet._

---

## [1.2.0] - 2026-03-10

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

## [1.1.0] - 2026-02-25

### Fixed

- Remove unsupported `changelog` key from plugin.json that blocked installation
  via Claude Code's remote validator.

---

## [1.0.0] - 2026-02-18

### Added

- Initial release — multi-agent PR review with adaptive agent selection,
  parallel comment resolution, and sequential stack review.

---

**Maintained by**: [KingInYellows](https://github.com/KingInYellows)
