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
snapshot's supported source languages. Adding operators individually leaves
the same class of failure open.

## Correction

After a recognized credential marker, redact every remaining line in that file
and return `partial`. Preserve line numbers and earlier source; each other file
starts independently. This intentionally loses later benign context. The
marker regex includes generic `credential` and `credentials` assignments but
remains a limited detector, so sources known to contain unmarked
credentials must remain outside this workflow.

## Verification

The executable contract regression suite covers nullish, logical, ternary and
comment continuations alongside quoted credentials, URLs, escaped literals,
YAML scalars and PEM blocks. A separate benign-source test preserves ordinary
identifiers and public URLs. Generated Codex references must match the source.
