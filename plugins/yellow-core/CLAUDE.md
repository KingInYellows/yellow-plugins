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

### Agents (10)

**Review** — parallel code review specialists:

- `code-simplicity-reviewer` — YAGNI enforcement, simplification
- `security-sentinel` — security audit, OWASP, secrets scanning
- `performance-oracle` — bottlenecks, algorithmic complexity, scalability
- `architecture-strategist` — architectural compliance, design patterns
- `polyglot-reviewer` — language-idiomatic review for TS/Py/Rust/Go
- `test-coverage-analyst` — test quality, coverage gaps, edge cases

**Research** — codebase and external research:

- `repo-research-analyst` — repository structure, conventions
- `best-practices-researcher` — external docs, community standards
- `git-history-analyzer` — git archaeology, change history

**Workflow** — planning and analysis:

- `spec-flow-analyzer` — user flow analysis, gap identification

### Commands (4)

- `/workflows:plan` — transform feature descriptions into structured plans
- `/workflows:work` — execute work plans systematically
- `/workflows:review` — multi-agent comprehensive code review
- `/workflows:compound` — document a recently solved problem to compound knowledge

### Skills (2)

- `create-agent-skills` — guidance for creating skills and agents
- `git-worktree` — git worktree management for parallel development

### MCP Servers (1)

- `context7` — up-to-date library documentation via
  [context7.com](https://context7.com). Third-party HTTP service; all agents
  work without it (used only for fetching live docs). No credentials are sent.
