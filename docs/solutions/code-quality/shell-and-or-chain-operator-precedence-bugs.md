---
title: Shell && / || Chain Operator-Precedence Bugs in Guard-Then-Act Patterns
date: 2026-05-04
category: code-quality
track: bug
problem: "[ -n \"$VAR\" ] && cmd 2>/dev/null || warn fires the warning when $VAR is empty AND silently swallows cmd failures when $VAR is set"
tags: [shell, operator-precedence, bash, guard, error-handling, silent-failure, command-authoring]
components:
  - plugins/yellow-council/agents/review/opencode-reviewer.md
---

# Shell `&&` / `||` Chain Operator-Precedence Bugs in Guard-Then-Act Patterns

## Problem

Yellow-council's opencode reviewer used this inline chain for session cleanup:

```bash
[ -n "$SESSION_ID" ] && opencode session delete "$SESSION_ID" 2>/dev/null || warn "cleanup failed"
```

This chain has two independent failure modes:

### Failure mode 1: Warning fires on empty `$SESSION_ID`

Shell operator precedence: `&&` and `||` are left-associative and equal
precedence. The chain parses as:

```
( [ -n "$SESSION_ID" ] && opencode session delete "$SESSION_ID" 2>/dev/null ) || warn "..."
```

When `$SESSION_ID` is empty, `[ -n "" ]` exits 1. The `&&` short-circuits —
`opencode session delete` does not run. The `||` then fires because the left
side exited non-zero. `warn "cleanup failed"` runs with an empty session ID,
producing a misleading warning that implies a delete attempt was made and
failed.

### Failure mode 2: `2>/dev/null` swallows delete errors before `||` sees them

When `$SESSION_ID` is set and `opencode session delete` fails (e.g., session
already gone, network error), the failure's stderr is silenced by
`2>/dev/null`. The `||` is triggered by the non-zero exit code — so the
warning *does* fire, but the original error message is gone. The operator
can only see "cleanup failed" with no diagnostic information.

Combined effect: the chain misreports in both the "empty variable" and "actual
error" cases, and the two cases are indistinguishable from the warning message.

## Key Insight

**Never write `[ -n "$VAR" ] && cmd || handler` when the handler is intended
only for cmd failure.** The `||` binds to the entire left side, not just `cmd`.

The `&&`/`||` inline chain is safe only when:
1. The guard condition is the first thing that can fail, AND
2. Either branch of `||` is the correct response to ANY left-side failure,
   including guard failures

For guard-then-act-then-handle patterns, use `if/then/fi` which has explicit
branch semantics.

## Fix

```bash
# WRONG: || fires on empty $SESSION_ID too
[ -n "$SESSION_ID" ] && opencode session delete "$SESSION_ID" 2>/dev/null || warn "cleanup failed"

# CORRECT: explicit if guard separates "not set" from "delete failed"
if [ -n "$SESSION_ID" ]; then
  if ! opencode session delete "$SESSION_ID" 2>/dev/null; then
    printf '[opencode-reviewer] Warning: session cleanup failed for %s\n' "$SESSION_ID" >&2
  fi
fi
```

If stderr from the delete command is useful for diagnosis, remove the
`2>/dev/null` and redirect to stderr instead:

```bash
if [ -n "$SESSION_ID" ]; then
  opencode session delete "$SESSION_ID" 2>&1 \
    || printf '[opencode-reviewer] Warning: session cleanup failed for %s\n' "$SESSION_ID" >&2
fi
```

## Detection

```bash
# Find inline && / || chains with a guard condition as the first element
# These are candidates for the misfiring-on-empty-var pattern
rg '\[ -[nz] "\$\w+"\s*\]\s*&&.*\|\|' plugins/ --include='*.md'

# Broader: any && ... || chain (any of them may have this precedence issue)
rg '&&.*2>/dev/null.*\|\|' plugins/ --include='*.md'
```

Checklist question when reviewing shell guards:

1. Can the expression before `&&` fail for a reason OTHER than cmd failure?
   (e.g., empty variable, missing file, unset env var)
2. If yes: does the `||` handler make sense for that non-cmd-failure case?
3. If no: refactor to `if/then/fi`

## Prevention

- [ ] Guard-then-act-then-warn patterns always use `if [ ... ]; then cmd; else warn; fi`
      — never inline `[ ... ] && cmd || warn`
- [ ] `2>/dev/null` is never placed between the action and its `||` error
      handler — if stderr is suppressed, the handler must not claim it observed
      an error
- [ ] When reviewing cleanup/teardown code: trace every `||` back to its left
      side and confirm the handler is appropriate for ALL ways the left side
      can fail, not just the primary intended failure
- [ ] Linter note: ShellCheck SC2015 flags `A && B || C` as potentially
      unintended — enable SC2015 in CI for command files that contain shell code

## Related Documentation

- MEMORY.md: "Command File Anti-Patterns" section — existing `&&`/`||` entries
  cover curl split and flag parsing; this extends to guard-condition misfiring
- `docs/solutions/code-quality/bash-block-subshell-isolation-in-command-files.md`
  — related shell execution pitfalls in command files
- `docs/solutions/code-quality/claude-code-command-authoring-anti-patterns.md`
  — broader command anti-patterns catalogue
