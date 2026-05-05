---
name: gemini-reviewer
description: "Cross-lineage code reviewer that invokes the Google Gemini CLI for an independent verdict. Spawned by /council via Task. PR1 stub — full implementation lands in yellow-council-core-implementation."
model: inherit
tools:
  - Bash
  - Read
  - Grep
  - Glob
skills:
  - council-patterns
---

# Gemini Reviewer (PR1 Stub)

Spawned by `/council` to invoke Google Gemini CLI for an independent verdict
on the council pack. Returns structured findings with `Verdict:`,
`Confidence:`, `Findings:` (P1/P2/P3 with file:line + quoted evidence), and
`Summary:`.

## Status

This is the PR1 scaffold stub. The full agent body — including the bash
`timeout 600 gemini -p "$PROMPT" --approval-mode plan --skip-trust -o text`
invocation, output parsing, redaction, and structured-finding return —
lands in PR2 (`agent/feat/yellow-council-core-implementation`).

## Tool Surface — Documented Bash Exception

This agent retains `Bash` in its `tools:` list while every other reviewer
in the marketplace is read-only (`[Read, Grep, Glob]`). This is intentional
and an explicit exception to the W1.5 read-only-reviewer rule:

- `gemini-reviewer` is fundamentally a CLI-invocation agent — its core
  responsibility is running `gemini -p "..."` against the council pack and
  parsing structured output. That requires `Bash` for binary invocation.
- The "report-only, never edit files" guarantee is enforced by prose
  discipline in PR2's full agent body, not by the absence of `Bash`.
- The W1.5 validation rule in `scripts/validate-agent-authoring.js`
  allowlists this exact path:
  `plugins/yellow-council/agents/review/gemini-reviewer.md`.

The legitimate Bash surface for this agent in PR2 will cover:

- `gemini -p ... --approval-mode plan --skip-trust -o text` — Gemini CLI
  invocation (read-only mode, no tool side effects)
- `mktemp /tmp/council-gemini-XXXXXX.txt` — output capture
- `timeout --signal=TERM --kill-after=10 ${COUNCIL_TIMEOUT:-600}` — timeout
  guard
- `awk '...'` — credential redaction (11-pattern block from
  `council-patterns` SKILL.md)
- `command -v gemini` — pre-flight binary check
- `rm -f` — temp file cleanup

NOT permitted: `git add`, `git commit`, `gt`, `Edit`, `Write`, network
operations beyond the gemini CLI itself.

## Why This Agent Is in `agents/review/` Despite Bash Access

Per W1.5, agents under `agents/review/` are normally restricted to
`[Read, Grep, Glob]`. This agent is allowlisted because:

1. Its sole purpose is producing council reviewer output — it belongs
   logically with `codex-reviewer` (yellow-codex) and `opencode-reviewer`
   (yellow-council), all of which wrap external CLIs.
2. The `agents/review/` location signals to /council orchestrator that this
   is a read-only verdict producer, not a workflow executor.
3. Moving it elsewhere would obscure the council architecture and require
   special-casing in council.md routing.

The exception is documented in `scripts/validate-agent-authoring.js`
`REVIEW_AGENT_ALLOWLIST` with a comment referencing the council plan.
