---
title: 'Fail-Open Observer Stage Patterns (statusline pipe, deadlines, backups)'
date: 2026-09-28
category: code-quality
track: knowledge
problem: "Opt-in observer stages that must fail open silently blank pipelines, swallow deadlines, or clobber backups"
tags: [fail-open, statusline, python, signal-alarm, oserror, backup, silent-failure, observer]
components:
  - plugins/yellow-core/lib/context-observer.py
  - plugins/yellow-core/lib/statusline-settings.py
  - plugins/yellow-core/lib/context-observer.sh
---

# Fail-Open Observer Stage Patterns

## Context

PR #912 (yellow-core opt-in context observer) review P2 findings produced
four patterns that recur whenever a best-effort observer is spliced into an
existing user-owned flow. Each was a silent-failure path, not a crash.

## Guidance

1. **Compose a pass-through stage that `exec`s the observer, with an
   `exec cat` fallback.** When wrapping an existing statusline command, write
   `{ command -v python3 >/dev/null && [ -r <observer> ] && exec python3 <observer>; exec cat; } | <existing>`.
   The `exec cat` covers a missing python3 or an unreadable observer file, so
   the downstream statusline still renders. `exec` makes the observer the only
   holder of the pipe's write end, so its early stdout release gives the next
   stage EOF and lets it compute while the observer records. The host still
   shows the output only once the whole command exits, so recording needs its
   own deadline. Recording inline under that deadline is the accepted
   trade-off: detaching it after stdout is released would need a background
   process, which the observer's no-subprocess contract rules out. Two forms
   to avoid:
   - A bare `python3 <observer> | <existing>` blanks the statusline on any
     startup failure.
   - The guarded group `{ python3 <observer> || cat; } | <existing>` keeps the
     write end open in its subshell until the group exits, so the early
     release never reaches the next stage.

   Trade-off: a python3 that starts but crashes before reading stdin no
   longer falls back to `cat`; the observer's own top-level try/except keeps
   that path fail-open.
2. **Deadline exception classes must not derive from `OSError`.** `TimeoutError`
   subclasses `OSError`, so a `signal.alarm` handler raising it is swallowed
   by every `except OSError:` I/O guard. Raise a dedicated
   `class DeadlineReached(BaseException)` and catch it only at the top level.
3. **Distinguish unreadable from absent.** A loader that returns `None` for
   both "no record" and "record exists but unreadable" lets callers treat
   corruption as a fresh start. Report the two differently (the observer's
   `load_previous` lets the `OSError` propagate, so the old record is kept).
4. **Never overwrite an earlier backup; report recovery distinctly.**
   Corrupt-settings recovery that writes a fixed `.corrupt.backup` destroys
   the previous backup on the second corruption. Use numbered backups
   (`.corrupt.backup`, `.corrupt.backup.2`, ...) and return a distinct
   action (`recovered`) so `--json` callers see that settings were reset,
   not that a normal enable happened.

Related smaller lessons from the same review:

- Add bats cases for future-dated timestamps (`observed_at` in the future)
  wherever age or staleness is computed.
- A slash command that gates behaviour behind an interactive prompt needs a
  non-interactive path for agents: `enable|disable --yes`, plus a read-only
  `status` that needs no confirmation.
- Do not persist advisory state (watermarks) that has no consumer; either
  expose it to the reader (`last_state`, `watermark_remaining`) or remove it.

## Why This Matters

All four failures degrade silently: the user sees an empty statusline, a
missed deadline, a false "fresh" state, or a lost backup, with no error to
trace.

## When to Apply

Any hook, statusline wrapper, or setup script that must never break the host
flow and that touches user-owned config.

## Examples

```bash
# wrap, do not replace
"statusLine": { "command": "{ command -v python3 >/dev/null && [ -r \"$OBS\" ] && exec python3 \"$OBS\"; exec cat; } | $EXISTING" }
```

```python
class DeadlineReached(BaseException):
    pass

def on_deadline(signum, frame):
    raise DeadlineReached("recording deadline reached")
```

---

## Update — 2026-09-28

Third-round P2 findings on PR #912, in four groups.

### 1. A guarded group does not release the pipe early

Time until the next stage sees EOF, with a 1 s simulated recording step:

| Stage | Time to EOF |
|---|---|
| bare `python3 obs \| existing` | 0.04 s |
| `{ python3 obs \|\| cat; } \| existing` | 2.40 s |
| `{ … && exec python3 obs; exec cat; } \| existing` | 0.02 s |

Codex reproduced it independently at about 1.06 s against 0.10 s. The
next stage did not see EOF until the recording ended because the brace group
held the pipe's write end. The fix is the `exec` stage in Guidance item 1;
`install` upgrades the earlier guarded and plain forms in place (action
`upgraded`).
The T10 EOF-timing bats test now runs the installed command under
`bash -c`. The original piped the bare observer, so it could not see this
bug. Test the composed command, not the component.

### 2. Report what actually happened

- Resetting invalid settings.json returns action `recovered` (`recover` on
  `--dry-run`), not the ordinary statusline-set action.
- `prune` counts only successful unlinks and fails with `prune_incomplete`,
  instead of swallowing `OSError` and reporting the files as removed.
- A status probe separates "not enabled" from "could not tell" (for example
  `settings_jsonc`): report an unknown state with the error code.

### 3. Validate numbers at the boundary

`json.loads` accepts `NaN` and `Infinity`. A `number_or_none` helper that
only checks the type writes non-JSON tokens and defeats equality-based
throttles such as `unchanged()` (`NaN != NaN`). Guard with `math.isfinite`.

### 4. Keep docs and commands in step with the code

- `docs/security.md` drifted three ways: it said no code path prunes
  records (on-demand `prune` ships), that the reader exposes four fields (it
  returns six), and that lookup tries the primary slug first (the reader
  takes the newest record across all projects). Re-check enumerated claims
  when a feature grows.
- A slash command whose `argument-hint` lists subcommands needs a fenced
  Arguments section that parses `$ARGUMENTS`.
- Drop tool-call-budget claims once later steps add calls.
- Untested promises need cases: the 0700/0600 file modes and the
  `observer_not_removable` path.
