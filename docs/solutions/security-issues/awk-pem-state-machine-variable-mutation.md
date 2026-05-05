---
title: awk PEM State Machine Breaks When Testing Mutated Variable
date: 2026-05-04
category: security-issues
track: bug
problem: awk redaction state machine tests the already-overwritten line variable for END-marker, so in_pem never resets and all subsequent output is silently redacted
tags: [awk, redaction, pem, state-machine, silent-failure, security-sentinel]
components:
  - plugins/yellow-council/skills/council-patterns/SKILL.md
  - plugins/yellow-council/agents/review/gemini-reviewer.md
  - plugins/yellow-council/agents/review/opencode-reviewer.md
---

# awk PEM State Machine Breaks When Testing Mutated Variable

## Problem

A PEM private-key redaction state machine in three yellow-council files used
this pattern:

```awk
{
  line = $0
  if (line ~ /^-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/) in_pem = 1
  if (in_pem) line = "[REDACTED PEM BLOCK]"
  if (line ~ /^-----END (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/)  in_pem = 0
  print line
}
```

The END-marker test on line 5 runs against `line` — but `line` was already
overwritten to `"[REDACTED PEM BLOCK]"` on line 4. The literal string
`"[REDACTED PEM BLOCK]"` never matches `-----END ... PRIVATE KEY-----`, so
`in_pem` is never reset to 0. Every line after the first PEM block is
silently redacted, even when no PEM material is present.

## Why This Matters

The failure has two independent security consequences:

1. **Data loss:** All content after the first PEM block is replaced with the
   redaction marker. If the reviewed file or diff contains a PEM block followed
   by normal code, the entire subsequent section is lost — reviewer sees only
   `[REDACTED PEM BLOCK]` for everything.

2. **Bypass via single-line PEM:** An adversarial or malformed PEM block on a
   single line (BEGIN and END on the same line) sets `in_pem = 1` but the
   END-marker test also fails for the same mutation reason. The attacker embeds
   a single-line fake PEM header and every subsequent line is redacted,
   effectively blinding the reviewer.

Five reviewers flagged this across correctness, security-sentinel, and
silent-failure-hunter roles in the same review wave.

## Key Insight

**Always test original `$0` — never the variable that may have been mutated by
an earlier branch in the same awk block.**

State-transition tests (BEGIN/END markers, delimiter detection, boundary
matching) must evaluate the unmodified input line. Assign to a working variable
only for the output value, not for the guard condition itself.

## Fix

```awk
{
  if ($0 ~ /^-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/) in_pem = 1
  line = in_pem ? "[REDACTED PEM BLOCK]" : $0
  if ($0 ~ /^-----END (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/)   in_pem = 0
  print line
}
```

Key changes:
- All state-transition tests use `$0` directly, not `line`
- The END-marker test now correctly sees the original input and resets `in_pem`
- `line` is derived from `in_pem` after it may have changed, covering
  the edge case where BEGIN and END markers appear on the same line
  (single-line PEM block): that line is redacted, but `in_pem` resets
  immediately so the next line is not redacted

## Severity

P0. Silent data-loss for all content after the first PEM block. Bypass-capable
via single-line PEM injection. Three separate file copies meant the bug was
present in the gemini, opencode, and council-patterns skill paths
simultaneously.

## Detection

```bash
# Find awk blocks where a variable is overwritten then tested for END-marker
# against the same variable — the classic mutation-before-test pattern
rg -n 'in_pem\b' plugins/ --include='*.md' | grep -v 'in_pem = 0' | head -20

# Structural check: any awk block where line= appears before if (line ~
grep -n 'line = ' plugins/*/skills/*/SKILL.md plugins/*/agents/**/*.md 2>/dev/null \
  | grep -A2 'in_pem\|redact'
```

When reviewing any multi-line redaction state machine in awk:
- Confirm every state-transition condition uses `$0`, not a derived variable
- Confirm the END-marker test can never match the redaction placeholder string

## Prevention

- [ ] In every awk redaction block: state transitions test `$0`, not `line`
- [ ] Derived output variable (`line`) is assigned AFTER the state update
      (or derived from the current state rather than tested for transitions)
- [ ] When copying a PEM redaction snippet, run a mental trace: what is
      `line`'s value when the END-marker `if` executes?
- [ ] Add a one-line unit test: pipe a 3-line PEM block followed by a normal
      line through the awk and assert the normal line is not redacted

## Related Documentation

- `docs/solutions/security-issues/heredoc-delimiter-collision.md` — adjacent
  pattern: delimiter/marker matching bugs in shell redaction pipelines
- `docs/solutions/security-issues/prompt-injection-defense-layering-2026.md`
  — broader context on output-filtering as load-bearing security control
