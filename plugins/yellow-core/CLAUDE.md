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

### Commands (6)

- `/workflows:brainstorm` — explore requirements through dialogue and research before planning
- `/workflows:plan` — transform feature descriptions into structured plans
- `/workflows:work` — execute work plans systematically
- `/workflows:review` — redirects to `/review:pr` (yellow-review)
- `/workflows:compound` — document a recently solved problem to compound knowledge
- `/statusline:setup` — generate and install an adaptive statusline showing context, git, MCP health

### Skills (3)

- `brainstorming` — reference guide for iterative brainstorm dialogues (internal)
- `create-agent-skills` — guidance for creating skills and agents
- `git-worktree` — git worktree management for parallel development

### Optional Plugin Dependencies

- **gt-workflow** — `/workflows:work` delegates to `/smart-submit` for
  commit+submit. Without it, falls back to inline `gt modify -c` +
  `gt submit --no-interactive`.
- **yellow-review** — `/workflows:work` invokes `/review:pr` after submission;
  `/workflows:review` redirects to `/review:pr`. Without either, review steps
  are skipped with a user notice.

### MCP Servers (1)

- `context7` — up-to-date library documentation via
  [context7.com](https://context7.com). Third-party HTTP service; all agents
  work without it (used only for fetching live docs). No credentials are sent.

### Optional Enhancement: yellow-morph

When yellow-morph is installed, two additional MCP tools become available:
`edit_file` (Fast Apply for high-accuracy code merging) and
`warpgrep_codebase_search` (intent-based code discovery). See yellow-morph's
CLAUDE.md for tool preference rules and domain separation with ruvector. These
tools are available in freeform conversations; structured commands use built-in
Edit and Grep.
