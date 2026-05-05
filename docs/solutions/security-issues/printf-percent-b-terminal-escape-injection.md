---
title: 'printf `%b` in Colored Output Helpers Enables Terminal Escape Injection'
date: 2026-04-28
category: 'security-issues'
---

# printf `%b` in Colored Output Helpers Enables Terminal Escape Injection

## Summary

Shell helper functions like `error()`, `warning()`, and `success()` commonly
use `printf` with `%b` to inject ANSI color codes around a message. The `%b`
specifier interprets backslash escape sequences in the argument — so any
caller that passes external output (a CLI's stderr, a pip error string, a
parsed version field) lets that source inject `\033[...m`, `\n`, `\t`, or
arbitrary terminal escape sequences into the user's terminal.

The risk increases when the helper is called as
`error "$(some_external_command 2>&1)"` because the captured output contains
literal `\033` bytes that `%b` will faithfully reinterpret.

## Anti-Pattern

```bash
readonly RED='\033[0;31m'
readonly NC='\033[0m'

error() {
  printf '%bError: %s%b\n' "$RED" "$1" "$NC" >&2
  exit 1
}

# Caller passes external output as $1:
error "$(pip install pkg 2>&1)"
# pip emits literal \033 bytes inside its diagnostic — terminal receives
# arbitrary escape sequences from an attacker who controls the package
# metadata or the PyPI mirror.
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
- `$1` flows through `%s`, which prints bytes verbatim without escape
  interpretation. A malicious version string `\033[red]ERR\033[0m` is shown
  as the literal text sequence, not a color change.

The named-constant variables (`RED`, `GREEN`, `YELLOW`, `NC`) become unused
after this fix; remove them to silence shellcheck SC2034.

## Detection

```bash
# Find risky helpers in install/setup scripts:
rg -nP "printf\s+'[^']*%b[^']*'" plugins/*/scripts/*.sh
```

A match where `%b` is followed by a `%s`-like content slot signals the
pattern. False positives: `%b` used to print a known internal constant
(e.g., a flag set by the script itself).

## Origin

PR #248 (yellow-mempalace plugin), security-sentinel agent. The script's
`error` was called as `error "pipx install --force both failed. Try manually:
pipx upgrade mempalace"` — a literal string today, but the pattern is
fragile if a future caller passes captured output. Pre-emptive fix applied.

## See Also

- `docs/solutions/security-issues/heredoc-delimiter-collision.md` — related
  shell-injection pattern via heredoc delimiters.
- MEMORY.md "Shell Script Security Patterns" — printf format string rules.
