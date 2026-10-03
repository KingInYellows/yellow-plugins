# yellow-core Loop and Work Integrity

## Overview

The integration evaluation (`docs/brainstorms/2026-10-02-turn-the-integration-evaluation-into-an-brainstorm.md`, Spec A) found that two yellow-core loop transitions are guessed rather than checked. The first is which plan is current. The second is whether a lesson was captured from the final state of a loop.

- **Stop-hook capture.** The compound Stop hook skips capture whenever `stop_hook_active` is true. Under native `/goal`, or any other Stop-blocking loop, compound staging therefore records only the first iteration's tail and never the state at completion.
- **Plan picker.** `/flow:work` picks a plan with `ls -t plans/*.md | head -5` and always asks the user, even when only one plan is live.
- **`--goal-condition`.** `/flow:work` has no way to hand a loop a falsifiable, transcript-provable finish line.

This spec covers roadmap steps 1 (re-entrant Stop capture), 4 (plan supersession and resolver) and 6 (`--goal-condition`). yellow-core is used in arbitrary projects, so every behaviour must be project-agnostic. Steps that use yellow-plugins conventions (for example, the AGENTS.md validation matrix) degrade to asking the user when the convention is absent.

## Users

- **Maintainer or plugin user running yellow-core flows.** Wants `/flow:work` to start on the right plan without a question, and wants `/goal` runs that finish on proof instead of judgement.
- **Compound pipeline (staging-reviewer drain).** Consumes staged transcript tails and needs the final state of looped sessions.

## Requirements

### Re-entrant Stop capture (roadmap step 1)

- **R1.** When the Stop hook fires with `stop_hook_active: true`, the system shall capture the transcript tail exactly as it does for a non-re-entrant stop, regardless of which loop driver caused the continuation.
  - Acceptance: `tests/compound-stop-hook.bats` case "stop hook exits when stop_hook_active is true" is replaced by a case asserting one pending entry exists for the session.
- **R2.** When a capture for a session finishes, the system shall keep at most one pending entry per session, and the entry shall always be the one with the longest transcript seen for that session. A capture shall not write when a per-session high-water mark of `transcript_lines` is already at or above its own, so an out-of-order subshell cannot overwrite or re-create a stale entry, including after the drain has consumed a newer one. The compare and the write shall run under a per-session lock, so two overlapping captures cannot both pass the check.
  - Acceptance:
    - A bats case runs two captures for one session, the later one with a longer transcript, in reverse completion order. The pending entry holds the longer tail.
    - A bats case runs the longer capture, moves its entry to `processing/` (as the drain does), then runs the shorter capture. No new pending entry exists.
    - A bats case starts two captures for one session concurrently (backgrounded, released together, repeated at least 20 times). Every run ends with the longer tail as the only pending entry.
- **R23.** When the drain holds entries for the same session in `pending/` and `processing/`, the system shall keep only the entry with the greatest `transcript_lines` and discard the others as superseded, in addition to the `content_hash` dedupe. Entries without the field compare as 0. An entry already promoted by an earlier drain pass is not retracted.
  - Acceptance: a fixture with an early entry in `processing/` and a later, longer entry in `pending/` for one session yields one promoted entry, the longer one.
- **R3.** The pending entry shall add `stop_hook_active` (boolean) and `transcript_lines` (integer) fields. They are additive within schema `"1"`, and the drain shall keep working on entries without them.
- **R4.** The Stop hook shall emit `{"continue": true}` on every path, never emit `decision: "block"`, and add no synchronous I/O to the parent process.
- **R5.** Before the step 1 PR merges, the system's behaviour shall be checked on the installed Claude Code version.
  - Record the version.
  - Baseline: count pending entries holding the final-iteration tail after a 2+ iteration native `/goal` run on current `main` (expected 0).
  - Repeat the count with the change (expected 1).
  - The PR description records both counts and the version.

### Plan supersession and resolution (roadmap step 4)

