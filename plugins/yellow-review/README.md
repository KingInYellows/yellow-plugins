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

### Review (16)

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
| `thermonuclear-reviewer`       | Strict structural-quality lane: code-judo restructurings, spaghetti-condition growth, weak type/module boundaries, misplaced ownership, evidence-gated file-size threshold crossings. **Opt-in only** — never auto-selected; enable via `reviewer_set.include` |

### Workflow (1)

| Agent                 | Description                                |
| --------------------- | ------------------------------------------ |
| `pr-comment-resolver` | Implements fix for a single review comment |

## Skills

| Skill                | Description                                                          |
| -------------------- | -------------------------------------------------------------------- |
| `pr-review-workflow` | Internal reference for adaptive selection and output format          |
| `stack-traversal`    | Internal reference for the bottom-up Graphite stack walk shared by `/review:all` and `/review:resolve-stack` |
| `yellow-thermonuclear-review` | Portable structural-quality rubric preloaded by `thermonuclear-reviewer`; adapted from Cursor's MIT-licensed `thermo-nuclear-code-quality-review` |

## Opt-in: thermonuclear structural review

`thermonuclear-reviewer` is the one persona `/review:pr` never selects on
its own. It applies a deliberately aggressive structural rubric at
opus/xhigh, which is not worth paying on every PR — so a repository enables
it explicitly in `yellow-plugins.local.md`:

```yaml
---
reviewer_set:
  include:
    - thermonuclear-reviewer
---
```

Then run `/review:pr` as usual. All default personas still run; this adds a
high-pressure structural lane on top of them. Remove the entry to turn it
off again.

### Cursor and Codex

Those hosts do not ship `/review:pr`, the persona, or the
`reviewer_set.include` opt-in. Each generated target exposes **only** the
`yellow-thermonuclear-review` skill, and it is explicit-invocation-only:
ask for a thermonuclear review (or one of the skill description's other
trigger phrases) after installing the plugin. It will not load on an
ordinary review.

- **Cursor** — install the generated `yellow-review` plugin (see
  [cursor-distribution.md](../../docs/cursor-distribution.md)) and invoke
  `yellow-thermonuclear-review` directly.
- **Codex** — install from the generated `.agents/plugins/` marketplace
  (see [codex-distribution.md](../../docs/codex-distribution.md)), confirm
  it with `codex plugin list`, then invoke the same skill.

Neither host enforces the Claude agent's read-only tool allowlist. The
skill's report-only rails are prompt-level, not runtime-enforced. Live
host smoke tests are tracked in
[#774](https://github.com/KingInYellows/yellow-plugins/issues/774).

Two caveats worth knowing before enabling it:

- Its findings are advisory and owned by a human. No automatic-fix lane
  will ever apply a restructuring it proposes.
- It is unreachable under `review_pipeline: legacy`. The legacy escape
  hatch carries its own fixed persona list and never reads `reviewer_set`,
  so `include` has no effect there.

## Confidence gating

Three conditional personas (`agent-native-reviewer`,
`agent-cli-readiness-reviewer`, `cli-readiness-reviewer`) report every
in-scope finding with a `confidence` anchor (`0`, `25`, `50`, `75`, `100`)
and severity — they no longer pre-filter below 75. They do cap at 40
findings: overflow is dropped at the persona and is not counted in the
orchestrator's suppressed total. Other
persona reviewers still apply their own anchor floors (for example,
`correctness-reviewer` suppresses anchor-25 items and
`plugin-contract-reviewer` suppresses anchor-25 items before Step 6).

`/review:pr` Step 6 and `/review:all` Step 8 item 9 (the Aggregate-findings
confidence gate) apply the **single** confidence gate: suppress findings
below anchor 75 except P0 at 50+. Sub-75 input
from the three recall personas is expected; the report's "Findings suppressed
at confidence < 75" line counts only what the orchestrator removes.
Pre-existing findings pass through the same gate (gated-out items count as
suppressed, not listed under Pre-existing).

## Prompt cache TTL

Five always-run `/review:pr` agents carry `experimental.cacheTtl: 1h` in
agent frontmatter (nested under `experimental:`):

- `project-compliance-reviewer`
- `correctness-reviewer`
- `maintainability-reviewer`
- `project-standards-reviewer`
- `code-simplifier`

On Claude Code 2.1.259+, a second review of the same PR within an hour can
read these stable persona prompts from cache instead of reprocessing them
full length. Supported values are `5m` and `1h`; the field is read only from
subagent files. Trade-off: on usage-billed routes a `1h` cache write bills at
about 2x base input versus 1.25x for the default `5m`, so the setting pays off
only when a second review runs within the hour (a re-review,
`/review:all` across several PRs, or `/review:sweep-all`). A
`subagentPromptCacheTtl` setting or
environment variable overrides the frontmatter value for every subagent, which
is the opt-out. While a subscription is drawing on usage credits, Claude Code
may ignore the setting — check `cache_read_input_tokens` in the transcript
(Ctrl-O) to confirm caching on your auth route.

## Limitations

- Very large PRs (1000+ lines) may cause agent context overflow — consider
  splitting
- Draft PRs excluded from `/review:all scope=all` by default
- Cross-plugin agents require the yellow-core plugin to be installed

## License

MIT
