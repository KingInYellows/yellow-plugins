# yellow-plugins Audit Report

**Generated:** 2026-05-07
**Scope:** read-only audit of the marketplace + 18 plugins under `plugins/`
**Toolchain run:** `pnpm validate:schemas` (full pipeline: marketplace → plugin → setup-all → agent-authoring), plus targeted `find`/`grep`/`jq`/`awk` introspection of every `.claude-plugin/plugin.json`, every `commands/*.md`, every `agents/**/*.md`, every `skills/<name>/SKILL.md`, every hook script, and every `.mcp.json`-equivalent `mcpServers` block.

---

## Executive summary (5 bullets)

- **The marketplace is structurally healthy.** All 18 plugin manifests pass `validate-marketplace.js`, `validate-plugin.js`, and `validate-setup-all.js`. The single ERROR raised by `validate-agent-authoring.js` is a **false positive** in the validator itself, not a runtime defect (`yellow-review/CHANGELOG.md` documents a deprecated agent stub, and the validator greps prose without distinguishing it from declarations).
- **`yellow-core` is the agent backbone.** Its review and research personas (knowledge-compounder, learnings-researcher, brainstorm-orchestrator, repo-research-analyst, etc.) are dispatched from at least four other plugins. A single 3-segment subagent_type rename in `yellow-core` would ripple through the marketplace — and three callers in `yellow-core/commands/workflows/plan.md` are still on the **legacy 2-segment form**, surfaced as INFO warnings.
- **Hook surface is small but session-start is dominated by yellow-morph.** Only 5 plugins ship hooks; 4 of them fire on SessionStart in parallel. yellow-morph's prewarm hook has a **30-second timeout** on the hot path, which sets the floor for cold-session latency for any user who installs morph. This is the single largest user-visible perf cost in the marketplace.
- **Cross-plugin "silent" dependencies exist but degrade gracefully.** yellow-debt's `/debt:sync`, yellow-ci's `/ci:report-linear`, and yellow-chatprd's `/chatprd:link-linear` all silently require yellow-linear's MCP. yellow-linear's `/linear:delegate` requires yellow-devin's userConfig env. These are documented in some cases (per-skill, per-CLAUDE.md) but no single index lists them — making install-time failures opaque.
- **Highest-impact, lowest-effort cleanup.** Three INFO warnings + one ERROR + one WARNING are already surfaced by the validators and trivially fixable. The largest *correctness* find is the 30s morph prewarm; the largest *architecture* find is that the validator itself trips on its own CHANGELOG (a tooling improvement, not a content fix).

---

## 1. Repository map

```text
yellow-plugins/                          # pnpm monorepo (no published runtime)
├── .claude-plugin/marketplace.json      # 18-plugin catalog, schema-validated
├── plugins/                             # 18 plugins (auto-discovery)
│   ├── gt-workflow/                     # 7 cmds, 0 agents, 0 skills, 2 hooks, 1 MCP
│   ├── yellow-core/                     # 8 cmds, 18 agents, 17 skills (backbone)
│   ├── yellow-linear/                   # 9 cmds, 3 agents, 1 skill, 1 MCP
│   ├── yellow-devin/                    # 10 cmds, 1 agent, 1 skill, 2 MCPs
│   ├── yellow-chatprd/                  # 6 cmds, 4 agents, 1 skill, 1 MCP
│   ├── yellow-review/                   # 5 cmds, 16 agents, 1 skill
│   ├── yellow-ruvector/                 # 6 cmds, 2 agents, 3 skills, 5 hooks, 1 MCP
│   ├── yellow-browser-test/             # 4 cmds, 3 agents, 2 skills
│   ├── yellow-debt/                     # 6 cmds, 7 agents, 1 skill, 1 hook
│   ├── yellow-ci/                       # 9 cmds, 4 agents, 2 skills, 1 hook
│   ├── yellow-composio/                 # 2 cmds, 0 agents, 1 skill, 1 MCP, 2 userConfig
│   ├── yellow-research/                 # 4 cmds, 2 agents, 1 skill, 6 MCPs
│   ├── yellow-morph/                    # 2 cmds, 0 agents, 0 skills, 1 hook, 1 MCP
│   ├── yellow-semgrep/                  # 5 cmds, 2 agents, 1 skill, 1 MCP
│   ├── yellow-docs/                     # 6 cmds, 10 agents, 1 skill
│   ├── yellow-codex/                    # 4 cmds, 3 agents, 1 skill
│   ├── yellow-council/                  # 2 cmds, 2 agents, 1 skill
│   └── yellow-mempalace/                # 6 cmds, 2 agents, 2 skills, 1 MCP
├── packages/{domain,infrastructure,cli} # Layered TS validators (never published)
├── schemas/                             # Local JSON schemas (drift from remote possible)
└── scripts/                             # validate-{marketplace,plugin,setup-all,agent-authoring,versions}.js
```

