# Command and Skill Reference

Every slash command and user-invocable skill in the marketplace, grouped by
plugin in `catalog/catalog.json` `pluginOrder`. Descriptions are the first
sentence of each file's frontmatter `description:`, so the plugin file is the
source of truth. When you add, rename or remove a command, update this page in
the same PR.

Commands come from `plugins/<name>/commands/**/*.md`. Their slash name is the
frontmatter `name:`, which matches the path (`commands/review/pr.md` is
`/review:pr`). Skills listed here have `user-invocable: true`; internal skills
that only other commands or agents load are omitted. For hooks, MCP servers and
configuration, see each plugin's `README.md` and `CLAUDE.md`.

For how these pieces call each other, see
[Workflow diagrams](workflow-diagrams.md).

## gt-workflow

Graphite-native workflow commands for stacked PR development. Provides smart
commit-and-submit with parallel audit agents, stack planning, sync, and
navigation — all through the gt CLI.

Details: [plugins/gt-workflow/README.md](../plugins/gt-workflow/README.md)

| Skill (invoke as `gt-workflow:<skill>`) | What it does                                                                                         |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `gt-amend`                              | Fold working-tree changes into the current branch commit, audit them, and re-submit via Graphite.    |
| `gt-cleanup`                            | Scan local branches for staleness and divergence, then delete or reconcile them with safeguards.     |
| `gt-merge`                              | Merge the current stack's pull requests, from trunk up to the current branch, via Graphite.          |
| `gt-nav`                                | Visualize your Graphite stack and navigate between its branches.                                     |
| `gt-setup`                              | Validate Graphite CLI prerequisites and configure settings for AI agent workflows.                   |
| `gt-stack-plan`                         | Decompose a feature into stacked PRs, ordered by dependency (plan-only).                             |
| `gt-sync`                               | Pull latest trunk, restack all tracked branches, and untrack branches whose PRs merged.              |
| `smart-submit`                          | Stage, audit, commit, and submit uncommitted changes via Graphite, with parallel code-review agents. |

## github-workflow

GitHub-native stacked-PR provider. Creates, submits, amends, syncs, navigates,
cleans up, and merges stacks through a validated CLI adapter over the official
github/gh-stack extension.

Details:
[plugins/github-workflow/README.md](../plugins/github-workflow/README.md)

| Command                      | What it does                                                                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `/github-stack:amend`        | Fold working-tree changes into the current branch commit and re-submit via gh stack.                                           |
| `/github-stack:cleanup`      | Remove local stack tracking, and by default also remote-unstack every PR via the GitHub API (--local skips the remote call).   |
| `/github-stack:merge`        | Merge a stacked PR via gh stack merge.                                                                                         |
| `/github-stack:merge-single` | Merge one ordinary, unstacked pull request.                                                                                    |
| `/github-stack:nav`          | Check out a stack target — stack number, PR number, PR URL, or branch.                                                         |
| `/github-stack:plan`         | Report the current GitHub-native stack structure (read-only).                                                                  |
| `/github-stack:setup`        | Check GitHub-native stacked-PR prerequisites — gh CLI, authentication, and the official github/gh-stack extension.             |
| `/github-stack:status`       | Report GitHub-native stacked-PR provider readiness — tooling state plus a pointer to the authoritative active-provider answer. |
| `/github-stack:submit`       | Stage, commit, and submit uncommitted changes as a GitHub-native stacked PR.                                                   |
| `/github-stack:sync`         | Sync the local stack with trunk via gh stack sync, optionally pruning merged branches.                                         |

## yellow-core

Dev toolkit with review agents, research agents, and workflow commands for
TypeScript, Python, Rust, and Go

Details: [plugins/yellow-core/README.md](../plugins/yellow-core/README.md)

