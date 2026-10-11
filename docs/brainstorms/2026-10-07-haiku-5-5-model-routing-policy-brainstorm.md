# Haiku 5.5 model-routing policy

Date: 2026-10-07
Status: brainstorm (input to `/flow:plan`)
Source: a downloaded, unreviewed ideation write-up, "Haiku 5.5 Routing Review" (not committed). Its claims were checked against this repo and the official docs; unverified ones are listed under Open Questions.

## What We're Building

A model and effort routing policy for the `plugins/` agents in this repo, rolled out in phases so that nothing ships on unpublished evidence.

Scope: yellow-plugins only. The goal-gen changes in the source write-up belong to the separate `yellow-goal` repo and are excluded.

User context that shapes the policy:
- Claude Max subscription, OAuth login, Anthropic first-party only. The `haiku` alias resolves to Haiku 5.5 (needs Claude Code v2.1.293 or later). The Bedrock/Vertex/Foundry caveat reduces to one line in the docs.
- Usual lead session is Opus, so every `inherit` agent runs on Opus today. Savings show up as usage-limit headroom, not dollars, so Phase 2 is lower urgency than Phase 1.

### Tiers

| Tier | Model / effort | Work shape | Examples |
|---|---|---|---|
| T1 | haiku / low | Calls one CLI or MCP tool and reformats, scores one item, reports status | linear-issue-loader, ruvector agents, test-reporter, staging-scorer |
| T2 | haiku / medium | Long procedural wrappers, rule matching, extraction | codex wrappers, gemini/opencode wrappers, learnings-researcher, coherence-reviewer |
| T3 | sonnet / medium to high | Default. Edits code, judges correctness or security, writes prose | fixers, researchers, most review personas |
| T4 | opus / high to xhigh | Synthesis and adversarial review. Always set effort explicitly | adversarial-reviewer, thermonuclear-reviewer, architecture-strategist, security-sentinel |

Rules:
- The tier follows what the agent does with its output.
- Haiku stays out of security review, code-writing fixers and synthesizers.
- `inherit` is a deliberate, documented choice.
- Fable never appears in frontmatter.
- Every pinned `model:` gets an explicit `effort:`.

## Why This Approach

Chosen: Approach A, a phased, evidence-gated rollout.

- Phase 1 fixes what is silently wrong today and needs no eval.
- Phase 2 holds the swaps that could lose review quality. Each ships only after a ledger-labeled replay.
- Phase 3 holds structural work, with the router deferred.

Rejected:
- **B (minimal drift fix only):** leaves 18 `inherit` agents on an Opus lead with no policy to guide new agents.
- **C (everything now):** about 9 plugins touched at once, swap quality unproven, and a router with a recall risk and no published evidence.

Research that drove the choice:
- The repo's current state matches the source write-up. There are 78 agents: 45 sonnet, 18 inherit, 9 opus, 6 haiku. 61 have no `effort:`. All eight spot-checked claims were true.
- Official docs confirm that Haiku 5.5 supports effort with a `medium` default. They also warn that at `low` effort on long agent prompts the model is more likely to skip a search, stop early or skip a check. This supports raising the long wrappers to medium.
- No published study compares static rules, an LLM router and a hybrid for choosing review personas. Vendors mostly fan out broadly and filter afterwards.
- Small-to-large cascades save cost only when the escalation check is more reliable than the cheap model. Code review has no cheap check for "found nothing".
- A judge from the same model family as the output is biased. With an Opus lead and Anthropic-only models, grade replays against golden findings deterministically instead.

## Key Decisions

### Decided with the user
1. Scope is the full policy for this repo. goal-gen is excluded.
2. The `inherit` question is evaluated agent by agent. Whether the validator changes follows from that evaluation.
3. The review router is deferred. First tighten the plugin-markdown triggers and build a per-reviewer yield rollup from the review ledger. Opus-to-Sonnet moves for the two opus/high reviewers ship only after an eval passes.
4. Swaps are listed as candidates and shipped only after a ledger-labeled replay.
5. Approach A.

### Phase 1: no eval needed
- Add explicit `effort: high` to architecture-strategist, performance-oracle and security-sentinel. Their `opus` alias now resolves to a model whose default effort is `medium`.
- Add explicit effort to staging-scorer (haiku/low) and coherence-reviewer (haiku/medium).
- Move the `inherit` agents per the verdict table below.
- Add `--model` to both `claude -p` calls in `plugins/yellow-core/hooks/scripts/session-start.sh` (lines 361 and 367). The source suggests haiku, falling back to sonnet if dispatch proves flaky. Test one manual drain first.
- Pin `claude_args: --model sonnet` in the claude-code-action workflows. Verify the input syntax during planning.
- Docs:
  - Correct the four stale "Haiku 4.5 ignores effort" statements: `AGENTS.md:313`, `docs/plugin-template.md:450`, the frontmatter catalog `:77`, and `docs/research/all-possible-subagent-frontmatter-config.md:134`.
  - Resolve the default-effort contradiction. The research doc says the default is `medium`; the catalog says it inherits from the caller.
  - Replace `docs/research/model-selection-token-context-optimization.md`, a stale snapshot, with the tier policy.
  - Note the v2.1.293 minimum.
- Add a changeset for each affected plugin.

### Proposed verdicts for the 18 `inherit` agents
These are proposals from the codebase research. They are not user-approved decisions, and each is open to review in `/flow:plan`.

