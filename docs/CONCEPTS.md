# Concepts

Shared domain vocabulary for this project — entities, named processes, and
status concepts with project-specific meaning. It accretes as
`/flow:compound` processes learnings; direct edits are fine. Glossary
only, not a spec or catch-all.

## shell

A structured markdown stub, one per future work session, that
`/flow:decompose` produces to record a spec's requirement coverage
together with its produces/consumes/depends-on wiring, without yet
committing to concrete file paths. It is not executable itself:
`/flow:pick-next-shell` expands a shell into a concrete checkbox plan
and deletes the stub, and a coverage gate blocks writing any shell until
every requirement ID is covered either by one bare claim or complete,
non-overlapping partial claims across all shells.

## exposure lint

A CI check (`pnpm validate:codex`) that rejects a fixed list of Claude-only
constructs found anywhere in a plugin's Codex-exposed content, in two
enforcement modes: an unconditional pattern match for `$ARGUMENTS`,
`.claude/`, `userConfig`, `outputStyles`, `subagent_type`, and known
`CLAUDE_*` env vars; and, for slash-command syntax, hard-coded cross-plugin
paths, and `mcp__plugin_*` references, a registry-gated match — flagged only
when the token names a real, currently-known entry (an actual command name,
an actual sibling plugin, an actual generated MCP tool name), not merely a
token of that shape. This is pattern/registry matching, not exhaustive
semantic coverage: it does not check for
arbitrary Claude-only built-in tool names appearing in skill prose (e.g.
`AskUserQuestion`), so a pass narrows but does not guarantee a Codex
session never encounters an unresolvable instruction or reference. Its
scope is also narrower than "everything Codex might read": it scans only
the generated Codex plugin manifest and skill tree
(or a plugin's configured skill-path override), never the
hook/lib/command-wrapper layer behind those skills — code in that layer
may reference Claude-only paths freely since Codex never executes it
directly.

## spec-tier

The escalation path `/flow:plan` takes for a feature too
multi-subsystem to fit in one plan file or one work session, redirecting to
`/flow:spec` → `/flow:decompose` → `/flow:pick-next-shell`
instead of drafting a plan directly. Note: the escalation check is
qualitative (no numeric threshold) and can also fire in Phase 5, after a
plan draft already exists.

## council

The multi-reviewer orchestrator (`/council`) that fans a single review request
out to an in-process reviewer plus several external LLM CLIs, and aggregates
their verdicts into one report.

## fenced-output path

The dedicated file path a council reviewer agent writes its human-readable
(Layer-1, capitalized `Verdict:` / `Findings:` / `Summary:`) review to. The
structured Layer-2 `key=value` contract is returned through the Task call, not
written here — keeping the two layers separate is the point of the file.
A reviewer that produces no review file (a stub or non-voting return)
reports a sentinel value in place of a real path; every site that checks,
reads or deletes a fenced-output path must explicitly allow that sentinel, so
a missing file is never treated as an error or cleanup target.

## CLI-wrapper reviewer

A council reviewer that shells out to an external LLM CLI (e.g. Gemini or
OpenCode) via its own Bash tool.

## remote-agent group

The set of remote-agent-provider plugins (Cursor, Devin, and a planned
Jules provider) governed by the same exactly-one-enabled pattern as the
stacked-PR provider selection — exactly one member active at a time, with
a preferred default among them (`yellow-cursor`; Jules joins the group without
becoming the default).

## not-exercisable outcome

A spec-verification outcome value, distinct from pass or fail, recorded
explicitly when a cited requirement or vendor API surface cannot yet be
inspected or tested — used instead of silently defaulting the criterion
to a passing verdict.

## Gate C

The evidence-verification gate in `/plan:complete` that confirms a plan's
underlying work actually shipped as a merged PR before archival, evaluated
as three deterministic tiers in order — file-provenance (the closed PR
associated with the last trunk commit that touched the plan file, or, for a Graphite merge-queue PR that stays closed and unmerged, the PR numbered in that commit's subject once its files confirm it), strict (slug-matched merged-PR search), and
loose (token-coverage scoring over the 100 most recent merged PRs) —
falling through to a user-confirmed override prompt only when no tier
meets its pass condition.

## non-voting verdict

A council reviewer outcome (a timeout, an error, or an unavailable or
quota-exhausted reviewer) that reports the reviewer could not give a judgment.
It is excluded from consensus counting and must never be read as the reviewer
having reviewed the change and found it clean. Non-voting verdicts still appear
in the aggregated report; a new one has to be excluded in every place that
tallies votes or computes a "reviewed clean" reading.

## reviewer return contract

The fixed set of structured `key=value` fields (verdict, confidence, summary,
fenced-output path, and a findings block) that every council reviewer returns
through its Task call, so the council can aggregate heterogeneous reviewers
uniformly. It is the Layer-2 contract, separate from the human-readable review
written to the fenced-output path.
