# yellow-council V3: Multi-Round Review

## Overview

`/council` is single-shot today. Four reviewers form independent positions, the synthesizer combines them, and the run ends. Reviewers never see corrections to their own claims, so a factually wrong round-1 finding stands. The OpenCode reviewer also cold-starts with `opencode run` on every spawn.

Roadmap step 11 of the integration evaluation (`docs/brainstorms/2026-10-02-turn-the-integration-evaluation-into-an-brainstorm.md`) borrows four ideas:

- feed each reviewer its prior round, with an anti-escalation clause (adversarial-review);
- keep first-round positions independent, and add a corrections-only addendum before round 2, preserving dissent (Advisory Council);
- run a persistent `opencode serve` with headless permission-deny (the opencode plugin).

**Blocked.** This spec starts only after council v2 shells `yellow-council-v2-four-cli-04` (quota and OpenCode routing) and `-05` (evidence verification) are archived in `plans/complete/`. It consumes shell 05's `verify_finding()`, which uses the yellow-core quote-grounding script from Spec B R1–R4, and shell 04's `QUOTA_EXHAUSTED` handling.

## Requirements

- **R1.** The council v2 spec's out-of-scope list (`plans/specs/yellow-council-v2-four-cli.md`) shall be amended. "Multi-round review" moves to this spec, with a pointer. The `council.md` "V2 Trajectory" entry for `--round 2` is updated to match.
- **R2.** When `/council` receives `--rounds 2`, or when `COUNCIL_ROUNDS=2`, the system shall run a second round in the same invocation. Without either, the run stays single-round. Any value other than 1 or 2 warns and keeps 1.
- **R3.** Round 1 shall run exactly as today: each reviewer sees only the council pack, never another reviewer's output.
- **R4.** Between rounds, the system shall build a corrections-only addendum. It contains two lists:
  - the round-1 findings whose citations `verify_finding()` marked `unverified`;
  - the factual contradictions between reviewers that the synthesizer identified.

  It makes no new reviewer call, and it states no new findings of its own.
- **R5.** In round 2, each reviewer shall receive its own round-1 review, the round-1 synthesis, and the addendum. It shall not receive other reviewers' raw reviews. Its prompt carries the anti-escalation clause: do not introduce new blocking issues unless critical, and revise or withdraw findings the addendum corrects.
- **R6.** The final synthesis shall keep minority (dissenting) positions from both rounds visible. It marks each finding as kept, revised or withdrawn between rounds.
- **R7.** A reviewer that returned `QUOTA_EXHAUSTED` or timed out in round 1 shall be skipped in round 2. The skip is reported with its reason.
- **R8.** When OpenCode is in the roster, the system shall start one `opencode serve` at council start, route every OpenCode spawn in the invocation (both rounds) through it, and stop it on every exit path.
  - The server runs with headless permission-deny settings, so it can never prompt for or grant tool permissions.
  - `--dangerously-skip-permissions` stays forbidden.
- **R9.** If `opencode serve` fails to start or becomes unreachable, the system shall fall back to today's per-spawn `opencode run` and report the fallback.
- **R10.** Before the default changes or the feature is called stable, the system shall compare single-round and two-round runs over 10 councils on the same packs. The comparison measures wall-clock latency, verdict stability (same verdict across reruns) and withdrawn-finding count, and is recorded in the PR or the Spec C baseline document.
- **R11.** `validate-council-roster.js`, `bats plugins/yellow-council/tests/` and yellow-council's CLAUDE.md and README shall reflect the new flag, env var and serve lifecycle. The PR carries a changeset.

## Design

- **Flag and env.** Step 1 argument parsing in `plugins/yellow-council/commands/council/council.md` accepts `--rounds <n>`. A `COUNCIL_ROUNDS` row joins the configuration table (R2).
- **Round loop.**
  - After Step 5 synthesis, when rounds = 2, a new step builds the addendum (R4) from the per-finding `verify_finding()` results and a synthesizer contradictions list.
  - The synthesizer's output contract gains a `contradictions` block.
  - The step re-dispatches the surviving reviewers (R7) with round-2 prompts (R5), then runs final synthesis with round annotations and preserved dissent (R6).
  - Round-2 prompt text and the addendum are untrusted-content fenced, like the existing pack.
- **Herding guard.** R5's visibility rule (own review, synthesis and addendum only) keeps round 2 from copying other reviewers. It is consistent with shell 03's synthesis-bias mitigation.
- **OpenCode serve (R8, R9).**
  - A start block launches `opencode serve` on a free localhost port, inside the existing `timeout` discipline, with a headless permission-deny config file written to a `mktemp` directory.
  - A trap in the same Bash call that consumes the server stops it, per `docs/solutions/code-quality/trap-cleanup-across-tool-call-boundaries.md`.
  - `plugins/yellow-council/agents/review/opencode-reviewer.md` gains an attach-to-server invocation path, with `opencode run` as the fallback.
  - Spike before implementation: confirm `opencode serve` and attach flags plus the permission-deny config keys on the pinned OpenCode version, and record them in the PR.
- **Measurement (R10).** A manual 10-run protocol is documented in yellow-council CLAUDE.md. Its results are recorded in the PR that would change any default.

### Traceability

| Component | Requirements | Consumer |
| --- | --- | --- |
| v2 spec and trajectory amendment | R1 | maintainers, `/flow:decompose` |
| `--rounds` / `COUNCIL_ROUNDS` | R2 | `/council` users |
| Addendum builder + `contradictions` block | R4 | round-2 prompts |
| Round-2 dispatch and final synthesis | R3, R5–R7 | council report |
| `opencode serve` lifecycle | R8, R9 | opencode-reviewer |
| 10-run comparison | R10 | default-change decision |

## MVP Scope

- **First:** R1. This is a docs-only amendment and can land any time.
- **After shells 04 and 05:**
  - R2–R7 (rounds);
  - R8–R9 (serve), which can ship independently of rounds;
  - R10 before any default change;
  - R11 with each PR.
