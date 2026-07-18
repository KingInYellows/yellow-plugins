# yellow-core

Dev toolkit with review agents, research agents, and workflow commands for
TypeScript, Python, Rust, and Go.

## Install

```
/plugin marketplace add KingInYellows/yellow-plugins
/plugin install yellow-core@yellow-plugins
```

## Prerequisites

- Git
- Graphite CLI (`gt`) recommended for branch management

## Commands

| Command                 | Description                                                        |
| ----------------------- | ------------------------------------------------------------------ |
| `/workflows:brainstorm` | Explore requirements through dialogue and research before planning |
| `/workflows:spec`       | Draft a requirements spec (stable `R1..Rn` IDs + design) to `plans/specs/<slug>.md` via guided dialogue; entry point for multi-subsystem projects |
| `/workflows:decompose`  | Break a spec into dependency-ordered shell files in `plans/shells/` with a blocking R-id coverage gate; single-shell specs bail out to `/workflows:plan` |
| `/workflows:pick-next-shell` | Pick the lowest-numbered shell whose `depends_on` are archived in `plans/complete/`, expand it, and halt for a fresh `/workflows:work` session; reports cycles and the terminal state |
| `/workflows:expand-shell` | Expand one shell into a concrete `- [ ]` checkbox plan in `plans/`, verifying `Consumes` against the live codebase and deleting the shell only after approval |
| `/workflows:plan`       | Transform feature descriptions into structured plans               |
| `/workflows:work`       | Execute work plans systematically                                  |
| `/workflows:review`     | Session-level review of plan adherence, cross-PR coherence, and scope drift |
| `/workflows:compound`   | Document a recently solved problem to compound knowledge. Pass `--in-pr` while on a feature branch with an open PR to draft the doc + MEMORY.md line from the PR body and commits (the default pattern in CONTRIBUTING.md "Solution Docs") |
| `/compound:review-staged` | Manually drain the background-compounding staging ledger (M3-gated) |
| `/plan:status`          | Read-only dashboard of `plans/` (open) and `plans/complete/` (archived) with per-file checkbox progress |
| `/plan:complete`        | Archive a completed plan with two safety gates: Gate A scans for unchecked task boxes; Gate C verifies merged-PR evidence via a strict slug match with a loose token-coverage fallback |
| `/statusline:setup`     | Generate and install an adaptive statusline for plugins            |
| `/setup:all`            | Run setup for all installed marketplace plugins with unified dashboard |
| `/setup:claude-web`     | Audit a repository and scaffold files Claude Code Web needs (`.claude/settings.json`, `scripts/install_pkgs.sh`, `.gitattributes`, `.gitignore`, `.github/workflows/claude.yml`) |
| `/worktree:cleanup`     | Scan git worktrees, classify by state, and remove stale worktrees with safeguards |

## Agents

### Review (10)

| Agent                              | Description                                                                                |
| ---------------------------------- | ------------------------------------------------------------------------------------------ |
| `code-simplicity-reviewer`         | YAGNI enforcement, simplification                                                          |
| `security-sentinel`                | Security audit, OWASP, secrets scanning                                                    |
| `security-reviewer`                | Review-time exploitable security vulnerabilities (companion to `security-sentinel`)        |
| `security-lens`                    | Plan-level security architect for planning documents and architecture proposals            |
| `performance-oracle`               | Bottlenecks, algorithmic complexity, scalability                                           |
| `performance-reviewer`             | Review-time runtime performance with anchored confidence rubric (companion to `performance-oracle`) |
| `architecture-strategist`          | Architectural compliance, design patterns                                                  |
| `polyglot-reviewer`                | Language-idiomatic review for TS/Py/Rust/Go                                                |
| `test-coverage-analyst`            | Test quality, coverage gaps, edge cases                                                    |
| `pattern-recognition-specialist`   | Anti-patterns, duplication, naming drift                                                   |

### Research (4)

| Agent                       | Description                                                                                  |
| --------------------------- | -------------------------------------------------------------------------------------------- |
| `repo-research-analyst`     | Repository structure, conventions                                                            |
| `best-practices-researcher` | External docs, community standards                                                           |
| `git-history-analyzer`      | Git archaeology, change history                                                              |
| `learnings-researcher`      | Searches `docs/solutions/` for past learnings relevant to a PR diff or planning context      |

### Workflow (7)

