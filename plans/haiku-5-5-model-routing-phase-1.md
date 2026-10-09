# Feature: Haiku 5.5 model-routing policy — Phase 1

> **Status (2026-10-07):** Planned. Source:
> `docs/brainstorms/2026-10-07-haiku-5-5-model-routing-policy-brainstorm.md`.
> Phase 2 (replay-gated swaps) and Phase 3 (trigger tightening; router
> deferred) are tracked under "Follow-ups" and are not implemented here.

## Overview

Every `model: inherit` agent runs on the lead session's model, which for this
user is Opus. 61 of 78 agents set no `effort:`. A subagent without `effort:`
inherits the session's effort, and an Opus 5.5 session defaults to `medium`,
so the three Opus reviewers the repo treats as high-effort run at medium
unless the user has raised the session level. Phase 1 fixes what is silently wrong today with changes that
need no replay eval. It pins model and effort per the four-tier policy, moves
15 of 18 `inherit` agents, pins the compound-drain and CI models, adds two
validator advisories, and corrects stale "Haiku 4.5 ignores effort" docs.

## Problem Statement

### Current Pain Points

- 18 agents use `model: inherit`. On an Opus lead, single-MCP-call wrappers
  such as `linear-issue-loader` run on Opus.
- `security-sentinel`, `performance-oracle` and `architecture-strategist` are
  `opus` with no `effort:`, so they inherit the session's effort, and an Opus
  5.5 session defaults to `medium` (code.claude.com/docs/en/sub-agents,
  /model-config).
- The SessionStart compound drain (`session-start.sh:361-371`) passes no
  `--model`, so it runs on the user's default model.
- `claude.yml` and `claude-code-review.yml` pass no model.
- Four docs say Haiku ignores effort. Haiku 5.5 supports `low`..`max`.
- Validator rule V3 covers only `scanners/` and `ci/`, and both `ci/` inherit
  agents are allowlisted, so it fires on nothing.
  `maintenance/runner-diagnostics.md` escapes it entirely.

### User Impact

The user is on Max with OAuth, first-party only. Savings show up as
usage-limit headroom, not dollars. The quality-relevant fix is explicit
`effort: high` on the Opus reviewers.

## Proposed Solution

### Key Design Decisions (user-confirmed 2026-10-07)

1. **Tiers:**
   - T1: `haiku`/`low`
   - T2: `haiku`/`medium`
   - T3: `sonnet`/`medium`–`high`
   - T4: `opus`/`high`–`xhigh`

   Every pinned `model:` gets an explicit `effort:`. Fable never appears in
   frontmatter. Haiku stays out of security review, code-writing fixers and
   synthesizers.
2. **Old clients:** document the version floor and accept degraded mode. The
   `haiku` alias resolves to Haiku 5.5 from Claude Code v2.1.293, `sonnet` from
   v2.1.284 and `opus` from v2.1.280. Older clients get Haiku 4.5, which runs
   the agent but ignores `effort:`. All hosts are the user's own; check
   `claude --version` on each.
3. **Validator:** do both now.
   - Generalize V3 to every agent subdirectory.
   - Add a new `[V5 advisory]` for a pinned `model:` without `effort:`.

   Both are warnings only, so they never change the exit code.
4. **Drain:** `--model sonnet` by default, overridable with
   `COMPOUND_DRAIN_MODEL` so a rollback needs no release. Validate the value
   against an allowlist pattern, and fall back to `sonnet` on a bad value
   with a warning in `DRAIN_LOG`.
5. **CI:** add `claude_args: --model sonnet` to both workflows. The action's
   `model:` input is deprecated.
6. **Inherit verdicts:**
   - 15 move.
   - 3 stay `inherit` with a recorded reason: `codex-executor`,
     `claude-reviewer` and `devin-orchestrator`.

<!-- deepen-plan: external -->
> **Research:** The sub-agents frontmatter table says `effort`: "Overrides
> the session effort level. Default: inherits from session." Pinned agents
> without `effort:` therefore run at the lead's effort, not at the pinned
> model's `medium` default. The Overview's claim that the "Opus reviewers run
> at medium" holds only when the lead is at its default. If the user has
> raised Opus to `high`/`xhigh`, they already inherit that. Either way an
> explicit `effort:` makes the level deterministic. Two gotchas: a top-level
> `effortLevel` setting "doesn't count for Opus 5.5" (use
> `modelSettings.claude-opus-5-5.effortLevel`), and `maxEffortLevel` caps
> frontmatter effort. Sources: https://code.claude.com/docs/en/sub-agents and
> https://code.claude.com/docs/en/model-config
<!-- /deepen-plan -->

### Trade-offs Considered

- **Long wrappers on sonnet instead of haiku:** rejected. Old clients are the
  user's own machines, so the floor is documentable.
- **Full model IDs (`claude-haiku-5-5`):** rejected. Aliases follow future
  upgrades, and an unknown full ID errors on older clients.
- **Drain on haiku:** rejected for Phase 1. A 50-turn dispatch prompt on low
  effort risks early stops. Haiku is a Phase 2 candidate behind the override.