**Aggregate:** 18 plugins · 105 commands · 79 agents · 38 skills · 9 inline-hook entries (across 5 plugins) · 16 MCP servers (across 11 plugins) · 9 userConfig entries (across 6 plugins).

---

## 2. Workflow analysis (top 7)

| ID | Workflow | Entry point | Agents/commands chained | Output |
|---|---|---|---|---|
| W1 | Brainstorm → Plan → Work → Review → Compound | `/workflows:brainstorm` | brainstorm-orchestrator → /workflows:plan (repo-research-analyst, best-practices-researcher, spec-flow-analyzer, optionally research-conductor + devin-orchestrator) → /workflows:work → /review:pr → /review:resolve → /workflows:compound (knowledge-compounder) | docs/{brainstorms,plans,solutions}/<slug>.md, MEMORY.md |
| W2 | CI failure → Linear bug | `/ci:status` | failure-analyst → optional runner-diagnostics → /ci:report-linear (yellow-linear MCP create_issue) | Linear issue, diagnosis report |
| W3 | Tech-debt audit cycle | `/debt:audit` (preceded by SessionStart hook seeding `.debt/`) | 5 parallel scanners (ai-pattern, architecture, complexity, duplication, security-debt) → audit-synthesizer (opus) → /debt:triage → /debt:fix → /debt:sync | `.debt/` artefacts, optional Linear issues |
| W4 | Document/PRD lifecycle | `/chatprd:create` | /docs:review (6 always-on personas + adversarial conditional) → /chatprd:link-linear → /linear:work → optional /linear:delegate | ChatPRD doc, Linear issues, possible Devin session |
| W5 | Research-first dev | `/research:code` (inline) or `/research:deep` | research-conductor (opus) → /workflows:deepen-plan annotates an existing plan | docs/research/<slug>.md, annotated plan |
| W6 | Multi-lineage review | `/review:pr` | In-house adaptive personas → /codex:review → /council (Codex+Gemini+OpenCode in parallel) | Tiered P0/P1/P2/P3 findings |
| W7 | Agent-memory cycle (passive) | SessionStart | yellow-ruvector hooks_recall + yellow-morph prewarm → UserPromptSubmit context inject → Pre/PostToolUse record → Stop flush | `ruvector.db`, recalled context, learning logs |

### Cross-plugin collaboration matrix (caller → callee)

Edge weight = static `subagent_type` references (excluding self-loops).

| Caller \ Callee | core | review | research | docs | devin |
|---|---|---|---|---|---|
| yellow-core | self | — | 1 | — | 1 |
| yellow-review | 3 | self | — | — | — |
| yellow-docs | 1 | — | — | self | — |
| yellow-research | 1 | — | self | — | — |
| yellow-devin | — | 1¹ | — | — | self |

¹ = the deprecated `yellow-review:review:code-reviewer` stub referenced from the CHANGELOG; not a live edge.

### MCP cross-consumption (plugins consuming each other's MCP tools)

| MCP | Consumed by |
|---|---|
| yellow-linear | yellow-debt (`/debt:sync`), yellow-ci (`/ci:report-linear`), yellow-chatprd (`/chatprd:link-linear`) |
| yellow-devin | yellow-linear (`/linear:delegate`) |
| yellow-ruvector | All plugins via `mcp-integration-patterns` skill (recall/remember pattern) |
| yellow-morph | All plugins via `morph-discovery-pattern` skill (deferred-tool discovery) |

### Silent dependencies (caller → undeclared dep)

| Consumer | Implicit dep | Symptom if missing |
|---|---|---|
| `/debt:sync` | yellow-linear MCP | `mcp__plugin_yellow-linear_linear__create_issue` not registered → silent failure |
| `/ci:report-linear` | yellow-linear MCP | same |
| `/chatprd:link-linear` | yellow-linear MCP | same |
| `/linear:delegate` | yellow-devin userConfig (`DEVIN_SERVICE_USER_TOKEN`) | 401 from Devin API |
| `/council` Codex leg | yellow-codex installed + Codex CLI | Council reports "Codex unavailable" — graceful but not first-class |

---

