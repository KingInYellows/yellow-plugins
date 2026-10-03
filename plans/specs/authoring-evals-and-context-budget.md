# Authoring Evals and Context Budget

## Overview

The integration evaluation (`docs/brainstorms/2026-10-02-turn-the-integration-evaluation-into-an-brainstorm.md`, Spec C) found four gaps in how yellow authors components and measures the result:

- **No trigger testing.** yellow checks skill and command descriptions only statically (single line, "Use when"). Nothing tests whether a description triggers on the right prompts, or stays quiet on near-misses.
- **Unmeasured listing pressure.** yellow's descriptions total roughly 39,700 characters across skills and commands, against a native listing budget of 1% of the context window. Nobody has measured how many descriptions are dropped. CONTRIBUTING.md and the evaluation disagree on whether `user-invocable: false` skills count toward the budget.
- **One user of `disable-model-invocation`.** Only one component sets it (`plugins/yellow-ci/commands/ci/runner-cleanup.md`), and the authoring skill that teaches it (`create-agent-skills`) describes it wrongly.
- **No baseline.** The roadmap's "better" claims (evaluation §7.2) have no starting measurement to compare against.

This spec covers roadmap step 8 (trigger evals), the step-12 `disable-model-invocation` pass, and the roadmap's baseline measurement. It owns the cross-spec metrics roll-up, which Specs A and B feed.

## Users

- **Maintainer.** Changes descriptions and wants evidence that a change improves triggering and does not crowd other components out of the listing.
- **Plugin users.** Benefit when the listing keeps the descriptions that matter, and when user-only workflows stop auto-triggering.

## Requirements

### Baseline and listing budget

- **R1.** Before the first Spec C behaviour PR merges, the system shall have measured listing-budget usage on a clean, isolated install of the full marketplace with the installed Claude Code version, using `/doctor` and `/skill-doctor`. The measurement records the version, the context window, the budget, the descriptions dropped, and the contribution of skills, commands and `user-invocable: false` skills.
- **R2.** The R1 measurement shall settle whether `user-invocable: false` skill descriptions and command descriptions count toward the listing budget. If it contradicts `CONTRIBUTING.md` "Skill Description Budget" or the README's "descriptions dropped" figures, the same PR corrects them.
- **R3.** The system shall keep a dated baseline document covering the seven §7.2 metrics.
  - Spec C fills the listing and trigger-accuracy rows directly.
  - The other rows point at the Spec A and Spec B PRs that record their numbers.
  - Every metric carries a numeric target.
- **R4.** A repo script shall re-derive description character totals per kind (skills by `user-invocable`, commands, agents) from the plugin files. This lets the budget be re-measured after any change without manual counting.

### Trigger-eval vehicle (roadmap step 8)

- **R5.** Before any eval tooling lands, a spike shall decide between native `claude plugin eval` and vendoring skill-creator's eval scripts.
  - Native wins if it can score both a skill and a command on both should-trigger and should-not-trigger (near-miss) cases, with n runs and a threshold, without the run firing yellow's compound-staging hooks. A vehicle that passes for the skill but cannot observe or grade command invocation does not win.
  - The spike records the Claude Code version and its verdict in the baseline document.
- **R6.** If native wins, the eval runner shall wrap `claude plugin eval` (`--ablation none`, `--max-cost-usd`). It stages repo-level eval sets into a temporary copy of the target plugin.
- **R7.** If native loses, the system shall vendor skill-creator's `run_eval.py`, `run_loop.py`, `improve_description.py` and `utils.py` into `vendor/anthropics/skill-creator-evals/`, and record the local modifications in `PROVENANCE.json`. The vendored copy carries:
  - the upstream `LICENSE.txt` (Apache-2.0);
  - a `PROVENANCE.json` holding the upstream URL, path, commit SHA, license, per-file sha256, local modifications, verification date and sync owner;
  - its `generate_report.py` and browser import removed;
  - acceptance of yellow's `user-invocable` and `argument-hint` keys;
  - a stream-json smoke test against the installed CLI.
