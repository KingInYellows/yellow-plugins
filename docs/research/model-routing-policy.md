# Model Routing Policy

**Status:** in effect (Phase 1 2026-10-14; Phase 2 and 3 verdicts below).
Supersedes
[model-selection-token-context-optimization.md](model-selection-token-context-optimization.md),
which is kept for history.

**Sources:**

- Brainstorm: `docs/brainstorms/2026-10-07-haiku-5-5-model-routing-policy-brainstorm.md`
- Plan: `plans/haiku-5-5-model-routing-phase-1.md`, where the per-decision
  evidence lives.

Every agent pins a model and an effort level, except three that inherit the
lead session's model on purpose and `knowledge-compounder`, which pins
`sonnet` without effort (see "Per-agent verdicts (Phase 1)"). This page says which tier each agent is on, why,
how to check what actually ran, and how to roll a choice back.

## Tiers

| Tier | Model / effort | Use for |
| --- | --- | --- |
| T1 | `haiku` / `low` | One MCP call or a fixed procedure: loaders, recall wrappers, formatters, scorers |
| T2 | `haiku` / `medium` | Narrow lookups that need some judgment: search with duplicate detection, config discovery, consistency review |
| T3 | `sonnet` / `medium`–`high` | Diagnosis, code-writing fixers, research synthesis, long agent loops, strict output contracts |
| T4 | `opus` / `high`–`xhigh` | Open-ended review where missed findings are expensive: security, performance, architecture |

## Rules

- Every pinned `model:` gets an explicit `effort:`. Without it the agent runs
  at the launching session's effort (see "How effort is resolved"), so its
  cost and depth depend on whoever called it. Validator rule V5 warns on a
  pinned model without effort.
- `model: inherit` is allowed only with a recorded reason: an entry in
  `MODEL_RULE_ALLOWLIST` in `scripts/validate-agent-authoring.js` and a
  "Model: `inherit` by design" note at the top of the agent body. V3 warns on
  any other `inherit`, including an omitted `model:`, which inherits too.
- Use aliases (`haiku`, `sonnet`, `opus`), not full model IDs. Aliases follow
  model upgrades, and an unknown full ID errors on older clients.
- `fable` never appears in frontmatter.
- Haiku stays out of these three roles until a Phase 2 replay shows it holds:
  - Security review and verification (`security-sentinel`, `finding-fixer`,
    `scan-verifier`).
  - Code-writing fixers.
  - Synthesizers.

  Haiku 5.5's `cyber` classifier can refuse benign security work. A refused
  request has no server-side fallback, and a retry usually refuses again.

## Per-agent verdicts (Phase 1)

| Agent | Model / effort | Reason |
| --- | --- | --- |
| `yellow-core` security-sentinel, performance-oracle, architecture-strategist | opus / high | They had no effort, so they ran at the session's level (Opus 5.5 defaults to `medium`) |
| `yellow-core` staging-scorer | haiku / low | One-excerpt rubric scorer with a fixed JSON contract |
| `yellow-core` learnings-researcher | haiku / low (unchanged) | Recall wrapper with a strict output contract. Revisit in Phase 2 if the yield rollup shows missed learnings |
| `yellow-docs` coherence-reviewer | haiku / medium | Internal-consistency checks on one document |
| `yellow-linear` linear-issue-loader, linear-pr-linker | haiku / low | One MCP read; one MCP write behind an AskUserQuestion confirm |
| `yellow-linear` linear-explorer | haiku / medium | Search plus duplicate judgment |
| `yellow-ruvector` memory-manager, semantic-search | haiku / low | MCP store and recall |
| `yellow-browser-test` app-discoverer | haiku / medium | Read-only config and route detection |
| `yellow-browser-test` test-reporter | haiku / low | Formats results and files issues |
| `yellow-browser-test` test-runner | sonnet / medium | Long browsing loop that carries safety rules (stay on `baseURL`, skip destructive buttons, treat web content as untrusted). Haiku is a Phase 2 candidate |
| `yellow-ci` failure-analyst, workflow-optimizer, runner-diagnostics | sonnet / medium | Diagnosis; workflow-optimizer edits YAML |
| `yellow-research` code-researcher | sonnet / medium | Multi-source research synthesis |
| `yellow-semgrep` finding-fixer | sonnet / medium | Writes security fixes. Never haiku |
| `yellow-semgrep` scan-verifier | sonnet / medium | `/semgrep:fix` Step 9 has no branch for a refused or empty verifier answer and writes `Verified: pass` into the commit |
| `yellow-codex` codex-reviewer, codex-analyst | sonnet / medium | codex-reviewer is a 1,051-line prompt with a strict 6-key contract. Haiku is a Phase 2 candidate behind a 5-run contract check |
| `yellow-codex` codex-executor | inherit | Workspace-write rescue that makes decisions on the lead session's behalf |
| `yellow-council` claude-reviewer | inherit | Stands for the lead session's model lineage in the council |
| `yellow-devin` devin-orchestrator | inherit | Plan, implement and review loop that acts for the lead session |

