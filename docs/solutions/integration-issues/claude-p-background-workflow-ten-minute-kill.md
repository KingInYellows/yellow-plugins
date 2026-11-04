---
title: 'claude -p kills a background workflow after ten idle minutes'
date: '2026-11-03'
category: 'integration-issues'
track: bug
problem:
  'Headless review-gate runs on high-tier PRs end with no workflow result'
tags:
  - claude-p
  - workflow-tool
  - review-gate
  - headless
components:
  - scripts/eval/review-gate/eval.py
  - scripts/ci/review-gate/ci.py
---

# claude -p kills a background workflow after ten idle minutes

## Problem

The review-gate CI job (`.github/workflows/review-gate.yml`) failed on #1644, a
high-tier PR, with
`no workflow result in the reply: The workflow is running in the background. I'll print its JSON result once it finishes.`
Low-tier runs, which finish in about a minute, passed.

A local repro showed the workflow's state file
(`<transcript dir>/workflows/wf_*.json`) with `status: killed`,
`error: Workflow aborted` and `durationMs: 608118`. That is ten minutes after
the parent's turn ended, while the hunter agents were still working.

## Root cause

The Workflow tool always runs the workflow in the background. The parent's turn
ends right after the launch, and `claude -p` then waits for the background
task's notification. That wait is capped by
`CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS`, 600000 ms by default. When the session
has been idle that long, the CLI stops the background task, so any workflow that
needs more than about ten minutes after launch is killed. A high-tier review (11
hunters plus verifier votes) takes 13 to 14 minutes.

The variable is undocumented. It was found in the CLI binary (2.1.316 and
2.1.317): it is parsed as an int of at least 0, and the ceiling applies only
when the value is above 0.

Prompting the parent to keep waiting does not help: the ceiling is enforced by
the CLI, not by the model.

## Fix

`run_env()` in `scripts/eval/review-gate/eval.py`, which the CI driver also
uses, sets `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0`. The caller's subprocess
timeout (2700 s in CI, 3600 s in the eval) is then the only deadline. The
variable is not part of `row_fingerprint`, so cached eval rows stay valid.

With the fix, the same #1644 run completed in 809 s with 52 agents.

## Applies elsewhere

Any `claude -p` caller that launches a Workflow, or other background work it
must wait for, longer than ten minutes needs the same setting. If a future CLI
renames the variable, the symptom returns: a killed workflow about ten minutes
after launch.
