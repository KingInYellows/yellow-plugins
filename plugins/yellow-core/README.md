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

| Command              | Description                                              |
| -------------------- | -------------------------------------------------------- |
| `/workflows:plan`    | Transform feature descriptions into structured plans     |
| `/workflows:work`    | Execute work plans systematically                        |
| `/workflows:review`  | Multi-agent comprehensive code review                    |
| `/statusline:setup`  | Generate and install an adaptive statusline for plugins  |

## Agents

### Review (6)

| Agent                      | Description                                      |
| -------------------------- | ------------------------------------------------ |
| `code-simplicity-reviewer` | YAGNI enforcement, simplification                |
| `security-sentinel`        | Security audit, OWASP, secrets scanning          |
| `performance-oracle`       | Bottlenecks, algorithmic complexity, scalability |
| `architecture-strategist`  | Architectural compliance, design patterns        |
| `polyglot-reviewer`        | Language-idiomatic review for TS/Py/Rust/Go      |
| `test-coverage-analyst`    | Test quality, coverage gaps, edge cases          |

### Research (3)

| Agent                       | Description                        |
| --------------------------- | ---------------------------------- |
| `repo-research-analyst`     | Repository structure, conventions  |
| `best-practices-researcher` | External docs, community standards |
| `git-history-analyzer`      | Git archaeology, change history    |

### Workflow (1)

| Agent                | Description                            |
| -------------------- | -------------------------------------- |
| `spec-flow-analyzer` | User flow analysis, gap identification |

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
