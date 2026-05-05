# Brainstorm: /review:sweep — Chain /review:pr → /review:resolve

## What We're Building

A new wrapper command — working name `/review:sweep` — that runs `/review:pr`
followed by `/review:resolve` sequentially on the same PR. The user invokes one
command and gets a full pass: AI multi-agent code review with autonomous P0/P1
fixes, then parallel resolution of all open reviewer comment threads (bot and
human alike), leaving the PR with no unresolved threads.

**Origin question (reframed):** The user initially asked whether
`/workflows:review` could chain into `/review:resolve`. After reading the actual
command files, the correct pairing is `/review:pr` -> `/review:resolve`:
both operate on a single PR, both use the same `gh` / Graphite auth context,
and both live in `plugins/yellow-review/`. `/workflows:review` is a
session-level plan-adherence tool and was not the right target.

**Critical finding — these commands do not compose as a data pipeline.**
`/review:pr` emits its findings to the terminal (Step 10 report table) and
applies auto-fixes to the working tree. It does NOT post findings as GitHub PR
comment threads. `/review:resolve` consumes existing unresolved GitHub review
threads fetched via GraphQL (`get-pr-comments` script) — threads posted by
humans and bots, not by `/review:pr`. The chaining is a sequential UX
convenience on a shared PR number, not a data handoff.

**Confirmed: `/review:resolve` handles both bot and human threads.** The
`get-pr-comments` GraphQL script fetches all unresolved threads with no
author-type filter. Each thread is routed to a `pr-comment-resolver` agent
that either submits a fix or posts an FP-response and marks the thread
resolved. This already covers CodeAnt, Greptile, Devin, and any other
bot-posted threads without additional work.

## Why This Approach

**Why a new wrapper command, not modifying either existing command:**

- `/review:pr` is a general-purpose code review tool. Adding resolve
  behavior to it would make it do two unrelated jobs and complicate its
  failure modes.
- `/review:resolve` is a standalone comment-resolution tool. Users invoke it
  directly after human review cycles, independent of any prior AI review pass.
- A wrapper is pure orchestration — no new logic enters either underlying
  command. If users want only one step, they invoke the existing command
  directly.
- This follows YAGNI: the minimum change that delivers the chained workflow is
  a thin new command file.

**Recommended name: `/review:sweep`**

Rationale: "sweep" communicates "clear everything" without implying a specific
sub-operation order. It is short, tab-complete friendly, and distinct from
`/review:pr` and `/review:resolve` so there is no ambiguity about which
command is which.

Alternatives considered:

- `/review:full` — readable, but "full" is vague (full depth? full pipeline?).
  Could conflict with a future depth-control flag on `/review:pr` itself.
- `/review:pr-and-resolve` — accurate but verbose; not idiomatic for a slash
  command.
- `/review:complete` — same vagueness issue as "full."

**Failure boundary: stop on review failure (user's choice B).**

The resolve step only runs if `/review:pr` completes cleanly. "Clean" means:
the command reached its Step 10 report without aborting, AND the user approved
the Step 9 push confirmation (or there were no changes to push). If the user
declines the Step 9 push, or if `/review:pr` errors for any reason, the
wrapper stops and reports that the resolve step was skipped. This avoids
resolving reviewer threads on a PR whose AI-review fixes were never committed.

## Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Implementation shape | New wrapper command | No changes to existing commands; pure orchestration |
| Command name | `/review:sweep` | Short, distinct, communicates "clear everything" |
| Arg shape | Mirror `/review:pr` (PR# / URL / branch / empty=current) | User passes one arg; wrapper forwards it to both sub-commands |
| Failure boundary | Stop if review fails or push declined | Resolve only makes sense when the review pass is committed |
| Bot thread handling | No additional work needed | `/review:resolve` already fetches all threads with no author filter |
| Modification to existing commands | None | YAGNI — both commands work independently and stay unchanged |

**Arg shape detail:** `/review:sweep` accepts the same argument shape as
`/review:pr`:

- Numeric PR number
- GitHub PR URL
- Branch name
- Empty (auto-detect from current branch)

The resolved PR number is extracted once and passed explicitly to both
sub-commands so they operate on the same PR regardless of branch state changes
mid-run (e.g., after `/review:pr` commits fixes and `gt submit` updates the
stack).

## Open Questions

These are implementation details for `/workflows:plan` to resolve:

1. **How to detect Step 9 decline in `/review:pr`.** The wrapper invokes
   `/review:pr` via the `Skill` tool (or equivalent delegation). The sub-command
   currently reports "changes remain uncommitted for manual review" when the
   user declines. The wrapper needs a reliable signal — either a non-zero exit
   from the Skill invocation, or a sentinel string in the output — to know
   whether to proceed. Plan should define the detection contract.

2. **How to invoke `/review:pr` from within a command file.** Options:
   `Skill` tool with `skill: "review:pr"`, or spawning it as a Task subagent.
   The `Skill` tool is the idiomatic path for command-to-command delegation in
   this codebase; confirm it surfaces exit status reliably for the failure
   boundary check.

3. **File location.** `plugins/yellow-review/commands/review/sweep.md` is the
   natural home. Confirm the command namespace (`review:sweep`) matches what
   Claude Code derives from that path.

4. **`allowed-tools` list.** The wrapper itself needs at minimum `Skill` (or
   `Task`) and `AskUserQuestion`. It delegates all actual work to the
   sub-commands, so it should not need `Bash`, `Edit`, etc. directly. Confirm
   whether `Skill` invocations inherit the caller's tool permissions or need
   explicit listing.

5. **Behavior when `/review:resolve` finds zero unresolved threads.** This is
   a clean success — report "No open threads to resolve" and exit. Not a
   failure. Worth making the wrapper's final report distinguish "resolved N
   threads" from "no threads found" for clarity.

6. **`plugin.json` registration.** _Resolved during planning:_
   `plugins/yellow-review/.claude-plugin/plugin.json` has no `commands`
   array — commands are auto-discovered from the directory layout. No
   manifest registration is required. (See plan
   `plans/review-sweep-wrapper-command.md` "Files NOT to Modify".)
