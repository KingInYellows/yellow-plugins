# yellow-review

Multi-agent PR review with adaptive agent selection, parallel comment
resolution, and sequential stack review.

## Install

```
/plugin marketplace add KingInYellows/yellow-plugins
/plugin install yellow-review@yellow-plugins
```

## Prerequisites

- `gh` CLI (GitHub) installed and authenticated
- `jq` installed
- Graphite CLI (`gt`) for branch management
- Clean working directory before running review commands

Run `/review:setup` after install to verify the local prerequisites and optional
yellow-core integration before reviewing real PRs.

## Commands

| Command           | Description                                                               |
| ----------------- | ------------------------------------------------------------------------- |
| `/review:setup`   | Validate review prerequisites and optional yellow-core integration        |
| `/review:pr`      | Adaptive multi-agent review of a single PR with automatic fix application |
| `/review:resolve` | Parallel resolution of unresolved PR review comments                      |
| `/review:all`     | Sequential review of multiple PRs (Graphite stack, all open, or single)   |

## Agents

### Review (12)

| Agent                          | Description                                                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `project-compliance-reviewer`  | CLAUDE.md/AGENTS.md compliance, naming, project-pattern adherence (always selected; renamed from code-reviewer in Wave 2) |
| `correctness-reviewer`         | Logic errors, edge cases, state bugs (always selected; new in Wave 2)                                        |
| `maintainability-reviewer`     | Premature abstraction, dead code, coupling, naming (always selected; new in Wave 2)                          |
| `reliability-reviewer`         | Production reliability: error handling, retries, timeouts, cascades (conditional; new in Wave 2)             |
| `project-standards-reviewer`   | Frontmatter, references, cross-platform portability (always selected; new in Wave 2)                         |
| `adversarial-reviewer`         | Constructed failure scenarios across boundaries (conditional; new in Wave 2)                                 |
| `pr-test-analyzer`             | Test coverage and behavioral completeness                                                                    |
| `comment-analyzer`             | Comment accuracy and rot detection                                                                           |
| `code-simplifier`              | Simplification preserving functionality (final pass)                                                         |
| `type-design-analyzer`         | Type design, encapsulation, invariants                                                                       |
| `silent-failure-hunter`        | Silent failure and error handling analysis                                                                   |
| `code-reviewer`                | DEPRECATED stub; will be removed next minor version                                                          |

### Workflow (1)

| Agent                 | Description                                |
| --------------------- | ------------------------------------------ |
| `pr-comment-resolver` | Implements fix for a single review comment |

## Skills

| Skill                | Description                                                 |
| -------------------- | ----------------------------------------------------------- |
| `pr-review-workflow` | Internal reference for adaptive selection and output format |

## Limitations

- Very large PRs (1000+ lines) may cause agent context overflow — consider
  splitting
- Draft PRs excluded from `/review:all scope=all` by default
- Cross-plugin agents require the yellow-core plugin to be installed

## License

MIT
