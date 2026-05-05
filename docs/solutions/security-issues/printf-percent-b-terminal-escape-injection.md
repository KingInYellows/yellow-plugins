---
title: 'printf `%b` in Colored Output Helpers Enables Terminal Escape Injection'
date: 2026-04-28
category: 'security-issues'
---

## Summary

Shell helper functions like `error()`, `warning()`, and `success()` commonly
use `printf` with multiple `%b` specifiers — one for an opening color constant,
one for the closing reset, and (the risky part) **one for the message argument
`$1` itself**. Because `%b` interprets backslash escape sequences in its
argument, any caller that passes external output (a CLI's stderr, a pip error
string, a parsed version field) directly to that `%b` slot lets that source
inject `\033[...m`, `\n`, `\t`, or arbitrary terminal escape sequences into the
user's terminal. The injection path requires `$1` to flow through a `%b`
specifier; a helper that uses `%b` only for known-internal color constants and
`%s` for `$1` is not vulnerable to this specific vector.

The risk materialises when the helper is called as
`error "$(some_external_command 2>&1)"` and the captured output contains
literal backslash-escape sequences as text (e.g. `\033[31m` written out as
those six ASCII characters in a debug log, Python traceback, or version
string). `%b` interprets those text sequences as terminal escapes. Note that
content emitting real ESC bytes (0x1B) directly — rather than the two-character
text `\033` — passes through both `%b` and `%s` unchanged, so `%s` does not
neutralise every terminal-injection source; it only prevents printf-level
backslash reinterpretation.

## Anti-Pattern

```bash
readonly RED='\033[0;31m'
readonly NC='\033[0m'

error() {
  printf '%bError: %b%b\n' "$RED" "$1" "$NC" >&2
  exit 1
}

# Caller passes external output as $1:
error "$(pip install pkg 2>&1)"
# pip's diagnostic output may contain literal \033[...m text sequences.
# %b reinterprets them as terminal escapes — an attacker who controls the
# package metadata or the PyPI mirror can inject arbitrary escape sequences.
```

## Pattern

Use `%s` for all variable content. Put ANSI codes inline as literal escape
sequences in the format string itself, so they are bound at function
definition rather than passed through arguments:

```bash
error() {
  printf '\033[0;31mError: %s\033[0m\n' "$1" >&2
  exit 1
}

warning() {
  printf '\033[0;33mWarning: %s\033[0m\n' "$1" >&2
}

success() {
  printf '\033[0;32m%s\033[0m\n' "$1"
}
```

Two consequences:

- The format string is a static literal — no caller controls what `%b` sees.
- `$1` flows through `%s`, which prints bytes verbatim without printf-level
  backslash interpretation. A version string containing literal text like
  `\033[31m` is shown as those characters, not as a colour change.
- Scope: `%s` prevents printf reinterpreting backslash-as-text sequences. It
  does NOT strip real ESC bytes (0x1B) that a command emits directly — those
  reach the terminal unchanged regardless of format specifier. For sources
  that may emit real escape bytes, strip them before passing to the helper
  (e.g. `strip_ansi "$(cmd)"` via `sed 's/\x1b\[[0-9;]*m//g'`).

The named-constant variables (`RED`, `GREEN`, `YELLOW`, `NC`) become unused
after this fix; remove them to silence shellcheck SC2034.

## Detection

**Step 1 — find `printf` calls that have any `%b` in the format string:**

```bash
# Find printf calls whose format string contains %b:
rg -nP "printf\s+['\"][^'\"]*%b[^'\"]*['\"]" plugins/*/scripts/*.sh
```

**Step 2 — for each match, confirm whether `%b` consumes untrusted data.**

The regex above intentionally casts a wide net. Triage each match:

- **Safe (not risky):** `%b` arguments are exclusively known-static color
  constants declared `readonly` in the same script (e.g.,
  `printf '%b%s\n' "$RED" "$1"` where `readonly RED='\033[0;31m'`).
  Here `%b` only interprets the controlled constant; `%s` handles all
  variable/external content.

- **Risky:** any of the following shapes:
  - `printf '%b' "$var"` — a single `%b` consuming a variable directly.
  - `printf '%b%b\n' "$RED" "$1"` — `$1` (caller-supplied) reaches `%b`.
  - `printf "$FMT" ...` — format string itself is a variable; `%b` may
    appear at runtime depending on `$FMT`.
  - Multi-arg where it is not clear which variable maps to `%b` — count
    `%` specifiers in order vs. argument positions to confirm.

A quick confirmation for ambiguous cases — check whether all `%b`
arguments are drawn from `readonly` constants declared in the same file:

```bash
# List readonly color constants in the same file to cross-check %b args:
rg -n 'readonly\s+(RED|GREEN|YELLOW|BLUE|NC|RESET|BOLD)=' <file>.sh
```

If every argument bound to a `%b` slot is in that set, the call is safe.
If any `%b` slot receives `$1`, `$2`, `"$(cmd)"`, or any other non-readonly
external value, it is the risky pattern and should be fixed per the
Pattern section above.

## Origin

PR #248 (yellow-mempalace plugin), security-sentinel agent. The script's
`error` was called as `error "pipx install --force both failed. Try manually:
pipx upgrade mempalace"` — a literal string today, but the pattern is
fragile if a future caller passes captured output. Pre-emptive fix applied.

## See Also

- `docs/solutions/security-issues/heredoc-delimiter-collision.md` — related
  shell-injection pattern via heredoc delimiters.
- MEMORY.md "Shell Script Security Patterns" — printf format string rules.
