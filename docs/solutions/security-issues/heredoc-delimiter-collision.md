---
title: 'Heredoc Delimiter Collision with User-Supplied Input'
date: 2026-02-26
category: 'security-issues'
---

# Heredoc Delimiter Collision with User-Supplied Input

## Problem

When a shell heredoc captures user-supplied free text and the delimiter word
is a common English word, the heredoc closes prematurely if the user types
that word on a line by itself.

Example from `plugins/yellow-debt/commands/debt/triage.md`:

```bash
REASON=$(cat <<'REASON'
<user types their defer reason here>
REASON
)
```

If the user's defer reason contains the word `REASON` on its own line (e.g.,
`REASON: timeline conflict`), the heredoc closes at that line and the variable
captures only the text up to that point. The remainder of the user's input
becomes shell syntax — potentially a command injection vector.

This is a P1 security finding because:
1. The truncation silently produces wrong data written to files
2. In the worst case, text after the premature close is interpreted as shell
   commands

## Detection

Search for heredocs in command files and hook scripts that use short, common
English words as delimiters:

```bash
# Find heredoc delimiters in shell blocks within markdown
grep -rE "<<'[A-Z]{2,10}'" plugins/*/commands/**/*.md

# Find heredoc delimiters in shell scripts
grep -rE "<<'[A-Z]{2,10}'" plugins/*/hooks/scripts/*.sh
```

Delimiters at risk: `EOF`, `END`, `REASON`, `INPUT`, `TEXT`, `DATA`, `BODY`,
`MSG`, `NOTE`, `CONTENT`, `PROMPT`, `MESSAGE`. Any word a user might plausibly
type on its own line in a free-text field.

## Fix

Use a long, unique, unlikely-to-appear-in-user-content delimiter:

```bash
# WRONG — REASON is a common word the user might type
REASON=$(cat <<'REASON'
<user defer reason>
REASON
)

# RIGHT — unique delimiter with structural prefix and suffix
REASON=$(cat <<'__EOF_DEFER_REASON__'
<user defer reason>
__EOF_DEFER_REASON__
)
```

### Delimiter naming convention

Use the pattern `__EOF_<CONTEXT>__` where `<CONTEXT>` describes what the
heredoc captures:

| Use case | Delimiter |
| -------- | --------- |
| Defer reason | `__EOF_DEFER_REASON__` |
| Commit message | `__EOF_COMMIT_MSG__` |
| Issue description | `__EOF_ISSUE_BODY__` |
| PR summary | `__EOF_PR_SUMMARY__` |
| User note | `__EOF_USER_NOTE__` |

The double-underscore prefix and suffix make accidental collision with any
realistic user input effectively impossible.

### Quoted vs unquoted delimiters

Always use quoted delimiters (`<<'__EOF__'` not `<<__EOF__`) when capturing
user input. Unquoted heredoc delimiters allow `$variable` and backtick
expansion inside the body — a separate injection risk.

```bash
# WRONG — unquoted: $variables expand inside, potential injection
REASON=$(cat <<__EOF_DEFER_REASON__
The $REASON is: $(some-command)
__EOF_DEFER_REASON__
)

# RIGHT — single-quoted: content is literal, no expansion
REASON=$(cat <<'__EOF_DEFER_REASON__'
The $REASON is: $(some-command)  # literal, not expanded
__EOF_DEFER_REASON__
)
```

## Prevention

- Code review checklist: any heredoc in a command that accepts free-text user
  input must use a `__EOF_<CONTEXT>__` style delimiter
- Grep check before merge: `grep -rE "<<'[A-Z]{2,10}'"` on all command and
  hook files — flag anything with a short common-word delimiter
- Template: when authoring new commands that capture user input via heredoc,
  always start from `<<'__EOF_<CONTEXT>__'`

## Related

- `MEMORY.md` — "Command File Anti-Patterns": `Heredoc for user-supplied free
  text` (PR #74) — covers the safe-passing pattern after capture
- `plugins/yellow-debt/commands/debt/triage.md` — fixed in this review session
