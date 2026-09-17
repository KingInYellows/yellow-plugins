---
spec: plans/specs/session-continuity-foundation.md
spec-r-ids: [R1, R2, R3, R4, R5, R6, R7, R8, R9, R10, R11, R12, R13, R14, R15, R16, R17, R18, R19, R20, R21, R22, R23, R24, R25, R26]
depends_on: [session-continuity-foundation-01-handoff-tool-and-preflight]
---

# Plan: Opt-In Context Observer

## Context

The statusline payload is the only documented surface on Claude Code 2.1.274
that carries context-window numbers, and the generated statusline renders and
discards it. This shell adds a pass-through observer that records a
session-bound observation to an untracked per-project file, a reader that
treats missing, stale, malformed, or cross-session data as `unknown`, a
provisional 50 % advisory watermark that produces one advisory per crossing
and nothing else, and an explicit opt-in step in `/statusline:setup` that
composes the observer ahead of the user's statusline without rewriting their
script. Installing the plugin changes nothing; headless sessions are reported
unsupported.

## Produces

- Pass-through context observer (stdlib only) with atomic record writes and
  observation record format v1
- Observation reader function with staleness, session-binding, and range
  rules, returning `unknown` otherwise
- Advisory watermark state and idempotent crossing marker in the record
- `/statusline:setup` opt-in step composing the pipeline, backing up
  settings, plus the documented manual merge
- `context_at_capture` wiring into the handoff measurement
- Versioned real-host statusline payload fixtures and the observer bats suite
  covering T09–T11, including the timing budget
- Changeset for yellow-core

## Consumes

- Handoff tool `measure` subcommand and its `context_at_capture` stub — from Shell session-continuity-foundation-01-handoff-tool-and-preflight
- PATH shim and fixture conventions — from Shell session-continuity-foundation-01-handoff-tool-and-preflight
- `cs_derive_project_slug` and the atomic-write pattern — from existing codebase
- `/statusline:setup` command and its backup and preview steps — from existing codebase
- Installed statusline script's null handling as the T09 baseline — from existing codebase

## Covers Spec Requirements

- R2 (partial: observer-and-setup-scripts)
- R18
- R19
- R20
- R21
- R22
- R23 (partial: observer-files)
- R25 (partial: context-observer-suite)
- R26 (partial: shell-two-gates)

## Implementation Steps (High-Level)

1. **Observer** — stdin to stdout pass-through, session id sanitization,
   record assembly, temp-and-rename, exit 0 always, write nothing on missing
   session or malformed input.
2. **Reader** — `unknown` rules, watermark evaluation, one-advisory-per-crossing
   state.
3. **Handoff wiring** — replace the `context_at_capture` stub with the reader.
4. **Setup opt-in** — new step in the setup command, pipeline composition,
   settings backup, custom-statusline preservation, manual-merge doc.
5. **Fixtures and tests** — capture and sanitize 2.1.274 payloads, bats for
   T09–T11 including kill-injection and the timing budget.
6. **Gates and changeset** — run suites and validators, disclose the not-run
   installed-host interruption smoke.

## Open Questions

- None
