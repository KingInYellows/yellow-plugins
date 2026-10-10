---
# TEMPLATE — this file is not the smoke result.
# After the smoke, copy it to docs/yellow-jules/smoke-result.md and fill every field.
# PR4 work is gated on smoke-result.md containing `result: pass`; the placeholder
# values below ("pass|fail", "true|false") deliberately match nothing.
result: pass|fail
archiveVisibilityConfirmed: true|false
vendorPrObserved: true|false
date: YYYY-MM-DD
operator: <name>
---

# yellow-jules Owner Smoke Result

Procedure: [smoke-procedure.md](smoke-procedure.md).

## Summary

One or two sentences: what was run, against which repository and scratch branch,
and the overall verdict.

## Environment

| Item            | Value                        |
| --------------- | ---------------------------- |
| yellow-jules    | `<version>`                  |
| Claude Code     | `<version>`                  |
| Node            | `<version>`                  |
| Controller host | `<host>`                     |
| Scratch branch  | `scratch/jules-smoke-<date>` |
| Grant id        | `jg-…` (revoked: yes/no)     |

## Results

| Section | Check                                                           | Result (pass/fail) | Notes and ids |
| ------- | --------------------------------------------------------------- | ------------------ | ------------- |
| B       | Agent shell refused; grant written on a real terminal; modes    |                    |               |
| C       | One session created; plan inspected; one write within the grant |                    |               |
| C       | Initial prompt echoed back without tripping supervision         |                    |               |
| D       | Interrupted launch did not duplicate the task                   |                    |               |
| E       | Patch collected; independently checked; checkout untouched      |                    |               |
| F       | No pull request created by the vendor                           |                    |               |
| F       | No merge                                                        |                    |               |
| G       | Archived session visible in an unfiltered sessions walk         |                    |               |
| H       | Live Codex session (optional)                                   |                    |               |

## Decisions this result feeds

- **Vendor PR in the smoke** (`vendorPrObserved`): did Jules open a pull request
  despite auto-PR being off? If yes, say what shell 04 should do with one.
- **Archive visibility** (`archiveVisibilityConfirmed`): does an archived
  session appear in an unfiltered walk? This is the observation that can unlock
  the `released` reconcile outcome once a follow-up decides how the flag is set.

## Anything that surprised you

Vendor behavior that differed from the contract: response shapes, state names,
the initial prompt echo, activity ordering, errors.