## Implementation Plan

### Phase 1.0: Verification tooling (do first; gates the doc wording)

- [ ] 1.0.1: Write a transcript check that prints, for each subagent in a
      session, the `message.model` and effort actually used. Run the `jq`
      one-liner from the research note below over the per-agent transcripts
      at `~/.claude/projects/<slug>/<session-id>/subagents/agent-*.jsonl`,
      not the session JSONL. `/tasks` shows effort only when the definition
      sets `effort:`, so it cannot confirm inherited effort. Put the command
      in the new policy doc's "Verify" section.
- [ ] 1.0.2: Run the check once on a current client (≥ v2.1.293). Spawn one
      agent per tier (T1 `linear-issue-loader`, T2 `coherence-reviewer`, T3
      `failure-analyst`, T4 `security-sentinel`) after their edits land.
      Confirm the documented behavior (brainstorm Open Question 1, answered
      by the sub-agents docs): an agent with a pinned `model:` and no
      `effort:` inherits the session's effort. Also confirm that each pinned
      `effort:` overrides it. If the transcript contradicts the docs, record
      that and word 1.4.4 to match what was observed.
- [ ] 1.0.3: Confirm the action's bundled CLI is ≥ v2.1.284, so that `sonnet`
      resolves to 5.5. Read the run log of the first CI run after 1.3.

