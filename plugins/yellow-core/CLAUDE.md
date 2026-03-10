# yellow-core Plugin

Comprehensive dev toolkit for TypeScript, Python, Rust, and Go projects.

## Conventions

- Use Graphite (`gt`) for all branch management and PR creation — never raw
  `git push` or `gh pr create`
- Use conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`,
  `chore:`
- Keep code simple and direct. No premature abstractions
- Prefer explicit over implicit. Name things clearly
- Write tests for non-trivial logic

## Plugin Components

### Agents (13)

**Review** — parallel code review specialists:

- `code-simplicity-reviewer` — YAGNI enforcement, simplification
- `security-sentinel` — security audit, OWASP, secrets scanning
- `performance-oracle` — bottlenecks, algorithmic complexity, scalability
- `architecture-strategist` — architectural compliance, design patterns
- `polyglot-reviewer` — language-idiomatic review for TS/Py/Rust/Go
- `test-coverage-analyst` — full test suite audits, coverage gaps, strategy
- `pattern-recognition-specialist` — anti-patterns, duplication, naming drift

**Research** — codebase and external research:

- `repo-research-analyst` — repository structure, conventions
- `best-practices-researcher` — external docs, community standards
- `git-history-analyzer` — git archaeology, change history

**Workflow** — planning and analysis:

- `spec-flow-analyzer` — user flow analysis, gap identification
- `brainstorm-orchestrator` — iterative brainstorm dialogue with research integration
- `knowledge-compounder` — extract and document solved problems to docs/solutions/ and MEMORY.md

### Commands (7)

- `/workflows:brainstorm` — explore requirements through dialogue and research before planning
- `/workflows:plan` — transform feature descriptions into structured plans
- `/workflows:work` — execute work plans systematically
- `/workflows:review` — redirects to `/review:pr` (yellow-review)
- `/workflows:compound` — document a recently solved problem to compound knowledge
- `/statusline:setup` — generate and install an adaptive statusline showing context, git, MCP health
- `/setup:all` — run setup for all installed marketplace plugins with unified dashboard

### Skills (4)

- `brainstorming` — reference guide for iterative brainstorm dialogues (internal)
- `create-agent-skills` — guidance for creating skills and agents
- `git-worktree` — git worktree management for parallel development
- `mcp-integration-patterns` — canonical patterns for ruvector recall/remember and morph discovery integration (internal)

### Optional Plugin Dependencies

- **gt-workflow** — `/workflows:work` delegates to `/smart-submit` for
  commit+submit and supports stack-aware execution when a
  `## Stack Decomposition` section exists in the plan (produced by
  `/gt-stack-plan`). Without gt-workflow, falls back to inline `gt modify -m` +
  `gt submit --no-interactive` and stack features are unavailable.
- **yellow-review** — `/workflows:work` invokes `/review:pr` after submission;
  `/workflows:review` redirects to `/review:pr`. Without either, review steps
  are skipped with a user notice.
- **yellow-linear** — `/workflows:work` can invoke `/linear:sync --after-submit`
  as a fallback when native Linear GitHub automation is unavailable or needs
  repair. `/workflows:plan` detects Linear issue context in brainstorm docs and
  includes a `## Linear Issues` metadata section. Without yellow-linear, both
  features skip silently.

### MCP Servers (1)

- `context7` — up-to-date library documentation via
  [context7.com](https://context7.com). Third-party HTTP service; all agents
  work without it (used only for fetching live docs). No credentials are sent.

### MCP Tool Integration

- **ruvector** — Recall past learnings at workflow start; tiered remember at
  workflow end. Graceful skip if yellow-ruvector not installed. See
  `mcp-integration-patterns` skill for canonical patterns.
- **morph** — Preferred for file edits (>200 lines or 3+ non-contiguous
  regions) and intent-based code search. Discovered via ToolSearch at runtime;
  falls back to built-in tools silently.
