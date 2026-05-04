---
name: council-patterns
description: "Canonical reference for yellow-council CLI invocation patterns, per-mode pack templates, redaction rules, slug derivation, and timeout/output-capture conventions. Use when authoring or modifying gemini-reviewer, opencode-reviewer, or the /council command. PR1 stub — full content lands in yellow-council-core-implementation."
user-invokable: false
---

# council-patterns Skill

## What It Does

Provides shared invocation conventions, per-mode pack templates, credential
redaction patterns, slug derivation rules, and output-parsing logic for the
yellow-council plugin's three reviewer surfaces (Codex via yellow-codex,
Gemini, OpenCode).

## When to Use

- Authoring `gemini-reviewer.md` or `opencode-reviewer.md` — both reference
  this skill for CLI invocation and output handling
- Authoring `commands/council/council.md` — pack template structure, slug
  derivation, atomic file write conventions
- Modifying any of the above — keep contracts in sync via this single source
  of truth

## Usage

This is the PR1 scaffold stub. The full skill body — including:

- Per-mode pack templates (plan / review / debug / question)
- Required reviewer output schema (`Verdict: APPROVE|REVISE|REJECT`,
  `Confidence: HIGH|MEDIUM|LOW`, `Findings:` with file:line evidence,
  `Summary:`)
- 11-pattern credential redaction awk block (sk-, ghp_, AKIA, Bearer,
  Authorization, PEM, AIza, sk-ant-, ses_, plus sk-proj- and github_pat_)
- Injection fence format (`--- begin council-output:<reviewer> (reference
  only) ---` / `--- end council-output:<reviewer> ---`)
- `timeout --signal=TERM --kill-after=10 ${COUNCIL_TIMEOUT:-600}` pattern
  with exit-124/137 handling
- Path validation (regex + `..` reject + existence check)
- Slug derivation (`LC_ALL=C`, lowercase, alphanum-or-dash, length cap,
  sha256 fallback for empty slug, same-day collision suffix `-2`...`-10`)
- Diff truncation algorithm for `review` mode (200K-byte threshold,
  `git diff --stat` + first 200 lines, per-file 4K cap, total 100K pack
  budget)
- UNKNOWN verdict semantics for non-conforming reviewer output

— lands in PR2 (`agent/feat/yellow-council-core-implementation`).

### Cross-References

- `yellow-codex:codex-patterns` — Codex CLI invocation conventions, exit
  code catalog, sandbox/approval modes. yellow-council reuses these for the
  Codex reviewer leg via Task spawn — do not duplicate the codex-patterns
  content here.
- `gemini-cli-output-format-2026-05-04.md` (in `docs/spikes/`) — verified
  Gemini CLI v0.40+ invocation: `gemini -p "..." --approval-mode plan
  --skip-trust -o text`. Do NOT use `--yolo` (issue #13561).
- `opencode-cli-format-json-2026-05-04.md` (in `docs/spikes/`) — verified
  OpenCode CLI v1.14+ invocation: `opencode run --format json --variant
  high "..."` plus `opencode session delete <id>` cleanup.