- **R6.** When `/flow:plan` writes a new plan, the system shall prepend YAML frontmatter with `status: active` and `supersedes: <plan-slug>`, leaving `supersedes` empty when none. It shall use no `spec:` or `depends_on:` keys, because those mark shells (`expand-shell.md`).
- **R7.** Before `/flow:plan` writes a plan, the system shall check active plans for overlap with the new one. Overlap means two or more shared non-stopword slug tokens, or the same brainstorm or spec path cited. When one or more overlap, it shall ask once, "Does this replace <plan>?" (options: each overlapping plan, plus "No"), and record the answer in `supersedes`. With no overlap it shall ask nothing.
- **R8.** When `/flow:spec` writes a spec, the system shall write the same `status` / `supersedes` frontmatter with the R7 overlap check against active specs. `/flow:decompose`'s implicit spec resolution shall skip superseded specs.
- **R9.** The plan resolver shall classify each `plans/*.md` file (top level only) as **active** or **inactive**.
  - **Inactive** means any of:
    - frontmatter `status` is `superseded` or `complete`;
    - it is reachable from an active file by following `supersedes` links, so every ancestor of an active head stays inactive (if active A supersedes B and B supersedes C, both B and C are inactive);
    - it has no frontmatter and has at least one checkbox, all ticked.
  - Everything else is **active**.
  - Malformed frontmatter counts as absent, with a stderr warning.
  - A `supersedes` naming a missing file is ignored, with a warning.
  - Files in a `supersedes` cycle are all reported active and the cycle is named on stderr.
- **R10.** When `/flow:work` runs without a plan argument:
  - With exactly one active plan, the system shall use it without asking and print which plan it chose and why.
  - With two or more, it shall ask among active plans only (newest first, at most 5).
  - With none, it shall fall back to today's `ls -t` list.
  - An explicit plan argument bypasses the resolver unchanged.
  - Acceptance: with a fixture holding one active and two inactive plans, the picker step makes 0 AskUserQuestion calls.
- **R11.** When `/flow:review` runs without an argument, the system shall offer the resolver's active plans plus the existing "None — redirect to review:pr" option, in place of `ls -t … | head -3`.
- **R12.** When `/flow:deepen-plan` (yellow-research) runs without an argument, the system shall use the yellow-core resolver located through cross-plugin path resolution. When the resolver cannot be found it falls back to the current Glob listing.
- **R13.** The plan-status dashboard shall show each open plan's status. It annotates superseded plans `-- superseded by <slug>` and leaves frontmatter-less plans rendered as today. The generated Codex copy, `tests/plan-status-parity.bats` and the golden fixtures change in the same PR.
- **R14.** Before the step 4 PR merges, the system's picker behaviour shall be measured on current `main` (AskUserQuestion calls in the picker step with no argument, expected 1). The same measurement after the change shall be 0 on the R10 fixture. Both are recorded in the PR.

### `--goal-condition` for native `/goal` (roadmap step 6)

- **R15.** When `/flow:work` receives `--goal-condition` (alone or with a plan path), the system shall compose a native `/goal` condition for the resolved plan instead of executing tasks. Without the flag, behaviour is unchanged.
- **R16.** The composed condition shall have three parts in order, totalling at most 3,800 characters (native limit 4,000). It is refused, with the reason, if longer.
  - **Objective.** Execute `<plan>` with `/flow:work`.
  - **Exit branch.** STOP when three consecutive BLOCKED lines appear or after 20 turns.
  - **DONE WHEN.** Numbered criteria, each naming a proof command whose output must appear in the transcript.
- **R17.** The system shall take proof commands from the plan's `## Proof Commands` section.
  - If the section is absent and the project has an AGENTS.md "Targeted Validation Matrix", it shall propose commands from that matrix for the plan's touched paths and confirm them with the user.
  - Otherwise it shall ask the user for them.
  - It shall refuse to compose a condition with zero proof commands.
- **R18.** The `/flow:plan` templates shall include an optional `## Proof Commands` section (one runnable command per acceptance criterion).
- **R19.** Before the step 6 PR merges, a check shall determine whether a command can start native `/goal` on the installed Claude Code version, and record the version.
  - If it can, `--goal-condition` starts the goal.
  - If it cannot, it prints a ready-to-paste `/goal <condition>` line and stops.
