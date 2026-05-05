# yellow-plugins ↔ EveryInc/compound-engineering-plugin Merge Plan

> **Read this first.** yellow-plugins is **not a git fork** of EveryInc/compound-engineering-plugin. The earliest commit (42926be, 2026-01-10) is "Add PRD for KingInYellows Plugin Marketplace" — a fresh pnpm monorepo. There is no merge history, shared SHA, or fork ancestry from EveryInc. The origin remote is KingInYellows/yellow-plugins.git only.
>
> What you actually have is a **concept-fork**: yellow-core's commands/workflows/{plan,work,review,brainstorm,compound}.md plus eight reviewer/research agents whose names match upstream's pre-v2.38.0 naming (workflows:\* instead of ce-\*, architecture-strategist instead of ce-architecture-strategist). Per upstream CHANGELOG, that naming was retired on **2026-03-01** (v2.38.0, the workflows:\* → ce:\* rename). Your concept-fork therefore mirrors upstream's state from **before March 2026**, predating the entire skills-first migration, the tiered persona reviewer pipeline (#348/#371), and the marketplace split (plugins/compound-engineering/).
>
> **The most important architectural decision this document forces is §3 P0:** do you adopt upstream's ce-\* skill-first architecture wholesale into a single yellow-compound plugin, or do you keep your 16-plugin marketplace shape and only port specific reviewer agents and the persona pipeline pattern? Every individual component decision below is downstream of that call.

## 1. Inventory Diff Table

Sorted: UNIQUE → DRIFTED → MISSING → OBSOLETE → RENAMED → MATCH. Component naming uses upstream's ce-\* form on the right side; left side ("Mine") shows the actual yellow-plugins path. Counts: **UNIQUE=43, DRIFTED=15, MISSING=43, OBSOLETE=1, RENAMED=5, MATCH=8** (totals 115 components compared).

