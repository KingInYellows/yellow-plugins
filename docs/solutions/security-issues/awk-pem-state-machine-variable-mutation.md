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
rg -n --glob 'plugins/*/skills/*/SKILL.md' --glob 'plugins/*/agents/**/*.md' \
  'line = ' \
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

## Update — 2026-08-06: full-line anchoring bypasses redaction for single-line/inline PEM keys (PR #700)

A second, independent bug in the same PEM redaction state machine — distinct
from the `line` vs `$0` mutation-before-test bug above, but living in the
same lineage of files. `plugins/yellow-council/skills/council-patterns/SKILL.md`
(the canonical source other PEM redaction blocks are copied from) anchored
both the BEGIN and END marker tests to the full line:

```awk
if ($0 ~ /^-----BEGIN [A-Z ]*PRIVATE KEY-----[[:space:]]*$/) in_pem = 1
```

A PEM block spanning multiple lines matches this fine. A PEM key flattened
onto a single line — `-----BEGIN RSA PRIVATE KEY----- MIIEow... -----END
RSA PRIVATE KEY-----`, or one quoted inline inside a JSON string or prose
sentence — never matches, because the anchored pattern requires the BEGIN
marker to be the *entire* line (`^...[[:space:]]*$`). The redaction state
machine never fires; the key passes through untouched. This bypasses
redaction entirely rather than just mis-tracking state, which is a more
severe failure mode than the original mutation bug: there, redaction fired
too much (over-redaction, data loss); here, redaction never fires at all
(under-redaction, credential leak).

**How it was found:** PR #700 ported the same PEM redaction block from the
canonical `council-patterns` SKILL.md into six new sites across plugins/yellow-codex (three in
agents/review/codex-reviewer.md, three in commands/codex/review.md),
faithfully copying
the anchoring bug along with the pattern it was meant to reuse. Adversarial,
correctness, and Codex reviewers each independently flagged the anchored
regex across the new sites; tracing it back to the source showed the bug
predated PR #700 and had been latent in the canonical file the whole time.

**The trap in the naive fix:** unanchoring only the BEGIN check (to catch
inline/single-line keys) while leaving the END check anchored reintroduces
the never-terminating `in_pem` bug this doc's original entry already covers
— a single-line BEGIN+END pair would set `in_pem = 1` on the unanchored
BEGIN match but never satisfy the still-anchored END match, so every line
after it would stay redacted. **Both the BEGIN and END checks must be
unanchored together**, as a single change, or the fix trades one bypass for
the other bug this doc already documents.

**Fix (applied at all 7 sites — the canonical `council-patterns` SKILL.md
plus 6 new codex-reviewer.md sites — in commit `cda089c2`):**

```awk
if ($0 ~ /-----BEGIN [A-Z ]*PRIVATE KEY-----/) in_pem = 1
if (in_pem) {
  print label
  if ($0 ~ /-----END [A-Z ]*PRIVATE KEY-----/) in_pem = 0
  next
}
```

Unanchored substring matches on purpose — both ends. A code comment at the
fix site now states the rationale inline so a future copy of this pattern
doesn't reintroduce full-line anchoring by "cleaning up" what looks like an
overly loose regex.

**General rule (an addition to the "Key Insight" above, not a replacement
for it):** when a delimiter-pair state machine (BEGIN/END, open/close,
start/stop) needs one end's match condition changed, treat both ends as one
unit to change together. Fixing only the end you're looking at — because
that's the one the current bug report names — reliably reintroduces a
different failure mode at the other end, because the two conditions are
coupled through the same state variable. This is the second time this exact
PEM state machine has broken via a "fix half the pair" trap: the first was
testing the wrong variable on one end (original entry above), this one is
anchoring one end differently than the other.

**Propagation note:** this is the second bug found in this same
canonical-source-copied-into-siblings lineage (`council-patterns` SKILL.md →
gemini-reviewer.md / opencode-reviewer.md → now codex-reviewer.md). Any
future new sibling reviewer that copies this PEM redaction block should be
diffed against the canonical source's current state, not against whichever
sibling file was most recently updated — copying a stale sibling risks
reintroducing either the mutation bug or the anchoring bug independently.

**Components (this Update):**
`plugins/yellow-council/skills/council-patterns/SKILL.md`,
`plugins/yellow-codex/agents/review/codex-reviewer.md`,
`plugins/yellow-codex/commands/codex/review.md`.