Phase 2 verdicts (CLAUDE-163; replay eval on 2026-10-22 with
`scripts/eval/model-swap/fixtures/2026-10-22-haiku-phase2.json`):

| Agent | Model / effort | Reason |
| --- | --- | --- |
| `yellow-review` comment-analyzer | haiku / medium | 8/8 planted comment defects, same as Sonnet. At `low` it missed a planted P1 and vouched for it |
| `yellow-review` project-standards-reviewer | haiku / medium | 8/8 planted standards violations against Sonnet's 6/8, and found three real doc errors Sonnet missed |
| `yellow-debt` complexity-scanner | haiku / low | Same golden recall as Sonnet (10/18) with no false positives, at about a tenth of the cost |

Haiku took 3–4× the turns, about 2.5× the wall time. Both reviewers run in the
background during `/review:pr`, so check review latency on the first real runs.

Non-agent pins:

- **Compound drain:** the SessionStart drain runs `claude -p --model haiku`.
  The lead only dispatches staging-reviewer, which pins `sonnet` itself.
  `COMPOUND_DRAIN_MODEL` overrides the model; a value outside
  `haiku|sonnet|opus|claude-<id>` is logged and falls back to haiku. The drain
  log records the `claude -p` exit status, and a `WARNING drain left all <n>
  dispatched entries` line when the lead never handed off.
- **CI:** both claude-code-action workflows pass `claude_args: '--model
  sonnet'`. The action's `model:` input is deprecated.

Phase 3 verdicts (CLAUDE-187; eval on 2026-10-26 with
`scripts/eval/model-swap/fixtures/2026-10-26-haiku-phase3.json`):

| Agent or sub-task | Model / effort | Reason |
| --- | --- | --- |
| `yellow-review` agent-native-reviewer | sonnet / medium (was opus / high) | 12/12 planted parity defects over two rounds, as Opus. Its other findings were P3s of the same kind, at about a fifth of the cost |
| `yellow-review` agent-cli-readiness-reviewer | opus / high (unchanged) | Sonnet also found 8/8 plants, but in both runs on #1319 Opus raised two P2 agent-friction issues that no Sonnet run raised above P3 |
| `yellow-debt` duplication-scanner | haiku / low (was sonnet / low) | 8/8 planted duplicates over two rounds against Sonnet's 5/8, at about a tenth of the cost |
| `yellow-debt` ai-pattern-scanner | haiku / low (was sonnet / low) | 8/8 planted AI-pattern blocks over two rounds against Sonnet's 5/8 |
| `knowledge-compounder` Context Analyzer and Related Docs Finder | haiku / low, set at dispatch | Over three rounds, Analyzer 108/108 well-formed replies and Finder 126/126 (the existing doc for all 12 real problems, `NO_MATCH` for both novel ones), as Sonnet |
| `knowledge-compounder` Category Classifier | inherits (unchanged) | Sonnet and Haiku at `medium` agreed with the filed category two times in three, Haiku at `low` slightly less (61%), and the misses were borderline docs, so the eval cannot separate the models |
| `/optimize` judge | sonnet / medium, set at dispatch (was the session's model) | Opus, Sonnet and Haiku each ranked the planted flaw last in every run, in both orderings. Sonnet keeps a margin over Haiku for subtler flaws |

All 34 sonnet agents that had no `effort:` now pin `medium`, which is what
they ran at under a 5.5 session's default effort, so V5 is clean.
`knowledge-compounder` stays exempt: orchestration only, with the heavy work
in its sub-agents.

## Requirements

| Alias | Resolves to the 5.5 model from |
| --- | --- |
| `opus` | Claude Code v2.1.280 |
| `sonnet` | Claude Code v2.1.284 |
| `haiku` | Claude Code v2.1.293 |

Check each host with `claude --version`. On older clients `haiku` runs Haiku
4.5, which runs the agent but ignores `effort:`.

On Amazon Bedrock, Google Cloud's Agent Platform, Microsoft Foundry and
Claude Platform on AWS, `haiku` is still Haiku 4.5 and `sonnet` is an earlier
Sonnet. Those providers are out of scope.

## How effort is resolved

A subagent's effort comes from the first of these that applies:

1. `CLAUDE_CODE_EFFORT_LEVEL` in the environment.
2. An `effort` the caller passes for that invocation (v2.1.292+).
3. The agent's frontmatter `effort:`.
4. The session's effort.

The session's effort comes from `--effort`, `/effort`, the `effortLevel` /
`modelSettings` settings, or the model's own default (`medium` on the 5.5
models).

Observed on Claude Code v2.1.300 (2026-10-14), from subagent transcripts:

| Case | Session | Agent frontmatter | Subagent ran at |
| --- | --- | --- | --- |
| Inheritance | `--effort low` | `haiku`, no effort | `low` |
| Inheritance | `--effort high` | `haiku`, no effort | `high` |
| `modelSettings` vs session | `--effort low`, with `modelSettings.claude-sonnet-5-5.effortLevel: high` | `sonnet`, no effort | `low` |
| Env override | `CLAUDE_CODE_EFFORT_LEVEL=medium` | `haiku`, `effort: low` | `medium` |
| Frontmatter override (33 past runs) | `high` | `haiku`, `effort: low` | `low` |