- **R8.** Whichever vehicle wins, `pnpm eval:skill-trigger <plugin>:<component>` shall:
  - run locally under a temporary `HOME`, `CLAUDE_CONFIG_DIR` and `XDG_*`, with `COMPOUND_DRAIN_IN_PROGRESS=1`;
  - apply a default cost cap;
  - run each query 3 times, with a 0.5 trigger-rate threshold per query;
  - report should-trigger recall, should-not-trigger precision, and overall and held-out accuracy;
  - exit 0 when held-out accuracy ≥ 0.8, 1 when below, and 2 on a partial or failed run.
- **R9.** Each component's eval set shall live at repo level in `evals/<plugin>/<component>/` and never ship inside a plugin. It holds at least 8 should-trigger queries and 8–10 near-miss should-not-trigger queries, each labelled train or held-out (60/40). Plugin-level `evals/` is allowed only if the spike shows it is excluded from installs or inert.
- **R10.** The system shall seed eval sets for 3 existing components.
  - Acceptance: `pnpm eval:skill-trigger` passes on all 3.
- **R11.** When a PR changes a skill or command description, the PR shall add or update that component's eval set and record its held-out accuracy in the PR description. `CONTRIBUTING.md` documents the rule. A validator warning, not an error, fires when a description changes without a matching eval-set change.
- **R12.** If R7 applies, `scripts/check-upstream-pins.js` shall:
  - fail when a vendored file's hash differs from `PROVENANCE.json` (local drift);
  - report upstream changes to the vendored files as advisory in the weekly pins workflow;
  - leave the blocking gate free of network calls.
- **R13.** Any new top-level directory (`vendor/`, `evals/`) shall be excluded from ESLint and Prettier where it holds third-party or non-JS content, and shall pass `pnpm validate:flow-namespace`.

### Authoring guidance

- **R14.** `plugins/yellow-core/skills/create-agent-skills/SKILL.md` shall describe `disable-model-invocation` correctly:
  - the description leaves the listing;
  - the user can still run the component;
  - the model and the Skill tool cannot invoke it;
  - `skills:` preloading and scheduled tasks that target it are blocked.
- **R15.** create-agent-skills shall teach eval-set design (near-miss negatives, held-out selection) and point at `pnpm eval:skill-trigger`, replacing "invoke /my-skill" as the only test.

### `disable-model-invocation` pass (step 12 borrow)

- **R16.** The agent-authoring validator shall error when a component that sets `disable-model-invocation: true` is listed in any agent's `skills:` frontmatter, or is named as a Skill-tool target in any command, skill or agent body.
- **R17.** The pass shall flag only components that meet all of these:
  - the component is a destructive or maintenance command, or a user-invocable skill that `/skill-doctor` shows as rarely auto-invoked;
  - R16 does not reject it;
  - R1 shows its description in the listing budget.
  - `*:setup` commands are expected to be excluded, because `/setup:all` invokes them through the Skill tool.
- **R18.** After the pass, the system shall re-measure with R1's method and run the seeded eval sets.
  - Acceptance: the dropped-description count does not rise, and held-out accuracy on the seeded sets does not fall.

### Delivery

- **R19.** Each item shall ship as its own PR. Plugin changes carry a changeset. Root tooling (`scripts/`, `vendor/`, `evals/`, `docs/`) needs none.

## Design

### Baseline (R1–R4)

- **Measurement.**
  - Reuse `scripts/smoke-plugin-install.sh`'s isolation (temporary `HOME`, `CLAUDE_CONFIG_DIR` and `XDG_*`) to install the marketplace cleanly.
  - Run `/doctor` and `/skill-doctor` in that session.
  - Record the results in `docs/research/2026-10-integration-baseline.md`.
  - The slash commands are interactive, so R1 is a recorded manual step.
- **Description report (R4).** `scripts/report-description-budget.js` is a Node script that parses single-line `description:` frontmatter. It excludes codex and cursor copies, and prints totals by kind and `user-invocable`. It is covered by a vitest file in `tests/integration/` and exposed as `pnpm report:descriptions`.
- **Metrics roll-up (R3).** The baseline document's table has these columns: metric, today, target, source. Spec A's R5/R14 and Spec B's R11/R21 PRs link their measurements into it.