| Agent | Evidence | Proposed |
|---|---|---|
| codex-reviewer, codex-analyst | Wrap `codex exec` read-only; long prompt; reviewer returns the 6-key contract | haiku/medium, after a 5-run contract-parse spot check |
| codex-executor | Workspace-write rescue; makes decisions for the lead | Keep `inherit`, record the reason |
| linear-issue-loader | One MCP read | haiku/low |
| linear-pr-linker | One MCP write, confirms with the user first | haiku/low |
| linear-explorer | Search plus duplicate judgment | haiku/medium |
| ruvector-memory-manager, ruvector-semantic-search | MCP store and recall | haiku/low |
| app-discoverer | Read-only config and route detection | haiku/medium |
| test-reporter | Formats results and files issues | haiku/low |
| test-runner | Browser-driven testing | sonnet/medium now; haiku/medium is a Phase 2 candidate |
| failure-analyst | Diagnosis; delegates to runner-diagnostics | sonnet/medium; drop its allowlist entry |
| workflow-optimizer | Edits workflow YAML | sonnet/medium; revisit its "quality scales with the parent model" allowlist reason |
| runner-diagnostics | SSH and CLI diagnosis; in `maintenance/`, so the validator never sees it | sonnet/medium |
| code-researcher | Multi-source research synthesis | sonnet/medium |
| finding-fixer | Edits code, security fixes | sonnet/medium; never haiku |
| claude-reviewer (council) | Stands for the lead's model lineage | Keep `inherit`, record the reason |
| devin-orchestrator | Plan, implement, review loop for the lead | Keep `inherit` (already allowlisted) |

Result: 15 agents move off `inherit` and 3 stay with a recorded reason.

Validator consequence, for decision in `/flow:plan`:
- V3 fires on nothing today. It covers only `scanners/` and `ci/`, and both `ci/` inherit agents are allowlisted.
- After these verdicts only 3 `inherit` agents remain, all justified. Generalizing V3 to every directory with an allowlist would therefore be low-noise.
- A new advisory for "pinned model without explicit `effort:`" would codify the new rule.
- The source's "haiku plus Edit/Write on a fix/security/resolver name" advisory has no current violators and is deferred as YAGNI.

### Phase 2: replay-gated candidates
Each ships only after replay shows it holds.
- Wrapper effort: gemini-reviewer and opencode-reviewer, low to medium.
- Sonnet to Haiku: scan-verifier (held back from Phase 1 because the claim that Haiku 5.5's cyber classifiers refuse security tooling is unverified), comment-analyzer, project-standards-reviewer, git-history-analyzer, the complexity/duplication/ai-pattern scanners, and staging-promoter.
- test-runner to haiku/medium.
- knowledge-compounder's six extractors as typed haiku/medium agents.
- Opus to Sonnet: agent-cli-readiness-reviewer and agent-native-reviewer (sonnet/high), audit-synthesizer, and research-conductor (sonnet/medium, spawning an Opus synthesizer only for complex queries).
- A typed sonnet/high judge for the optimize skill.
- Conditional Opus reviewers in `/flow:work`. Today security-sentinel and performance-oracle run on every non-trivial run.

Replay prerequisites:
- The review ledger already records a `reviewers` array per finding but nothing aggregates it. Build a per-reviewer yield rollup first.
- The ledger is per clone and pruned when a PR closes. An export or retention step is needed.
- Past PRs cannot be labeled; labels accrue going forward.
- Grade against golden findings deterministically, not with an Opus judge.

### Phase 3: structural
- Tighten the plugin-markdown reviewer triggers. Four path globs now fire four reviewers on every plugin-markdown PR, two of them opus/high, although those two target CLI and agent-tool surfaces.
- Router: deferred. If revisited, use a static floor plus an add-only Haiku pass that logs the selected set and the reasons.
- Validator changes per the consequence above.

### Not in scope
- goal-gen (`yellow-goal` repo).
- Bedrock/Vertex/Foundry handling beyond a one-line docs note.
- The opt-in Haiku Explore override (YAGNI, not discussed).

## Open Questions

1. When a subagent has no frontmatter `effort:` and runs on a different model than the session, which level applies? Not confirmed in the docs; check the `effort` and `message.model` fields in the session transcript `.jsonl`. Explicit effort on every pinned agent sidesteps this.
2. How do Max usage limits weight Haiku against Opus? Docs say only "less", with no multiplier. Opus-lead `inherit` is the likely main driver.
3. Do Haiku 5.5's stricter cyber classifiers refuse security tooling? This is a claim from the source write-up and is unverified.
4. What happens for users on Claude Code older than v2.1.293? Does `haiku` still map to 4.5 for them, and how should the docs say so? Also unconfirmed: whether OAuth subscription logins count as the "Anthropic API" alias row. This was inferred.
5. The source tier table puts learnings-researcher in T2 (haiku/medium) but it is haiku/low today and the per-agent table does not change it. Should it move?
6. Is the replay set feasible given a per-clone ledger that is pruned on PR close, and who owns the export step?
7. What is the exact claude-code-action input syntax for the model pin? It was not checked.
8. Should the V3 generalization and the pinned-model-needs-effort advisory ship, now that only 3 `inherit` agents remain?
9. The source's claim that the `opus` alias now resolves to Opus 5.5 with default effort `medium` was only partly corroborated. Confirm before relying on it for the Phase 1 effort fix.