- **R20.** The flag's help text and yellow-core docs shall state that `--goal-condition` targets native Claude Code `/goal`, and is unrelated to the `yellow-goal` plugin (`/goal:*`) and the jules goal-engine milestone.
- **R21.** As a user running a goal, I want every proof command baseline-checked before the goal starts and re-run afterwards so that "done" is never vacuous.
  - Acceptance:
    - Before composing, each proof runs once. A target that already passes is rejected as vacuous, and an invariant that already fails is rejected as invalid.
    - Commands are shown and confirmed before any execution.
    - After the run, a recheck log records each proof's result.
    - The plan's spec (not the mutable plan) is pinned by hash.

### Delivery

- **R22.** Each roadmap step shall ship as its own PR with a changeset. The R12 change to yellow-research ships as a separate PR with its own changeset. Behaviour changes update the plugin's CLAUDE.md and README.

## Design

### Step 1: capture path (R1–R5, R23)

- **`stop.sh`.** Delete the `STOP_HOOK_ACTIVE` early exit (lines 52–57) and pass the flag to the subshell as a fifth argument. The `COMPOUND_DRAIN_IN_PROGRESS` recursion guard stays first. No new synchronous work in the parent (R4).
- **`_stop-capture-subshell.sh`.**
  - Count transcript lines (`wc -l`) and add `stop_hook_active` and `transcript_lines` to the jq entry (R3).
  - Serialize on a per-session `mkdir` lock under the staging root (portable, no `flock` dependency). Wait a bounded few seconds, break a lock older than the wait, and release it on exit. The wait runs in the disowned subshell, never in the parent (R4). On wait timeout, fall back to an unlocked best-effort check: read the mark and write only when this capture is longer. Losing a capture is worse than the rare race this reopens.
  - Under the lock, read the per-session high-water mark file (`<session>.hwm`, holding the highest `transcript_lines` written). If it is at or above this capture's `transcript_lines`, exit without writing (R2).
  - Otherwise, still under the lock, call `cs_atomic_jsonl_write`, then update the mark atomically (tmp + `mv`). Order matters: a crash between the two leaves a newer entry and an older mark, which is safe.
  - The mark survives the drain moving the entry to `processing/`, so a slow earlier capture cannot re-create a stale pending entry after the drain consumed the newer one. Retention reaping of an old mark is harmless.
  - A missing mark compares as 0. Existing `pending/` entries without `transcript_lines` also compare as 0.
- **Drain (R23).** The staging-reviewer's Phase 2 dedupe gains a supersession pass before the `content_hash` pass. Group the batch by session, including entries in `processing/` and entries moved from `pending/` in this pass, and delete all but the greatest `transcript_lines`. Entries without the field compare as 0 and fall back to `content_hash`. Residual: an early entry promoted by an earlier drain pass before the final one is written stays promoted. The drain cannot know a later capture is coming.
- **Tests.** In `tests/compound-stop-hook.bats`: invert the re-entrant case (R1), add the out-of-order, post-drain and concurrent cases by calling the subshell directly (R2), and assert the new fields (R3). Add the supersession fixture for the drain (R23) alongside the existing staging-reviewer tests.
- **Checks.** R5's live check is manual and recorded in the PR.

### Step 4: plan resolver (R6–R14)

- **New script `plugins/yellow-core/lib/plan-chain.sh`.**
  - Standalone bash, executed with `bash` (not sourced), pure bash + awk, no jq.
  - Subcommands:
    - `resolve [dir]` prints active files newest first. Exit 0 = exactly one, 2 = several, 3 = none active (prints the `ls -t` fallback list), 1 = error.
    - `overlap <new-slug> [source-path] [dir]` prints overlapping active files (R7, R8).
    - `status <file>` prints the classified status and supersedes target, for plan-status (R13).
  - It implements R9's classification and warnings.
  - Fenced blocks call it as `bash "${CLAUDE_PLUGIN_ROOT}/lib/plan-chain.sh" …`.
  - It gets a bats suite `tests/plan-chain.bats` covering every R9 branch, multi-link supersession chains (A→B→C leaves only A active), cycles, dangling links, malformed frontmatter and the 100%-ticked rule.
- **`/flow:plan` (`commands/flow/plan.md`).**
  - Phase 4 writes the frontmatter (R6) and runs `overlap` before the write (R7).
  - The MINIMAL, STANDARD and COMPREHENSIVE templates gain the optional `## Proof Commands` section (R18).