| Command                   | What it does                                                                                                                                                                                                                                                               |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/compound:review-staged` | Manually drain the compound-staging ledger ahead of the SessionStart auto-drain threshold.                                                                                                                                                                                 |
| `/flow:brainstorm`        | Explore a feature or problem through iterative Q&A and optional research before planning.                                                                                                                                                                                  |
| `/flow:compound`          | Document a recently solved problem to compound team knowledge into memory or solution docs                                                                                                                                                                                 |
| `/flow:decompose`         | Decompose a spec from plans/specs/ into dependency-ordered shell files in plans/shells/, enforcing R-id coverage and depends_on traceability.                                                                                                                              |
| `/flow:expand-shell`      | Expand one shell from plans/shells/ into a concrete checkbox plan in plans/, verifying Consumes against the live codebase, then deleting the shell only after approval.                                                                                                    |
| `/flow:pick-next-shell`   | Pick the lowest-numbered shell whose dependencies are archived in plans/complete/, expand it via /flow:expand-shell, capture learnings, and halt for a fresh /flow:work session.                                                                                           |
| `/flow:plan`              | Transform feature descriptions into structured implementation plans                                                                                                                                                                                                        |
| `/flow:review`            | Session-level review of plan adherence, cross-PR coherence, and scope drift with autonomous P1 fix loop                                                                                                                                                                    |
| `/flow:spec`              | Draft a requirements spec (stable R1..Rn IDs + design) through guided dialogue, written to `plans/specs/<slug>.md` as the input to /flow:decompose.                                                                                                                        |
| `/flow:work`              | Execute implementation plans systematically with testing and quality checks                                                                                                                                                                                                |
| `/plan:complete`          | Archive a completed plan with two safety gates: Gate A scans for unchecked task boxes; Gate C verifies merged-PR evidence via file-commit provenance (with a commit-subject fallback for merge-queue PRs), then a strict slug match, then a loose token-coverage fallback. |
| `/plan:status`            | Show a per-file checkbox progress dashboard of plans/ (open) and plans/complete/ (archived).                                                                                                                                                                               |
| `/setup:all`              | Run setup for all installed marketplace plugins.                                                                                                                                                                                                                           |
| `/setup:claude-web`       | Prepare a repository for Claude Code Web: audit and scaffold .claude/settings.json, scripts/install_pkgs.sh bootstrap, .gitattributes, .gitignore, and .github/workflows/claude.yml.                                                                                       |
| `/stack:select`           | Select the active stacked-PR provider (graphite or github) at user, project, or local scope — shows the exact commands first, enables one provider, disables the other, and refuses managed-scope conflicts.                                                               |
| `/stack:status`           | Report which stacked-PR provider is active and classify the state as UNSELECTED, READY_GRAPHITE, READY_GITHUB, CONFLICT, CONFIG_MISMATCH, CONFIG_INVALID, MANAGED_CONFLICT, or PARTIAL_TOOLING.                                                                            |
| `/statusline:setup`       | Generate and install an adaptive Python statusline for yellow-plugins.                                                                                                                                                                                                     |
| `/worktree:cleanup`       | Scan git worktrees, evaluate staleness, and remove stale worktrees with safeguards                                                                                                                                                                                         |
| `/worktree:restack`       | Restack a stack whose branches live in separate worktrees (use when a restack fails with "already used by worktree"), then restore every worktree; pauses on conflicts and resumes with --continue or --abort                                                              |

| Skill (invoke as `yellow-core:<skill>`) | What it does                                                                                                                                          |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `compound-lifecycle`                    | Audit, refresh, and consolidate `docs/solutions/` to keep the institutional knowledge catalog from rotting.                                           |
| `create-agent-skills`                   | Expert guidance for creating Claude Code skills and agents.                                                                                           |
| `debugging`                             | Find root causes systematically before fixing — trace the causal chain and form hypotheses with predictions for uncertain links.                      |
| `git-worktree`                          | Git worktree management for isolated parallel development, and restacking a stack whose branches live in separate worktrees.                          |
| `ideation`                              | Generate 3 grounded approaches to a soft problem, then hand the chosen one off to `brainstorm-orchestrator`.                                          |
| `multi-host-fleet`                      | Multi-host plugin credential and config reference for yellow-plugins.                                                                                 |
| `optimize`                              | Run a metric-driven optimization pass: parallel candidate variants scored against an LLM-as-judge analytic rubric.                                    |
| `session-handoff`                       | Write a validated session-handoff note at `plans/handoff/<YYYY-MM-DD>-<slug>.md`, or resume from an explicitly named one after a read-only preflight. |
| `session-history`                       | Search prior sessions across Claude Code, Devin, and Codex for the same problem or topic.                                                             |
| `worktree-inventory`                    | List existing Git worktrees and their branch, detached, lock and prune status without changing the repository.                                        |

Agents: `architecture-strategist`, `best-practices-researcher`,
`brainstorm-orchestrator`, `code-simplicity-reviewer`, `git-history-analyzer`,
`knowledge-compounder`, `learnings-researcher`,
`pattern-recognition-specialist`, `performance-oracle`, `performance-reviewer`,
`polyglot-reviewer`, `repo-research-analyst`, `security-lens`,
`security-reviewer`, `security-sentinel`, `session-historian`,
`spec-flow-analyzer`, `staging-promoter`, `staging-reviewer`, `staging-scorer`,
`test-coverage-analyst`

## yellow-linear

Linear MCP integration with PM workflows for issues, projects, initiatives,
cycles, and documents

Details: [plugins/yellow-linear/README.md](../plugins/yellow-linear/README.md)

| Command              | What it does                                                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/linear:create`     | Create a Linear issue from current context.                                                                                                                  |
| `/linear:delegate`   | Delegate a Linear issue to a coding agent: a Cursor cloud agent or a Devin AI session (the remote-agent group), or the local Antigravity agent (yellow-agy). |
| `/linear:plan-cycle` | Plan sprint cycle by selecting backlog issues.                                                                                                               |
| `/linear:setup`      | Validate Linear MCP availability and first-use OAuth readiness.                                                                                              |
| `/linear:status`     | Generate project and initiative health report.                                                                                                               |
| `/linear:sync`       | Sync current branch with its Linear issue — load context, link PR, update status.                                                                            |
| `/linear:sync-all`   | Audit open Linear issues and close ones with merged PRs.                                                                                                     |
| `/linear:triage`     | Review and assign incoming Linear issues.                                                                                                                    |
| `/linear:work`       | Start working on a Linear issue — loads context and routes to plan or stack.                                                                                 |

