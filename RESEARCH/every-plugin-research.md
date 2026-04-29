# Every / Compound Engineering Claude Code Plugin — Technical Reference

> Snapshot date: April 28, 2026. Source of truth: `EveryInc/compound-engineering-plugin` `main` branch on GitHub. Some sub-trees (raw `plugin.json`, full agent and skill bodies, settings/hooks files, full commit log) could not be fetched directly due to GitHub rate limits and robots restrictions during this research. Where I could not read a file directly, I have flagged it explicitly in **Section 8: Open Questions** and noted the best-available indirect source. The Change Log section, README inventories, and CHANGELOG history were read directly from GitHub.

---

## 1. Executive Summary

- **What it is.** `EveryInc/compound-engineering-plugin` is now a *multi-target marketplace repo*, not a single Claude Code plugin. The repo at `main` ships **two plugins** (`compound-engineering` and `coding-tutor`) under `plugins/`, plus a Bun/TypeScript CLI (`@every-env/compound-plugin`) under `src/` that converts the Claude-Code-format plugin into OpenCode, Pi, Gemini CLI, and Kiro CLI layouts. The flagship `compound-engineering` plugin ships **~36 skills and ~51 agents** (per the live README) implementing the Plan → Work → Review → Compound loop on Claude Code, Codex, Cursor, Copilot, Droid, and Qwen.
- **What's new since ~6 months ago (Oct/Nov 2025 → Apr 2026).** Massive architectural refactor. The biggest shifts: (a) commands were renamed `workflows:*` → `ce:*` in v2.38.0 (Mar 1, 2026) then refactored from *commands* to *skills* with `ce-` prefix; (b) the entire plugin moved into a `plugins/compound-engineering/` subdirectory and the repo became a marketplace; (c) Codex got a *native* plugin install path (PR #616), Cursor got native install (v0.8.0), and converter-only targets (OpenCode/Pi/Gemini/Kiro) were split off; (d) major new top-level skills added — `ce-debug`, `ce-optimize`, `ce-ideate`, `ce-demo-reel`, `ce-setup`, `ce-update`, `ce-release-notes`, `ce-polish-beta`, `ce-sessions`, `ce-slack-research`, `ce-pr-description`; (e) review pipeline was rebuilt around tiered persona reviewers with confidence calibration and a separate `ce-doc-review` for plans/brainstorms.
- **Biggest architectural decisions.** (1) **Skills-first, commands-thin** — the CE workflow is now expressed mostly as Anthropic-spec SKILL.md directories under `plugins/compound-engineering/skills/`, with thin command shims; (2) **Reviewer agents as read-only specialists** — reviewer subagents (`ce-*-reviewer`) are restricted to read-only tools and dispatched in parallel by the `ce-code-review` skill; (3) **Multi-platform via converters** — a Bun CLI (`@every-env/compound-plugin`) under `src/` rewrites the Claude-Code plugin into other agents' formats; (4) **Release automation owns versioning** — multiple semver-tracked components (cli, compound-engineering, coding-tutor, marketplace), each with its own GitHub release tag; (5) **Universal (non-software) planning** — `ce-plan` and `ce-brainstorm` were generalized so the same workflow handles features, research, events, and study plans.
- **Current versions** (latest GitHub Releases as of late April 2026): `compound-engineering-v3.2.0` (latest, 26 Apr 2026), `cli-v3.2.0`, plus prior `compound-engineering-v3.1.0`, `compound-engineering-v3.0.3` (24 Apr 2026), `compound-engineering-v3.0.2`. Root `package.json` reports `@every-env/compound-plugin` at `3.2.0`.
- **What problem it solves vs. vanilla Claude Code.** Vanilla Claude Code gives you a chat loop and tools. CE adds an *engineering discipline* on top: forced planning + brainstorming before code, a tiered parallel code-review pipeline with confidence gating, an explicit "compound" step that writes solved-problem artifacts to `docs/solutions/` and `docs/learnings/`, and a setup skill that auto-detects stack and configures the right reviewer set. It is essentially Every's internal SDLC encoded as Claude Code primitives.

---

## 2. Repo Tree

The repo's `main` branch is structured like this (top-level directories confirmed by GitHub UI, README, AGENTS.md, and the CHANGELOG history). Item-level paths inside `plugins/compound-engineering/` are confirmed by the README's component reference and the GitHub directory listing for `plugins/compound-engineering/skills` and `/agents`.