| **Component** | **Type** | **Mine** | **Upstream** | **Status** | **Notes** |
| --- | --- | --- | --- | --- | --- |
| gt-workflow (entire plugin) | plugin | plugins/gt-workflow/ | — | UNIQUE | 7 commands + 2 hooks; Graphite CLI flow you actually use |
| yellow-ci (entire plugin) | plugin | plugins/yellow-ci/ | — | UNIQUE | 9 commands, 4 agents, runner-health for self-hosted GH Actions |
| yellow-linear (entire plugin) | plugin | plugins/yellow-linear/ | — | UNIQUE | Linear MCP + 9 commands; CE has no PM tracker integration |
| yellow-devin (entire plugin) | plugin | plugins/yellow-devin/ | — | UNIQUE | Devin V3 API delegation + DeepWiki; CE has nothing equivalent |
| yellow-chatprd (entire plugin) | plugin | plugins/yellow-chatprd/ | — | UNIQUE | ChatPRD MCP + Linear bridging |
| yellow-ruvector (entire plugin) | plugin | plugins/yellow-ruvector/ | — | UNIQUE | Persistent vector memory; conceptual rival to CE's docs/solutions/ |
| yellow-debt (entire plugin) | plugin | plugins/yellow-debt/ | — | UNIQUE | Tech debt audit pipeline w/ AI-pattern scanners — no CE analog |
| yellow-semgrep (entire plugin) | plugin | plugins/yellow-semgrep/ | — | UNIQUE | Semgrep AppSec finding remediation |
| yellow-research (Ceramic/Perplexity/Tavily/EXA/Parallel/ast-grep) | plugin | plugins/yellow-research/ | partial | UNIQUE | CE bundles no research MCPs (context7 was removed in #486) |
| yellow-morph (entire plugin) | plugin | plugins/yellow-morph/ | — | UNIQUE | Morph Fast Apply + WarpGrep editing — no CE analog |
| yellow-composio (entire plugin) | plugin | plugins/yellow-composio/ | — | UNIQUE | Optional Composio accelerator |
| yellow-codex (entire plugin) | plugin | plugins/yellow-codex/ | partial overlap | UNIQUE | Standalone Codex CLI wrapper; CE has ce-work Codex *delegation* (#328) — different |
| yellow-docs (entire plugin) | plugin | plugins/yellow-docs/ | — | UNIQUE | Docs audit/generation/Mermaid; CE has only ce-ankane-readme-writer (Ruby gems) |
| code-reviewer (general) | agent | plugins/yellow-review/agents/review/code-reviewer.md | — | UNIQUE | General correctness + CLAUDE.md compliance reviewer; not in CE persona pipeline |
| code-simplifier (post-fix pass 2) | agent | plugins/yellow-review/agents/review/code-simplifier.md | — | UNIQUE | Post-fix simplification pass — distinct from CE's pre-fix ce-code-simplicity-reviewer |
| comment-analyzer | agent | plugins/yellow-review/agents/review/comment-analyzer.md | — | UNIQUE | Comment-rot detection — no CE equivalent |
| silent-failure-hunter | agent | plugins/yellow-review/agents/review/silent-failure-hunter.md | — | UNIQUE | Error-suppression detection — no CE equivalent |
| type-design-analyzer | agent | plugins/yellow-review/agents/review/type-design-analyzer.md | — | UNIQUE | Encapsulation + invariants reviewer — no CE equivalent |
| polyglot-reviewer | agent | plugins/yellow-core/agents/review/polyglot-reviewer.md | partial | UNIQUE | One agent for TS/Py/Rust/Go; CE splits into ce-kieran-{python,typescript,rails}-reviewer |
| knowledge-compounder | agent | plugins/yellow-core/agents/workflow/knowledge-compounder.md | partial overlap | UNIQUE | Writes solutions; CE's ce-compound skill handles writes, ce-learnings-researcher handles reads |
| brainstorm-orchestrator | agent | plugins/yellow-core/agents/workflow/brainstorm-orchestrator.md | — | UNIQUE | Standalone orchestrator agent; CE's ce-brainstorm is now a skill, not an agent |
| pr-test-analyzer | agent | plugins/yellow-review/agents/review/pr-test-analyzer.md | — | UNIQUE | PR-scoped test analysis split from test-coverage-analyst (full-suite) |
| ai-pattern-scanner | agent | plugins/yellow-debt/agents/scanners/ai-pattern-scanner.md | — | UNIQUE | AI-generated debt patterns — no CE equivalent |
| architecture-scanner | agent | plugins/yellow-debt/agents/scanners/architecture-scanner.md | — | UNIQUE | Different from architecture-strategist (debt audit vs PR review) |
| complexity-scanner | agent | plugins/yellow-debt/agents/scanners/complexity-scanner.md | — | UNIQUE | Codebase-wide complexity scan |
| duplication-scanner | agent | plugins/yellow-debt/agents/scanners/duplication-scanner.md | — | UNIQUE | Cross-file duplication scan |
| security-debt-scanner | agent | plugins/yellow-debt/agents/scanners/security-debt-scanner.md | — | UNIQUE | Inventory-style security audit, not PR review |
| debt-fixer | agent | plugins/yellow-debt/agents/remediation/debt-fixer.md | — | UNIQUE | Remediation-side; no CE equivalent |
| audit-synthesizer | agent | plugins/yellow-debt/agents/synthesis/audit-synthesizer.md | — | UNIQUE | Aggregates scanner findings |
| failure-analyst, runner-assignment, workflow-optimizer, runner-diagnostics | agents | plugins/yellow-ci/agents/{ci,maintenance}/\*.md | — | UNIQUE | CI/runner agents; outside CE's scope |
| codex-{analyst,reviewer,executor} | agents | plugins/yellow-codex/agents/\*\*/\*.md | — | UNIQUE | Codex CLI wrappers |
| document-{assistant,reviewer}, linear-prd-bridge, project-dashboard | agents | plugins/yellow-chatprd/agents/workflow/\*.md | — | UNIQUE | ChatPRD/Linear workflows |
| linear-explorer, linear-issue-loader, linear-pr-linker | agents | plugins/yellow-linear/agents/\*\*/\*.md | — | UNIQUE | Linear-specific |
| memory-manager, semantic-search | agents | plugins/yellow-ruvector/agents/ruvector/\*.md | — | UNIQUE | ruvector-specific |
| devin-orchestrator | agent | plugins/yellow-devin/agents/workflow/devin-orchestrator.md | — | UNIQUE | Devin-specific |
| code-researcher, research-conductor | agents | plugins/yellow-research/agents/research/\*.md | — | UNIQUE | Multi-backend research; CE has only ce-best-practices-researcher/ce-web-researcher |
| doc-{auditor,generator}, diagram-architect | agents | plugins/yellow-docs/agents/\*\*/\*.md | — | UNIQUE | Docs plugin |
| app-discoverer, test-runner, test-reporter | agents | plugins/yellow-browser-test/agents/testing/\*.md | partial overlap | UNIQUE | Browser testing pipeline; conceptually adjacent to ce-test-browser skill but architected differently |
| finding-fixer, scan-verifier | agents | plugins/yellow-semgrep/agents/semgrep/\*.md | — | UNIQUE | Semgrep-specific |
| commands/workflows/plan.md | command | plugins/yellow-core/commands/workflows/plan.md | skills/ce-plan/SKILL.md | RENAMED | Old workflows:plan; upstream renamed in v2.38.0, then converted command→skill |
| commands/workflows/work.md | command | plugins/yellow-core/commands/workflows/work.md | skills/ce-work/SKILL.md | RENAMED | Same as above; upstream's ce-work adds Codex delegation (#328), system-wide test check |
| commands/workflows/review.md | command | plugins/yellow-core/commands/workflows/review.md | skills/ce-code-review/SKILL.md | RENAMED | Yours is "session-level" review (#230); upstream became persona pipeline |
| commands/workflows/brainstorm.md | command | plugins/yellow-core/commands/workflows/brainstorm.md | skills/ce-brainstorm/SKILL.md | RENAMED | Upstream universal-mode in v2.63.0 (#519), HITL review-loop (#580) |
| commands/workflows/compound.md | command | plugins/yellow-core/commands/workflows/compound.md | skills/ce-compound/SKILL.md | RENAMED | Upstream track-based bug/knowledge schema (#445), stack-aware routing (#497) |
| best-practices-researcher | agent | plugins/yellow-core/agents/research/best-practices-researcher.md | agents/ce-best-practices-researcher.agent.md | DRIFTED | Yours has Ceramic+context7 MCPs wired in; upstream is skills-first (Phase 1 reads SKILL.md), web second |
| repo-research-analyst | agent | plugins/yellow-core/agents/research/repo-research-analyst.md | agents/ce-repo-research-analyst.agent.md | DRIFTED | Upstream got "structured technology scan" overhaul (#327) |
| git-history-analyzer | agent | plugins/yellow-core/agents/research/git-history-analyzer.md | agents/ce-git-history-analyzer.agent.md | DRIFTED | Same purpose; verify frontmatter parity (model: inherit, read-only tools) |
| architecture-strategist | agent | plugins/yellow-core/agents/review/architecture-strategist.md | agents/ce-architecture-strategist.agent.md | DRIFTED | Upstream restricts reviewer agents to read-only tools (#553); yours has Bash |
| code-simplicity-reviewer | agent | plugins/yellow-core/agents/review/code-simplicity-reviewer.md | agents/ce-code-simplicity-reviewer.agent.md | DRIFTED | Same; check read-only tool restriction (#553) |
| pattern-recognition-specialist | agent | plugins/yellow-core/agents/review/pattern-recognition-specialist.md | agents/ce-pattern-recognition-specialist.agent.md | DRIFTED | Yours adds plugin-authoring conventions trigger; upstream is generic |
| performance-oracle | agent | plugins/yellow-core/agents/review/performance-oracle.md | agents/ce-performance-oracle.agent.md | DRIFTED | Upstream split into ce-performance-oracle + ce-performance-reviewer (with confidence calibration) |
| security-sentinel | agent | plugins/yellow-core/agents/review/security-sentinel.md | agents/ce-security-sentinel.agent.md | DRIFTED | Upstream split into ce-security-sentinel + ce-security-reviewer (confidence-calibrated) + ce-security-lens-reviewer (plan-level) |
| spec-flow-analyzer | agent | plugins/yellow-core/agents/workflow/spec-flow-analyzer.md | agents/ce-spec-flow-analyzer.agent.md | DRIFTED | Same purpose; verify frontmatter |
| pr-comment-resolver | agent | plugins/yellow-review/agents/workflow/pr-comment-resolver.md | agents/ce-pr-comment-resolver.agent.md | DRIFTED | Yours wraps /review:resolve; upstream's ce-resolve-pr-feedback skill adds cross-invocation cluster analysis (#480), actionability filter (#461), untrusted-input handling (#490) |
| test-coverage-analyst | agent | plugins/yellow-core/agents/review/test-coverage-analyst.md | agents/ce-testing-reviewer.agent.md | DRIFTED | Yours splits full-suite (yellow-core) vs PR-scoped (yellow-review); upstream has just ce-testing-reviewer |
| commands/review/review-pr.md (adaptive) | command | plugins/yellow-review/commands/review/review-pr.md | skills/ce-code-review/SKILL.md | DRIFTED | Both do PR review; upstream has tiered persona pipeline + confidence rubric (#434) + base-branch fetch (#544) |
| commands/review/resolve-pr.md | command | plugins/yellow-review/commands/review/resolve-pr.md | skills/ce-resolve-pr-feedback/SKILL.md | DRIFTED | Yours predates upstream's cluster-analysis (#480) + actionability filter (#461) |
| commands/review/review-all.md (sequential stack) | command | plugins/yellow-review/commands/review/review-all.md | partial | DRIFTED | Stack-aware sequential review; upstream has no direct equivalent (gt-workflow style) |
| skills/git-worktree/SKILL.md | skill | plugins/yellow-core/skills/git-worktree/SKILL.md | skills/ce-worktree/SKILL.md | DRIFTED | Upstream auto-trusts mise/direnv (#312), detects when .git is a file |
| skills/brainstorming/SKILL.md | skill | plugins/yellow-core/skills/brainstorming/SKILL.md | skills/ce-brainstorm/SKILL.md | DRIFTED | Yours is user-invokable: false reference for the orchestrator; upstream is the user-invokable entry point itself |
| skills/create-agent-skills/SKILL.md | skill | plugins/yellow-core/skills/create-agent-skills/SKILL.md | partial | DRIFTED | Roughly maps to upstream's skill-creator/create-agent-skills (CHANGELOG 2.31.0 confirms disable-model-invocation: true for both) |
| commands/worktree/cleanup.md | command | plugins/yellow-core/commands/worktree/cleanup.md | skills/ce-clean-gone-branches/SKILL.md | DRIFTED | Different scope: yours cleans worktrees (#227, 7-category classification); upstream cleans branches w/ gone tracking |
| context7 MCP server | mcp | plugins/yellow-core/.claude-plugin/plugin.json mcpServers.context7 | — | OBSOLETE | Upstream **removed bundled context7 MCP in v2.62.0 (#486)** because users were ending up with two copies. Auth-key fix from #297 (v2.39.0) was deprecated by removal |
| ce-agent-native-architecture | skill | — | skills/ce-agent-native-architecture/ | MISSING | Bundled refs: mcp-tool-design.md, dynamic-context-injection.md, action-parity-discipline.md, etc. (CHANGELOG 2.17.0/2.18.0) |
| ce-agent-native-audit | skill | — | skills/ce-agent-native-audit/ | MISSING | 8-principle audit harness |
| ce-debug | skill | — | skills/ce-debug/ | MISSING | Test-first systematic debugging — added v2.64.0 (#543) |
| ce-demo-reel | skill | — | skills/ce-demo-reel/ | MISSING | GIF/video demos for PRs (#541, #546, #664) |
| ce-doc-review | skill | — | skills/ce-doc-review/ | MISSING | Persona-based doc review (#359, #401, #425) |
| ce-frontend-design | skill | — | skills/ce-frontend-design/ | MISSING | Layered architecture + visual verification (#343) |
| ce-ideate | skill | — | skills/ce-ideate/ | MISSING | Mode-aware v2 ideation (#588), warrant contract (#671) |
| ce-optimize | skill | — | skills/ce-optimize/ | MISSING | Auto-research loop, LLM-as-judge (#446); has its own README + schema.yaml |
| ce-polish-beta | skill | — | skills/ce-polish-beta/ | MISSING | HITL polish phase + stacked-PR seeds (#568) |
| ce-pr-description | skill | — | skills/ce-pr-description/ | MISSING | Net-result PR descriptions (#561), delegated by ce-commit-push-pr |
| ce-release-notes | skill | — | skills/ce-release-notes/ | MISSING | Plugin release-history Q&A (#589) |
| ce-report-bug | skill | — | skills/ce-report-bug/ | MISSING | Bug-report flow for the plugin itself |
| ce-sessions | skill | — | skills/ce-sessions/ | MISSING | Cross-platform session history (#534) |
| ce-setup (unified) | skill | — | skills/ce-setup/ | MISSING | Diagnose env + install + bootstrap (#345); writes compound-engineering.local.md |
| ce-update | skill | — | skills/ce-update/ | MISSING | Plugin version check + cache fix (#532, #645, #656, #660) |
| ce-compound-refresh | skill | — | skills/ce-compound-refresh/ | MISSING | Refresh stale learnings, overlap detection (#372) |
| ce-slack-research | skill | — | skills/ce-slack-research/ | MISSING | Slack org-context research (#538) |
| ce-test-xcode | skill | — | skills/ce-test-xcode/ | MISSING | iOS via XcodeBuildMCP |
| ce-gemini-imagegen | skill | — | skills/ce-gemini-imagegen/ | MISSING | Gemini image gen |
| ce-proof | skill | — | skills/ce-proof/ | MISSING | Proof collaborative editor |
| ce-dhh-rails-style | skill | — | skills/ce-dhh-rails-style/ | MISSING | Rails 37signals style |
| lfg | skill | — | skills/lfg/ | MISSING | Autonomous chain plan→work→review→resolve→test-browser |
| ce-commit | skill | — | skills/ce-commit/ | MISSING | Value-communicating commit message; gt-amend overlaps but isn't a port |
| ce-commit-push-pr | skill | — | skills/ce-commit-push-pr/ | MISSING | Net-result PR (#558), fix-up filter (#484); gt-workflow/smart-submit overlaps |
| ce-adversarial-reviewer | agent | — | agents/ce-adversarial-reviewer.agent.md | MISSING | Failure-scenario constructor across boundaries (#403) |
| ce-adversarial-document-reviewer | agent | — | agents/ce-adversarial-document-reviewer.agent.md | MISSING | Doc-side adversarial reviewer |
| ce-correctness-reviewer | agent | — | agents/ce-correctness-reviewer.agent.md | MISSING | Logic + edge-case + state bugs |
| ce-maintainability-reviewer | agent | — | agents/ce-maintainability-reviewer.agent.md | MISSING | Coupling, complexity, naming, dead code |
| ce-reliability-reviewer | agent | — | agents/ce-reliability-reviewer.agent.md | MISSING | Production reliability + failure modes |
| ce-project-standards-reviewer | agent | — | agents/ce-project-standards-reviewer.agent.md | MISSING | Always-on CLAUDE.md/AGENTS.md compliance (#402) |
| ce-data-integrity-guardian | agent | — | agents/ce-data-integrity-guardian.agent.md | MISSING | DB migration safety |
| ce-data-migrations-reviewer | agent | — | agents/ce-data-migrations-reviewer.agent.md | MISSING | Migration safety w/ confidence calibration |
| ce-data-migration-expert | agent | — | agents/ce-data-migration-expert.agent.md | MISSING | ID-mapping production validation |
| ce-deployment-verification-agent | agent | — | agents/ce-deployment-verification-agent.agent.md | MISSING | Go/No-Go checklists |
| ce-schema-drift-detector | agent | — | agents/ce-schema-drift-detector.agent.md | MISSING | Conditional schema.rb change detection |
| ce-api-contract-reviewer | agent | — | agents/ce-api-contract-reviewer.agent.md | MISSING | Breaking-change detection |
| ce-cli-readiness-reviewer | agent | — | agents/ce-cli-readiness-reviewer.agent.md | MISSING | Conditional CLI persona, structured JSON (#471) |
| ce-cli-agent-readiness-reviewer | agent | — | agents/ce-cli-agent-readiness-reviewer.agent.md | MISSING | 7-principle CLI agent-friendliness audit (#391) |
| ce-agent-native-reviewer | agent | — | agents/ce-agent-native-reviewer.agent.md | MISSING | Action+context parity verification |
| ce-coherence-reviewer | agent | — | agents/ce-coherence-reviewer.agent.md | MISSING | Internal consistency, terminology drift |
| ce-design-lens-reviewer | agent | — | agents/ce-design-lens-reviewer.agent.md | MISSING | Missing design decisions, AI-slop risk |
| ce-feasibility-reviewer | agent | — | agents/ce-feasibility-reviewer.agent.md | MISSING | Will it survive contact with reality |
| ce-product-lens-reviewer | agent | — | agents/ce-product-lens-reviewer.agent.md | MISSING | Domain-agnostic problem framing (#481) |
| ce-scope-guardian-reviewer | agent | — | agents/ce-scope-guardian-reviewer.agent.md | MISSING | Unjustified complexity / scope creep |
| ce-security-lens-reviewer | agent | — | agents/ce-security-lens-reviewer.agent.md | MISSING | Plan-level security gaps |
| ce-security-reviewer | agent | — | agents/ce-security-reviewer.agent.md | MISSING | Confidence-calibrated PR security review |
| ce-performance-reviewer | agent | — | agents/ce-performance-reviewer.agent.md | MISSING | Confidence-calibrated runtime perf |
| ce-issue-intelligence-analyst | agent | — | agents/ce-issue-intelligence-analyst.agent.md | MISSING | GitHub issues theme/pain analysis |
| ce-learnings-researcher | agent | — | agents/ce-learnings-researcher.agent.md | MISSING | **Always-run in ce-code-review** — searches docs/solutions/ for prior fixes |
| ce-web-researcher | agent | — | agents/ce-web-researcher.agent.md | MISSING | Iterative web research for prior art |
| ce-framework-docs-researcher | agent | — | agents/ce-framework-docs-researcher.agent.md | MISSING | Framework docs + best practices |
| ce-session-historian | agent | — | agents/ce-session-historian.agent.md | MISSING | Cross-platform session-history backend |
| ce-slack-researcher | agent | — | agents/ce-slack-researcher.agent.md | MISSING | Slack-specific researcher |
| ce-design-iterator | agent | — | agents/ce-design-iterator.agent.md | MISSING | Iterative UI refinement, Step-0 skill autoload |
| ce-design-implementation-reviewer | agent | — | agents/ce-design-implementation-reviewer.agent.md | MISSING | UI vs Figma verification |
| ce-figma-design-sync | agent | — | agents/ce-figma-design-sync.agent.md | MISSING | Figma sync |
| ce-dhh-rails-reviewer, ce-julik-frontend-races-reviewer, ce-kieran-{python,typescript,rails}-reviewer, ce-swift-ios-reviewer, ce-ankane-readme-writer | agents | — | agents/ce-\*.agent.md | MISSING | Stack-specific personas; not relevant to your TS/Py/Rust/Go set |
| Skill-injection hook | hook | — | plugins/compound-engineering/hooks/ | MISSING | Injects skills into subagent context (CHANGELOG 2.31.0 ref); your hooks (gt-workflow, yellow-ci, yellow-debt, yellow-ruvector) do different things |
| compound-engineering.local.md settings file | settings | — | per-project | MISSING | Tool-agnostic stack/depth/reviewer-set config (#345 v2.65.0). You don't have a per-project setup file |
| Tiered persona reviewer pipeline (orchestration pattern) | architecture | — | skills/ce-code-review/ | MISSING | Parallel persona dispatch + confidence rubric (#434) + dedup + base-branch fetch (#544) — your review:pr is adaptive but flat |
| coding-tutor (second plugin) | plugin | — | plugins/coding-tutor/ | MISSING | Out of scope; ignore |

## 2. Take From Mine — Worth Preserving

Every component below is UNIQUE to yellow-plugins. Each has a specific reason to survive a merge. None are flagged as unjustified — but several **should not** be replaced even if you adopt upstream's ce-\* architecture.

### 2.1 Plugins (entire directories) — preserve

- **plugins/gt-workflow/** — Graphite-native commit/submit/sync flow. Per memory feedback_conventions.md, Graphite is your enforced branching tool. Upstream has nothing equivalent (CE assumes vanilla git/gh). Keep verbatim. Specifically: commands/smart-submit.md is your equivalent of ce-commit-push-pr and is built around gt submit, not git push + gh pr create.

- **plugins/yellow-ci/** — CI failure diagnosis + self-hosted GH Actions runner health. Outside CE's scope entirely. Has its own SessionStart hook (hooks/scripts/session-start.sh). 9 commands, 4 agents, 2 skills.

- **plugins/yellow-linear/** — Linear MCP + 9 PM commands (linear:create, linear:plan-cycle, linear:triage, linear:work, etc.). CE has no PM-tracker integration. Your linear-pr-linker agent connects PRs back to Linear issues, which is fork-specific value.

- **plugins/yellow-devin/** — Devin V3 API delegation + DeepWiki research. Distinct from CE's ce-work Codex delegation (#328) — different vendor, different API. Service-user-token auth is fork-specific.

- **plugins/yellow-chatprd/** — ChatPRD MCP integration + Linear bridging. Niche but unique; CE has no PRD-tooling story.

- **plugins/yellow-ruvector/** — This is your fork's most novel architectural bet. Upstream uses static docs/solutions/ + auto-memory. yellow-ruvector adds *live* vector recall via mcp__plugin_yellow-ruvector_ruvector__hooks_recall wired into 5+ commands and 5 hook scripts. **Decide explicitly**: ruvector vs upstream's ce-compound/ce-learnings-researcher static-doc approach. Both can coexist (ruvector for live recall, docs/solutions/ for durable archive), but the duplication is real.

- **plugins/yellow-debt/** — Tech debt audit/remediation pipeline with 5 scanner agents (ai-pattern, architecture, complexity, duplication, security-debt) + audit-synthesizer + debt-fixer. CE has nothing comparable; this is a category CE doesn't address.

- **plugins/yellow-semgrep/** — Semgrep AppSec finding remediation. Outside CE scope. Reuses your security agents but pulls findings from a specific platform.

- **plugins/yellow-research/** — 6 MCP backends (Ceramic, Perplexity, Tavily, EXA, Parallel, ast-grep). CE removed bundled MCPs in #486. Your code-researcher (inline) vs research-conductor (deep-research-to-file) split is novel.

- **plugins/yellow-morph/** — Morph Fast Apply + WarpGrep. Editor-tier MCP. Not in CE.

- **plugins/yellow-composio/** — Optional Composio accelerator. Not in CE.

- **plugins/yellow-codex/** — Standalone Codex CLI wrapper (rescue/review/analyze). Distinct from CE's ce-work *delegating to* Codex. If you keep both patterns, document the difference.

- **plugins/yellow-docs/** — Docs audit (doc-auditor), generation (doc-generator), Mermaid diagrams (diagram-architect). CE has only ce-ankane-readme-writer (Ruby-gem-specific). Non-overlapping value.

### 2.2 Reviewer agents inside yellow-review — preserve, integrate

These five agents should survive as additions to whatever review pipeline you adopt. They are **not** redundant with upstream's persona reviewers — upstream has nothing equivalent for any of them:

- **plugins/yellow-review/agents/review/code-reviewer.md** — General correctness + CLAUDE.md compliance. Keep as the always-on baseline reviewer (analogous to upstream's ce-project-standards-reviewer but with broader scope).

- **plugins/yellow-review/agents/review/code-simplifier.md** — *Post-fix* (pass 2) simplification. Distinct from upstream's ce-code-simplicity-reviewer (pre-fix, pass 1). Both are valuable; they run at different points in the loop.

- **plugins/yellow-review/agents/review/comment-analyzer.md** — Comment-rot detection. No CE equivalent. Most reviewers don't catch stale // TODO and lying docstrings.

- **plugins/yellow-review/agents/review/silent-failure-hunter.md** — Suppressed-error and swallowed-exception detection. No CE equivalent. High-signal in agent-generated code.

- **plugins/yellow-review/agents/review/type-design-analyzer.md** — Encapsulation + invariants reviewer for TS/Py/Rust/Go type design. No CE equivalent.

> Open question: do you still want yellow-core's polyglot-reviewer (one agent, four languages) once these five fine-grained reviewers exist? If you adopt upstream's persona reviewers and keep the five above, polyglot-reviewer may become redundant.

### 2.3 Workflow agents — preserve, possibly rename

- **plugins/yellow-core/agents/workflow/knowledge-compounder.md** — Writes solutions to docs/solutions/. This *is* your equivalent of upstream's ce-compound skill execution path. If you adopt ce-compound, you can delete this; otherwise keep.

- **plugins/yellow-core/agents/workflow/brainstorm-orchestrator.md** — Drives /workflows:brainstorm. Upstream removed this orchestrator and folded the logic into ce-brainstorm skill itself (#519, #580). If you migrate to skills-first, delete this. If not, keep.

- **plugins/yellow-debt/agents/scanners/\* (5 agents) + debt-fixer + audit-synthesizer** — All unique. Keep all 7. The audit-synthesizer orchestration pattern (parallel scanners → synthesizer) is essentially a tech-debt-flavored version of upstream's tiered persona pipeline; the architecture works, don't break it.

### 2.4 Skills — preserve, possibly relocate

- **plugins/yellow-core/skills/create-agent-skills/SKILL.md** — Plugin-author-facing skill for skill/agent authoring. Upstream has roughly the same idea (skill-creator / create-agent-skills) and marks it disable-model-invocation: true (CHANGELOG 2.31.0). Keep yours; mirror the disable flag.

- **plugins/yellow-core/skills/mcp-integration-patterns/SKILL.md** — Reference for ruvector recall/remember + morph discovery. Hard-wired to your fork's MCP set. No upstream equivalent (CE has no bundled MCPs to integrate). Keep.

### 2.5 Output style — preserve

- **plugins/yellow-review/output-styles/pr-findings.md** — PR finding output style. No CE equivalent. Keep.

### 2.6 Stale UNIQUE candidates — flag, ask user

> Open question: plugins/yellow-composio/ ships only setup + status commands and one skill. If you don't actively use Composio, this is dead weight — delete. (No code/agents to lose.)
>
> Open question: plugins/yellow-codex/ is at version 0.1.0 (newest plugin, added in PR #239). If yellow-core/commands/workflows/work.md already gets you Codex delegation in practice, the standalone Codex commands may be redundant. Confirm usage before deciding.

## 3. Take From Upstream — Worth Adopting

### P0 — Architectural decisions that block everything else

**P0.1. Resolve the workflows:\* → ce-\* rename and command→skill migration.**

- Source: upstream CHANGELOG **v2.38.0 (2026-03-01)** for the rename, and the cumulative skill conversions through v2.65.0/v2.68.0 for the command→skill migration.

- Your state: plugins/yellow-core/commands/workflows/{plan,work,review,brainstorm,compound}.md are still commands, still workflows:\* namespace.

- Decision required: **(a)** rename in place to ce-\* and convert to skills (high churn, but tracks upstream), **(b)** keep workflows:\* as your fork's branding (low churn, but you'll diverge further every release), or **(c)** introduce a parallel ce-\* skill set and mark the old workflows:\* commands deprecated.

- Recommendation: **(c)**. Lowest-risk path. Lets you adopt upstream skills at your own pace without breaking existing muscle memory / aliases.

**P0.2. Adopt the tiered persona reviewer pipeline as an orchestration pattern.**

- Source: PR **#348** (v2.51.0 ce:review-beta introduced the pipeline), PR **#371** (v2.52.0 promoted to stable), PR **#434** (v2.60.0 confidence rubric + FP suppression + intent verification), PR **#553** (v2.66.0 reviewer agents restricted to read-only tools), PR **#544** (always fetch base branch), PR **#535** (compact returns to reduce orchestrator context).

- Your state: plugins/yellow-review/commands/review/review-pr.md is "adaptive" (selects agents based on PR size/content) but is a flat orchestration. No confidence calibration. No intent verification. No base-branch-fetch hardening.

- Decision required: rewrite review:pr (or a new ce-code-review skill per P0.1) around the persona pipeline pattern. Reuse your existing 11 reviewer agents (yellow-core's 7 + yellow-review's 5 keepers from §2.2) as the persona set; add upstream's ce-correctness-reviewer, ce-maintainability-reviewer, ce-reliability-reviewer, ce-project-standards-reviewer (always-on), ce-adversarial-reviewer to round it out. Adopt the confidence rubric (#434) verbatim.

- This is the single highest-ROI port from upstream.

**P0.3. Restrict reviewer agents to read-only tools.**

- Source: PR **#553** (v2.66.0).

- Your state: many reviewer agents (architecture-strategist, code-simplicity-reviewer, pattern-recognition-specialist, performance-oracle, security-sentinel, polyglot-reviewer, test-coverage-analyst) declare Bash in their tools: list. Read-only restriction = Read, Grep, Glob only.

- Decision required: strip Bash and any write tools from all agents under \*/agents/review/. Adversarial agents in upstream are read-only too.

### P1 — High-value individual components to ADOPT or ADAPT

| **Action** | **Component** | **Source PR/CHANGELOG** | **Rationale** |
| --- | --- | --- | --- |
| ADOPT | ce-learnings-researcher agent | v2.33.0 (always-run wiring) + v2.45.0 (#311) | The missing piece that closes the compound loop — reads docs/solutions/ *back into* every code review. Without this, knowledge-compounder writes are write-only. |
| ADOPT | ce-project-standards-reviewer agent | PR #402 (v2.55.0) | Always-on CLAUDE.md/AGENTS.md compliance reviewer. You already enforce CLAUDE.md heavily (per feedback_conventions.md); this codifies it. |
| ADOPT | ce-adversarial-reviewer + ce-adversarial-document-reviewer agents | PR #403 (v2.55.0) | Failure-scenario constructor across component boundaries. No yellow analog. |
| ADOPT | ce-correctness-reviewer, ce-maintainability-reviewer, ce-reliability-reviewer agents | v2.51.0+ persona pipeline | Fill obvious gaps in your reviewer set. |
| ADOPT | ce-debug skill | PR #543 (v2.64.0) | Test-first systematic debugging. No yellow analog. Plug-and-play. |
| ADOPT | ce-doc-review skill + 6 doc-review persona agents (ce-coherence-reviewer, ce-design-lens-reviewer, ce-feasibility-reviewer, ce-product-lens-reviewer, ce-scope-guardian-reviewer, ce-security-lens-reviewer) | PR #359 (v2.51.0), #401 (v2.55.0), #425 (headless), #481 (domain-agnostic) | Brings persona review to plans/brainstorms, not just code. Pairs with your existing brainstorm flow. |
| ADAPT | ce-pr-description skill | PR #561 (v2.66.0), #558 (net-result not changelog), #484 (fix-up filter) | Extract description-writing from gt-workflow/smart-submit into a focused skill. Keep the skill, keep smart-submit as the orchestrator that calls it. |
| ADAPT | ce-resolve-pr-feedback improvements into yellow-review/commands/review/resolve-pr.md | PR #480 (cluster analysis), #461 (actionability filter), #490 (untrusted-input handling) | Don't replace — port these three improvements into your existing command. Especially #490 (treat PR comment text as untrusted input) is a correctness fix. |
| ADAPT | ce-code-review compact-returns + base-branch-fetch logic | PR #535, #544 (v2.66.0) | Port into your review:pr orchestration, even if you keep the rest of the architecture. |
| ADAPT | ce-setup unified pattern | PR #345 (v2.65.0) | Your setup:all covers MCP visibility but not env-detection or stack-aware config. Adopt the compound-engineering.local.md-style per-project file (rename to yellow-plugins.local.md) so review depth/focus/agent set is configurable. |
| ADAPT | ce-update cache-fix logic | PR #645, #656, #660 (v3.0.x) | If you ship updates the way upstream does, the cache-dir derivation from CLAUDE_PLUGIN_ROOT parent (#645) and the claude plugin update invocation (#656) are operational fixes you'll hit too. |
| ADOPT | ce-update's ce_platforms filtering pattern | PR #532 | If you ever support non-Claude-Code targets, adopt this. Otherwise SKIP. |

### P2 — Nice-to-haves

| **Action** | **Component** | **Source PR/CHANGELOG** | **Rationale** |
| --- | --- | --- | --- |
| ADOPT | ce-ideate skill | PR #588, #671, #580 (HITL review-loop) | Pre-brainstorm ideation w/ warrant contract. Optional but useful for vague requests. |
| ADOPT | ce-optimize skill | PR #446 (v2.66.0) | Auto-research loop + LLM-as-judge for tuning system prompts, vector clustering, comparing implementations. Useful given your ruvector and research-MCP investments. |
| ADOPT | ce-polish-beta skill | PR #568 (v2.67.0) | HITL polish phase between review and merge. Stacked-PR seeds (#568) align well with gt-workflow. |
| ADOPT | lfg skill | various | Autonomous chain. Optional; your workflow may already be too custom for this to map cleanly. |
| ADAPT | ce-worktree improvements into yellow-core/skills/git-worktree | PR #312 (auto-trust mise/direnv), #543-era .git is-a-file detection | Two specific improvements; port them, don't replace the skill. |
| ADAPT | ce-clean-gone-branches into gt-workflow/commands/gt-cleanup.md | upstream skill | Different scope (worktrees vs branches) but the gone-tracking detection pattern is portable. |
| ADOPT | ce-sessions + ce-session-historian | PR #534 (v2.64.0) | Cross-platform session-history search. Useful given your multi-vendor footprint (Devin, Codex, Claude Code). |
| ADOPT | ce-demo-reel skill | PR #541, #546, #664 | GIF/video demos for PRs. Optional; useful if you ship UI work. |
| SKIP | ce-dhh-rails-style skill, ce-dhh-rails-reviewer, ce-julik-frontend-races-reviewer, ce-kieran-rails-reviewer, ce-swift-ios-reviewer, ce-test-xcode, ce-ankane-readme-writer | — | Ruby/Swift/Rails-specific. Not your stack (TS/Py/Rust/Go per yellow-core description). |
| SKIP | ce-slack-research + ce-slack-researcher agent | PR #495, #538 | No Slack workspace tied to this fork. Opt-in by design. |
| SKIP | ce-proof skill | — | Proof collaborative editor — not in your toolchain. |
| SKIP | ce-gemini-imagegen | — | Niche; you don't generate images in this workflow. |
| SKIP | ce-figma-design-sync, ce-design-iterator, ce-design-implementation-reviewer, ce-design-lens-reviewer, ce-frontend-design skill | — | Figma/UI-design-heavy. Probably not your use case — confirm before discarding. |
| SKIP | ce-data-integrity-guardian, ce-data-migration-expert, ce-data-migrations-reviewer, ce-deployment-verification-agent, ce-schema-drift-detector | — | Rails-migration-shaped. Adopt only if you work on apps with similar production-DB risk. |
| SKIP | ce-cli-readiness-reviewer, ce-cli-agent-readiness-reviewer, ce-agent-native-reviewer, ce-agent-native-architecture skill, ce-agent-native-audit skill | PR #391, #471, CHANGELOG 2.17.0/2.18.0 | These are CE's "review the agent we're building" specialists. **Reconsider as P1 if you ship plugins**: your pattern-recognition-specialist already triggers on plugin authoring conventions, so these are aligned with your plugin-development focus. |
| SKIP | ce-issue-intelligence-analyst | — | GitHub Issues theme analysis. Niche. |
| SKIP | ce-web-researcher, ce-framework-docs-researcher agents | — | Your code-researcher (yellow-research) and best-practices-researcher (yellow-core) cover this with better MCP backends. |
| SKIP | ce-release-notes skill | PR #589 | Plugin-meta. Optional. |
| SKIP | ce-report-bug skill | — | Plugin-meta. Optional. |
| SKIP | Skill-injection hook | CHANGELOG 2.31.0 | Adopt only if you migrate to skills-first (P0.1 (a) or (c)). Otherwise SKIP. |

> Open question: do you ship plugins as a primary use case? If yes, the SKIP'd "agent-native" reviewers (ce-cli-readiness-reviewer, ce-cli-agent-readiness-reviewer, ce-agent-native-reviewer, plus the ce-agent-native-architecture/ce-agent-native-audit skills) all become P1 — they exist precisely to review plugins/agents you're building.

## 4. Delete — Redundant or Obsolete

The single confirmed obsolete item plus stale-UNIQUE candidates flagged above. Format is a git rm checklist; do not execute without confirming the open questions below.

```bash
# OBSOLETE: bundled context7 MCP server
# Upstream removed bundled context7 in v2.62.0 (#486) because users were ending up
# with two copies whenever they had it installed elsewhere. Remove the mcpServers
# entry from yellow-core's plugin.json (do NOT git rm a file — edit in place):
# plugins/yellow-core/.claude-plugin/plugin.json → delete "mcpServers": { "context7": {...} }
# Note: code-researcher.md references mcp__plugin_yellow-core_context7__resolve-library-id;
# either move context7 declaration to per-user settings, or remove the tool reference.
# UNIQUE-but-possibly-stale candidates — confirm before deleting:
# yellow-composio: 2 commands + 1 skill, no agents. Pure setup wrapper.
# git rm -r plugins/yellow-composio
# Update: .claude-plugin/marketplace.json, README.md plugin table
# yellow-codex: introduced in PR #239 (v0.1.0). Possible overlap with yellow-core
# workflows:work Codex delegation. Confirm whether you actually run codex:rescue,
# codex:review, codex:status before keeping.
# git rm -r plugins/yellow-codex
# Update: .claude-plugin/marketplace.json, README.md plugin table
```
> Open question: do you actively use /composio:setup? If not, delete plugins/yellow-composio (saves marketplace clutter, no functional loss).
>
> Open question: do you run /codex:rescue, /codex:review, /codex:status from yellow-codex outside of workflows:work? If no, delete plugins/yellow-codex and lean on yellow-core's Codex delegation only.
>
> Open question (the big one): if you adopt P0.1 option (a) — full migration to ce-\* skills — then plugins/yellow-core/commands/workflows/{plan,work,review,brainstorm,compound}.md and the brainstorm-orchestrator agent become OBSOLETE in favor of upstream's skill versions. Add to delete list only if you commit to (a). Under option (c) (parallel deprecation), keep them; under (b) (stay on workflows:\*), keep them.

Generated 2026-04-28 — review-only, no files modified.