<!-- deepen-plan: external -->
> **Research:**
> - **1.0.1:** subagent transcripts live at
>   `~/.claude/projects/<slug>/<session-id>/subagents/agent-<id>.jsonl` and
>   are marked `isSidechain: true`. The model is in `message.model` on
>   `type=="assistant"` records. A top-level `effort` field is
>   community-reported (anthropics/claude-code#81677) but undocumented. Check
>   it exists first with `jq -c 'select(.type=="assistant")|keys' <file> | head -1`.
>   One-liner:
>   `jq -r 'select(.type=="assistant") | [input_filename, .message.model, (.effort // "-")] | @tsv' ~/.claude/projects/"$SLUG"/"$SESSION"/subagents/agent-*.jsonl | sort -u`.
>   `/tasks` (v2.1.242+) shows the model on each subagent row, and effort only
>   when the definition sets `effort:`.
> - **1.0.2:** Open Question 1 is answered by the docs: effort inherits from
>   the session (see the Proposed Solution note). Reduce 1.0.2 to confirming
>   it on one agent. The unresolved part is whether a pinned model's own
>   `modelSettings` entry beats the inherited level (#91415).
> - **1.0.3:** claude-code-action's `base-action/action.yml` on main hardcodes
>   `CLAUDE_CODE_VERSION="2.1.293"`, which meets every alias floor. Because
>   `@v1` floats, pin a release tag or SHA (e.g. `@v1.0.237`) to freeze it.
>   Source: https://raw.githubusercontent.com/anthropics/claude-code-action/main/base-action/action.yml
<!-- /deepen-plan -->

### Phase 1.1: Agent frontmatter (one commit per plugin, revertable alone)

The Opus reviewers and existing haiku agents get explicit effort:

- [ ] 1.1.1: `yellow-core`:
  - `agents/review/security-sentinel.md` → `effort: high`
  - `agents/review/performance-oracle.md` → `effort: high`
  - `agents/review/architecture-strategist.md` → `effort: high`
  - `agents/workflow/staging-scorer.md` → `effort: low`
- [ ] 1.1.2: `yellow-docs`: `agents/review/coherence-reviewer.md` →
      `effort: medium`.

Inherit moves (all currently `model: inherit` on line 4, with no effort):

| # | File (`plugins/…`) | New | Notes |
|---|---|---|---|
| 1.1.3 | `yellow-linear/agents/workflow/linear-issue-loader.md` | haiku/low | ToolSearch then MCP read; smoke test (1.5.2) |
| 1.1.4 | `yellow-linear/agents/workflow/linear-pr-linker.md` | haiku/low | Only T1 write path; smoke test must show the AskUserQuestion confirm fires first. If it doesn't, use haiku/medium |
| 1.1.5 | `yellow-linear/agents/research/linear-explorer.md` | haiku/medium | |
| 1.1.6 | `yellow-ruvector/agents/ruvector/memory-manager.md` | haiku/low | |
| 1.1.7 | `yellow-ruvector/agents/ruvector/semantic-search.md` | haiku/low | |
| 1.1.8 | `yellow-browser-test/agents/testing/app-discoverer.md` | haiku/medium | |
| 1.1.9 | `yellow-browser-test/agents/testing/test-reporter.md` | haiku/low | |
| 1.1.10 | `yellow-browser-test/agents/testing/test-runner.md` | sonnet/medium | haiku is a Phase 2 candidate |
| 1.1.11 | `yellow-ci/agents/ci/failure-analyst.md` | sonnet/medium | Spawns runner-diagnostics |
| 1.1.12 | `yellow-ci/agents/ci/workflow-optimizer.md` | sonnet/medium | Edits workflow YAML |
| 1.1.13 | `yellow-ci/agents/maintenance/runner-diagnostics.md` | sonnet/medium | Was outside V3's scope |
| 1.1.14 | `yellow-research/agents/research/code-researcher.md` | sonnet/medium | |
| 1.1.15 | `yellow-semgrep/agents/semgrep/finding-fixer.md` | sonnet/medium | Never haiku |
| 1.1.16 | `yellow-codex/agents/review/codex-reviewer.md` | haiku/medium | Gated on 1.5.1; separate commit |
| 1.1.17 | `yellow-codex/agents/research/codex-analyst.md` | haiku/medium | Gated on 1.5.1; separate commit |

Kept `inherit`, with the reason recorded:

- [ ] 1.1.18: Add a one-line body note under the frontmatter, in the form
      "Model: `inherit` by design — <reason>". Use a body note rather than a
      YAML comment, because the parser treatment of comments is unverified.
  - `yellow-codex/agents/workflow/codex-executor.md`: workspace-write rescue
    that makes decisions for the lead.
  - `yellow-council/agents/review/claude-reviewer.md`: stands for the lead's
    model lineage in the council.
  - `yellow-devin/agents/workflow/devin-orchestrator.md`: plan, implement and
    review loop that acts for the lead.
<!-- deepen-plan: codebase -->
> **Codebase:** All three files close their frontmatter with `---`, and no
> validator rule rejects a one-line body note, so the body-note choice is
> safe. `claude-reviewer.md` is already 407 lines, over the 300-line RULE 21
> agent ceiling (`scripts/validate-agent-authoring.js:262,1602`). That warning
> already exists, so one more line is harmless. `codex-executor.md` (251) and
> `devin-orchestrator.md` (247) stay under the ceiling. The frontmatter counts
> are confirmed: 78 agents, 61 without `effort:`, 18 `inherit` (all on line
> 4). The 1.1.1/1.1.2 preconditions hold, and `learnings-researcher` is
> already `haiku`/`low` (`learnings-researcher.md:4-5`).
<!-- /deepen-plan -->

- [ ] 1.1.19: Leave `learnings-researcher` at haiku/low and record why in the
      policy doc: it is a recall wrapper with a strict output contract. This
      resolves Open Question 5. Revisit it in Phase 2 if the yield rollup shows
      missed learnings.

### Phase 1.2: Validator (`scripts/validate-agent-authoring.js`)

- [ ] 1.2.1: Generalize V3 (lines 538-552). Drop the
      `subdir === 'scanners' || subdir === 'ci'` clause, and reword the
      message so it no longer interpolates `subdir`: "model: inherit — make an
      explicit model choice, or add the file to MODEL_RULE_ALLOWLIST with a
      reason." Update the rule comment block at lines 112-117.
- [ ] 1.2.2: Add V5 after V4. When `modelVal`, `modelVal !== 'inherit'` and
      `effortVal === null` all hold and the file is not allowlisted, push
      `[V5 advisory] <path>: model: <m> pinned without effort: — it inherits
      the session's effort; set it explicitly`. It is a warning only. V5
      honors `MODEL_RULE_ALLOWLIST` like V3 and V4, because the shared
      `allowlisted` flag exempts a file from every advisory. That keeps
      `knowledge-compounder` (sonnet, no effort, allowlisted for V4) out of V5.
      Say so in the rule comment.
<!-- deepen-plan: codebase -->
> **Codebase + Research:** Fix the V5 message wording. The subagent default
> is documented ("inherits from session"), so it isn't "undocumented".
> Suggested wording: `pinned without effort: — it inherits the session's
> effort; set it explicitly`. Decide whether V5 honors `MODEL_RULE_ALLOWLIST`.
> The only live case is `knowledge-compounder` (sonnet, no effort,
> allowlisted for V4). Whether it shows up in V5 depends on that choice, so
> document the decision in the rule comment.
<!-- /deepen-plan -->

- [ ] 1.2.3: Edit `MODEL_RULE_ALLOWLIST` (lines 139-157):
  - Remove `failure-analyst` and `workflow-optimizer`. They are no longer
    `inherit`, and neither name matches V4's pattern.
  - Keep `devin-orchestrator` and `knowledge-compounder`; V4 needs them.
  - Add `codex-executor` and `claude-reviewer`, each with a reason comment.
- [ ] 1.2.4: Update `tests/integration/validate-agent-authoring-model-effort-rules.test.ts`:
  - Header comment (lines 1-14).
  - Invert the line-295 test, "does NOT warn on agents/workflow/", so it now
    warns.
  - Add a `maintenance/` V3 case.
  - Rework the failure-analyst and workflow-optimizer allowlist tests (lines
    306, 317) to use an entry that is still allowlisted.
  - Add V5 tests: warns when a pinned model has no effort; silent when effort
    is set; silent on `inherit`; silent when allowlisted. Use
    `agentBody`/`writeAgent`/`runValidator`.
- [ ] 1.2.5: The baseline is 43 agents that pin a model without `effort:`
      today (V5 doesn't exist yet, so the tool can't report it). After 1.1,
      18 inherit agents drop to 3, all allowlisted, so V3 must report 0. Check
      with `pnpm validate:agents 2>&1 | grep -c 'V3 advisory'`. V5 must report
      37: the remaining sonnet agents without effort, minus the allowlisted
      `knowledge-compounder`. Those belong to a Phase 2 sweep; list them in the
      PR body and don't fix them here.

<!-- deepen-plan: codebase -->
> **Codebase:**
> - **1.2.3:** `codex-executor` and `claude-reviewer` need allowlist entries
>   only for the generalized V3. Their names don't match V4's pattern.
>   Confirm with `git grep -n MODEL_RULE_ALLOWLIST` that only the validator
>   and its test reference the Set.
> - **1.2.5:** Today 43 agents pin a model without `effort:`: 38 sonnet,
>   3 opus and 2 haiku. The plan fixes the 5 opus/haiku ones, so V5 will
>   report 38. If V5 honors the allowlist, `knowledge-compounder` drops out
>   and it reports 37, not "roughly 40". The "before" baseline is 0 because
>   V5 doesn't exist yet. Use the 43 count as the baseline in the PR body.
>   No CI step or test asserts on warning output: `lint-plugins.sh` checks
>   only `description`/`tools:`.
> - **1.2.4:** The line numbers are accurate (header 1-14, V3 `workflow/`
>   test ~295, allowlist tests ~306/~317). The `agentBody`/`writeAgent`/
>   `runValidator` helpers are used at lines 285-330.
<!-- /deepen-plan -->

### Phase 1.3: Drain and CI pins

- [ ] 1.3.1: In `plugins/yellow-core/hooks/scripts/session-start.sh`, near
      line 341 next to `DRAIN_TIMEOUT_S`, add:

      ```sh
      DRAIN_MODEL="${COMPOUND_DRAIN_MODEL-sonnet}"
      case "$DRAIN_MODEL" in
        ''|*[!a-z0-9-]*) DRAIN_MODEL_REJECTED=1 ;;
        claude-|*--*|*-) DRAIN_MODEL_REJECTED=1 ;;
        haiku|sonnet|opus|claude-*) DRAIN_MODEL_REJECTED=0 ;;
        *) DRAIN_MODEL_REJECTED=1 ;;
      esac
      ```

      The default uses `-` (no colon). Unset silently defaults to sonnet with
      no warning; set-but-empty (`COMPOUND_DRAIN_MODEL=`) reaches the `''` arm
      and is rejected and logged. The second arm mirrors the full-ID shape
      of `MODEL_VALUE_PATTERN` in `scripts/validate-agent-authoring.js`
      (non-empty segments joined by single hyphens), so `claude-`,
      `claude-opus--5` and `claude-opus-5-` are rejected rather than reaching
      `claude -p`.

      Put the block after `DRAIN_LOG` is created (`:314-316`). When
      `DRAIN_MODEL_REJECTED=1`, append a warning to `DRAIN_LOG` before
      resetting: `[compound-drain] COMPOUND_DRAIN_MODEL rejected (only
      haiku|sonnet|opus|claude-<id> allowed); using sonnet`. Then set
      `DRAIN_MODEL=sonnet`. Don't echo the raw value, which is untrusted. A
      mistyped rollback then shows up in the log instead of failing silently.
      The negated class rejects IDs with a `[1m]` suffix. That's acceptable,
      because the drain doesn't need 1M context.

      Add `--model "$DRAIN_MODEL" \` to both branches, the `timeout` one and
      the plain one. Do not add `--bare`, because it drops plugin discovery and
      the drain calls `staging-reviewer` (see
      `docs/solutions/code-quality/claude-code-bare-flag-and-hook-recursion-guard.md`).
      After each `claude -p` call, append the exit status to `DRAIN_LOG`
      (`[compound-drain] claude exited <rc>`). Today a non-zero exit, such as
      a model the client rejects, leaves only the CLI's stderr behind, and the
      1.3.3 pass criterion and the rollback watch both depend on seeing it.
<!-- deepen-plan: codebase -->
> **Codebase:** An earlier draft matched `claude-[a-z0-9-]*` with no
> negated-class arm in front, so `claude-x; rm` passed. The block above now
> follows the negated-class precedent at `session-start.sh:323-325`
> (`''|*[!0-9]*|0)`): the `*[!a-z0-9-]*` arm rejects that value before the
> `claude-*` arm, and every rejection sets `DRAIN_MODEL_REJECTED=1` so the
> warning is logged. Keep the `claude-x; rm` test case as a regression. Don't gate `COMPOUND_DRAIN_MODEL` on
> `BATS_VERSION` the way `COMPOUND_DRAIN_CMD` (`:254`) and
> `COMPOUND_STAGING_REVIEWER_AGENT` (`:273`) are gated. It's a user-facing
> rollback knob, not a binary-hijack vector. Insertion points are confirmed:
> `DRAIN_TIMEOUT_BIN`/`DRAIN_TIMEOUT_S` at `:340-341`, branches at `:360-371`.
<!-- /deepen-plan -->

- [ ] 1.3.2: In `plugins/yellow-core/tests/compound-session-start-hook.bats`,
      add tests that grep the stub's recorded argv:
  - `--model sonnet` by default (unset, no rejection warning).
  - `COMPOUND_DRAIN_MODEL=haiku` gives `--model haiku`.
  - An invalid value (`'x; rm'`, `claude-x; rm`, set-but-empty
    `COMPOUND_DRAIN_MODEL=`, and the malformed IDs `claude-`,
    `claude-opus--5`, `claude-opus-5-`) falls back to
    `--model sonnet`, and the rejection warning is in `DRAIN_LOG`.
  - `--bare` is absent and `--max-turns 50` is still present.

  The suite runs only the branch the host takes, which in practice is the
  `timeout` one. Don't build a restricted `PATH`. Add a static test that
  greps `session-start.sh` and asserts both `claude -p` invocations carry
  `--model "$DRAIN_MODEL"`, so the two branches can't drift apart.
<!-- deepen-plan: codebase -->
> **Codebase:** The stub (`compound-session-start-hook.bats:14-27`) writes
> `"$*"` to `$STUB_MARKER` once, so read it after `_wait_for_stub`.
> `DRAIN_TIMEOUT_BIN` comes from `command -v timeout`
> (`session-start.sh:340`), and the suite never changes `PATH`, so today only
> the host's branch runs. Covering the no-timeout branch needs a restricted
> `PATH`: a symlink dir with bash, jq, date and the hook's other tools but
> no `timeout`. Budget for that, or drop the both-branches requirement and
> rely on the two branches being textually identical.
<!-- /deepen-plan -->

- [ ] 1.3.3: Run one real drain against a non-empty staging dir. Pass means
      items are processed, the exit code is 0, the JSON result line in
      `DRAIN_LOG` parses (`grep -m1 '^{' "$DRAIN_LOG" | jq -e .`;
      `--output-format json` emits one line), the `[compound-drain] claude
      exited 0` line is present, and there is no rejection warning. Record the result in the PR.
- [ ] 1.3.4: In `.github/workflows/claude-code-review.yml` (`with:` near line
      40), add
      `claude_args: --model sonnet  # model pin: docs/<policy doc>`.
- [ ] 1.3.5: In `.github/workflows/claude.yml` (`with:` near line 35), replace
      the commented `claude_args` example at lines 46-49 with a live
      `claude_args: --model sonnet`. Keep a comment showing where
      `--allowed-tools` would be appended.
- [ ] 1.3.6: Run `actionlint` on both files if it is available. After merge,
      confirm in the run logs that the model is Sonnet 5.5 (this is 1.0.3).

<!-- deepen-plan: codebase -->
> **Codebase:** `actionlint` isn't installed here (`which actionlint` is
> empty), so 1.3.6's "if available" path is live. Use `pnpm dlx` or skip and
> rely on the first CI run. Line numbers are confirmed: `claude-code-review.yml`
> has no `claude_args` (its `with:` block ends ~line 50), and `claude.yml`'s
> commented example is at 46-49.
<!-- /deepen-plan -->