Agents: `linear-explorer`, `linear-issue-loader`, `linear-pr-linker`

## yellow-cursor

Cursor Cloud Agents integration — delegate coding tasks to Cursor's remote
agents, track status, and manage runs

Details: [plugins/yellow-cursor/README.md](../plugins/yellow-cursor/README.md)

| Command             | What it does                                                                                                                                 |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `/cursor:archive`   | Archive a Cursor Cloud Agent to hide it from default listing, after user confirmation.                                                       |
| `/cursor:artifacts` | List or download artifacts produced by a Cursor Cloud Agent run.                                                                             |
| `/cursor:cancel`    | Cancel a running Cursor Cloud Agent run after user confirmation.                                                                             |
| `/cursor:delegate`  | Launch a Cursor Cloud Agent against a repository with a task prompt, always dry-run validated and user-confirmed before the billable launch. |
| `/cursor:follow-up` | Send a follow-up prompt to an existing Cursor Cloud Agent, confirmed before the billable send.                                               |
| `/cursor:list`      | List Cursor Cloud Agents merged with local state.                                                                                            |
| `/cursor:setup`     | Detect Cursor SDK/credential availability and optionally install the @cursor/sdk runtime.                                                    |
| `/cursor:status`    | Check the live status of a Cursor Cloud Agent (and optionally a specific run), reconciling local state against the server.                   |
| `/cursor:unarchive` | Restore an archived Cursor Cloud Agent to default listing, after user confirmation.                                                          |
| `/cursor:usage`     | Show token usage and cost for a Cursor Cloud Agent, broken down by run.                                                                      |

