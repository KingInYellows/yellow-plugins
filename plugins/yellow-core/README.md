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
| `/workflows:review`     | Session-level review of plan adherence, cross-PR coherence, and scope drift |
| `/workflows:compound`   | Document a recently solved problem to compound knowledge           |
| `/statusline:setup`     | Generate and install an adaptive statusline for plugins            |
| `/setup:all`            | Run setup for all installed marketplace plugins with unified dashboard |

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

| Skill                 | Description                                                                                                                                                       |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `compound-lifecycle`  | Audit, refresh, and consolidate `docs/solutions/` with composite-scored staleness detection, BM25+cosine overlap clustering, and archive superseded entries       |
| `create-agent-skills` | Guidance for creating skills and agents                                                                                                                           |
| `git-worktree`        | Git worktree management for parallel development                                                                                                                  |

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