<!-- deepen-plan: external -->
> **Research:** The action docs mark the `model:` input "DEPRECATED: Use
> `claude_args` with `--model` instead". `claude_args` goes straight to the
> CLI, and nothing ties model choice to the auth type. Community issues
> (claude-code-action#1462, #957) show OAuth/Max runs on non-default models.
> No official example pairs `claude_code_oauth_token` with an alias, so that
> combination is inferred. A multi-line form also works:
> `claude_args: |` followed by `--model sonnet`. Source:
> https://github.com/anthropics/claude-code-action/blob/main/docs/usage.md
<!-- /deepen-plan -->

### Phase 1.4: Docs (no changeset; root and `docs/`)

- [ ] 1.4.1: Write the policy doc at `docs/research/model-routing-policy.md`.
      It covers:
  - The tier table, the rules and the per-agent verdicts with reasons.
  - Requirements: the client floor, and a one-line Bedrock/Vertex/Foundry note
    that `haiku` is still 4.5 there.
  - A "Verify" section with the 1.0.1 command.
  - Rollback steps.
  - Phase 2 and 3 entry gates.
- [ ] 1.4.2: Supersede `docs/research/model-selection-token-context-optimization.md`
      without deleting it, because CHANGELOGs, `plans/complete/` and the
      2026-05-08 brainstorm link to it. Add a top banner: "Superseded
      2026-10-07 by model-routing-policy.md; kept for history."
- [ ] 1.4.3: Fix the stale Haiku statements:
  - `AGENTS.md:313`
  - `docs/plugin-template.md:450-451`
  - `docs/solutions/code-quality/subagent-frontmatter-field-catalog.md:77`
  - `docs/research/all-possible-subagent-frontmatter-config.md:134`. Also fix
    "haiku = claude-haiku-4-5" here.

  The new wording: Haiku 5.5 supports `low`..`max`, and only Haiku 4.5 (on
  clients older than v2.1.293, or on Bedrock/Vertex/Foundry) ignores effort.
  Separately,
  `docs/research/best-practices/background-compounding-triggers-best-practices.md:19`
  cites Haiku 4.5 *pricing*, not effort. Refresh its version reference, or
  mark it dated, rather than applying the effort wording.
- [ ] 1.4.4: Resolve the default-effort statements:
  - Catalog lines 53 and 82, and the effort tier rule at 65-67.
  - Research doc: the default column near 304-308, line 309 and line 694.

  The wording: "A subagent without `effort:` inherits the session's effort.
  The session default is the model's (`medium` on the 5.5 models). Set
  `effort:` explicitly on every pinned agent." Adjust it only if 1.0.2
  observes otherwise. Bump the catalog's "last verified" note (line 28).
- [ ] 1.4.5: Add the v2.1.293 floor note to `AGENTS.md`'s model/effort
      section, linking to the policy doc.
- [ ] 1.4.6: Run `rg -n "Haiku 4\.5|ignores .?effort" AGENTS.md docs/ --glob '!docs/brainstorms/**' --glob '!docs/research/model-selection-token-context-optimization.md'`.
      Only qualified mentions may remain. The superseded doc is excluded
      because its banner covers it.

<!-- deepen-plan: codebase -->
> **Codebase:**
> - **1.4.3 line corrections:**
>   - In `docs/plugin-template.md` the claim spans lines 450-451 ("Haiku" ends
>     450, "4.5 ignores it." is 451).
>   - `background-compounding-triggers-best-practices.md:19` cites Haiku 4.5
>     *pricing*, not effort, so it needs a version or pricing refresh rather
>     than the effort wording.
>   - The other lines are confirmed.
> - **1.4.4 line corrections:**
>   - Catalog line 66 is blank. The effort tier heading is at 65 and its table
>     follows 67.
>   - Research-doc line 304 is a table separator. The targets are the default
>     column near 304-308, plus 309 and 694.
>   - The catalog's "last verified" note is at line 28.
>   - Given the external finding, the wording can now be definite: subagent
>     effort inherits from the session, and the session default is the
>     model's (`medium` on 5.5).
> - **1.4.6:** The `rg` currently hits 5 lines in 5 files. One is
>   `model-selection-token-context-optimization.md:20`, which is being
>   superseded and keeps its text by design. Exclude it, or accept it as
>   covered by the banner.
> - **1.4.1/1.4.2:** `docs/research/` has no README or index, so nothing has
>   to list the new doc. The repo has no markdown link checker, only
>   `markdownlint-cli` (`package.json:70`), so "no dangling links" is enforced
>   only by not deleting the old file.
<!-- /deepen-plan -->

### Phase 1.5: Behavioral gates (manual; results go in the PR body)

- [ ] 1.5.1: Codex contract check. Run `codex-reviewer` 5 times on haiku
      against the same fixed diff. No automated parser exists, so check each
      output by hand against the contract in `codex-reviewer.md:144,199`. It
      needs verdict, confidence, summary and fenced_output_path, plus a
      well-formed findings block (5/5 required). Also run
      `pnpm vitest run tests/integration/codex-reviewer-step6-extraction.test.ts`
      as a regression check on the Step 6 pipeline. Run `codex-analyst` 5 times on a fixed question; each
      answer must be non-empty and cite files. On any failure, set both agents
      to sonnet/medium instead and note it.
- [ ] 1.5.2: Run one smoke per haiku MCP agent: `linear-issue-loader`,
      `linear-pr-linker` (against a scratch issue), `linear-explorer`, and
      both ruvector agents. Pass means ToolSearch, then a real MCP call, then
      output in the documented format. For the linker, the confirmation must
      come before `save_issue`.
- [ ] 1.5.3: Run the transcript check from 1.0.2 across the tiers.

<!-- deepen-plan: codebase -->
> **Codebase:** No parser runs `codex-reviewer` output through a model.
> `tests/integration/codex-reviewer-step6-extraction.test.ts` tests only the
> Step 6 shell pipeline against fixture JSON, so it's a regression check and
> not the gate. The consumers are prose (`council.md:512`,
> `review-pr.md:781-804`). `plugins/yellow-council/tests/extract.bats` is the
> nearest reusable parser, but its input format is unverified. Define 1.5.1
> as a manual checklist instead: each run must emit all 6 keys (verdict,
> confidence, summary, fenced_output_path, and the findings block per
> `codex-reviewer.md:144,199`). Also run the step6 vitest as a regression
> check.
<!-- /deepen-plan -->

### Phase 1.6: Release hygiene

- [ ] 1.6.1: Add a `patch` changeset for each plugin with edited files:
  - yellow-core
  - yellow-docs
  - yellow-linear
  - yellow-ruvector
  - yellow-browser-test
  - yellow-ci
  - yellow-research
  - yellow-semgrep
  - yellow-codex
  - yellow-council
  - yellow-devin

  These are model and effort changes with no new capability.
- [ ] 1.6.2: Run the gates:
  - `pnpm validate:agents`
  - `pnpm lint:plugins`
  - `pnpm validate:schemas`
  - `pnpm validate:generated`
  - `pnpm test:integration`
  - `pnpm release:check`
  - `bats tests/` in `plugins/yellow-core`. This is the gate for the
    session-start edit; `pnpm validate:shell-compat` doesn't cover
    `session-start.sh`.

  Run `pnpm install` first, because the worktree has no `node_modules`.
- [ ] 1.6.3: Run `/stack:status`, then submit through the enabled provider.
      Never use raw `git push` or `gh pr create`. Suggested stack:
      1. The validator and tests (1.2).
      2. Frontmatter moves and notes (1.1, excluding codex).
      3. The codex moves (1.1.16-17).
      4. The drain and CI pins (1.3).
      5. Docs (1.4).

<!-- deepen-plan: codebase -->
> **Codebase:**
> - **1.6.1:** All 11 plugins do get file edits, including council and devin
>   (one body note each). CI blocks plugin-file PRs without a changeset, so
>   those two need one too. Confirm `changeset-check` keys on
>   `plugins/<name>/` paths. A single `.changeset/*.md` can list several
>   plugins (format: `.changeset/ruvector-install-wait-default.md`).
> - **1.6.2:** `pnpm validate:shell-compat` doesn't cover
>   `session-start.sh`. It lints fenced blocks plus the libraries listed in
>   `scripts/shell-compat-config.json`, so for this edit the bats suite is the
>   real gate. The worktree has no `node_modules`; run `pnpm install` first.
<!-- /deepen-plan -->

## Acceptance Criteria

1. `grep -l '^model: inherit' plugins/*/agents/**/*.md` returns exactly
   codex-executor, claude-reviewer and devin-orchestrator, each with a body
   note.
2. All 20 agents edited in 1.1 have both `model:` and `effort:` set, matching
   the table, except that `codex-reviewer` and `codex-analyst` may instead be
   `sonnet/medium` when 1.5.1 fails. Verify by grepping frontmatter.
3. `pnpm validate:agents` emits no V3 advisories. V5 lists exactly 37 agents,
   all outside this plan's scope, and that list is recorded in the PR.
4. The validator tests pass, including an inverted `workflow/` V3 case and the
   new `maintenance/` and V5 cases.
5. The bats tests cover the default model, the override, rejection of an
   invalid value (with its log warning), and the absence of `--bare` on the
   host's drain branch. A static test proves both `claude -p` invocations
   carry `--model "$DRAIN_MODEL"`. One real drain succeeds, and `DRAIN_LOG`
   records its exit status.
6. Both workflows carry `claude_args: --model sonnet`, and a run log shows
   Sonnet 5.5.
7. The 1.4.6 `rg` check returns only qualified mentions. The policy doc exists,
   and the old research doc carries a supersede banner with no dangling links.
8. The 1.5 gates are recorded in the PR body. The codex haiku moves land
   only if the manual 1.5.1 checklist passes 5/5 and the Step 6 vitest
   passes; otherwise both agents land as `sonnet/medium` with the failure
   noted in the PR body.
9. Every touched plugin has a changeset, and `pnpm release:check` passes.

## Edge Cases & Error Handling

- **Client < v2.1.293:** haiku agents run on 4.5 and ignore effort. This is
  accepted and documented. A full model ID would error instead, which is
  another reason to use aliases.
- **Bedrock/Vertex/Foundry users:** `haiku` resolves to 4.5. This gets one
  line in the docs only, because it is out of scope.
- **Subagent spawns subagent:** `failure-analyst` spawns `runner-diagnostics`
  without a model parameter. The child's frontmatter wins, per the documented
  order: per-invocation, then frontmatter, then `CLAUDE_CODE_SUBAGENT_MODEL`,
  then the parent. Confirm this in 1.5.3.
- **`CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` set by a user:** it overrides every
  frontmatter pin. Note this in the policy doc as the global escape hatch.
- **Invalid `COMPOUND_DRAIN_MODEL`:** the `case` falls back to `sonnet` and
  writes a warning to `DRAIN_LOG`, without echoing the raw value. No value
  from the environment is interpolated unquoted.
- **A model the client rejects:** for example a valid-looking `claude-<id>`
  that an older CLI doesn't know. `claude -p` exits non-zero, and its stderr
  plus the exit status recorded in 1.3.1 land in `DRAIN_LOG`. There is no
  automatic retry on another model. The next SessionStart drains again, and
  the user fixes or unsets the override.
- **Drain recursion:** unchanged. The `COMPOUND_DRAIN_IN_PROGRESS` sentinel
  stays the guard.

<!-- deepen-plan: external -->
> **Research:** Reported paths where frontmatter `effort` is ignored:
> agent-team teammates (anthropics/claude-code#80569), the `--agent` session
> persona (#81677), and skills invoked mid-turn (#65531, #69267). Recent
> releases also add an `effort` parameter to the Agent tool, and its
> precedence over frontmatter is undocumented. None of the 20 edited agents
> runs as a teammate or `--agent` persona today, but the policy doc should
> note these limits. Earlier builds (#87605, 2.1.233) mislabeled `/tasks`
> rows with the parent's model, so on old clients trust the transcript over
> `/tasks`.
<!-- /deepen-plan -->

## Security Considerations

- `finding-fixer`, `security-sentinel` and `scan-verifier` stay off haiku. The
  claim that Haiku 5.5 refuses cyber work is undocumented (open question).
- `COMPOUND_DRAIN_MODEL` is rejected first if it holds any character outside
  `a-z0-9-`. Only then is it matched against `haiku|sonnet|opus|claude-*`.
  It is always quoted in the argv.
- `linear-pr-linker` is the only haiku agent that writes to an external
  service. The smoke test in 1.5.2 must show the confirm gate holds.

## Migration & Rollback

- One commit per plugin, and the codex moves in their own commit, so any
  single move can be reverted alone.
- To roll back one agent, restore `model: inherit`, drop its `effort:`, and
  re-add an allowlist entry with a reason.
- The drain rolls back without a release by exporting `COMPOUND_DRAIN_MODEL`,
  e.g. `opus`. Before this change the drain passed no `--model` and ran on the
  user's default model. Exporting the alias of that default model reproduces
  it. Restoring "no flag" exactly needs a code revert.
- CI rolls back by deleting one line per workflow.
- Watch for 2 weeks after release:
  - Codex contract parse failures in `/council` and `/review:pr`.
  - Drain log errors.
  - Linear or ruvector agents answering in prose without calling a tool.

## Follow-ups (not in this plan)

- **Phase 2, replay-gated:** first build the per-reviewer yield rollup from the
  review ledger's `reviewers` array. The ledger is per clone and pruned when a
  PR closes, so it needs an export or retention step; the owner is TBD (Open
  Question 6). Then replay these swaps, grading deterministically against
  golden findings:
  - gemini-reviewer and opencode-reviewer effort to medium.
  - Sonnet→Haiku for scan-verifier, comment-analyzer,
    project-standards-reviewer, git-history-analyzer, the
    complexity/duplication/ai-pattern scanners, and staging-promoter.
  - test-runner to haiku.
  - The compounder extractors.
  - Opus→Sonnet for agent-cli-readiness-reviewer, agent-native-reviewer,
    audit-synthesizer and research-conductor.
  - The optimize judge.
  - Conditional Opus reviewers in `/flow:work`.
  - The drain on haiku.
  - The V5 effort sweep.
- **Phase 3:** tighten the plugin-markdown reviewer triggers in `/review:pr`.
  The router stays deferred; if revisited, use an add-only Haiku pass on top of
  a static floor.
- **Open questions carried over:** 2 (Max weighting of Haiku), 3 (cyber
  refusals), 4 (whether OAuth counts as the API alias row; inferred yes).

## References

- Brainstorm: `docs/brainstorms/2026-10-07-haiku-5-5-model-routing-policy-brainstorm.md`
- Validator: `scripts/validate-agent-authoring.js` (allowlist 139-157, V3
  538-552, V4 554-571). Tests:
  `tests/integration/validate-agent-authoring-model-effort-rules.test.ts`
- Drain: `plugins/yellow-core/hooks/scripts/session-start.sh:341-371`;
  `plugins/yellow-core/tests/compound-session-start-hook.bats`
- Learnings:
  - `docs/solutions/code-quality/subagent-frontmatter-field-catalog.md`
  - `docs/solutions/code-quality/claude-code-bare-flag-and-hook-recursion-guard.md`
- External:
  - https://code.claude.com/docs/en/model-config (alias version history,
    effort defaults)
  - https://code.claude.com/docs/en/sub-agents (model resolution order)
  - https://code.claude.com/docs/en/cli-reference (`--model`, `--effort`)
  - https://github.com/anthropics/claude-code-action/blob/main/docs/usage.md
    (`claude_args`)

<!-- deepen-plan: external -->
> **Research:**
> - Haiku 5.5 on OAuth logins: the v2.1.293 release adds
>   `claude-haiku-5-5` as "the default Haiku model on the Anthropic API". The
>   alias table is split by provider, not by auth type, and the docs treat
>   claude.ai logins as the Anthropic API provider. So OAuth/Max resolves
>   `haiku` to 5.5. This is inferred, not stated verbatim.
>   `ANTHROPIC_DEFAULT_HAIKU_MODEL` overrides it. To confirm on a host, run
>   `claude -p --model haiku --output-format json "hi"` and read
>   `modelUsage`.
> - Further references:
>   - https://github.com/anthropics/claude-code/releases/tag/v2.1.293
>   - https://code.claude.com/docs/en/changelog
>   - https://raw.githubusercontent.com/anthropics/claude-code-action/main/docs/configuration.md
>     (`path_to_claude_code_executable` to pin a CLI)
>   - https://github.com/anthropics/claude-code/issues/81677
>   - https://github.com/anthropics/claude-code/issues/91415
>   - https://github.com/anthropics/claude-code-action/issues/1462
<!-- /deepen-plan -->
