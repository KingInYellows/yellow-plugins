---
name: opencode-reviewer
description: "Cross-lineage code reviewer that invokes the OpenCode CLI for an independent verdict. Spawned by /council via Task. PR1 stub — full implementation lands in yellow-council-core-implementation."
model: inherit
tools:
  - Bash
  - Read
  - Grep
  - Glob
skills:
  - council-patterns
---

# OpenCode Reviewer (PR1 Stub)

Spawned by `/council` to invoke OpenCode CLI for an independent verdict on
the council pack. Returns structured findings with `Verdict:`,
`Confidence:`, `Findings:` (P1/P2/P3 with file:line + quoted evidence), and
`Summary:`.

## Status

This is the PR1 scaffold stub. The full agent body — including the bash
`timeout 600 opencode run --format json --variant high "$PROMPT"`
invocation, JSON event stream parsing via jq, session cleanup via
`opencode session delete`, redaction, and structured-finding return — lands
in PR2 (`agent/feat/yellow-council-core-implementation`).

## Tool Surface — Documented Bash Exception

This agent retains `Bash` in its `tools:` list while every other reviewer
in the marketplace is read-only (`[Read, Grep, Glob]`). Same rationale as
`gemini-reviewer.md`:

- `opencode-reviewer` is fundamentally a CLI-invocation agent.
- The "report-only, never edit files" guarantee is enforced by prose
  discipline in PR2's full agent body.
- The W1.5 validation rule in `scripts/validate-agent-authoring.js`
  allowlists this exact path:
  `plugins/yellow-council/agents/review/opencode-reviewer.md`.

The legitimate Bash surface for this agent in PR2 will cover:

- `opencode run --format json --variant high "..."` — OpenCode CLI
  invocation (read-only via prompt design — no `--dangerously-skip-permissions`)
- `mktemp /tmp/council-opencode-XXXXXX.json` — JSONL capture
- `timeout --signal=TERM --kill-after=10 ${COUNCIL_TIMEOUT:-600}` — timeout
  guard
- `jq -r '...'` — extract `text` events (assistant message) and
  `sessionID` for cleanup
- `awk '...'` — credential redaction (11-pattern block from
  `council-patterns` SKILL.md, applied to extracted text NOT raw JSONL)
- `opencode session delete <id>` — REQUIRED post-call cleanup to prevent
  session accumulation in `~/.local/share/opencode/`
- `command -v opencode` — pre-flight binary check
- `rm -f` — temp file cleanup

NOT permitted: `git add`, `git commit`, `gt`, `Edit`, `Write`, network
operations beyond the opencode CLI itself.

## OpenCode-Specific Concerns

- **Persistent sessions:** every `opencode run` creates a SQLite session in
  `~/.local/share/opencode/`. Cleanup via `opencode session delete` is
  REQUIRED.
- **Tool-use events embed file content:** OpenCode's `--format json` stream
  may contain `tool_use` events with `part.state.input` and
  `part.state.output` fields that include full file contents. Apply
  redaction to the EXTRACTED assistant text only — never write the raw
  JSONL to `docs/council/` reports.
- **Major-version upgrades trigger SQLite migration:** first invocation
  after `opencode upgrade` may take 2–5 minutes due to a one-time database
  migration. PR2 implementation should detect "sqlite-migration" in stderr
  and surface a user-facing warning.
- **`--variant high` is the default; `max` is much slower.** Reserve `max`
  for explicit `COUNCIL_OPENCODE_VARIANT=max` overrides.