- **`/flow:spec` and `/flow:decompose`.** The spec template gains the frontmatter and the overlap check (R8). `/flow:decompose` Step 1's "most recently modified" fallback calls `resolve plans/specs` and skips superseded specs. An explicit path or slug still wins.
- **Picker sites.**
  - `commands/flow/work.md` Phase 1 step 1 (R10).
  - `commands/flow/review.md` no-argument branch (R11). The file-not-found listing at line 51 also switches to `resolve`.
  - `plugins/yellow-research/commands/flow/deepen-plan.md` Step 1 (R12) finds the script under `${CLAUDE_PLUGIN_ROOT}/../yellow-core/` with a highest-version sibling fallback (`…/../yellow-core/*/lib/plan-chain.sh`, `sort -V`), and uses its Glob path when the script is not found.
- **plan-status (R13).**
  - `skills/plan-status/SKILL.md` Phase 1 adds a status column via `plan-chain.sh status`.
  - Run `pnpm generate:manifests` for the Codex copy.
  - Update `tests/plan-status-parity.bats` and `tests/fixtures/plan-status/*.golden.txt` together.
- **Unchanged.** `/plan:complete` Gate A/C and `scripts/validate-plans.js`. Archiving still moves the file, which makes it inactive by location.
- **Gates.** `pnpm validate:agents`, `pnpm lint:plugins`, `pnpm validate:shell-compat`, `pnpm check:shell-parse`, `bats plugins/yellow-core/tests/`, `pnpm generate:manifests`, `pnpm validate:generated`.

### Step 6: `--goal-condition` (R15–R21)

- **Flag parsing.** `/flow:work` Phase 1 parses `$ARGUMENTS` as an optional `--goal-condition` followed by an optional plan path. The path goes through the existing validation. With no path, R10 resolution applies.
- **Compose step (new, before Phase 2).**
  - Read proof commands (R17).
  - Assemble objective, exit branch and DONE WHEN (R16).
  - Enforce the length limit.
  - Then either start `/goal` or print the ready-to-paste line, per R19's recorded result.
  - Every DONE WHEN criterion names a proof command, because the `/goal` evaluator reads only the transcript.
- **Docs (R20).** The disambiguation sentence lives in the flag's help text and in yellow-core `CLAUDE.md` / `README.md`.
- **Later stage (R21).**
  - Adds baseline execution and the recheck log under `.claude/goals/<plan-slug>/`.
  - The pinned artifact is the spec referenced by the plan (or the plan's content hash when it has no spec). `/flow:work` rewrites plan checkboxes, so the plan itself cannot be hash-pinned.
  - Proof commands run only after user confirmation, because they execute shell commands.

### Traceability

| Component | Requirements | Consumer |
| --- | --- | --- |
| `stop.sh`, `_stop-capture-subshell.sh` | R1–R4 | staging-reviewer drain |
| staging-reviewer Phase 2 | R23 | compound pipeline |
| `lib/plan-chain.sh` | R7–R13 | `/flow:plan`, `/flow:spec`, `/flow:decompose`, `/flow:work`, `/flow:review`, `/flow:deepen-plan`, plan-status |
| Plan/spec frontmatter | R6, R8 | `plan-chain.sh` |
| `## Proof Commands` section | R17, R18 | `--goal-condition` compose step |
| Compose step | R15–R17, R19, R21 | user / native `/goal` |

## MVP Scope

- **Now:** R1–R5 and R23 (step 1, one PR) and R6–R14 (step 4: a yellow-core PR, plus the yellow-research PR for R12).
- **Next:** R15–R20 (step 6 MVP: compose and start/print). Depends on step 1 having merged, so `/goal` runs capture their final state.
- **Later:** R21 (baseline vacuity check, recheck log, spec pinning).

## Open Questions

None. Both were resolved during spec review on 2026-10-03:

- Whether a command can start native `/goal` stays a recorded pre-merge check (R19). The design covers both outcomes.
- The R7 overlap heuristic is kept as specified and tuned after use. It asks at most one question, so false positives are cheap.
