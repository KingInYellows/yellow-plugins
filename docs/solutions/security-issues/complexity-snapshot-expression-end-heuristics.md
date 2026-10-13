---
title: 'Complexity snapshots must not guess credential expression endings'
date: 2026-10-11
category: security-issues
track: knowledge
problem: 'Chained credential assignments bypassed line-continuation redaction'
tags: [credentials, redaction, codex, bounded-snapshot]
components:
  - plugins/yellow-debt/skills/debt-complexity-scan/references/scan-contract.md
  - tests/integration/codex-waves-analysis-integration.test.ts
---

# Complexity snapshots must not guess credential expression endings

## Symptom and cause

A credential assignment split across an environment lookup and a nullish or
logical fallback hid the marker but emitted the later value. Delimiter and
trailing-operator checks cannot establish expression boundaries across the
snapshot's supported source languages. Adding operators individually leaves the
same class of failure open.

## Correction

After a recognized credential marker, redact every remaining line in that file
and return `partial`. Preserve line numbers and earlier source; each other file
starts independently. Recognized names at line endings, including backslash
continuations before an assignment separator, also start redaction immediately.
Comment openers after recognized names start quarantine before separators hidden
behind comments. This intentionally loses later benign context, including
standalone references to credential names. The marker regex includes generic
`credential`/`credentials` assignments, cookie headers, and common session/SID
identifiers but remains a limited detector, so sources known to contain unmarked
credentials must remain outside this workflow.

Bracketed keys such as `config["password"]` and `os.environ["TAVILY_API_KEY"]`
also trigger quarantine. A closing bracket is a boundary after a recognized
marker, even when the assignment separator appears on a later line. This
intentionally includes lookups: do not try to distinguish them from assignments
with expression-ending heuristics.

## Verification

The executable contract regression suite covers nullish, logical, ternary and
comment continuations and separators split after credential names alongside
quoted credentials, URLs, escaped literals, YAML scalars and PEM blocks. A
separate benign-source test preserves ordinary identifiers and public URLs.
Generated Codex references must match the source.

Bracketed-key regressions cover Python and JavaScript environment assignments,
single/double quotes, whitespace, multiline values and separators, and ordinary
non-credential keys that must remain visible.

URL userinfo does not require a nonempty `username:password` pair. Token-only
and empty-username URLs also trigger quarantine. Regressions test these forms
independently, before any other credential marker, so an earlier redacted line
cannot mask a detection gap.

Opening brackets also delimit credential markers: C/C++ declarations such as
`API_KEY[]` and `password[64]` must start quarantine before their initializers.
Treating `[` itself as a boundary covers multiple dimensions and line breaks
without trying to parse array-size expressions. Tests exercise each declaration
in an otherwise unmarked file and preserve ordinary noncredential arrays.