| Skill (invoke as `yellow-cursor:<skill>`) | What it does                   |
| ----------------------------------------- | ------------------------------ |
| `cursor-plan`                             | Validate offline Cursor plans. |

## yellow-devin

Devin.AI V3 API integration — delegate tasks, manage sessions, review and
remediate PRs, orchestrate plan-implement-review chains

Details: [plugins/yellow-devin/README.md](../plugins/yellow-devin/README.md)

| Command             | What it does                                                                          |
| ------------------- | ------------------------------------------------------------------------------------- |
| `/devin:archive`    | Archive a Devin session.                                                              |
| `/devin:cancel`     | Terminate a running Devin session.                                                    |
| `/devin:delegate`   | Create a single Devin session with a task prompt (fire-and-track, no review loop).    |
| `/devin:message`    | Send a follow-up message to an active Devin session.                                  |
| `/devin:review-prs` | Discover Devin PRs for current repo, review with multi-agent pipeline, and remediate. |
| `/devin:setup`      | Validate Devin V3 credentials and permissions.                                        |
| `/devin:status`     | Check status of Devin sessions.                                                       |
| `/devin:tag`        | Manage session tags.                                                                  |
| `/devin:wiki`       | Query DeepWiki or Devin Wiki about a GitHub repository's indexed wiki.                |

Agents: `devin-orchestrator`

## yellow-jules

Google Jules integration (deprecated: Jules is read-only from 2026-11-11 and
shuts down 2026-12-31) — delegate, supervise, and review Jules remote-agent
sessions under owner-written grants

Details: [plugins/yellow-jules/README.md](../plugins/yellow-jules/README.md)

| Command            | What it does                                                                                                                                                               |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/jules:abandon`   | Prepare the terminal command that abandons a Google Jules launch or message whose outcome could not be determined, freeing its repository and branch guard.                |
| `/jules:approve`   | Approve the pending plan of a Google Jules session under an owner-written grant, after re-reading the plan fresh from the vendor and confirming with the user.             |
| `/jules:authorize` | List or revoke Google Jules grants, or prepare the terminal command that writes a new grant or moves the controller to this host.                                          |
| `/jules:collect`   | Stage a Google Jules session's patches, generated files, and pull-request references into the yellow-jules data directory for local review, without touching any checkout. |
| `/jules:delegate`  | Launch a Google Jules session on a repository branch under an owner-written grant, always dry-run validated and user-confirmed before anything is sent.                    |
| `/jules:list`      | List one page of Google Jules sessions with their normalized condition, matched against the local journal.                                                                 |
| `/jules:reply`     | Send one message to a Google Jules session under an owner-written grant, dry-run validated and user-confirmed first.                                                       |
| `/jules:setup`     | Check Jules credential and SDK availability and, with consent, install the pinned Jules SDK into the plugin data directory.                                                |
| `/jules:status`    | Check the live state of one Google Jules session — normalized condition, new activities, pending plan, and outputs — reading fresh from the vendor.                        |
| `/jules:supervise` | Run one bounded supervision pass over a Google Jules session under a grant, then act on its decision with at most one reply or approval.                                   |

## yellow-agy

Local supervised delegate on the Antigravity CLI (agy) under the owner's Google
AI Pro sign-in — successor to yellow-jules

Details: [plugins/yellow-agy/README.md](../plugins/yellow-agy/README.md)

| Command          | What it does                                                                                                                                                                                                                 |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/agy:abandon`   | Give the owner the terminal command that abandons a yellow-agy task: it collects the work first, removes the worktree and keeps the branch.                                                                                  |
| `/agy:approve`   | Approve a yellow-agy task's plan and let agy implement it in the task's worktree, file edits only.                                                                                                                           |
| `/agy:authorize` | List or revoke yellow-agy grants, or give the owner the terminal command that creates one (repo, branch pattern, operations, quota floor, limits, expiry).                                                                   |
| `/agy:collect`   | Write a yellow-agy task's work out as patch files (commits and uncommitted changes) and scan them for secret-shaped content, ready for the stack provider to open a PR.                                                      |
| `/agy:delegate`  | Hand one coding task to the Antigravity CLI (agy) on this machine, in a new git worktree and branch, under an owner-written grant.                                                                                           |
| `/agy:reply`     | Send a follow-up message to a yellow-agy task's agy conversation: a question or change before approval (read-only), or more work after it.                                                                                   |
| `/agy:setup`     | Check that the Antigravity CLI (agy) is installed, new enough, signed in on the Google AI Pro subscription with no API-key or Vertex variables, has AI-credit overages off and no enabled MCP servers, then record the host. |
| `/agy:status`    | Show yellow-agy delegate tasks: state, plan, branch, worktree and any live run, from the local journal.                                                                                                                      |

