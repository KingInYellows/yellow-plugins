---
title: 'Nested claude -p: a Write(./**) allow rule denies writes'
date: '2026-11-17'
category: 'integration-issues'
track: bug
problem:
  'An eval run that approves Write and Edit with path rules gets every write
  denied, so file-editing agents fail cases they actually solved'
tags:
  - claude-cli
  - permissions
  - eval
  - headless
components:
  - scripts/eval/model-swap/run-one.sh
---

## Problem

The eval corpus (CLAUDE-304, PR #1847) runs agents that edit files, such as
`pr-comment-resolver` and `/flow:plan`, in a nested headless `claude -p` inside
a throwaway worktree. The first harness version approved the write tools the
same way it approved the read tools, with path-scoped allow rules:

```text
--allowedTools "Read(./**),Grep(./**),Glob(./**),Write(./**),Edit(./**)"
```

Reads worked. Every `Write` and `Edit` came back in the result's
`permission_denials`, so the run reported a fix and left the file untouched, and
the grader failed it. Nothing in stderr says why.

## Cause

In a nested `claude -p` run, a `Write(./**)` or `Edit(./**)` allow rule does not
approve writes under the working directory the way `Read(./**)` approves reads.
With no interactive user to answer the prompt, the write is denied.

## Fix

Give the write tools no allow rule at all, and start the run with
`--permission-mode acceptEdits`. That mode approves file edits inside the
working directory (and its allowed directories) only, so the run still cannot
write outside its tree:

```text
--tools "Read,Grep,Glob,Edit,Write" \
--allowedTools "Read(./**),Grep(./**),Glob(./**)" \
--permission-mode acceptEdits
```

`scripts/eval/model-swap/run-one.sh` does this for every row. Read, Grep and
Glob keep their path rules, so a fixture that names a host path gets a denial
instead of the file.

## Prevention

- After any harness change that touches permissions, grade one paid row and read
  its `permission_denials`; `eval.py grade` lists every row that had one.
- Keep path-scoped allow rules for read tools only. Approve writes with
  `acceptEdits` and a run directory you can throw away.