### Eval vehicle (R5–R13)

- **Spike (R5).** Build one hand-written case pair for one skill and one for one command. Each pair has:
  - a should-trigger case graded on the component's invocation (`tool_used: Skill` for the skill; whatever signal the vehicle exposes for the command);
  - a near-miss case whose grader asserts the component was not used.

  Run both pairs with `--ablation none` under the R8 isolation. The winning vehicle must pass both pairs. The verdict depends on whether command invocation can be observed and graded, whether a "not used" grader exists, whether n-run thresholds work, and whether the run left a compound staging entry.
- **Runner.** `scripts/eval-skill-trigger.sh`, exposed as `pnpm eval:skill-trigger`, does three things:
  1. Resolves `<plugin>:<component>` to its eval set.
  2. Builds the isolated environment.
  3. Dispatches to native (staging `evals/<plugin>/<component>/` into a temporary plugin copy's eval dir) or to the vendored `run_eval.py` with yellow's split labels. It then normalizes both outputs to one report and the R8 exit codes.
- **Vendored path only.**
  - `vendor/anthropics/skill-creator-evals/` holds `PROVENANCE.json`, validated by a small ajv schema under `schemas/`.
  - Add a row in `docs/upstream-pins.md` with a monthly sync owner.
  - Add the R12 hash check in `scripts/check-upstream-pins.js`, with a fixture test in `tests/integration/check-upstream-pins.test.ts`.
  - R12 is the only check on this provenance file. Spec D's "pin inventory" is a different thing: the tests that pin behaviour before a debt refactor.
- **Eval sets (R9, R10).**
  - Each set is `evals/<plugin>/<component>/cases.jsonl`, one object per line: `{query, should_trigger, split}`.
  - Pick the three seeds from yellow-core, covering a skill and a command with distinct trigger phrases. One should be a component with a known near-miss sibling (for example `optimize` against `/flow:review`).
- **Description-change warning (R11).** A new advisory in `scripts/validate-agent-authoring.js` compares the PR diff's description lines with `evals/` changes.
- **Ignores (R13).** Add `vendor/` and `evals/` to `.eslintignore` and `.prettierignore` as applicable.

### Authoring guidance (R14–R15)

Edit `create-agent-skills/SKILL.md` at the frontmatter table (lines 83 and 95) and its testing section. The semantics follow https://code.claude.com/docs/en/skills.

### Pass (R16–R18)

- **Validator (R16).** Add a new rule in `scripts/validate-agent-authoring.js`. It reads every agent's `skills:` list, and scans bodies for Skill-tool targets (`skill: "<name>"`, including plugin-qualified names). It errors on any target that sets the flag. Tests go in the validator's existing vitest suite.
- **Candidate list (R17).**
  1. Take destructive and maintenance commands from `commands/**`.
  2. Add low-use skills from `/skill-doctor` usage.
  3. Filter both lists through R16 and R1.

  Record the list and each exclusion reason in the pass PR. Add the flag to the survivors.
- **Re-measure (R18).** Repeat R1 and run the seeded sets. Record the before/after rows in the baseline document.

### Traceability

| Component | Requirements | Consumer |
| --- | --- | --- |
| `docs/research/2026-10-integration-baseline.md` | R1–R3, R5, R18 | maintainer; Specs A, B, D targets |
| `scripts/report-description-budget.js` | R4 | R1, R18 re-measurement |
| `scripts/eval-skill-trigger.sh` + `evals/` | R6, R8–R10 | maintainer before description PRs (R11), R18 |
| `vendor/anthropics/skill-creator-evals/` (conditional) | R7, R12 | runner; check-upstream-pins |
| Description-change advisory | R11 | PR authors |
| create-agent-skills edits | R14, R15 | skill and command authors |
| Validator rule | R16 | R17 pass; future authors |

## MVP Scope

- **Now:** R1–R4. This is the baseline, and it gates the other specs' "better" claims.
- **Next:**
  - R5 (spike), then R6 or R7, then R8–R13 (eval tooling).
  - R14–R15 in parallel.
- **Later:** R16–R18. The pass depends on R1, R10 and R16.