## yellow-review

Multi-agent PR review with adaptive agent selection, parallel comment
resolution, and sequential stack review. Graphite-native workflow.

Details: [plugins/yellow-review/README.md](../plugins/yellow-review/README.md)

| Command                 | What it does                                                                                                                                                                                                          |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/review:all`           | Sequential review of multiple PRs — your Graphite stack, all open PRs, or a single PR.                                                                                                                                |
| `/review:merge-ready`   | Read-only merge gate for one PR: unresolved review threads (outdated included), CHANGES_REQUESTED reviewers, conversation-resolution enforcement, CI, pending P0-P2 ledger findings and the risk-tier human approval. |
| `/review:pr`            | Adaptive multi-agent review of a single PR with a tiered persona pipeline, learnings pre-pass, and confidence-rubric aggregation.                                                                                     |
| `/review:resolve`       | Parallel resolution of unresolved PR review comments with actionability filtering and same-region clustering.                                                                                                         |
| `/review:resolve-stack` | Walk a Graphite stack bottom-up and run /review:resolve on every open PR fully autonomously — no prompts, pushing and restacking as it goes.                                                                          |
| `/review:setup`         | Validate review command prerequisites and optional yellow-core integration.                                                                                                                                           |
| `/review:sweep`         | Run /review:pr then /review:resolve on the same PR in one unattended pass — no gates, no per-step prompts.                                                                                                            |
| `/review:sweep-all`     | Run /review:sweep on every open non-draft PR authored by the current user, sequentially, with one upfront confirmation.                                                                                               |
| `/review:triage`        | Triage the review-findings ledger of one PR: re-verify every residual finding against the PR head, then fix, dismiss, restore or skip each one.                                                                       |

Agents: `adversarial-reviewer`, `agent-cli-readiness-reviewer`,
`agent-native-reviewer`, `cli-readiness-reviewer`, `code-simplifier`,
`comment-analyzer`, `comment-reviewer`, `correctness-reviewer`,
`maintainability-reviewer`, `plugin-contract-reviewer`, `pr-comment-resolver`,
`pr-test-analyzer`, `previous-comments-reviewer`, `project-compliance-reviewer`,
`project-standards-reviewer`, `reliability-reviewer`, `review-gate-verifier`,
`silent-failure-hunter`, `test-value-reviewer`, `thermonuclear-reviewer`,
`type-design-analyzer`

## yellow-ruvector

Persistent vector memory and semantic code search for Claude Code agents via
ruvector

Details:
[plugins/yellow-ruvector/README.md](../plugins/yellow-ruvector/README.md)

| Command                    | What it does                                                                                                                                                   |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/ruvector:index`          | Index codebase for semantic search.                                                                                                                            |
| `/ruvector:learn`          | Record a learning, mistake, or pattern for future sessions.                                                                                                    |
| `/ruvector:memory`         | Browse and search stored memories and learnings.                                                                                                               |
| `/ruvector:related`        | List files most often edited together with a given file, from this project's co-edit history.                                                                  |
| `/ruvector:search`         | Search codebase by meaning using vector similarity.                                                                                                            |
| `/ruvector:seed-solutions` | Seed ruvector recall memory with ERROR-FIX entries extracted from a repo's docs/solutions/ corpus.                                                             |
| `/ruvector:setup`          | Install ruvector and initialize vector storage.                                                                                                                |
| `/ruvector:status`         | Show ruvector health, DB stats, queue status, and embedder provenance (PROVENANCE: FRESH \| OK \| MISMATCH \| UNSTAMPED \| UNKNOWN, with reembed remediation). |