```
compound-engineering-plugin/
├── .claude-plugin/                       # Marketplace catalog metadata for Claude Code
│   └── marketplace.json                  # Lists `compound-engineering` and `coding-tutor` plugins; pointed at by /plugin marketplace add
├── .cursor-plugin/                       # Cursor marketplace metadata
│   └── marketplace.json                  # Cursor's marketplace listing
├── .github/                              # GitHub Actions, release-please config, issue templates (release automation lives here)
├── plugins/                              # All distributed plugins live here
│   ├── compound-engineering/             # The flagship plugin
│   │   ├── .claude-plugin/
│   │   │   └── plugin.json               # Plugin manifest (name, version, description, author) — see §3.6
│   │   ├── .cursor-plugin/
│   │   │   └── plugin.json               # Cursor-format plugin manifest (mirrors the Claude one)
│   │   ├── .codex-plugin/                # Codex native plugin manifests (added in PR #616)
│   │   ├── agents/                       # ~51 subagent definitions, one Markdown file each, named `<agent>.agent.md` (with `.agent.md` suffix)
│   │   │   ├── ce-adversarial-document-reviewer.agent.md
│   │   │   ├── ce-adversarial-reviewer.agent.md
│   │   │   ├── ce-agent-native-reviewer.agent.md
│   │   │   ├── ce-ankane-readme-writer.agent.md
│   │   │   ├── ce-api-contract-reviewer.agent.md
│   │   │   ├── ce-architecture-strategist.agent.md
│   │   │   ├── ce-best-practices-researcher.agent.md
│   │   │   ├── ce-cli-agent-readiness-reviewer.agent.md
│   │   │   ├── ce-cli-readiness-reviewer.agent.md
│   │   │   ├── ce-code-simplicity-reviewer.agent.md
│   │   │   ├── ce-coherence-reviewer.agent.md
│   │   │   ├── ce-correctness-reviewer.agent.md
│   │   │   ├── ce-data-integrity-guardian.agent.md
│   │   │   ├── ce-data-migration-expert.agent.md
│   │   │   ├── ce-data-migrations-reviewer.agent.md
│   │   │   ├── ce-deployment-verification-agent.agent.md
│   │   │   ├── ce-design-implementation-reviewer.agent.md
│   │   │   ├── ce-design-iterator.agent.md
│   │   │   ├── ce-design-lens-reviewer.agent.md
│   │   │   ├── ce-dhh-rails-reviewer.agent.md
│   │   │   ├── ce-feasibility-reviewer.agent.md
│   │   │   ├── ce-figma-design-sync.agent.md
│   │   │   ├── ce-framework-docs-researcher.agent.md
│   │   │   ├── ce-git-history-analyzer.agent.md
│   │   │   ├── ce-issue-intelligence-analyst.agent.md
│   │   │   ├── ce-julik-frontend-races-reviewer.agent.md
│   │   │   ├── ce-kieran-python-reviewer.agent.md
│   │   │   ├── ce-kieran-rails-reviewer.agent.md
│   │   │   ├── ce-kieran-typescript-reviewer.agent.md
│   │   │   ├── ce-learnings-researcher.agent.md
│   │   │   ├── ce-maintainability-reviewer.agent.md
│   │   │   ├── ce-pattern-recognition-specialist.agent.md
│   │   │   ├── ce-performance-oracle.agent.md
│   │   │   ├── ce-performance-reviewer.agent.md
│   │   │   ├── ce-pr-comment-resolver.agent.md
│   │   │   ├── ce-product-lens-reviewer.agent.md
│   │   │   ├── ce-project-standards-reviewer.agent.md
│   │   │   ├── ce-reliability-reviewer.agent.md
│   │   │   ├── ce-repo-research-analyst.agent.md
│   │   │   ├── ce-schema-drift-detector.agent.md
│   │   │   ├── ce-scope-guardian-reviewer.agent.md
│   │   │   ├── ce-security-lens-reviewer.agent.md
│   │   │   ├── ce-security-reviewer.agent.md
│   │   │   ├── ce-security-sentinel.agent.md
│   │   │   ├── ce-session-historian.agent.md
│   │   │   ├── ce-slack-researcher.agent.md
│   │   │   ├── ce-spec-flow-analyzer.agent.md
│   │   │   ├── ce-swift-ios-reviewer.agent.md
│   │   │   ├── ce-testing-reviewer.agent.md
│   │   │   └── ce-web-researcher.agent.md
│   │   ├── skills/                       # ~36 skill directories, each containing SKILL.md plus optional references/, assets/, scripts/
│   │   │   ├── ce-agent-native-architecture/   # Agent-native architecture knowledge skill (SKILL.md + references/)
│   │   │   ├── ce-agent-native-audit/          # 8-principle audit harness
│   │   │   ├── ce-brainstorm/                  # Interactive Q&A → requirements doc
│   │   │   ├── ce-clean-gone-branches/         # Clean local branches whose remote tracking is gone
│   │   │   ├── ce-code-review/                 # Tiered persona-agent code-review pipeline
│   │   │   ├── ce-commit/                      # Single value-communicating commit
│   │   │   ├── ce-commit-push-pr/              # Commit + push + open or update PR
│   │   │   ├── ce-compound/                    # Capture solved-problem learnings
│   │   │   ├── ce-compound-refresh/            # Refresh stale learnings
│   │   │   ├── ce-debug/                       # Test-first systematic debugging
│   │   │   ├── ce-demo-reel/                   # Capture GIF/video demos for PRs
│   │   │   ├── ce-dhh-rails-style/             # 37signals/DHH Rails style knowledge
│   │   │   ├── ce-doc-review/                  # Persona-based brainstorm/plan review
│   │   │   ├── ce-frontend-design/             # Production frontend interfaces skill
│   │   │   ├── ce-gemini-imagegen/             # Gemini API image gen
│   │   │   ├── ce-ideate/                      # Big-picture ideation w/ warrant contract
│   │   │   ├── ce-optimize/                    # Iterative optimization w/ LLM-as-judge
│   │   │   ├── ce-plan/                        # Universal planning (software/non-software)
│   │   │   ├── ce-polish-beta/                 # HITL post-review polish phase
│   │   │   ├── ce-pr-description/              # Net-result PR description writer
│   │   │   ├── ce-proof/                       # Proof collaborative editor integration
│   │   │   ├── ce-release-notes/               # Plugin release-history Q&A
│   │   │   ├── ce-report-bug/                  # Report a bug in the CE plugin
│   │   │   ├── ce-resolve-pr-feedback/         # Parallel PR feedback resolution
│   │   │   ├── ce-sessions/                    # Cross-platform session history search
│   │   │   ├── ce-setup/                       # Diagnose env + install missing tools
│   │   │   ├── ce-slack-research/              # Slack organizational context research
│   │   │   ├── ce-test-browser/                # Browser tests on PR-affected pages
│   │   │   ├── ce-test-xcode/                  # iOS sim builds via XcodeBuildMCP
│   │   │   ├── ce-update/                      # Plugin version check + cache fix (Claude Code)
│   │   │   ├── ce-work/                        # Execute work items systematically
│   │   │   ├── ce-worktree/                    # Manage Git worktrees
│   │   │   ├── lfg/                            # Full autonomous workflow
│   │   │   └── (other skills referenced in CHANGELOG; full list confirmed by README)
│   │   ├── commands/                     # Thin slash-command shims that route into skills (some legacy commands like /ce-update kept here)
│   │   ├── hooks/                        # Hook scripts and hooks.json (skill injection into subagents per /iliaal mirror; original ref CHANGELOG 2.31.0)
│   │   ├── README.md                     # Component reference (skills+agents) — read in this research
│   │   └── CHANGELOG.md                  # Historical changelog through v2.68.1; canonical history now in root CHANGELOG.md
│   └── coding-tutor/                     # Second plugin (separate component, separate release line)
├── src/                                  # Bun/TypeScript CLI for converter-backed installs
│   ├── index.ts                          # Bin entry (`compound-plugin`)
│   ├── (parsers, converters, target writers — opencode/pi/gemini/kiro/codex-agents/cursor/droid/copilot/qwen/openclaw/windsurf)
│   └── ov_setup/                         # OV bootstrap reference assets
├── tests/                                # Bun test suite for converters/writers/CLI
│   └── fixtures/sample-plugin/           # Test fixture
├── scripts/                              # Repo maintenance, release tooling
│   └── release/                          # preview.ts, sync-metadata.ts, validate.ts (release automation)
├── docs/                                 # Specs and HTML pages
│   ├── specs/                            # Per-target specs (e.g., docs/specs/cursor.md)
│   └── pages/                            # Generated HTML doc pages
├── README.md                             # Repo root README — install matrix for all targets
├── CHANGELOG.md                          # Canonical release history (now points to GitHub Releases)
├── CLAUDE.md                             # Compatibility shim for tools that still look for CLAUDE.md
├── AGENTS.md                             # Canonical repo instruction file (replaces CLAUDE.md)
├── package.json                          # @every-env/compound-plugin@3.2.0; deps citty, js-yaml; semantic-release
├── LICENSE                               # MIT
└── (lock files: bun.lockb, etc.)
```

**Uncategorized / not directly verified.** I could not directly fetch `hooks/`, `commands/`, or `settings*.json` files from the live repo this session due to access errors. Their existence is implied by the README, AGENTS.md ("Keep mappings explicit: tools, permissions, hooks/events"), and the CHANGELOG (e.g., the v2.31.0 fix "Fix crash when hook entries have no matcher", referenced hook scripts for skill injection). See **Open Questions** for items to confirm.

---

## 3. Component Catalog

> Per-item write-ups below derive from the live `plugins/compound-engineering/README.md` (read directly), the historical `CHANGELOG.md` (read directly), and recent GitHub Release notes (read directly). Where individual file frontmatter could not be retrieved this session, that is flagged. The README's Skills/Agents tables are the canonical inventory and are reproduced here verbatim.

### 3.1 Slash Commands & Skill-Slash Shims

In current main, *most* user-facing entry points are **skills**, not commands. The README documents that the **primary entry points are skills invoked with slash syntax** (e.g., `/ce-ideate`, `/ce-plan`). Some skills are documented without leading `/` because they activate by description rather than as explicit slash commands (e.g., `ce-commit`, `ce-worktree`).

