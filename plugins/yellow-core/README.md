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
| `/workflows:plan`       | Transform feature descriptions into structured plans               |
| `/workflows:work`       | Execute work plans systematically                                  |
| `/workflows:review`     | Multi-agent comprehensive code review                              |
| `/workflows:compound`   | Document a recently solved problem to compound knowledge           |
| `/statusline:setup`     | Generate and install an adaptive statusline for plugins            |

## Agents

### Review (7)

| Agent                              | Description                                      |
| ---------------------------------- | ------------------------------------------------ |
| `code-simplicity-reviewer`         | YAGNI enforcement, simplification                |
| `security-sentinel`                | Security audit, OWASP, secrets scanning          |
| `performance-oracle`               | Bottlenecks, algorithmic complexity, scalability |
| `architecture-strategist`          | Architectural compliance, design patterns        |
| `polyglot-reviewer`                | Language-idiomatic review for TS/Py/Rust/Go      |
| `test-coverage-analyst`            | Test quality, coverage gaps, edge cases          |
| `pattern-recognition-specialist`   | Anti-patterns, duplication, naming drift         |

### Research (3)

| Agent                       | Description                        |
| --------------------------- | ---------------------------------- |
| `repo-research-analyst`     | Repository structure, conventions  |
| `best-practices-researcher` | External docs, community standards |
| `git-history-analyzer`      | Git archaeology, change history    |

### Workflow (3)

| Agent                    | Description                                                    |
| ------------------------ | -------------------------------------------------------------- |
| `spec-flow-analyzer`     | User flow analysis, gap identification                         |
| `brainstorm-orchestrator` | Iterative brainstorm dialogue with research integration       |
| `knowledge-compounder`   | Extract and document solved problems to compound knowledge     |

## Skills

| Skill                 | Description                                      |
| --------------------- | ------------------------------------------------ |
| `create-agent-skills` | Guidance for creating skills and agents          |
| `git-worktree`        | Git worktree management for parallel development |

## MCP Servers

| Server   | URL                            | Auth          |
| -------- | ------------------------------ | ------------- |
| Context7 | `https://mcp.context7.com/mcp` | None (public) |

## License

MIT