Agents: `memory-manager`, `semantic-search`

## yellow-browser-test

Autonomous web app testing with agent-browser — auto-discovery, structured
flows, exploratory testing, and bug reporting

Details:
[plugins/yellow-browser-test/README.md](../plugins/yellow-browser-test/README.md)

| Command                 | What it does                                          |
| ----------------------- | ----------------------------------------------------- |
| `/browser-test:explore` | Run autonomous exploratory browser testing.           |
| `/browser-test:report`  | Generate a test report from the most recent results.  |
| `/browser-test:setup`   | Install agent-browser and discover app configuration. |
| `/browser-test:test`    | Run structured browser test suite.                    |

Agents: `app-discoverer`, `test-reporter`, `test-runner`

## yellow-debt

Technical debt audit and remediation with parallel scanner agents. Use when you
need to assess codebase health, identify AI-generated debt patterns, prioritize
findings, and systematically remediate technical debt.

Details: [plugins/yellow-debt/README.md](../plugins/yellow-debt/README.md)

| Command        | What it does                                                            |
| -------------- | ----------------------------------------------------------------------- |
| `/debt:audit`  | Run comprehensive technical debt audit with parallel scanner agents.    |
| `/debt:fix`    | Agent-driven remediation of specific debt findings with human approval. |
| `/debt:setup`  | Validate debt audit prerequisites and optional Linear integration.      |
| `/debt:status` | Dashboard of current technical debt levels.                             |
| `/debt:sync`   | Push accepted debt findings to Linear as issues.                        |
| `/debt:triage` | Interactive review and prioritization of pending debt findings.         |

| Skill (invoke as `yellow-debt:<skill>`) | What it does          |
| --------------------------------------- | --------------------- |
| `debt-complexity-scan`                  | Scan complexity debt. |

Agents: `ai-pattern-scanner`, `architecture-scanner`, `audit-synthesizer`,
`complexity-scanner`, `debt-fixer`, `duplication-scanner`,
`security-debt-scanner`

## yellow-ci

CI failure diagnosis, workflow linting, and runner health management for
self-hosted GitHub Actions runners

Details: [plugins/yellow-ci/README.md](../plugins/yellow-ci/README.md)

| Command                    | What it does                                                                                                                  |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `/ci:diagnose`             | Diagnose CI failure and suggest fixes.                                                                                        |
| `/ci:lint-workflows`       | Lint GitHub Actions workflows for self-hosted runner issues.                                                                  |
| `/ci:report-linear`        | Diagnose a CI failure and create a Linear bug issue.                                                                          |
| `/ci:runner-cleanup`       | Clean Docker images/containers, old logs, and caches on self-hosted runner.                                                   |
| `/ci:runner-health`        | Check self-hosted runner health via SSH.                                                                                      |
| `/ci:setup`                | Check CI prerequisites and configure self-hosted runner SSH config.                                                           |
| `/ci:setup-runner-targets` | Configure runner pool targets, routing rules, and semantic metadata for CI workflow optimization.                             |
| `/ci:setup-self-hosted`    | Inventory available self-hosted runners and optimize workflow jobs to use the best runner based on labels, OS, and live load. |
| `/ci:status`               | Show recent CI workflow run status.                                                                                           |