## 3. Findings

Severity legend: **S1** = breaks functionality · **S2** = breaks workflow but plugin still loads · **S3** = friction or maintenance debt · **S4** = polish.

### Manifest & structure

| ID | Sev | Evidence | Description | Fix | Effort |
|---|---|---|---|---|---|
| M-01 | S3 | `CLAUDE.md:8` | Repo CLAUDE.md says *"marketplace (14 plugins under `plugins/`)"*; actual count is 18 (4-plugin drift since the doc was written). | Update to "(18 plugins …)". Optional: derive count via a doc-build hook that reads `.claude-plugin/marketplace.json`. | S |
| M-02 | S4 | `plugins/yellow-morph/hooks/scripts/prewarm-morph.sh` is `rw-r--r--` | Hook is invoked via `bash …prewarm-morph.sh` so the missing exec-bit doesn't break it, but `validate-plugin.js` flags it and it's the only hook script in the repo without `+x`. | `chmod +x plugins/yellow-morph/hooks/scripts/prewarm-morph.sh`. | S |
| M-03 | S4 | `plugins/yellow-devin/commands/devin/README.md` | A `README.md` lives inside `plugins/yellow-devin/commands/devin/` — it is auto-discovered as a "command" by `find …/commands -name '*.md'`. It has no frontmatter so Claude Code won't list it, but inflates the command count and is a portable trip hazard. | Move to `plugins/yellow-devin/docs/README.md` or `plugins/yellow-devin/CLAUDE.md`. | S |

### Skills (38 total)

| ID | Sev | Evidence | Description | Fix | Effort |
|---|---|---|---|---|---|
| S-01 | S3 | `plugins/yellow-core/skills/create-agent-skills/SKILL.md` (513 lines) | Crosses the 500-line guideline (Anthropic soft outer bound). The repo's own CLAUDE.md says "line counts are guidelines, not hard caps", so this is a *review-trigger*, not a defect. Worth audit for redundancy. | Diff against `optimize/SKILL.md` (461) and `git-worktree/SKILL.md` (440) — these three together exceed 1400 lines of authoring guidance. Consider extracting shared frontmatter rules into a sub-reference. | M |
| S-02 | S4 | `gt-workflow/commands/gt-amend.md:3-5`; `yellow-ruvector/commands/ruvector/setup.md:3-5` | Both files use the YAML "value-on-next-line + leading-whitespace continuation" form (`description:\n  '…'`). MEMORY.md notes that *multi-line single-quoted descriptions are silently truncated by Claude Code's frontmatter parser*. The available-skills list at session-start renders both correctly in this Claude Code version, so **the risk is forward-compat, not present**. | Convert both to single-line `description: '…'`. | S |
| S-03 | S3 | All 18 plugins | Of 38 skills, only 9 are `user-invokable: true`. The other 29 are pure-reference convention skills shared between agents. Skills without `user-invokable` only auto-trigger via description-match — meaning a typo or weak description hides them from agents. **No bad descriptions found**, but maintenance load is real: every reference skill needs its description re-read whenever the rules change. | Add an automated "skill description lint" — e.g., a `scripts/validate-skill-descriptions.js` that requires every skill description to contain a "Use when…" clause and a topic anchor (`yellow-core/CLAUDE.md` already requires this for agents). | M |

### Commands (105 total)

No findings of redundant skill-vs-command pairs (`grep` confirmed: zero name overlaps).

| ID | Sev | Evidence | Description | Fix | Effort |
|---|---|---|---|---|---|
| C-01 | S4 | `plugins/gt-workflow/commands/{gt-amend,gt-sync,gt-nav,gt-stack-plan,gt-cleanup,gt-setup,smart-submit}.md` | Seven commands in gt-workflow are un-namespaced (no `gt-workflow:` prefix). Pre-namespacing convention — *intentional*, but means any future plugin adding a generic `smart-submit` would collide silently. | Decide either: (a) leave as-is and document the namespace exception in `gt-workflow/CLAUDE.md`, or (b) deprecate to `gt-workflow:amend`, `gt-workflow:sync`, etc., with backward-compat aliases for one minor cycle. | M |
| C-02 | S2 | `plugins/yellow-core/commands/workflows/plan.md:90,98,132` | Three legacy 2-segment `subagent_type:` values: `yellow-core:repo-research-analyst`, `yellow-core:best-practices-researcher`, `yellow-core:spec-flow-analyzer`. `validate-agent-authoring.js` raises INFO; the runtime expects 3-segment form (`yellow-core:research:repo-research-analyst`, etc.). The plan command is one of the most-used in the repo. | Edit those three values to the 3-segment form. The agent files already exist at the expected paths. | S |

