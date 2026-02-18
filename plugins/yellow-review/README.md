# yellow-review

Multi-agent PR review with adaptive agent selection, parallel comment resolution, and sequential stack review.

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

## Commands

| Command | Description |
|---------|-------------|
| `/review:pr` | Adaptive multi-agent review of a single PR with automatic fix application |
| `/review:resolve` | Parallel resolution of unresolved PR review comments |
| `/review:all` | Sequential review of multiple PRs (Graphite stack, all open, or single) |

## Agents

### Review (6)

| Agent | Description |
|-------|-------------|
| `code-reviewer` | General code review, conventions (always selected) |
| `pr-test-analyzer` | Test coverage and behavioral completeness |
| `comment-analyzer` | Comment accuracy and rot detection |
| `code-simplifier` | Simplification preserving functionality (final pass) |
| `type-design-analyzer` | Type design, encapsulation, invariants |
| `silent-failure-hunter` | Silent failure and error handling analysis |

### Workflow (2)

| Agent | Description |
|-------|-------------|
| `pr-comment-resolver` | Implements fix for a single review comment |
| `learning-compounder` | Captures review patterns to memory and solution docs |

## Skills

| Skill | Description |
|-------|-------------|
| `pr-review-workflow` | Internal reference for adaptive selection and output format |

## Limitations

- Very large PRs (1000+ lines) may cause agent context overflow — consider splitting
- Draft PRs excluded from `/review:all scope=all` by default
- Cross-plugin agents require Compound Engineering plugin

## License

MIT
