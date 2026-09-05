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

| Command                 | Description                                                               |
| ----------------------- | ------------------------------------------------------------------------- |
| `/review:setup`         | Validate review prerequisites and optional yellow-core integration        |
| `/review:pr`            | Adaptive multi-agent review of a single PR with automatic fix application |
| `/review:resolve`       | Parallel resolution of unresolved PR review comments                      |
| `/review:resolve-stack` | Walk a Graphite stack bottom-up and run `/review:resolve` on every open PR autonomously |
| `/review:all`           | Sequential review of multiple PRs (Graphite stack, all open, or single)   |
| `/review:sweep`         | Run `/review:pr --non-interactive` then `/review:resolve --non-interactive` on the same PR in one unattended pass |
| `/review:sweep-all`     | Run `/review:sweep` on every open non-draft PR you authored, sequentially, with one upfront confirmation |

## Agents

### Review (15)

| Agent                          | Description                                                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `project-compliance-reviewer`  | CLAUDE.md/AGENTS.md compliance, naming, project-pattern adherence (always selected; renamed from code-reviewer in Wave 2) |
| `correctness-reviewer`         | Logic errors, edge cases, state bugs (always selected; new in Wave 2)                                        |
| `maintainability-reviewer`     | Premature abstraction, dead code, coupling, naming (always selected; new in Wave 2)                          |
| `reliability-reviewer`         | Production reliability: error handling, retries, timeouts, cascades (conditional; new in Wave 2)             |
| `project-standards-reviewer`   | Frontmatter, references, cross-platform portability (always selected; new in Wave 2)                         |
| `adversarial-reviewer`         | Constructed failure scenarios across boundaries (conditional; new in Wave 2)                                 |
| `plugin-contract-reviewer`     | Breaking changes to plugin public surface — subagent_type / command / skill / MCP-tool renames, manifest field changes, hook contract changes (conditional; new in Wave 3) |
| `cli-readiness-reviewer`       | CLI agent-readiness for autonomous invocation — non-interactive bypass, structured output, actionable errors, safe retries, bounded output, pipeline composability (conditional; new in Wave 3) |
| `agent-cli-readiness-reviewer` | 7-principle Blocker/Friction/Optimization rubric for CLI agent-optimization — deeper than `cli-readiness-reviewer`, suited for design-doc audits (conditional; new in Wave 3) |
| `agent-native-reviewer`        | Action parity, context parity, shared workspace, primitives over workflows, dynamic context injection (conditional; new in Wave 3) |
| `pr-test-analyzer`             | Test coverage and behavioral completeness                                                                    |
| `comment-analyzer`             | Comment accuracy and rot detection                                                                           |
| `code-simplifier`              | Simplification preserving functionality (final pass)                                                         |
| `type-design-analyzer`         | Type design, encapsulation, invariants                                                                       |
| `silent-failure-hunter`        | Silent failure and error handling analysis                                                                   |

### Workflow (1)

| Agent                 | Description                                |
| --------------------- | ------------------------------------------ |
| `pr-comment-resolver` | Implements fix for a single review comment |

## Skills

| Skill                | Description                                                          |
| -------------------- | -------------------------------------------------------------------- |
| `pr-review-workflow` | Internal reference for adaptive selection and output format          |
| `stack-traversal`    | Internal reference for the bottom-up Graphite stack walk shared by `/review:all` and `/review:resolve-stack` |

## Confidence gating

Three conditional personas (`agent-native-reviewer`,
`agent-cli-readiness-reviewer`, `cli-readiness-reviewer`) report every
in-scope finding with a `confidence` anchor (`0`, `25`, `50`, `75`, `100`)
and severity — they no longer pre-filter below 75 or cap the count. Other
persona reviewers still apply their own anchor floors (for example,
`correctness-reviewer` suppresses anchor-25 items and
`plugin-contract-reviewer` suppresses anchor-25 items before Step 6).

`/review:pr` and `/review:all` apply the **single** confidence gate in
Step 6/9: suppress findings below anchor 75 except P0 at 50+. Sub-75 input
from the three recall personas is expected; the report's "Findings suppressed
at confidence < 75" line counts only what the orchestrator removes.
Pre-existing findings pass through the same gate (gated-out items count as
suppressed, not listed under Pre-existing).

## Limitations

- Very large PRs (1000+ lines) may cause agent context overflow — consider
  splitting
- Draft PRs excluded from `/review:all scope=all` by default
- Cross-plugin agents require the yellow-core plugin to be installed

## License

MIT
