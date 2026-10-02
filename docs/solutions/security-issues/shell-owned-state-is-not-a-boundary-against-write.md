---
title: 'A Shell-Owned State File Is Not a Trust Boundary Against an Agent With Write'
date: 2026-10-01
category: security-issues
track: bug
problem: Moving a destructive capability into a shell-owned state file still lets an orchestrator with Write forge it
tags: [council, trust-boundary, state-file, prompt-injection, write-tool, capability, rm-rf]
components: [yellow-council, council-md, docs-security]
---

## Problem

`/council` Step 5a stages reviewer text in `/tmp/council-synth-XXXXXX` and
later steps (5b, 5d resume, 5e) write to and delete that directory. The first
design had the orchestrating model relay the directory path and a random token
from one Bash block to the next, so a prompt-injected model could substitute a
different path and steer 5e's `rm -rf`.

PR #971 (point-in-time: open and unmerged when this doc was written, so
`council.md` on `main` still has the relayed-literal design until it lands)
moves the capability (directory on line 1, token on line 2) into
`$GIT_ROOT/.git/council-synth.state`, written only by 5a and reloaded by every
destructive step. Review (seven reviewers) found that the change was described
as stronger than it is.

## Symptoms

- `council.md` and `docs/security.md` said no destructive step trusts
  model-relayed text.
- The orchestrator has the `Write` tool, and `Write` is not path-scoped at
  runtime. An injected orchestrator can write a forged state file and a
  matching `.token` inside a directory it chooses. Steps 5b/5d/5e then find a
  state file that is regular, owned by the user and internally consistent.

## What Didn't Work

Treating "shell-owned" as "model-proof". File ownership and mode (`-O`, 0600,
no symlink) stop other users and pre-placed symlinks. They do not stop the
same user's agent, which writes through the same account as the shell.

## Solution

State the guarantee the change actually provides and document the residual:

1. The state file removes the **relayed-literal** vector: nothing the model
   copies between blocks is trusted, so a model that merely mis-substitutes or
   is steered by pack text into relaying a bad path can no longer cause a
   delete.
2. It does **not** defend against a model that deliberately calls `Write` on
   the state file and the `.token`. Say so in `council.md` and
   `docs/security.md` ("Known residual").
3. Reviewers suggested real mitigations: a deny rule on `Write` to
   `.git/council-synth.state`, or a secret held only by the shell (for example
   a token never printed to the transcript, kept in the process environment or
   a file the model has no path to).
4. Keep the shape checks (`/tmp/council-synth-*`, no `..`, not a symlink,
   owned by the user). They bound what a forged state can reach: only a
   directory the forger also populated.

Related findings from the same review:

- **Concurrent runs.** A single per-repo state file lets a second `/council`
  overwrite the first run's capability, so the first run's 5e could delete the
  second run's directory. Claim the file atomically (`ln` fails if the target
  exists), reclaim only a dead or stale (over 24 hours, the staging retention)
  leftover, and document the one-synthesis-per-worktree limit. PR #971's
  review-fix round added the `ln` claim (point-in-time: see `council.md`
  Step 5a for the current code).
- **Cleanup comments.** After the change, `council_cleanup_claude_only` also
  unlinks the state file. A comment saying the minted path is the only
  reclaimable artifact became false. Update comments and the error-table row
  for "run stops between 5a and 5e" (it now leaves a state file) in the same
  change.

## Why This Works

A capability's strength is bounded by who can mint it. Moving it out of the
relay channel shrinks the attack surface from "any prose the model repeats" to
"a deliberate tool call", which is a materially different threat, but the
second one is still reachable by the same principal. Documenting that
precisely keeps later reviewers from relying on a guarantee that does not
exist.

## Prevention

- When a change moves a secret or capability to a "shell-owned" location, list
  every tool the model holds that can write there. If `Write` or `Edit` can
  reach the path, the claim is "removes the relay vector", not "model-proof".
- Phrase security claims as the vector removed, plus the residual, in the same
  paragraph.
- Test every cleanup site that deletes the state file (Step 7, 8, 9), including
  the symlink and foreign-file refusals, not only the happy path in 5e.
- Test the failure rollback in 5a (an unwritable state path removes the
  directory and state file).
- See also: [Bash-less Write-Only Agents Need Orchestrator-Minted Temp Paths](../code-quality/bash-less-agent-write-tool-temp-path-minting.md)
  for the sibling `CLAUDE_FENCED_FILE` handoff, which still relays its path
  through the model.