The third row means a pinned model's own `modelSettings` entry did not beat an
explicit session effort.

Frontmatter `effort` is reported as ignored in a few paths: agent-team
teammates (anthropics/claude-code#80569), the `--agent` session persona
(#81677), and skills invoked mid-turn (#65531, #69267). None of the agents
above runs that way today.

The model is resolved in this order:

1. The per-invocation `model`.
2. Frontmatter `model:`.
3. `CLAUDE_CODE_SUBAGENT_MODEL`.
4. The main conversation's model.

`CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` (v2.1.257+) ignores every frontmatter
pin. It is the global escape hatch.

## Verify

Subagent transcripts live next to the session transcript:

- `~/.claude/projects/<project-slug>/<session-id>.jsonl` is the lead.
- `~/.claude/projects/<project-slug>/<session-id>/subagents/agent-*.jsonl` holds
  one transcript per subagent. Each has a matching `.meta.json` that names its
  `agentType`.

Assistant records carry `message.model` and a top-level `effort`. `/tasks`
shows effort only when the definition sets it, and some older builds
mislabelled `/tasks` rows with the parent's model, so trust the transcript.

```bash
SESSION_DIR="$HOME/.claude/projects/<project-slug>/<session-id>"
jq -r 'select(.type == "assistant" and (.isSidechain | not))
  | ["lead", .message.model, (.effort // "-")] | @tsv' "$SESSION_DIR.jsonl" | sort -u
for t in "$SESSION_DIR"/subagents/agent-*.jsonl; do
  agent=$(jq -r '.agentType // "-"' "${t%.jsonl}.meta.json" 2>/dev/null)
  jq -r --arg a "${agent:--}" 'select(.type == "assistant")
    | [$a, .message.model, (.effort // "-")] | @tsv' "$t" | sort -u
done
```

Each line is `agent  model  effort`. Compare it with the agent's tier. Model
equality alone proves nothing: an agent whose tier matches the lead's model
shows that model whether or not the pin applied. To test a pin, run under a
lead whose model differs from the agent's tier (for example a `sonnet` lead for
a haiku or opus agent). Then an agent showing its tier's model and effort was
pinned, and an agent showing the lead's model was not pinned, or ran under
`CLAUDE_CODE_SUBAGENT_MODEL_FORCE`.

For the drain, read the newest file in
`~/.claude/projects/<project-slug>/compound-staging/drain-logs/`:

- `model=` on the dispatch line.
- The `drain claude exited <rc>` line.
- Either `drain took <n> of <n> dispatched entries` or the `WARNING drain left
  all` line.

## Rollback

- **One agent:** restore `model: inherit`, drop its `effort:`, add a
  `MODEL_RULE_ALLOWLIST` entry with the reason, and add a "Model: `inherit` by
  design" note at the top of the agent body (V3 checks only the allowlist, so
  it passes without the note). Or move it up a tier. Frontmatter changes ship
  with a plugin patch release.
- **The drain:** export `COMPOUND_DRAIN_MODEL=sonnet` (or `opus`). No release
  is needed. Restoring the old unpinned behaviour exactly needs a code revert.
- **CI:** delete the `claude_args` line from the workflow.
- **Every subagent at once, locally:** set `CLAUDE_CODE_SUBAGENT_MODEL` and
  `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1`.

Watch for two weeks after a release:

- Codex contract parse failures in `/council` and `/review:pr`.
- Drain-log `WARNING drain left all` lines or non-zero exits.
- Linear or ruvector agents answering in prose without calling their tool.

## Phase 2 and 3 entry gates

**Phase 2** swaps ship only after a replay shows they hold. First build a
per-reviewer yield rollup from the review ledger's `reviewers` array, then
grade each swap deterministically against golden findings, not with an Opus
judge. The ledger is per clone and pruned when a PR closes, so the rollup
needs an export or retention step first. Until that rollup exists,
`scripts/eval/model-swap/` grades swaps against planted defects in replayed
PRs and against a lizard golden set for scanners. Candidates:

- **Sonnet → Haiku:**
  - scan-verifier, after `/semgrep:fix` handles a refused verifier.
  - git-history-analyzer.
  - staging-promoter.
  - test-runner.
  - codex-reviewer and codex-analyst, after 5 of 5 contract checks and the
    Step 6 vitest.
- **Opus → Sonnet:** audit-synthesizer and research-conductor. Grading a
  synthesizer needs a rubric beyond planted defects.
- **Other:**
  - gemini-reviewer and opencode-reviewer effort to `medium`.
  - The compounder's Category Classifier, after its category definitions
    are sharpened; its Solution Extractor and Prevention Strategist are
    synthesis.
  - Conditional Opus reviewers in `/flow:work`.

**Phase 3** tightens the plugin-markdown reviewer triggers in `/review:pr`.
The router stays deferred. If revisited, use an add-only Haiku pass on top of
a static floor.