| Skill (invoke as `yellow-ci:<skill>`) | What it does                                                                                                                          |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `diagnose-ci`                         | Reference guide (not an executable action) for CI debugging workflows and the F01-F12 failure-pattern catalog on self-hosted runners. |

Agents: `failure-analyst`, `runner-assignment`, `runner-diagnostics`,
`workflow-optimizer`

## yellow-composio

Optional Composio accelerator for batch workflows with usage tracking

Details:
[plugins/yellow-composio/README.md](../plugins/yellow-composio/README.md)

| Command            | What it does                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------- |
| `/composio:setup`  | Validate Composio MCP availability, check connections, and initialize local usage tracking. |
| `/composio:status` | Show Composio usage dashboard with execution counts and threshold warnings.                 |

## yellow-research

Deep research plugin with Ceramic, DeepWiki, Perplexity, Tavily, EXA, and
Parallel Task MCP servers, plus optional ast-grep CLI code search. Code research
inline; deep research saved to docs/research/.

Details:
[plugins/yellow-research/README.md](../plugins/yellow-research/README.md)

| Command             | What it does                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------ |
| `/flow:deepen-plan` | Enrich an existing plan with codebase validation and external research, annotating inline. |
| `/research:code`    | Inline code research for active development.                                               |
| `/research:deep`    | Multi-source deep research saved to docs/research/.                                        |
| `/research:setup`   | Check which research API keys and MCP sources are configured and active.                   |

| Skill (invoke as `yellow-research:<skill>`) | What it does                                                                      |
| ------------------------------------------- | --------------------------------------------------------------------------------- |
| `library-context`                           | Use when an agent needs official library docs, API examples, or migration guides. |
| `research-public-repo`                      | Research public repos.                                                            |

Agents: `code-researcher`, `research-conductor`

## yellow-morph

Intelligent code editing and search via Morph Fast Apply and WarpGrep

Details: [plugins/yellow-morph/README.md](../plugins/yellow-morph/README.md)

| Command         | What it does                                     |
| --------------- | ------------------------------------------------ |
| `/morph:setup`  | Check prerequisites and configure Morph API key. |
| `/morph:status` | Show Morph API health and MCP server state.      |

## yellow-semgrep

Semgrep security finding remediation — fetch, fix, and verify 'to fix' findings
from the Semgrep AppSec Platform

Details: [plugins/yellow-semgrep/README.md](../plugins/yellow-semgrep/README.md)

| Command              | What it does                                                                                                                                 |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `/semgrep:fix`       | Fix a single Semgrep finding: fetch details, analyze vulnerability, apply fix (autofix or LLM), verify via re-scan, and update triage state. |
| `/semgrep:fix-batch` | Fix multiple 'to-fix' Semgrep findings with human approval between each fix.                                                                 |
| `/semgrep:scan`      | Run local Semgrep scan and compare results with platform findings.                                                                           |
| `/semgrep:setup`     | Validate SEMGREP_APP_TOKEN, test MCP connection, detect deployment slug, and cache configuration.                                            |
| `/semgrep:status`    | Show findings dashboard grouped by triage state and severity.                                                                                |

Agents: `finding-fixer`, `scan-verifier`

## yellow-docs

Documentation audit, generation, and evidence-backed technical diagrams for any
repository

Details: [plugins/yellow-docs/README.md](../plugins/yellow-docs/README.md)

