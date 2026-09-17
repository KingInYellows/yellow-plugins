---
spec: plans/specs/session-continuity-foundation.md
spec-r-ids: [R1, R2, R3, R4, R5, R6, R7, R8, R9, R10, R11, R12, R13, R14, R15, R16, R17, R18, R19, R20, R21, R22, R23, R24, R25, R26]
depends_on: []
---

# Plan: Handoff Tool and Read-Only Preflight

## Context

yellow-core's `session-handoff` skill resumes from the newest file under
`plans/handoff/` and records nothing a successor can verify. This shell
replaces that with an explicit path reference, a shell-measured identity block
in YAML front matter (hashed repository and worktree identity, HEAD, branch,
dirty digest, source session, body digest), atomic redacted publication, and a
read-only preflight that reports `ready | mismatched | unsupported | blocked`
with reason codes and never acts. Legacy notes stay readable, nothing launches
or stops a session, and the catalog hooks block is untouched.

It also ships the plugin-identity check so the preflight can say which
yellow-core copy is running, and the bats suites that make T01–T08 and T12
real evidence.

## Produces

- Handoff tool script with `measure`, `write`, `read`, and `preflight`
  subcommands, sourcing the existing redaction, atomic-write, and path helpers
- Handoff note format v1 (front matter measured block plus labeled narrative)
- Preflight JSON contract v1 with reason codes, precedence, and exit codes
- Rewritten `session-handoff` skill text: explicit-path resume, fenced
  narrative, AskUserQuestion gate before any mutation
- Plugin-identity helper reporting running copy versus checkout
- Observation-reader stub contract: `measure` fills `context_at_capture`
  with `unknown` until a reader is supplied
- Bats suites for the handoff tool and plugin identity with fixture
  repositories, kill-injection, synthetic secrets, and the PATH shim
- Changeset for yellow-core

## Consumes

- `cs_redact_secrets`, `cs_atomic_jsonl_write` pattern, `cs_derive_project_slug` — from existing codebase
- `validate_file_path` — from existing codebase
- `security-fencing` fence text — from existing codebase
- Legacy notes under `plans/handoff/` as R1 fixtures — from existing codebase
- `pre-compact-hook.bats` and `validate-fs.bats` test conventions — from existing codebase

## Covers Spec Requirements

- R1
- R2 (partial: handoff-and-preflight-scripts)
- R3
- R4
- R5
- R6
- R7
- R8
- R9
- R10
- R11
- R12
- R13
- R14
- R15
- R16
- R17
- R23 (partial: handoff-files)
- R24
- R25 (partial: session-handoff-and-plugin-identity-suites)
- R26 (partial: shell-one-gates)

## Implementation Steps (High-Level)

1. **Measurement core** — implement deterministic capture of every front
   matter field, `unknown` on failure, no raw paths, hashed identities.
2. **Writer** — path and slug validation, collision suffixing, symlink refusal,
   body cap, diff and transcript rejection, redaction on stdin, temp-and-rename.
3. **Reader and classifier** — front matter parse, legacy detection, format
   ceiling, body digest verification.
4. **Preflight** — re-measure, compare, completion detection, plugin identity,
   JSON plus summary output, exit codes, zero mutation.
5. **Plugin identity helper** — running root, version, cache commit versus
   checkout, `cache-lags-checkout` label.
6. **Skill rewrite** — new steps calling the tool, remove newest-file rule,
   fenced narrative, authorization gate.
7. **Tests** — two bats files with fixtures covering T01–T08 and T12, PATH shim
   proving no launch, stop, or model call.
8. **Gates and changeset** — run the yellow-core bats suites and repository
   validators, record counts and not-run items.

## Open Questions

- None