| Slash trigger | Type | What it does |
|---|---|---|
| `/ce-setup` | skill | Diagnoses environment, installs missing tools, bootstraps project config in one interactive flow. Auto-runs on first project use. (Added v2.65.0; ast-grep CLI check added v3.x via #653.) |
| `/ce-ideate` | skill | Optional big-picture ideation: generate and critically evaluate grounded ideas, route the strongest one into brainstorming. Mode-aware v2 ideation (#588), subject gate + surprise-me + warrant contract (#671). |
| `/ce-brainstorm` | skill | Interactive Q&A to think through a feature/problem and write a right-sized requirements doc before planning. Universal (works for non-software tasks per #519). HITL review-loop mode (#580). |
| `/ce-plan` | skill | Create structured plans for any multi-step task with automatic confidence checking. MINIMAL/MORE/A LOT templates. Status frontmatter (`active`/`completed`). Decision-matrix form, unchanged invariants, risk table (#417). Interactive deepening mode (#443). |
| `/ce-code-review` | skill | Structured code review with tiered persona agents, confidence gating, and a dedup pipeline. Compact returns to reduce orchestrator context (#535). Headless mode for programmatic callers (#430). Recursion guard (#527). Always fetches base branch (#544). |
| `/ce-work` | skill | Execute work items systematically. Test discovery, accepts bare prompts (#423). Codex delegation mode (#328) and beta version (#476). System-wide test check before marking done. Branch protection. Per-task incremental commits. |
| `/ce-debug` | skill | Systematically find root causes and fix bugs — traces causal chains, forms testable hypotheses, implements test-first fixes. Added v2.64.0 (#543). |
| `/ce-compound` | skill | Document solved problems to compound team knowledge. Track-based schema for bug vs knowledge learnings (#445). Stack-aware reviewer routing (#497). Discoverability check for `docs/solutions/` (#456). |
| `/ce-compound-refresh` | skill | Refresh stale or drifting learnings; decide keep/update/replace/archive. Consolidation + overlap detection (#372). |
| `/ce-optimize` | skill | Iterative optimization loops with parallel experiments, measurement gates, and LLM-as-judge quality scoring. Auto-research loop for system prompts / vector clustering / code solution comparison (#446). Has its own README under `skills/ce-optimize/README.md` with example specs. |
| `/ce-sessions` | skill | Ask questions about session history across Claude Code, Codex, and Cursor. Backed by `ce-session-historian` agent (#534). |
| `/ce-slack-research` | skill | Search Slack for interpreted organizational context — decisions, constraints, discussion arcs. Opt-in (#521); workspace identity surfaced. |
| `ce-clean-gone-branches` | skill | Clean up local branches whose remote tracking branch is gone. |
| `ce-commit` | skill | Create a git commit with a value-communicating message. |
| `ce-commit-push-pr` | skill | Commit, push, open PR with adaptive description; also update existing PR description, or generate description without committing. Skips evidence prompt when judgment allows (#663). Pre-resolved context to reduce bash calls (#488). Filters fix-up commits from descriptions (#484). |
| `ce-worktree` | skill | Manage Git worktrees for parallel development. Auto-trusts mise/direnv configs (#312). Detects when `.git` is a file. |
| `/ce-demo-reel` | skill | Capture visual demo reel (GIF demos, terminal recordings, screenshots) for PRs with project-type-aware tier selection. Two-stage upload approval gate (#546). Prevents secrets in recorded demos (#664). |
| `/ce-report-bug` | skill | Report a bug in the compound-engineering plugin. |
| `/ce-resolve-pr-feedback` | skill | Resolve PR review feedback in parallel. Cross-invocation cluster analysis (#480), actionability filter (#461), untrusted-input handling for PR comment text (#490). |
| `/ce-test-browser` | skill | Run browser tests on PR-affected pages. (Replaced `/playwright-test`, uses agent-browser CLI.) |
| `/ce-test-xcode` | skill | Build and test iOS apps on simulator using XcodeBuildMCP. |
| `/ce-update` | skill | Check compound-engineering plugin version and fix stale cache (Claude Code only). Compares against main `plugin.json` (#660). Derives cache dir from `CLAUDE_PLUGIN_ROOT` parent (#645). Replaced cache sweep with `claude plugin update` (#656). |
| `/ce-release-notes` | skill | Summarize recent CE plugin releases or answer a question about a past release with a version citation. Added v2.68.0 (#589). |
| `ce-agent-native-architecture` | skill | Build AI agents using prompt-native architecture. Reference docs cover dynamic context injection, action parity, shared workspace, mobile patterns. |
| `ce-dhh-rails-style` | skill | Write Ruby/Rails code in DHH's 37signals style. Reference docs for controllers/models/frontend/architecture/gems. |
| `ce-frontend-design` | skill | Create production-grade frontend interfaces. Layered architecture with visual verification (#343). |
| `ce-doc-review` | skill | Review documents using parallel persona agents for role-specific feedback. Headless mode (#425). Smart autofix + batch-confirm + error/omission classification (#401). |
| `ce-proof` | skill | Create, edit, and share documents via the Proof collaborative editor. Supports doc creation, track-changes suggestions, comments, bulk rewrites; no auth needed for shared docs. |
| `ce-gemini-imagegen` | skill | Generate and edit images using Google's Gemini API. |
| `ce-polish-beta` | skill | Beta. Human-in-the-loop polish phase after `/ce-code-review` — verifies review + CI, starts dev server from `.claude/launch.json`, generates a testable checklist, dispatches polish sub-agents for fixes. Emits stacked-PR seeds for oversized work. (#568) |
| `/lfg` | skill | Beta. Full autonomous engineering workflow: plan → deepen-plan → work → review → resolve todos → test-browser → feature-video. Platform-neutral skill references (#642). |

**Per-item exact frontmatter and full prompt bodies were not fetched this session for individual files.** See Open Questions §8.

### 3.2 Subagents

Agents are subagent files under `plugins/compound-engineering/agents/<name>.agent.md`. They are **invoked by skills, not directly** by users (per the README). Per CHANGELOG entry 2.23.1 ("Agent model inheritance"), all agents use `model: inherit` so they match the user's configured model — only `lint` (since removed) historically used `model: haiku`. Reviewer agents are restricted to read-only tools per #553.

The README enumerates these categories. The full table is reproduced verbatim below; per-agent system-prompt summaries derive from README descriptions.

**Review agents (used by `/ce-code-review`, often dispatched in parallel; tiered persona pipeline introduced in v2.51 (`ce:review-beta`) and promoted to stable in v2.52 (#371)):**

| Agent | What it's for |
|---|---|
| `ce-agent-native-reviewer` | Verify features are agent-native (action + context parity). |
| `ce-api-contract-reviewer` | Detect breaking API contract changes. |
| `ce-cli-agent-readiness-reviewer` | Evaluate CLI agent-friendliness against 7 core principles. |
| `ce-cli-readiness-reviewer` | Conditional CLI-readiness persona for ce-code-review (structured JSON). |
| `ce-architecture-strategist` | Architectural decisions and compliance. |
| `ce-code-simplicity-reviewer` | Final pass for simplicity and minimalism. |
| `ce-correctness-reviewer` | Logic errors, edge cases, state bugs. |
| `ce-data-integrity-guardian` | Database migrations and data integrity. |
| `ce-data-migration-expert` | Validate ID mappings match production; check for swapped values. |
| `ce-data-migrations-reviewer` | Migration safety with confidence calibration. |
| `ce-deployment-verification-agent` | Go/No-Go deployment checklists for risky data changes. |
| `ce-dhh-rails-reviewer` | Rails review from DHH's perspective. |
| `ce-julik-frontend-races-reviewer` | JavaScript/Stimulus race-condition review. |
| `ce-kieran-rails-reviewer` | Rails code review with strict conventions. |
| `ce-kieran-python-reviewer` | Python code review with strict conventions. |
| `ce-kieran-typescript-reviewer` | TypeScript code review with strict conventions. |
| `ce-maintainability-reviewer` | Coupling, complexity, naming, dead code. |
| `ce-pattern-recognition-specialist` | Patterns and anti-patterns. |
| `ce-performance-oracle` | Performance analysis and optimization. |
| `ce-performance-reviewer` | Runtime performance with confidence calibration. |
| `ce-reliability-reviewer` | Production reliability and failure modes. |
| `ce-schema-drift-detector` | Detects unrelated `schema.rb` changes in PRs. Conditional. |
| `ce-security-reviewer` | Exploitable vulnerabilities w/ confidence calibration. |
| `ce-security-sentinel` | Security audits and vulnerability assessments. |
| `ce-swift-ios-reviewer` | Swift/iOS — SwiftUI state, retain cycles, concurrency, Core Data threading, accessibility. |
| `ce-testing-reviewer` | Test-coverage gaps, weak assertions. |
| `ce-project-standards-reviewer` | CLAUDE.md and AGENTS.md compliance. Always-on persona (#402). |
| `ce-adversarial-reviewer` | Construct failure scenarios across component boundaries. |

**Document review agents (used by `/ce-doc-review`):**

| Agent | What it's for |
|---|---|
| `ce-coherence-reviewer` | Internal consistency, contradictions, terminology drift. |
| `ce-design-lens-reviewer` | Missing design decisions, interaction states, AI slop risk. |
| `ce-feasibility-reviewer` | Whether technical approaches will survive contact with reality. |
| `ce-product-lens-reviewer` | Problem framing, scope, goal misalignment. Domain-agnostic activation (#481). |
| `ce-scope-guardian-reviewer` | Unjustified complexity, scope creep, premature abstractions. |
| `ce-security-lens-reviewer` | Plan-level security gaps (auth, data, APIs). |
| `ce-adversarial-document-reviewer` | Challenge premises, surface unstated assumptions. |

**Research agents:**

| Agent | What it's for |
|---|---|
| `ce-best-practices-researcher` | External best practices and examples. Skills-first (Phase 1 reads SKILL.md), web second. |
| `ce-framework-docs-researcher` | Framework docs and best practices. |
| `ce-git-history-analyzer` | Git history and code evolution. |
| `ce-issue-intelligence-analyst` | GitHub issues — recurring themes and pain patterns. |
| `ce-learnings-researcher` | Search institutional learnings (`docs/solutions/`) for past solutions. Always-run in `/ce-code-review`. |
| `ce-repo-research-analyst` | Repository structure and conventions. Structured technology scan (#327). |
| `ce-session-historian` | Search prior Claude Code, Codex, Cursor sessions. |
| `ce-slack-researcher` | Slack organizational context. |
| `ce-web-researcher` | Iterative web research for prior art / market signals / cross-domain analogies. |

**Design agents:**

| Agent | What it's for |
|---|---|
| `ce-design-implementation-reviewer` | Verify UI implementations match Figma designs. |
| `ce-design-iterator` | Iteratively refine UI through systematic design iterations. Auto-loads design skills (Step 0). |
| `ce-figma-design-sync` | Synchronize web implementations with Figma designs. |

**Workflow agents:**

| Agent | What it's for |
|---|---|
| `ce-pr-comment-resolver` | Address PR comments and implement fixes. |
| `ce-spec-flow-analyzer` | Analyze user flows; identify gaps in specs. |

**Docs agents:**

| Agent | What it's for |
|---|---|
| `ce-ankane-readme-writer` | READMEs following Ankane-style template for Ruby gems. |

**Per-agent full frontmatter (description, tools, model) and system-prompt bodies were not directly fetched this session.** Defaults inferred from CHANGELOG: `model: inherit`; reviewer agents restricted to read-only tools (#553). Confirm in your fork.

### 3.3 Skills

Skills live in `plugins/compound-engineering/skills/<skill-name>/SKILL.md` with optional `references/`, `assets/`, and `scripts/` subdirectories per the Anthropic SKILL.md spec. The `ce-` prefix is mandatory and identifies the skill family. Several have substantial bundled references — for example, `ce-agent-native-architecture` ships at least: `mcp-tool-design.md`, `dynamic-context-injection.md`, `action-parity-discipline.md`, `shared-workspace-architecture.md`, `agent-native-testing.md`, `mobile-patterns.md`, `architecture-patterns.md` (per CHANGELOG 2.17.0 / 2.18.0). `ce-dhh-rails-style` ships `controllers.md`, `models.md`, `frontend.md`, `architecture.md`, `gems.md` (per CHANGELOG 2.16.0). `ce-optimize` has its own README, schema, and workflow docs. `ce-compound`/`ce-compound-refresh` reference `docs/solutions/` and `docs/learnings/` per CHANGELOG 2.45.0 (#311 integrates Claude Code auto-memory as supplementary data).

Skill compose pattern (per the README and AGENTS.md): skills delegate to agents using fully-qualified namespaces, e.g. `compound-engineering:research:learnings-researcher` (never the bare agent name). Many skills are marked `disable-model-invocation: true` so Claude doesn't auto-fire them as side-effects (e.g., `git-worktree`, `skill-creator`/`create-agent-skills`, `compound-docs`/`ce-compound`, etc., per CHANGELOG 2.31.0 — context-token optimization step that was the unlock for 27+ commands and skills).

### 3.4 Hooks

The repo ships at least one hook concept: a **skill-injection hook** that injects relevant skills into subagent context before a subagent runs (referenced in iliaal's mirror description and CHANGELOG entries about subagent skill awareness; CHANGELOG 2.31.0 also fixed a "crash when hook entries have no matcher" — implying hook config exists at the plugin root). The hooks directory is documented but I did not fetch the source files this session.

**Confirmed from CHANGELOG:** at least one hook entry exists in plugin config, must include a `matcher` field (the bug was that some had no matcher and crashed), and skill-injection happens around subagent dispatch. **See Open Questions** for the exact event(s), matcher patterns, and script paths.

### 3.5 Settings & Permissions

The plugin emits a project-level settings file: **`compound-engineering.local.md`** in the project root. This was introduced in v2.33.0 (Configurable Review Agents) and is *tool-agnostic* — works identically for Claude Code, Codex, and OpenCode. It records: detected stack, focus areas (security, performance, architecture, code simplicity), review depth (fast/thorough/comprehensive), and the configured reviewer set. `/ce-code-review` reads this file; if absent, it auto-invokes `/ce-setup`.

**Plugin-level settings.json (in `.claude-plugin/`):** the marketplace metadata and CHANGELOG references suggest standard Claude-Code-plugin permissions: read-only restrictions for reviewer agents (#553), skill-injection hook config, and an MCP server section. v2.62.0 (#486) **removed the bundled context7 MCP server**; v2.39.0 added a Context7 API-key auth fix (`x-api-key` header). Plugin-bundled MCP servers thus look minimal as of April 2026; users add MCP servers manually.

**`additionalDirectories` and statusLine:** not confirmed in this session.

### 3.6 Plugin Manifest (`plugins/compound-engineering/.claude-plugin/plugin.json`)

I could not directly fetch the raw `plugin.json` this session due to access errors. The exact contents must be confirmed in your fork. Indirect facts:

- **`name`:** `compound-engineering`
- **`version`:** ~`3.x` aligned with the latest GitHub Release tag `compound-engineering-v3.2.0` (26 Apr 2026), then `v3.1.0`, `v3.0.3`, `v3.0.2` preceding it. Release automation owns this; routine PRs do not hand-bump.
- **`description`:** historically "X agents, Y commands, Z skills, N MCP server(s)" format (per DeepWiki summary and CLAUDE.md guidance). Current description per README context likely "AI-powered development tools that get smarter with every use."
- **`author`:** Every Inc / Kieran Klaassen.
- **MCP servers:** none bundled as of April 2026 (Context7 removed in #486).
- The repo root **`package.json`** (separate, for the Bun CLI) is `@every-env/compound-plugin@3.2.0` with `bin` `compound-plugin: src/index.ts`, deps `citty ^0.1.6`, `js-yaml ^4.1.0`.

The **marketplace catalog file** `.claude-plugin/marketplace.json` at the repo root lists both `compound-engineering` and `coding-tutor` plugins; their plugin.json descriptions must match the marketplace entry.

---

## 4. Methodology Mapping

**Core philosophy (from Every).** Compound engineering's central claim: *each unit of engineering work should make the next unit easier, not harder.* Per Dan Shipper's article ["Compound Engineering: How Every Codes With Agents"](https://every.to/chain-of-thought/compound-engineering-how-every-codes-with-agents): "in compound engineering, you expect each feature to make the next feature easier to build. This is because compound engineering creates a learning loop for your agents and members of your team, so that each bug, failed test, or a-ha problem-solving insight gets documented and used by future agents." The canonical guide [every.to/guides/compound-engineering](https://every.to/guides/compound-engineering) distills it to four steps: **Plan → Work → Review → Compound**, with 80% of effort in plan + review and 20% in work + compound. Compound engineering emerged from building Cora (Every's AI inbox chief-of-staff). Every operates five products (Cora, Monologue, Sparkle, Spiral, Every.to) primarily with single-person engineering teams using this loop.

**How methodology maps onto plugin components:**

| Pillar | Plugin operationalization |
|---|---|
| Plan ("80% pre-code thinking") | `/ce-ideate` → `/ce-brainstorm` → `/ce-plan` (with confidence gating, decision-matrix form, optional deepening, persona-based `ce-doc-review`); research agents (`ce-best-practices-researcher`, `ce-framework-docs-researcher`, `ce-repo-research-analyst`, `ce-learnings-researcher`) parallelized during planning |
| Work ("execute with quality gates") | `/ce-work` orchestrator decomposes the plan, dispatches subagents (Ralph-Loop variant), runs system-wide test check before "done"; `/lfg` is the autonomous chain |
| Review ("parallel specialists with calibrated confidence") | `/ce-code-review` dispatches the tiered review agents in parallel; always-on `ce-learnings-researcher`, conditional `ce-schema-drift-detector`; confidence rubric + FP suppression + intent verification (#434); persona pipeline promoted to stable in v2.52 |
| Compound ("write down what you learned") | `/ce-compound` and `/ce-compound-refresh` write to `docs/solutions/` and `docs/learnings/` with track-based bug/knowledge schema; `/ce-code-review` reads them back so the loop closes |

**Canonical end-to-end workflow (current commands):**

```
/ce-setup                       # one-time, per-project
/ce-ideate "vague idea"         # optional
/ce-brainstorm                  # interactive Q&A → docs/brainstorms/<slug>.md
/ce-plan                        # → docs/plans/<date>-<seq>-<slug>.md (status: active)
/ce-work                        # iterates against the plan, commits per task
/ce-code-review                 # parallel persona reviewers; reads compound-engineering.local.md
/ce-resolve-pr-feedback         # parallel resolution
/ce-commit-push-pr              # PR with auto-generated description
/ce-compound                    # write learning to docs/solutions/ → next plan reads it
```
Or, `/lfg` chains the whole sequence with one approval gate after the plan.

**What it solves that vanilla Claude Code does not:** vanilla Claude Code is a tool harness with a single context. CE adds (1) forced pre-work artifact creation (brainstorm, plan), (2) parallel specialist review with calibrated severity, (3) durable cross-session knowledge under `docs/solutions/`, (4) cross-platform install, (5) tiered model usage (reviewers get cheap/fast tiers, coders get the user's tier).

---

## 5. Change Log / What's New

### Current versions

- **`compound-engineering` plugin:** `v3.2.0` (latest release, 26 Apr 2026). Recent line: `v3.2.0` → `v3.1.0` → `v3.0.3` (24 Apr 2026, sha `bc3709f`) → `v3.0.2` → ... → `v2.68.1` (2026-04-18) → `v2.68.0` (2026-04-17) → ... back to v2.15.x in late Dec 2025.
- **`@every-env/compound-plugin` (Bun CLI):** `cli-v3.2.0` and `cli-v3.1.0`, with package.json reporting `3.2.0`. Earlier `v0.4.0`–`v0.8.0` line dates from Feb 2026 when the CLI was its own product.
- **Marketplace and `coding-tutor`:** separate release lines.

### Top-line architectural shifts in last ~6 months (Nov 2025 → Apr 2026)

1. **Repo became a multi-plugin marketplace.** Plugin moved into `plugins/compound-engineering/`; second plugin `coding-tutor/` added. Marketplace metadata at `.claude-plugin/marketplace.json` and `.cursor-plugin/marketplace.json`. Release-automation owns versioning across cli, compound-engineering, coding-tutor, marketplace.
2. **Command → Skill migration with prefix change.** v2.38.0 (2026-03-01) renamed `/workflows:plan|work|review|brainstorm|compound` → `/ce-plan|work|review|brainstorm|compound`. Subsequent releases progressively converted commands into Anthropic-spec skills under `skills/`, with thin command shims preserved for back-compat.
3. **Tiered persona-agent review pipeline became the default.** v2.51.0 added `ce:review-beta` (#348) with structured persona pipeline; v2.52.0 promoted to stable `ce:review` (#371); v2.55.0 added project-standards-reviewer as always-on (#402) and adversarial reviewers (#403); v2.60.0 added confidence rubric / FP suppression (#434) and table-format enforcement (#454).
4. **Multi-target install matrix.** Native plugin installs added for Cursor (v0.8.0 — `/add-plugin compound-engineering`) and Codex (#616 — native plugin manifests + agents-only converter). Native marketplace flow for Copilot, Droid, Qwen. Converter-backed installs preserved for OpenCode, Pi, Gemini CLI, Kiro CLI. Old Bun-only Cursor/Codex/Copilot/Droid/Qwen installs deprecated; cleanup commands provided.
5. **Pi first-class support** (#651) via `pi-subagents` + `pi-ask-user`.
6. **Skill harness limit handling.** Skill descriptions capped at the harness limit (#643). Question-tool hardened so it doesn't silently skip when tool looks unavailable (#620). Skill descriptions / context-token usage cut by ~79% (CHANGELOG 2.31.0).
7. **Universal (non-software) planning + brainstorming** — v2.63.0 (#519): `ce-plan` and `ce-brainstorm` work for research workflows, events, study plans, etc.
8. **HITL polish phase** — v2.67.0 (#568) added `ce-polish-beta`: human-in-the-loop polish phase between `/ce-code-review` and merge, including a dev-server launch from `.claude/launch.json`, testable checklist, polish sub-agents, stacked-PR seeds for oversized work.
9. **Ideation overhaul** — v2.68.0 mode-aware v2 ideation (#588); subject gate, surprise-me, warrant contract (#671); HITL review-loop mode for `proof`/`ce-brainstorm`/`ce-plan`/`ce-ideate` (#580).
10. **Optimization loops** — v2.66.0 (#446) added `ce-optimize`: auto-research loop for tuning system prompts / vector clustering / evaluating different code solutions, with parallel experiments, measurement gates, LLM-as-judge.
11. **Cross-platform memory** — v2.45.0 (#311) integrated Claude Code auto-memory as supplementary data source for `ce-compound`/`ce-compound-refresh`. v2.64.0 (#534) `session-historian` cross-platform session-history agent and `/ce-sessions` skill.
12. **Slack research** — v2.63.0 (#495) added `ce-slack-researcher` agent; v2.64.0 added `/ce-slack-research` skill (#538). Made opt-in (#521).
13. **Demo/PR polish** — `/ce-demo-reel` skill with Python capture pipeline (v2.64.0 #541); two-stage upload approval gate (#546); secrets-prevention (#664). PR descriptions rewritten as net-result not changelog (#558); fix-up commit filtering (#484); shield-badge precomputation (#464).
14. **Setup unification** — v2.65.0 (#345) unified `ce-setup` skill with dependency management and config bootstrapping.
15. **Update flow** — v2.64.0 (#532) `ce-update` plugin version check skill with `ce_platforms` filtering. v3.x series fixed cache-dir derivation (#645), replaced cache sweep with `claude plugin update` (#656), compares against main `plugin.json` not release tags (#660).
16. **Doc-review** — v2.51.0 (#359) redesigned `document-review` with persona-based review; v2.55.0 (#401) smarter autofix + batch-confirm + error/omission classification; promote pattern-resolved findings to auto (#507); recursion guard (#523); headless mode (#425).
17. **Big cleanups in 2026-04.** Removed bundled context7 MCP (#486). Removed `claude-permissions-optimizer` skill (#583). Removed `rclone`, `agent-browser`, `lint`, `bug-reproduction-validator` skills (#545). Consolidated `compound-docs` into `ce-compound` (#390). Replaced manual review-agent config with `ce:review` delegation (#381).
18. **New focused PR-description skill** — v2.66.0 (#561) `ce-pr-description` extracted as a focused skill; `ce-commit-push-pr` now delegates to it.

### Diff-style summary vs. ~6 months ago

- **NEW components** (since Nov 2025, approximate): skills `ce-debug`, `ce-demo-reel`, `ce-ideate`, `ce-optimize`, `ce-pr-description`, `ce-polish-beta`, `ce-release-notes`, `ce-sessions`, `ce-setup` (unified), `ce-slack-research`, `ce-update`; agents `ce-adversarial-reviewer`, `ce-adversarial-document-reviewer`, `ce-cli-agent-readiness-reviewer`, `ce-cli-readiness-reviewer`, `ce-issue-intelligence-analyst`, `ce-project-standards-reviewer`, `ce-schema-drift-detector`, `ce-session-historian`, `ce-slack-researcher`, `ce-web-researcher`, `ce-coherence-reviewer`, `ce-design-lens-reviewer`, `ce-feasibility-reviewer`, `ce-product-lens-reviewer`, `ce-scope-guardian-reviewer`, `ce-security-lens-reviewer`, `ce-deployment-verification-agent`, `ce-data-migration-expert`.
- **MODIFIED**: virtually all reviewer agents got confidence calibration, read-only tool restriction, `model: inherit`, recursion guards. `ce-plan`/`ce-brainstorm` made universal. `ce-work` got Codex delegation, test discovery, swarm mode (`/slfg`). `ce-code-review` got headless mode, base-branch fetch hardening, compact returns.
- **DELETED/RENAMED**: `workflows:*` → `ce:*` then folded into skills; `/playwright-test` → `/ce-test-browser`; `/xcode-test` → `/ce-test-xcode`; `compound-docs` skill consolidated into `ce-compound`; `every-style-editor` agent removed (#234); `lint`, `rclone`, `agent-browser`, `bug-reproduction-validator` skills removed; `claude-permissions-optimizer` dropped (#583); bundled `context7` MCP removed (#486); legacy `ralph-wiggum` references replaced with `ralph-loop`. Old Bun-only converter targets for Cursor/Codex/Copilot/Droid/Qwen deprecated in favor of native marketplace installs.

### Recent releases (verbatim from GitHub Releases)

- **`compound-engineering-v3.2.0`** (latest, 26 Apr 2026, sha `1796120`)
- **`compound-engineering-v3.0.3`** (24 Apr 2026, sha `bc3709f`): includes #660 `ce-update` compare against main plugin.json; #645 derive cache dir from CLAUDE_PLUGIN_ROOT parent; #656 replace cache sweep with `claude plugin update`; #642 lfg platform-neutral skill references; #678 main: recover version drift; #620 question-tool stop silent skips; #643 cap skill descriptions at harness limit; #666 plan is a decision artifact, progress comes from git.
- **`cli-v3.1.0`** (24 Apr 2026): #671 ce-ideate subject gate / surprise-me / warrant contract; #653 ce-setup ast-grep CLI check; #616 codex native plugin install manifests + agents-only converter; #651 pi first-class support; #674 release: remove stale release-as pin.
- **`compound-engineering: v3.0.2`** (24 Apr 2026): #663 ce-commit-push-pr skip evidence prompt when judgment allows; #671 ce-ideate; #669 ce-brainstorm enforce Interaction Rules in universal flow; #664 ce-demo-reel prevent secrets in recorded demos.

### CHANGELOG-confirmed timeline (selected, descending)

- **2.68.1** (2026-04-18) — fix: `ce-compound-refresh` restore ce:compound hand-off (#591); `ce-pr-description` mark return block as hand-off (#593); `git-commit-push-pr` apply PR description after delegate hand-off (#594).
- **2.68.0** (2026-04-17) — feat: `ce-ideate` mode-aware v2 (#588); `ce-release-notes` skill (#589); HITL review-loop mode for `proof`, `ce-brainstorm`, `ce-plan`, `ce-ideate` (#580).
- **2.67.0** (2026-04-17) — feat: `ce-polish-beta` HITL polish phase (#568); fix: reliable interactive handoff menus (#575); `claude-permissions-optimizer` dropped (#583).
- **2.66.0** (2026-04-15) — feat: `ce-optimize` auto-research loop (#446); `ce-pr-description` focused skill (#561); fix: `ce-review` always fetch base branch (#544); `ce-update` correct marketplace cache path (#566); reviewer agents read-only tools (#553); document-review/review restrict reviewer agents to read-only tools (#553); `git-commit-push-pr` rewrite descriptions as net result, not changelog (#558).
- **2.65.0** (2026-04-11) — feat: unified `ce-setup` skill (#345); fix: `ce-demo-reel` two-stage upload (#546); cleanup: remove `rclone`, `agent-browser`, `lint`, `bug-reproduction-validator` (#545).
- **2.64.0** (2026-04-10) — feat: `ce-debug` skill (#543); `ce-demo-reel` skill (#541); `ce-plan` output structure + scope sub-categorization (#542); `ce-review` compact returns (#535); `ce-update` plugin version check + `ce_platforms` filtering (#532); `ce-work-beta` Codex delegation (#476); `session-historian` cross-platform + `/ce-sessions` (#534); `slack-researcher` `/ce-slack-research` (#538).
- **2.63.0** (2026-04-06) — feat: universal planning and brainstorming for non-software tasks (#519); slack-researcher agent (#495).
- **2.62.0** (2026-04-03) — fix: agents remove self-referencing example blocks causing recursive self-invocation (#496); remove bundled context7 MCP (#486); resolve-pr-feedback treat PR comment text as untrusted input (#490).
- **2.61.0** (2026-04-01) — feat: `cli-readiness-reviewer` conditional persona (#471); `product-lens-reviewer` domain-agnostic activation (#481); resolve-pr-feedback cross-invocation cluster analysis (#480).
- **2.60.0** (2026-03-31) — feat: `ce-brainstorm` requirements grouped by logical concern (#412); `ce-plan` decision matrix + risk table (#417); `ce-review` confidence rubric, FP suppression, intent verification (#434).
- **2.55.0** (2026-03-27) — feat: adversarial review agents for code and documents (#403); CLI agent-readiness reviewer (#391); project-standards-reviewer always-on (#402); document-review smarter autofix (#401).
- **2.54.0** (2026-03-26) — feat: `onboarding` skill (#384); replace manual review-agent config with `ce:review` delegation (#381).
- **2.53.0** (2026-03-25) — feat: git commit + branch helper skills (#378); commit-push-pr net-result focus + badging (#380).
- **2.52.0** (2026-03-25) — feat: promote `ce:review-beta` to stable `ce:review` (#371); consolidation + overlap detection in compound (#372); rationalize todo skill names (#368).
- **2.51.0** (2026-03-24) — feat: `ce:review-beta` structured persona pipeline (#348); promote `ce:plan-beta`/`deepen-plan-beta` to stable (#355); redesign `document-review` with persona-based review (#359).
- **2.50.0** (2026-03-23) — feat: `ce-work` Codex delegation (#328); rewrite `frontend-design` skill (#343).
- **2.39.0** (2026-03-10) — `ce:compound` context budget precheck; `ce:plan` daily sequence numbers; `ce:review --serial` mode; agent-browser inspection commands; test-browser port detection; `/lfg` phase gating; Context7 API-key auth fix.
- **2.38.0** (2026-03-01) — Big rename: `workflows:*` → `ce:*` (deprecated `workflows:*` aliases preserved).
- **2.34.0** (2026-02-14) — Gemini CLI converter target (#190).
- **2.33.0** (2026-02-12) — `setup` skill (configurable review agents), `learnings-researcher` always-run in `/workflows:review`, `schema-drift-detector` wired in.
- **2.32.0** (2026-02-11) — Factory Droid target.
- **2.31.0** (2026-02-08) — `document-review` skill, `/sync` command, ~79% context-token cuts, hook-matcher crash fix, `model: inherit` rollout.
- **2.30.0** (2026-02-05) — `orchestrating-swarms` skill, `/slfg` swarm-enabled `/lfg`.
- **2.28.0** (2026-01-21) — `/workflows:brainstorm` command.
- **2.26.0** (2026-01-14) — `/lfg` autonomous workflow added.
- **2.25.0** (2026-01-14) — `agent-browser` skill replaces Playwright MCP.
- **2.20.0** (2026-01-05) — `/feature-video` command.
- **2.19.0** (2025-12-31) — `/deepen-plan` command.

### Open issues / PR direction signals

- 38 open issues, 23–27 open PRs as of late Apr 2026 (per repo header). The active themes are: native-Codex agent support (gap until Codex ships custom-agent support), Pi parity, additional review personas, harness-limit-aware skill descriptions, and platform-neutral skill phrasing.

### External announcements about the plugin

- **Every guide:** [every.to/guides/compound-engineering](https://every.to/guides/compound-engineering) — canonical guide; describes the plugin as "26 specialized agents, 23 workflow commands, 13 skills" (older snapshot — confirms this guide pre-dates the v2.5x/v3 expansion).
- **Every Chain of Thought (Dan Shipper):** [every.to/chain-of-thought/compound-engineering-how-every-codes-with-agents](https://every.to/chain-of-thought/compound-engineering-how-every-codes-with-agents) — sets the philosophical frame; mentions the plugin and the `compound engineering plugin for Claude Code`.
- **GitHub repo description:** "Official Compound Engineering plugin for Claude Code, Codex, Cursor, and more."
- **Twitter / X:** Both Dan Shipper (@danshipper) and Kieran Klaassen (@kieranklaassen) post regular updates; specific dated tweets were not retrieved this session — see Open Questions.
- **Podcast:** Compound engineering has been discussed on Dan Shipper's "AI & I" and "How Do You Use ChatGPT?" podcasts; the plugin itself is mentioned in the every.to guide as the canonical artifact. Specific episode dates were not confirmed this session.

---

## 6. External Context (kept short)

- **Every / "compound engineering" tag:** [every.to/tag/compound-engineering](https://every.to/tag/compound-engineering) is the article hub. The two most load-bearing pieces are the "Compound Engineering" guide and Dan Shipper's "Compound Engineering: How Every Codes With Agents" essay; both define the four-step Plan/Work/Review/Compound loop the plugin operationalizes.
- **Anthropic Claude Code plugin docs:** [docs.claude.com/en/docs/claude-code/plugins](https://docs.claude.com/en/docs/claude-code/plugins) — the plugin uses the standard Claude Code plugin platform: marketplace.json + plugin.json + commands/agents/skills/hooks directories. Skills follow the SKILL.md spec (cross-shared with Codex and Cursor's open standard).
- **Forks of note** (as comparison points for your own fork): `kieranklaassen/compound-engineering-plugin` (DeepWiki-indexed snapshot of an older state — useful for "what did this look like 6 months ago" reference), `iliaal/compound-engineering-plugin` (PHP/Python/TS-flavored fork), `the-rabak/compound-engineering-plugin` (Laravel/NestJS/etc. fork). DeepWiki at [deepwiki.com/kieranklaassen/compound-engineering-plugin](https://deepwiki.com/kieranklaassen/compound-engineering-plugin) is useful for understanding the older "27 agents, 21 commands, 14 skills, 1 MCP server" structure the user likely forked from.

---

## 7. Comparison Checklist

Use this list against your fork. Each row corresponds to a component currently in Every's main branch. Present in mine? same name? same prompt body? same frontmatter (description, tools, model, allowed-tools, argument-hint)? Run `git diff` on each path.

**Skills (`plugins/compound-engineering/skills/<name>/SKILL.md`):**
- [ ] `ce-agent-native-architecture` — exists / SKILL.md desc / references/ files
- [ ] `ce-agent-native-audit` — exists
- [ ] `ce-brainstorm` — universal Q&A flow, HITL review mode
- [ ] `ce-clean-gone-branches` — exists
- [ ] `ce-code-review` — tiered persona pipeline, headless mode, `--serial` flag, base-branch fetch
- [ ] `ce-commit` — value-communicating message
- [ ] `ce-commit-push-pr` — net-result PR description, delegates to `ce-pr-description`, fix-up filtering
- [ ] `ce-compound` — track-based bug/knowledge schema, stack-aware reviewer routing
- [ ] `ce-compound-refresh` — overlap detection, consolidation, ce:compound hand-off
- [ ] `ce-debug` — Iron Law / test-first debugging
- [ ] `ce-demo-reel` — Python capture pipeline, two-stage upload, secrets prevention
- [ ] `ce-dhh-rails-style` — references controllers/models/frontend/architecture/gems
- [ ] `ce-doc-review` — persona-based, headless, recursion guard
- [ ] `ce-frontend-design` — layered architecture + visual verification
- [ ] `ce-gemini-imagegen`
- [ ] `ce-ideate` — mode-aware v2, subject gate, surprise-me, warrant contract
- [ ] `ce-optimize` — auto-research loop, LLM-as-judge, has its own README + schema.yaml
- [ ] `ce-plan` — universal, MINIMAL/MORE/A LOT, decision matrix, status frontmatter, daily sequence numbers, document-review routing
- [ ] `ce-polish-beta` — HITL polish, `.claude/launch.json`, stacked-PR seeds
- [ ] `ce-pr-description` — focused skill, hand-off via temp file
- [ ] `ce-proof` — Proof collaborative editor integration
- [ ] `ce-release-notes` — release-history Q&A
- [ ] `ce-report-bug`
- [ ] `ce-resolve-pr-feedback` — cross-invocation cluster analysis, actionability filter
- [ ] `ce-sessions` — cross-platform session history
- [ ] `ce-setup` — unified, ast-grep check, `compound-engineering.local.md`
- [ ] `ce-slack-research` — opt-in, workspace identity surfaced
- [ ] `ce-test-browser`
- [ ] `ce-test-xcode`
- [ ] `ce-update` — `claude plugin update` invocation, main `plugin.json` comparison
- [ ] `ce-work` — Codex delegation, system-wide test check, status-frontmatter updates
- [ ] `ce-worktree` — auto-trust mise/direnv
- [ ] `lfg` — autonomous chain
- [ ] (Confirm whether any of the following older skills still exist in your fork that have been **removed** upstream: `agent-browser`, `rclone`, `lint`, `bug-reproduction-validator`, `claude-permissions-optimizer`, `compound-docs`, `every-style-editor` agent, `dhh-ruby-style` skill, `feature-video`, `playwright-test`, `xcode-test`, `triage`, `release-docs`, `sync` command, `orchestrating-swarms`, `ralph-wiggum`)

**Agents (`plugins/compound-engineering/agents/<name>.agent.md`):**
- [ ] `ce-adversarial-document-reviewer`
- [ ] `ce-adversarial-reviewer`
- [ ] `ce-agent-native-reviewer` — triage + prioritization + stack-aware search
- [ ] `ce-ankane-readme-writer`
- [ ] `ce-api-contract-reviewer`
- [ ] `ce-architecture-strategist`
- [ ] `ce-best-practices-researcher` — skills-first
- [ ] `ce-cli-agent-readiness-reviewer`
- [ ] `ce-cli-readiness-reviewer`
- [ ] `ce-code-simplicity-reviewer`
- [ ] `ce-coherence-reviewer`
- [ ] `ce-correctness-reviewer`
- [ ] `ce-data-integrity-guardian`
- [ ] `ce-data-migration-expert`
- [ ] `ce-data-migrations-reviewer`
- [ ] `ce-deployment-verification-agent`
- [ ] `ce-design-implementation-reviewer`
- [ ] `ce-design-iterator` — Step 0 skill autoload
- [ ] `ce-design-lens-reviewer`
- [ ] `ce-dhh-rails-reviewer`
- [ ] `ce-feasibility-reviewer`
- [ ] `ce-figma-design-sync`
- [ ] `ce-framework-docs-researcher`
- [ ] `ce-git-history-analyzer`
- [ ] `ce-issue-intelligence-analyst`
- [ ] `ce-julik-frontend-races-reviewer`
- [ ] `ce-kieran-python-reviewer`
- [ ] `ce-kieran-rails-reviewer`
- [ ] `ce-kieran-typescript-reviewer`
- [ ] `ce-learnings-researcher` — always-run in code-review
- [ ] `ce-maintainability-reviewer`
- [ ] `ce-pattern-recognition-specialist`
- [ ] `ce-performance-oracle`
- [ ] `ce-performance-reviewer`
- [ ] `ce-pr-comment-resolver`
- [ ] `ce-product-lens-reviewer` — domain-agnostic activation
- [ ] `ce-project-standards-reviewer` — always-on
- [ ] `ce-reliability-reviewer`
- [ ] `ce-repo-research-analyst` — structured technology scan
- [ ] `ce-schema-drift-detector` — conditional on migration PRs
- [ ] `ce-scope-guardian-reviewer`
- [ ] `ce-security-lens-reviewer`
- [ ] `ce-security-reviewer`
- [ ] `ce-security-sentinel`
- [ ] `ce-session-historian`
- [ ] `ce-slack-researcher`
- [ ] `ce-spec-flow-analyzer`
- [ ] `ce-swift-ios-reviewer`
- [ ] `ce-testing-reviewer`
- [ ] `ce-web-researcher`
- [ ] All agents: `model: inherit`? Reviewer agents restricted to read-only tools? No self-referencing example blocks (#496)?

**Hooks:**
- [ ] Skill-injection hook entry for subagent dispatch — exists? has a `matcher`? same script body?
- [ ] Any other PreToolUse/PostToolUse/UserPromptSubmit/Stop/SessionStart hooks — confirm against upstream `plugins/compound-engineering/hooks/`

**Settings:**
- [ ] `plugins/compound-engineering/.claude-plugin/plugin.json` — `name`, `version`, `description` (count format), `author`, MCP servers (should be empty / no bundled context7)
- [ ] `.claude-plugin/marketplace.json` — entry for `compound-engineering` matches plugin.json description verbatim
- [ ] `.cursor-plugin/marketplace.json` and `.cursor-plugin/plugin.json` — present
- [ ] `compound-engineering.local.md` — generated by `/ce-setup` in projects (this is per-user, won't be in repo)

**Repo top-level files:**
- [ ] `README.md` — current install matrix (Claude Code, Cursor, Codex+Bun-agents, Copilot, Droid, Qwen, OpenCode/Pi/Gemini/Kiro converters)
- [ ] `CHANGELOG.md` — pointer to GitHub Releases
- [ ] `AGENTS.md` — canonical instruction file (replaces CLAUDE.md as primary)
- [ ] `CLAUDE.md` — compatibility shim
- [ ] `package.json` — `@every-env/compound-plugin@3.x`, deps `citty`, `js-yaml`, semantic-release scripts (`release:preview`, `release:sync-metadata`, `release:validate`)
- [ ] `src/` — converter writers for each target; `src/ov_setup/` reference assets
- [ ] `tests/` — Bun test suite, `tests/fixtures/sample-plugin`
- [ ] `LICENSE` — MIT
- [ ] `plugins/coding-tutor/` — second plugin

---

## 8. Open Questions

The following items could not be confirmed directly from the repo this session due to GitHub access errors (raw.githubusercontent.com fetches denied; GitHub HTML hit 429 and robots restrictions on tree pages). They should be checked manually in your fork:

1. **Exact contents of `plugins/compound-engineering/.claude-plugin/plugin.json`** — name, exact version string, description (whether still using "X agents, Y commands, Z skills" format), author, any `mcpServers`, `additionalDirectories`, or `statusLine` fields. Run `cat plugins/compound-engineering/.claude-plugin/plugin.json | jq .` (per AGENTS.md).
2. **Exact contents of `plugins/compound-engineering/hooks/`** — number of hooks, event types (`PreToolUse`/`PostToolUse`/`UserPromptSubmit`/`SessionStart`/`Stop`), matcher patterns, the script body (likely the skill-injection script). The CHANGELOG only confirms hooks exist and need a `matcher` field.
3. **Per-skill SKILL.md frontmatter** — each skill's exact `name`, `description`, `argument-hint`, `allowed-tools`, `model`, and `disable-model-invocation` flags. CHANGELOG 2.31.0 confirms 6 skills are marked `disable-model-invocation: true` (`orchestrating-swarms` (since removed), `git-worktree` (now `ce-worktree`), `skill-creator`/`create-agent-skills`, `compound-docs` (now folded into `ce-compound`), `file-todos`, `resolve-pr-parallel`/`ce-resolve-pr-feedback`) — confirm current set.
4. **Per-agent `.agent.md` frontmatter** — exact `description`, `tools`, `model`. README only gives one-line descriptions.
5. **Slash commands directory `plugins/compound-engineering/commands/`** — whether it still exists and which thin command shims survive (e.g., `/ce-update` may be a command file, not a skill, since CHANGELOG 2.64.0 framed it as a "skill").
6. **`marketplace.json` exact content** — the marketplace catalog at the repo root.
7. **Full commit log for the last 6 months** — only release-tag-bound commits and release notes were retrievable. The full per-commit log on `main` was not accessible due to access errors. Use `git log --since='6 months ago' --pretty='%h %ad %s'` against your local clone of upstream for the canonical list.
8. **Specific tweets / podcast episodes from @danshipper or @kieranklaassen about the plugin** — surfaces in many search results but specific dates and substance were not pinned this session.
9. **Whether `coding-tutor` plugin shares any skills/agents with `compound-engineering`** — both live under `plugins/`; the relationship is not documented in the materials read here.
10. **Status of the `lfg`/`/slfg` swarm command** — `orchestrating-swarms` skill was added v2.30.0 but its current presence/state in v3.x main is uncertain (no recent CHANGELOG mention). Confirm whether it survived the v2.65.0 cleanup of agent-browser/rclone/lint.
11. **Codex native install agent gap** — Codex's native plugin install handles only skills, not custom agents, as of late April 2026; the Bun follow-up step adds agents. This will change "once Codex's native plugin spec supports custom agents" — check if that has happened.
12. **Whether the historical `/feature-video`, `/triage`, `/sync`, `/release-docs`, `/onboarding`, `/agent-native-audit` (renamed to `ce-agent-native-audit` skill?), `/deepen-plan` commands still exist** — most appear to have been folded into skills or removed; confirm against your fork.

When fetching live, prefer these URLs:
- `https://raw.githubusercontent.com/EveryInc/compound-engineering-plugin/main/plugins/compound-engineering/.claude-plugin/plugin.json`
- `https://raw.githubusercontent.com/EveryInc/compound-engineering-plugin/main/plugins/compound-engineering/CHANGELOG.md`
- `https://raw.githubusercontent.com/EveryInc/compound-engineering-plugin/main/CHANGELOG.md`
- `https://github.com/EveryInc/compound-engineering-plugin/commits/main` (full commit log)
- `https://github.com/EveryInc/compound-engineering-plugin/releases` (canonical release notes)
- `https://github.com/EveryInc/compound-engineering-plugin/tree/main/plugins/compound-engineering/skills/<name>` per skill
- `https://github.com/EveryInc/compound-engineering-plugin/tree/main/plugins/compound-engineering/agents` for the agent file list
- `https://github.com/EveryInc/compound-engineering-plugin/tree/main/plugins/compound-engineering/hooks` for hooks

The README at `https://github.com/EveryInc/compound-engineering-plugin/blob/main/plugins/compound-engineering/README.md` is the single best up-to-date inventory; the `plugins/compound-engineering/CHANGELOG.md` is the single best historical record (1010 lines, 73.5 KB) and was read in full for this report.