| Command          | What it does                                                                                                                                                          |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/docs:audit`    | Scan repo for documentation gaps, staleness, and coverage.                                                                                                            |
| `/docs:diagram`  | Create or revise a repository diagram.                                                                                                                                |
| `/docs:generate` | Generate documentation from code analysis with human review.                                                                                                          |
| `/docs:refresh`  | Update stale documentation by analyzing code changes since a git ref.                                                                                                 |
| `/docs:review`   | Review a planning document (PRD, brainstorm, spec, ADR) with 6 always-on personas plus a conditional adversarial reviewer, aggregated under a confidence-rubric gate. |
| `/docs:setup`    | Validate docs plugin prerequisites and detect project structure.                                                                                                      |

| Skill (invoke as `yellow-docs:<skill>`) | What it does                                                                                    |
| --------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `docs-audit`                            | Audit local repository documentation for missing coverage, stale claims and structure problems. |
| `technical-diagrams`                    | Maintain editable technical diagrams.                                                           |

Agents: `adversarial-document-reviewer`, `coherence-reviewer`,
`design-lens-reviewer`, `diagram-architect`, `doc-auditor`, `doc-generator`,
`feasibility-reviewer`, `product-lens-reviewer`, `scope-guardian-reviewer`,
`security-lens-reviewer`

## yellow-codex

OpenAI Codex CLI wrapper with review, rescue, and analysis agents for workflow
integration

Details: [plugins/yellow-codex/README.md](../plugins/yellow-codex/README.md)

| Command         | What it does                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------------- |
| `/codex:rescue` | Delegate a debugging or investigation task to Codex for independent exploration and fix proposal. |
| `/codex:review` | Invoke Codex CLI to review current diff or a PR.                                                  |
| `/codex:setup`  | Detect Codex CLI, verify OpenAI authentication, and install if needed.                            |
| `/codex:status` | Check running Codex processes and recent session history.                                         |

| Skill (invoke as `yellow-codex:<skill>`) | What it does                     |
| ---------------------------------------- | -------------------------------- |
| `codex-readiness`                        | Check local Codex CLI and login. |

Agents: `codex-analyst`, `codex-executor`, `codex-reviewer`

## yellow-council

On-demand cross-lineage code review fanning out to an in-process Claude reviewer
plus the Codex, Gemini, and OpenCode CLIs in parallel for advisory consensus

Details: [plugins/yellow-council/README.md](../plugins/yellow-council/README.md)

| Command          | What it does                                                                                                                                                                      |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/council`       | On-demand cross-lineage code review fanning out to an in-process Claude reviewer plus the Codex (via yellow-codex), Gemini, and OpenCode CLIs in parallel for advisory consensus. |
| `/council:setup` | Detect Antigravity (agy) and OpenCode CLIs, verify their versions, and report yellow-codex availability for the Codex leg of the council.                                         |

Agents: `claude-reviewer`, `gemini-reviewer`, `opencode-reviewer`

## yellow-goal

yellow-goal engine bridge — probe a pinned goal-gen process, create/validate
request packets, run zero-spend stub scenarios, and forward a user-only
approval-gated real run. Never imports the engine.

Details: [plugins/yellow-goal/README.md](../plugins/yellow-goal/README.md)

| Command          | What it does                                                                                                                                                                                               |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/goal:request`  | Create or validate a yellow-goal request packet by spawning goal-gen (request create / request validate).                                                                                                  |
| `/goal:run-real` | User-only approval-gated real run.                                                                                                                                                                         |
| `/goal:run-stub` | Run one zero-spend, deterministic Provider Protocol v2 stub scenario (success \| failed \| budget-exhausted \| await-cancel) through the pinned goal-gen engine and report the validated terminal summary. |
| `/goal:setup`    | Probe the pinned goal-gen engine (version --json) and fail closed on missing binary or version mismatch.                                                                                                   |

## yellow-claudemod

Claude Code mod that records the model each subagent runs on and can downshift
listed Opus reviewers near a usage limit

Details:
[plugins/yellow-claudemod/README.md](../plugins/yellow-claudemod/README.md)

| Command            | What it does                                                                                             |
| ------------------ | -------------------------------------------------------------------------------------------------------- |
| `/claudemod:setup` | Check that Claude Code can load the yellow-claudemod hooks module and show how to turn the downshift on. |