| Agent                    | Description                                                    |
| ------------------------ | -------------------------------------------------------------- |
| `spec-flow-analyzer`     | User flow analysis, gap identification                         |
| `brainstorm-orchestrator` | Iterative brainstorm dialogue with research integration       |
| `knowledge-compounder`   | Extract and document solved problems to compound knowledge     |
| `session-historian`      | Cross-vendor session search across Claude Code (local JSONL), Devin (REST API via MCP), and Codex (local directory-per-session); BM25 + optional ruvector cosine + recency fused via Reciprocal Rank Fusion; secret redaction (AWS keys, GitHub tokens, API keys, JWTs, PEM blocks) before excerpts are returned |
| `staging-reviewer`       | Drain orchestrator for the background-compounding pipeline; spawned by the SessionStart hook's `claude -p` drain subshell |
| `staging-scorer`         | Haiku-backed rubric scorer for one transcript excerpt; structured JSON output with hardened prompt covering injection-attempt detection |
| `staging-promoter`       | Non-interactive writer that creates `docs/solutions/<category>/<slug>.md` and appends to MEMORY.md `## Session Notes` only (frontmatter `disallowedTools: [AskUserQuestion]` is load-bearing, enforced by RULE 14 in `scripts/validate-agent-authoring.js`) |

## Skills

| Skill                 | Description                                                                                                                                                       |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent-native-architecture` | Reference for five agent-native architecture principles: action parity, context parity, shared workspace, primitives over workflows, dynamic context injection (applied by `yellow-review:review:agent-native-reviewer`)                                            |
| `agent-native-audit`        | Step-by-step audit checklist for evaluating an existing codebase against agent-native principles — capability mapping, noun test, anti-pattern catalog                                                                                                              |
| `brainstorming`       | Reference guide for iterative brainstorm dialogues — question techniques, YAGNI, approach exploration, and research escalation                                    |
| `compound-lifecycle`  | Audit, refresh, and consolidate `docs/solutions/` with composite-scored staleness detection, BM25+cosine overlap clustering, and archive superseded entries       |
| `create-agent-skills` | Guidance for creating skills and agents                                                                                                                           |
| `debugging`           | Systematic root-cause debugging with causal-chain gate, prediction-for-uncertain-links hypotheses, three-failed-attempts smart escalation, and conditional defense-in-depth |
| `git-worktree`        | Git worktree management for parallel development                                                                                                                  |
| `ideation`            | Generate 3 grounded approaches with the Toulmin warrant contract (evidence + linking principle + idea), filtered through MIDAS three-phase generation, then route the chosen approach into `brainstorm-orchestrator` via Task |
| `local-config`        | Defines the `yellow-plugins.local.md` per-project config file schema — per-project overrides for review pipeline behavior, reviewer set narrowing, depth controls, and focus-area filtering |
| `mcp-health-probe`    | Canonical MCP server health classification (OFFLINE / DEGRADED / HEALTHY plus PRESENT (untested) refinement) for `/<plugin>:status` commands                      |
| `mcp-integration-patterns` | Shared patterns for ruvector recall/remember and morph discovery integration — its protocol constants are a RULE 16-linted replica of yellow-ruvector's canonical `memory-query` skill |
| `memory-recall-pattern` | Recall-Before-Act pattern for ruvector — query past learnings via `hooks_recall` at workflow start                                                              |
| `memory-remember-pattern` | Tiered-Remember-After-Act pattern for ruvector — record learnings via `hooks_remember` at workflow completion with Auto/Prompted/Skip signal-strength tiers   |
| `morph-discovery-pattern` | Morph discovery + fallback pattern — discover `edit_file` and `warpgrep` at runtime via ToolSearch, fall back to Edit/Grep when yellow-morph is missing       |
| `multi-host-fleet`    | Multi-host plugin credential and config reference — canonical shell env var names for every credential-bearing plugin (new workstation, CI/devcontainer, fleet replication, secrets manager) |
| `optimize`            | Metric-driven optimization with parallel candidate variants and an LLM-as-judge analytic rubric (per-criterion 1-5 scoring + two-run order-swap + style-bias self-check); optional `knowledge-compounder` hand-off writes the winner to `docs/solutions/optimizations/` |
| `security-fencing`    | Canonical prompt-injection hardening block for agents that analyze untrusted content (source code, CI logs, workflow files) — single source of truth for the inlined `CRITICAL SECURITY RULES` block |
| `session-handoff`     | Write a tracked session-handoff artifact at `plans/handoff/<date>-<slug>.md` — six fields (current task, workflow status, active artifact, open decisions, in-flight changes, next action), secret-redacted via `cs_redact_secrets` |
| `session-history`     | Cross-vendor session-history user surface — dispatches the `session-historian` agent against Claude Code + Devin + Codex backends with availability detection and graceful degradation per backend |

## MCP Servers

yellow-core does not bundle any MCP servers. Agents that benefit from
external library documentation (`best-practices-researcher`) detect
user-level Context7 (`mcp__context7__*`) at runtime via ToolSearch and fall
back to `WebSearch` when it is absent. Install Context7 at user level if
you want richer library docs:

```sh
# At user level (recommended) — single OAuth, no plugin-namespace conflict:
/plugin install context7@upstash
```

## License

MIT