### Agents (79 total)

| ID | Sev | Evidence | Description | Fix | Effort |
|---|---|---|---|---|---|
| A-01 | S3 | `plugins/yellow-core/agents/review/{architecture-strategist,security-sentinel,security-reviewer,performance-oracle,performance-reviewer,polyglot-reviewer,test-coverage-analyst}.md` and 67 others | 74 of 79 agents have `model: inherit` (or no model field). Only 5 pin a model: `architecture-strategist`/`audit-synthesizer`/`research-conductor` → opus, `coherence-reviewer` → haiku, `design-lens`/`scope-guardian`/`security-lens-reviewer` → sonnet. **This means review quality varies by whatever model the user is currently on.** For agents whose value depends on depth (security-sentinel, performance-oracle, adversarial-reviewer), inheritance is risky. | Pin opus for the 4–6 deep-analysis personas (security-sentinel, performance-oracle, adversarial-reviewer, audit-synthesizer is already opus). Pin sonnet for the rest of the always-on review personas. Pin haiku for shallow string-pattern personas (comment-analyzer, project-standards-reviewer). | M |
| A-02 | S3 | All 79 agents | None of the 79 agents declare a `tools:` restriction in frontmatter (`(none)` printed for every row in Phase 1). Plugin agents inherit the parent's tool set, which is permissive by default. **No actual exfil hazard found**, but a research-only agent like `learnings-researcher` should not need `Edit` or `Write`. | For research/review agents that should not modify the workspace, add `tools: [Read, Grep, Glob]`. For workflow agents that need to write reports, list tools explicitly. Start with the 4 yellow-core/research agents and the 16 yellow-review personas. | L |

### Hooks (9 inline entries across 5 plugins)

