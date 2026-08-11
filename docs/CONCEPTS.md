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

The multi-CLI review orchestrator (`/council`) that fans a single review
request out to multiple independent reviewer agents and aggregates their
verdicts into one report.

## fenced-output path

The dedicated file path a council reviewer agent writes its structured
verdict/findings block to, so the orchestrator can safely re-ingest it
without cross-contamination from the reviewer's own untrusted-input
handling.

## CLI-wrapper reviewer

A council reviewer that shells out to an external LLM CLI (e.g. Gemini or
OpenCode) via its own Bash tool.
