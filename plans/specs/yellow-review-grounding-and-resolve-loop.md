# yellow-review Grounding and Resolve Loop

## Overview

The integration evaluation (`docs/brainstorms/2026-10-02-turn-the-integration-evaluation-into-an-brainstorm.md`, Spec B) found three review transitions that are judged by an LLM rather than checked:

- **Whether a finding is real.** `/review:pr` relies on an LLM prose check for line accuracy, and only for P0/P1.
- **Whether a correctness bug is confirmed.** A severity claim needs no reproduction.
- **Whether a resolve run left the PR clean.** `/review:resolve` stops after one re-pass even when bots post new threads after each push.

This spec adopts roadmap step 5 (quote-grounding gate), step 13(c) (`--until-clean`), the remainder of step 7 (phantom resolver claims), and the step-12 "Confirmed only with a failing repro" rule.

The open resolve-hardening stack (#950, #952, #954, #955; plan `plans/review-resolve-hardening.md` on that stack) already delivers step 13(a) and 13(b): `reply-pr-thread`, `get-pr-blockers`, `--include-outdated`, the dispositions contract, issue filing, and one bounded re-pass. It also delivers most of step 7: the expected-file-set check in Step 6. This spec builds on that stack and does not redo it.

## Users

- **Maintainer running `/review:pr` and `/review:resolve`.** Wants findings that point at real code, and a resolve run that finishes with no open bot threads or an explicit reason.
- **Council (yellow-council shell 05).** Needs the same deterministic quote check for its Tier 1 evidence verification.

## Requirements

### Shared quote-grounding primitive

- **R1.** When given a file, a cited line, a radius (default 3) and a single-line quote, the yellow-core quote-grounding script shall report the quote as **grounded** when the whitespace-normalized quote is a substring of a whitespace-normalized line within `[line − radius, line + radius]`.
  - A quote with fewer than 8 non-whitespace characters is **too-short** and never grounded.
  - Exit 0 means grounded and prints the matched line number. Exit 1 means ungrounded or too-short. Exit 2 means a usage or file error.
- **R2.** The script shall accept a batch of findings in one invocation and return one result per finding, so that grounding 100 findings across 20 files takes under 2 seconds.
- **R3.** The script's tests shall cover tabs, CRLF, repeated spaces, backslashes and printf escapes, non-ASCII text, a cited line past EOF, a missing file, a too-short quote, and a match at each window edge.
- **R4.** Before council shell 05 is expanded, the system shall amend `plans/shells/yellow-council-v2-four-cli-05-evidence-verification-and-finalization.md` so that its Tier 1 check consumes the yellow-core script. The amendment also adds a yellow-core dependency to `catalog/plugins/yellow-council.json` in the shell 05 PR.

### Grounding gate in `/review:pr` (roadmap step 5)

- **R5.** The compact-return finding schema shall gain two optional fields:
  - `evidence`: one verbatim line of at most 200 characters from the cited file.
  - `absence`: boolean, true when the finding is about something missing, such as a missing test or missing doc.

  Every finding-producing persona shall be instructed to emit `evidence`, or `absence: true` with `evidence: null`.
- **R6.** When `/review:pr` Step 6 validates returns, the system shall classify every finding before deduplication:
  - **grounded:** the script returns 0.
  - **ungrounded:** the script returns 1.
  - **absence:** `absence: true`.
  - **missing:** no `evidence` and no `absence`.
- **R7.** While grounding mode is `report` (the default), the system shall drop no finding. It shall show per-class counts in the report's Coverage section.
- **R8.** While grounding mode is `enforce`, the system shall drop ungrounded and missing findings before deduplication, count them, and list the count in Coverage. Absence findings pass through.
- **R9.** The system shall read the grounding mode from `review_pr.grounding: report|enforce` in `yellow-plugins.local.md`. An invalid value falls back to `report` with a stderr warning. The local-config skill documents the key.
- **R10.** The system shall ground against the raw quote, and then let the ledger store only the redacted quote. A quote shall enter a prompt or report only inside an untrusted-content fence.
- **R11.** The review ledger shall record each observed finding's grounding class, and in enforce mode a drop record for each dropped finding.
  - A record without a grounding class reads as `not_evaluated`, never `ungrounded`.
  - `summary --all` shall report per-class counts and the ungrounded rate across PRs.
- **R12.** The default mode shall switch to `enforce` only in a PR that records evidence from the ledger:
  - at least 30 gated findings across at least 5 PRs;
  - a manual sample of at least 10 ungrounded findings with a false-drop rate of at most 10%.

  yellow-review CLAUDE.md documents this criterion.
- **R13.** `/review:all` Step 8 shall apply the same gate (the parity rule with `review-pr.md` Step 6). `tests/skill-content.bats` census and schema-parity tests shall cover the new fields.
- **R14.** The deterministic gate shall replace the LLM "Line accuracy" quality gate for grounded findings. The LLM check remains for ungrounded and missing findings while in report mode.

### Repro-required "Confirmed" (step 12 borrow)

- **R15.** correctness-reviewer shall emit an optional `repro` on findings: a minimal failing test snippet or a command, at most 20 lines.
  - In Step 6 validation, a P0 correctness-reviewer finding without `repro` is capped at P1, and the cap is counted in Coverage.
  - The report labels findings with a repro "repro provided (unverified)".
- **R16.** When the yellow-core debugging skill investigates a bug, it shall call the bug **Confirmed** only after a minimal failing repro in the project's own test framework has run and failed. Otherwise it reports the bug as **Suspected** and says what blocked reproduction.

### `/review:resolve --until-clean` (roadmap step 13c)

- **R17.** `/review:resolve` shall accept `--until-clean`. The flag is added to `docs/plugin-scope-mode-protocol.md`, the command's `argument-hint`, and the `/review:sweep` and `/review:sweep-all` pass-through in the same PR. Without the flag, the single bounded re-pass is unchanged.
- **R18.** While `--until-clean` is set, after each successful write phase the system shall poll for new threads and run another round, up to 4 rounds in total. It shall stop early on any of:
  - zero open bot threads outside an end state;
  - a no-progress round (no new threads and no thread state change);
  - a rate-limit stop;
  - a timeout stop;
  - a refused write.
- **R19.** Before each round, the system shall refresh all derived state: PR head, `pr-changed-ranges`, the thread list including outdated threads, and the run marker.
- **R20.** Across all rounds of one run, the system shall keep the hardening stack's cap of 3 created issues per PR, and its human-thread policy (`resolve_pr.resolve_human_threads`).
- **R21.** The final report shall state the rounds run, the stop reason, per-disposition counts, and the open bot-thread count taken from GraphQL `reviewThreads`. The `Resolve:` contract line gains `rounds=` and `stop=` fields additively.
  - Acceptance: a mocked PR has one bot thread per end state, and a bot posts one new thread after round 1. The run finishes with 0 open bot threads in at most 3 rounds, and a human `disagree` thread stays open. A no-progress fixture stops after round 2.

### Phantom resolver claims (remainder of roadmap step 7)

- **R22.** When a resolver's `Files modified` lists a path with no working-tree change, the orchestrator shall report a **phantom claim** naming the cluster and path, and shall turn that cluster's `fixed` threads into `unclear`. Today the entry is silently dropped from the expected set.
- **R23.** After each resolver wave, the orchestrator shall print a claimed-versus-changed summary: the claimed paths, the changed paths, the phantom claims, and the refused unclaimed changes.

### Delivery

- **R24.** Each step shall ship as its own PR with a changeset, and update yellow-review (and yellow-core, where touched) CLAUDE.md and README.
  - R17–R23 shall start only after #950–#955 have merged.
  - R1–R4 shall merge before council shell 05 is expanded.

## Design

### Primitive: `plugins/yellow-core/lib/quote-ground.sh` (R1–R4)

- **Shape.**
  - A standalone bash script, executed with `bash`, never sourced.
  - Single mode: `quote-ground.sh check <file> <line> <radius>`, with the quote read from stdin so it never appears on a command line.
  - Batch mode: `quote-ground.sh batch`, reading JSONL `{id, file, line, quote}` on stdin and writing JSONL `{id, result, matched_line}`. It runs one awk pass per distinct file (R2).
- **Normalization.** Same rules as `rl_normalize_line` in `plugins/yellow-review/lib/review-ledger.sh`:
  - tabs become spaces;
  - CRs are dropped;
  - space runs are squeezed;
  - the line is trimmed.

  Text reaches awk through `ENVIRON`, not `-v`, as `rl_window_match` does.
- **Tests.** `plugins/yellow-core/tests/quote-ground.bats` (R3).
- **Shell 05 amendment (R4).** Edit the shell's Consumes and Implementation Steps so Tier 1 calls `quote-ground.sh batch`, and record the yellow-core catalog dependency for that PR.

### Gate: `/review:pr` Step 6 (R5–R14)

- **Schema (R5).** Add `evidence` and `absence` to the schema example in `review-pr.md` and to `skills/pr-review-workflow/SKILL.md`. Add both fields to every producer listed in `tests/skill-content.bats` (the 11 yellow-review personas plus the yellow-core security and performance reviewers).
  - The fields are optional extensions. A return without them is never dropped at validation, so producers can update in any order.
- **Gate placement (R6–R8).** A new sub-step 1a runs between Validate (sub-step 1) and Deduplicate (sub-step 2).
  - It writes the findings as JSONL to a `mktemp` file.
  - It runs `quote-ground.sh batch` through `${CLAUDE_PLUGIN_ROOT}/../yellow-core/` with the highest-version-sibling fallback. If the script is not found, every finding is classed `not_evaluated` with a warning.
  - It attaches the class to each finding and applies the mode.
- **Mode (R9).** Read from `yellow-plugins.local.md` as `resolve_pr.*` keys already are. Document `review_pr.grounding` in `plugins/yellow-core/skills/local-config/SKILL.md`.
- **Redaction and fencing (R10).** Grounding runs on the raw quote before `review-ledger.sh observe`, which already applies `cs_redact_secrets`. Report rendering wraps quotes in the untrusted-content fence.
- **Ledger (R11).**
  - Add a `grounding` field to observed findings, and a `grounding_drop` record type.
  - Update `lib/review-ledger-vocab.json` and `references/review-pr/ledger.md`.
  - `cmd_observe` accepts the field.
  - `summary --all` adds per-class totals.
  - Tests go in `tests/review-ledger.bats`.
- **Mirror (R13).** `/review:all` gets the same sub-step in its Step 8 aggregation.
- **Quality gates (R14).** The "Line accuracy" bullet applies only to non-grounded findings.

### Confirmed rule (R15–R16)

- **correctness-reviewer.** The agent body documents `repro`. Step 6 Validate carries `repro` like the `breaking_change_class` extension, applies the P0 to P1 cap, and counts it.
- **Debugging skill.** `plugins/yellow-core/skills/debugging/SKILL.md` Phase 1.1 gains the Confirmed/Suspected rule.

### Loop: `--until-clean` (R17–R21)

- **Builds on the hardening stack's Step 8.** That step is "Bounded Re-pass", which uses `poll-new-threads` and `repass_wait_seconds`. With `--until-clean`, Step 8 becomes a loop of at most 4 rounds. Each round:
  1. Re-runs the derived-state refresh (R19), per `docs/solutions/logic-errors/resolve-stack-state-stale-after-fix-commit-push.md`.
  2. Then runs Steps 3c–7.
- **Stop reasons (R18).** `clean | no-progress | cap | ratelimited | timeout | refused`.
- **Open-thread count.** Uses GraphQL `reviewThreads` (`get-pr-blockers`), not `get-pr-comments`.
- **Flag parsing.** Step 1's unknown-flag rejection gains `--until-clean`.
- **Raw `gh` in the command.** Thread logic stays in the existing scripts, so `resolve-pr.md` stays within its `scripts/provider-neutral-commands-allowlist.json` cap.
- **Tests (R21 acceptance).** Extend the `tests/mocks/gh` fixtures with a per-round thread sequence.

### Phantom claims (R22–R23)

Step 6 "Files" currently drops resolver-listed paths with no change. It will instead:

- record those paths as phantom claims;
- downgrade the owning cluster's `fixed` threads to `unclear` before the write phase;
- print the R23 summary after each wave.

### Traceability

| Component | Requirements | Consumer |
| --- | --- | --- |
| `yellow-core/lib/quote-ground.sh` | R1–R3 | `/review:pr`, `/review:all`, council shell 05 |
| Shell 05 amendment | R4 | council v2 |
| Schema fields `evidence`, `absence`, `repro` | R5, R15 | Step 6 gate, ledger |
| Step 6 sub-step 1a | R6–R8, R14 | report, ledger |
| `review_pr.grounding` key | R9, R12 | Step 6 sub-step 1a |
| Ledger `grounding` and `grounding_drop` | R10, R11 | `summary --all`, R12 evidence |
| Debugging skill rule | R16 | `/flow:work` debugging, users |
| `--until-clean` loop | R17–R21 | `/review:resolve`, `/review:sweep`, `/review:sweep-all` |
| Phantom-claim check | R22, R23 | Step 6 write phase |

## MVP Scope

- **Now:** R1–R4. A small yellow-core PR that unblocks council shell 05.
- **Next:**
  - R5–R11, R13, R14: the gate shipped in report mode.
  - R15–R16: the Confirmed rule.
  - After #950–#955 merge: R17–R23 (loop and phantom claims).
- **Later:** R12, the enforce flip, once its evidence threshold is met.
- **Out of scope:** applying the gate to yellow-debt's audit-synthesizer. The evaluation suggests it, but it belongs to yellow-debt's own roadmap work.