| ID | Sev | Evidence | Description | Fix | Effort |
|---|---|---|---|---|---|
| H-01 | S2 | `plugins/yellow-morph/.claude-plugin/plugin.json` SessionStart `timeout: 30` | The morph prewarm hook is the dominant SessionStart latency for any user who has yellow-morph installed. Three other plugins also fire SessionStart (yellow-ci 3s, yellow-debt 3s, yellow-ruvector 3s) — they all run in parallel, so wall-clock = max ≈ 30s every cold session. | Make prewarm async or move it out of SessionStart. Options: (a) lazy-warm on first morph tool call, (b) drop the prewarm and rely on first-call cold start, (c) keep SessionStart but cap to 5s with a "best-effort" semantics. | M |
| H-02 | S3 | `plugins/yellow-ruvector/.claude-plugin/plugin.json` PreToolUse / PostToolUse `timeout: 1` | A 1-second timeout fires on **every** Bash/Edit/Write/MultiEdit. The handler at `hooks/scripts/pre-tool-use.sh` does `cat` stdin → `jq` parse → directory check → optional `hooks_recall` MCP call. If `.ruvector/` exists and the recall path is ever taken in <1s, fine; if not, the hook silently times out and the user's edit/bash proceeds without recall. | Either (a) raise to 3s and add explicit fast-path guard so the hook returns `{"continue": true}` within 200ms when no recall is warranted, or (b) keep 1s but add telemetry to count timeouts per session. | M |
| H-03 | S3 | gt-workflow PreToolUse Bash matcher + yellow-ruvector PreToolUse Bash matcher | Both fire on every Bash. They are correctly independent (each outputs its own `{"continue": true}`), but a user editing many files sees 2× hook latency on every tool call. | Document in CLAUDE.md as a known interaction; no code fix needed unless H-02 is addressed first. | S |
| H-04 | S4 | `plugins/yellow-ci/hooks/hooks.json`, `plugins/yellow-debt/hooks/hooks.json`, `plugins/yellow-ruvector/hooks/hooks.json`, `plugins/yellow-morph/hooks/hooks.json`, `plugins/gt-workflow/hooks/hooks.json` | All five plugins ship a `hooks/hooks.json` reference file alongside the inline `plugin.json.hooks` block. MEMORY.md notes the file is reference-only since 2026; only some carry the `_comment` annotation. | Spot-check each `hooks/hooks.json` for the `"_comment"` key and timeout-drift against `plugin.json`. (yellow-morph's `hooks/hooks.json` was previously confirmed non-authoritative.) | S |

### Cross-plugin

| ID | Sev | Evidence | Description | Fix | Effort |
|---|---|---|---|---|---|
| X-01 | S2 | `plugins/yellow-debt/commands/debt/sync.md`, `plugins/yellow-ci/commands/ci/report-linear.md`, `plugins/yellow-chatprd/commands/chatprd/link-linear.md` | Three commands silently depend on yellow-linear MCP without declaring it in `plugin.json.dependencies` (which is `{}` for all 18 plugins). Install-time failure mode is opaque: command runs, MCP tool is missing, error trickles up as "tool not found". | Either (a) document the dependency in each command's prose + `setup.md` (already partially done), or (b) extend `plugin.json.dependencies` schema to express soft cross-plugin deps and have `validate-plugin.js` warn at validation time. | M |
| X-02 | S3 | `plugins/yellow-review/CHANGELOG.md:52,55,60,89,96` | The CHANGELOG documents the deprecation of `yellow-review:review:code-reviewer` in correct prose form, but `validate-agent-authoring.js` greps every `.md` for `subagent_type: "<plugin>:<dir>:<name>"` strings without distinguishing prose from declarations. **This is a tooling defect, not a content defect** — the validator currently produces a hard ERROR for a *correct* CHANGELOG entry. | Improve `validate-agent-authoring.js` to skip `CHANGELOG.md` files OR to require the `subagent_type:` value to be in YAML frontmatter context (i.e., between `---` blocks), not in fenced code or prose. | M |
| X-03 | S3 | `yellow-core/agents/review/code-simplicity-reviewer.md`, `yellow-review/agents/review/code-simplifier.md`, `yellow-core/agents/review/security-lens.md`, `yellow-docs/agents/review/security-lens-reviewer.md` | Near-duplicate agent short names across plugins. FQDNs disambiguate at the runtime level, but a contributor reading two files named `security-lens*.md` cannot tell which one a plan dispatches without expanding the 3-segment form. | Add a one-line "namespace" header inside each agent body (e.g., `**FQDN:** yellow-core:review:security-lens`) so a reader sees the disambiguator without grepping plugin.json. | S |

### Code quality (handler scripts, hook commands)

| ID | Sev | Evidence | Description | Fix | Effort |
|---|---|---|---|---|---|
| Q-01 | none | All hook scripts | **No `set -e` violations** found across the 10 hook scripts. All use `set -uo pipefail` per MEMORY.md guidance and centralize exit via `json_exit`. Exemplar: `plugins/yellow-ruvector/hooks/scripts/pre-tool-use.sh:5-12`. | None — keep this as the in-repo canon. | — |
| Q-02 | none | All hook scripts | All handler paths use `${CLAUDE_PLUGIN_ROOT}` (verified by `jq -r '.hooks[][].hooks[][].command'` across all five plugin manifests). No `BASH_SOURCE` usage. | None. | — |
| Q-03 | S4 | `plugins/yellow-morph/hooks/scripts/prewarm-morph.sh` (and all WSL2-authored scripts) | Repo's `.gitattributes` enforces LF, but MEMORY.md notes the WSL2 `Write` tool produces CRLF; scripts created during a WSL2 session need `sed -i 's/\r$//'`. No CRLF found in current HEAD, but it's a recurring incident. | Add a pre-commit hook (or a check inside `validate-plugin.js`) that fails on any tracked `.sh` containing CR. | S |

### Findings I checked for and did NOT find (avoid padding)

- No skill SKILL.md exceeds 600 lines (max: 513).
- No agent has a `permissionMode:` field (correctly dropped per MEMORY.md "subagent frontmatter field catalog").
- No multi-line single-quoted descriptions (the truncation pattern from MEMORY.md). Two folded-block descriptions found, both currently render — flagged S4 only.
- No hook with `matcher: "*"` doing slow work (the 4 SessionStart `*` matchers are correct — that event is global by definition).
- No PostToolUse used for blocking, no Stop hook with infinite-loop risk.
- No hardcoded absolute paths or credentials in handler scripts.
- No namespace collisions between live commands.

---

## 4. Prioritized improvement plan

Ranked by **(severity × payoff) ÷ effort**. Each item names the files it changes.

| Rank | Item | Severity | Effort | Files | Expected impact |
|---|---|---|---|---|---|
| 1 | **C-02** Update legacy 2-segment subagent_types in `plan.md` | S2 | S | `plugins/yellow-core/commands/workflows/plan.md:90,98,132` | Removes 3 INFO warnings; future-proofs against the gate becoming hard-fail. plan.md is the entry point of W1. |
| 2 | **X-02** Fix `validate-agent-authoring.js` so CHANGELOGs don't trip it | S3 | M | `scripts/validate-agent-authoring.js` | Removes a hard ERROR that currently blocks `pnpm release:check`. Eliminates the single biggest contributor frustration when CHANGELOGs document deletions. |
| 3 | **H-01** Make morph prewarm async or lazy | S2 | M | `plugins/yellow-morph/.claude-plugin/plugin.json`, `plugins/yellow-morph/hooks/scripts/prewarm-morph.sh` | Up to **30s shaved off cold-session latency** for every yellow-morph user. Single biggest perf win in the marketplace. |
| 4 | **X-01** Declare cross-plugin MCP dependencies | S2 | M | `schemas/plugin.schema.json`, `scripts/validate-plugin.js`, 3 plugin manifests | Install-time clarity for `/debt:sync`, `/ci:report-linear`, `/chatprd:link-linear`. Prevents silent failure mode when yellow-linear isn't installed. |
| 5 | **A-01** Pin models on the deep-analysis review personas | S3 | M | `plugins/yellow-core/agents/review/{security-sentinel,performance-oracle}.md` (+ 2-3 yellow-review personas) | Stabilizes review quality across users on different default models. Already partially done (5 pinned today); extending to ~10 covers all the high-stakes personas. |
| 6 | **M-01** Update plugin count in CLAUDE.md | S3 | S | `CLAUDE.md:8` | Cheap — gets `14 → 18` right. Onboarding fix. |
| 7 | **C-01** Decide gt-workflow namespacing policy | S4 | M | `plugins/gt-workflow/commands/*.md`, `plugins/gt-workflow/CLAUDE.md` | Prevents future `smart-submit` collision. Aliases give one minor cycle of overlap. |
| 8 | **A-02** Restrict tools on research/review agents | S3 | L | 20+ agent files in yellow-core, yellow-review, yellow-research | Tightens blast radius (e.g., `learnings-researcher` cannot Write). Mostly hygiene — no current incident. |
| 9 | **S-01** Audit `create-agent-skills` (513 lines) for redundancy | S3 | M | `plugins/yellow-core/skills/create-agent-skills/SKILL.md` | Cuts skill load time slightly; reduces duplication with `optimize/SKILL.md` and `git-worktree/SKILL.md`. |
| 10 | **M-02** `chmod +x` morph prewarm hook | S4 | S | `plugins/yellow-morph/hooks/scripts/prewarm-morph.sh` | Removes the lone WARNING from `pnpm validate:schemas`. |

---

## 5. Risks & open questions

1. **CHANGELOG-grep false positives may re-occur.** Until X-02 lands, any future deprecation note that mentions a removed agent's FQDN will block `pnpm release:check`. Maintainers must keep mentioning removed agents using a non-`subagent_type:` formulation (e.g., back-quoted `\`yellow-review:review:code-reviewer\``) until the validator is fixed.
2. **Local schema vs remote validator drift.** `pnpm validate:schemas` passing does not guarantee Claude Code's remote validator accepts an install. The plugin.json `changelog`/`pattern`/`userConfig.type+title` history suggests this drift is expected. Any audit fix that touches schemas must be tested on a fresh `claude plugin install` before tagging.
3. **A-02 (tool restrictions) requires a per-agent decision.** Some review agents legitimately need `Edit`/`Write` (autonomous P1 fixers). Don't blanket-deny — audit each agent for the workflow step it serves.
4. **The 30s morph prewarm may be load-bearing.** Making it async (H-01) means the *first* `morph` tool call after session-start may be slow instead of session-start itself. Verify with the yellow-morph maintainer that lazy warm is acceptable before changing.
5. **Doc count drift (M-01) is symptomatic.** It suggests no automation derives the count from `marketplace.json`. The same drift may exist in `README.md` "consumer count" and other narrative docs. A doc-build hook that renders these from JSON would prevent recurrence.
6. **No PR/changeset enforcement was checked.** This audit was scoped to plugin/manifest/skill/agent/hook content; the changeset gate and version-sync rules were assumed working because `validate-versions.js` is part of the validation chain.
7. **Hook latency analysis is theoretical.** Real wall-clock measurements (especially for H-01 and H-02) require running Claude Code with hooks-debug enabled and timing SessionStart cold-starts on a representative machine. The 30s figure is the declared timeout, not the observed latency.

---

*End of audit. No source files were modified; the only file written is this `AUDIT_REPORT.md`.*
