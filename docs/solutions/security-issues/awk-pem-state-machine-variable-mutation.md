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
onto a single line — a `-----BEGIN … KEY-----` marker, `<base64 body>`, and
a same-line `-----END … KEY-----` marker all on one line — or one quoted
inline inside a JSON string or prose sentence — never matches, because the
anchored pattern requires the BEGIN marker to be the *entire* line
(`^...[[:space:]]*$`). The redaction state
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
plus six new yellow-codex sites, three in `agents/review/codex-reviewer.md`
and three in `commands/codex/review.md` — in commit `cda089c2`):**

The BEGIN/END regex change below is identical at all 7 sites; what gets
`print`-ed on a match differs by each site's surrounding structure — a
literal `"--- redacted credential at line " NR " ---"` string at five of
the six new sites, a `label` variable assigned earlier in scope at the
sixth (`redact_credentials()` in codex-reviewer.md), and a `line` variable
in the canonical SKILL.md. Only the unanchored regex shown here is the
shared fix:

```awk
if ($0 ~ /-----BEGIN [A-Z ]*PRIVATE KEY-----/) in_pem = 1
if (in_pem) {
  print "--- redacted credential at line " NR " ---"
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

**Residual exposure (not fixed by this Update):** `gemini-reviewer.md:348`
and `opencode-reviewer.md:363` still carry the pre-fix anchored pattern
(`^-----BEGIN [A-Z ]+PRIVATE KEY-----[[:space:]]*$`) on both the BEGIN and
END tests. This Update's fix landed only at the 7 sites listed above — the
canonical `council-patterns` SKILL.md and the new yellow-codex sites — not
in these two older siblings. A single-line or inline PEM key still passes
through unredacted in both files today. Porting the unanchored fix to
these two sites is tracked as follow-up work, not covered by this PR.

**Components (this Update):**
`plugins/yellow-council/skills/council-patterns/SKILL.md`,
`plugins/yellow-codex/agents/review/codex-reviewer.md`,
`plugins/yellow-codex/commands/codex/review.md`.

## Update — 2026-09-09: canonical-vs-copy drift hid a third trade-off — anchored classifier narrow-wrap leak (PR #781)

**Context:** `council.md` carried two 189-line copies of this exact awk
program (the Step 4 claude-leg pass and the Step 7 report-build pass) —
both roughly 101 lines behind the 290-line canonical body in
`council-patterns/SKILL.md`, still running the single-pass decoration
stripper the 2026-08-06 Update above already showed leaks, and missing the
stray-window release fix. This was a tracked gap, not a silent one:
`tests/lib/extract-redaction-awk.bash` only recognizes a bare, column-zero
`awk '` opener and returns one body per file, so it cannot see council.md's
two bodies, each indented inside a shell variable assignment.
`scripts/council-roster.json` carried council.md in an explicit
`redaction_known_untested` entry rather than letting it silently drop out
of coverage — but "tracked" is not "tested."

**Behavioral suite against the pre-sync body:** run once before the sync
landed, it produced 4 failures, all over-redaction. None of the suite's
leak checks failed — the stale body's known weakness was redacting too
much, not leaking.

**The trade-off found on re-review:** the canonical classifier decides
real-block vs. stray-mention once, at BEGIN time, by anchoring the
decoration-stripped BEGIN line full-line: a marker that is essentially the
whole line is a genuine key (unbounded, fail-closed); a marker sharing its
line with other text (a report merely quoting it) falls to a bounded
window with a body-width floor, so an ordinary report is not swallowed
whole. On a case built to probe exactly that boundary — a sentence that
ends by quoting the BEGIN marker, immediately followed by a real key body
wrapped narrower than the bounded path's floor (under 20 characters wide)
— the _old_, pre-sync, tail-anchored-only classifier happened to leak 0
lines of that body. The _new_, canonical, full-line-anchored classifier
leaks 2, because the real block is classified as a stray mention and only
escapes redaction once its width floor is satisfied.

**This is not a regression to revert.** The full-line anchor exists
specifically to close the under-redaction bypass this file's 2026-08-06
Update documents — a single-line or inline key sharing a line with a BEGIN
marker used to pass through completely unredacted. Leaking 2 lines of a
narrow body is strictly better than that. But it is a real, measured
regression against the specific stale behavior it replaces, on this one
shape, and the General Rule above applies: don't fix this by loosening the
anchor in isolation, that reopens the worse bug.

**Fix direction (tracked, not yet landed):** add a fixture for the
prose-prefixed, narrow-wrapped-body shape to the behavioral suite before
any width/anchor tuning, so the specific trade-off is measured against a
regression test rather than re-derived from memory next time someone
touches this classifier.

**Root-cause echo:** the same review round flagged that the canonical
SKILL.md names none of its own copy sites in prose — an editor changing
the canonical block has no way to discover council.md carries two of them
short of reading `scripts/council-roster.json`. That is the concrete
mechanism behind the #703 hardening pass missing this file in the first
place. See the companion Update in
`docs/solutions/code-quality/frontmatter-sweep-and-canonical-skill-drift.md`.

**Documentation gotcha:** `scripts/validate-council-roster.js`'s Rule R
walks the entire repository — including `plans/`, `docs/brainstorms/`, and
gitignored paths like `.claude/agent-memory/`; only `.git/`,
`node_modules/`, and the validator's own files are excluded — looking for
two literal function-definition strings that identify a copy of this awk
program. A prose file that quotes both together, anywhere, is treated as
an undeclared carrier and fails `pnpm validate:schemas`. When writing
about this code outside the canonical source and its registered carriers,
refer to the two functions separately rather than pairing their exact
definitions in one place.

**Components (this Update):**
`plugins/yellow-council/commands/council/council.md`,
`plugins/yellow-council/skills/council-patterns/SKILL.md`,
`scripts/council-roster.json`,
`plugins/yellow-council/tests/lib/extract-redaction-awk.bash`.

## Update — 2026-09-09: multi-body walker hardening closes three silent-pass gaps (PR #782)

PR #782 stacks directly on #781 and replaces the one-body-per-file extractor
with a content-anchored multi-body walker plus a fatal identity gate. Four
review findings extend the exact carrier-detection failure modes this doc
already tracks.

**Single-sourced markers.** The walker used to hardcode its own copy of the
two marker strings that identify the program, even though the bash lib's
header already claimed its array was the single source. It now receives both
markers via `-v` assignment from that array, so only one place authors them.

**Derived cross-check catches a corrupted anchor, not a deleted site.** The
walker counts marker occurrences and fails if the counts disagree, catching a
mangled anchor line that would otherwise let a copy silently vanish from the
walk while the roster validator still counts it as shipped. Documented
limitation, tracked not landed: a wholesale-deleted redaction site removes
both counts together, so the check still reports agreement and passes — a
companion pr-test-analyst finding flagged the same gap from the test side (no
fixture pins a per-carrier body count). Storing a per-carrier count in the
roster was declined — a stored count is itself a drift site. The tracked fix
direction instead ties site presence to consumer presence: assert that every
`awk "$redact_awk"` consumer in council.md sits after a
`local redact_awk='` opener in the same function, rather than deriving
presence from a number.

**A fatal gate needs a test of its own failure path.** `redaction.bats`'
`setup_file()` identity gate is fatal — if it fails, no behavioral test runs
— and its own failure path had only been checked by hand. The comparison
loop is now a lib function (`check_body_identity`) with a dedicated drift
unit test in `extract.bats`.

**Rule R had two more silent-pass shapes, both closed.** Adding the bash lib
to the validator's file-exclusion set (to stop it tripping its own detector)
also silently dropped it from the unrelated Rule S prose-sweep ledger — an
exclusion built for one rule narrowed a different rule's coverage. Fixed by
scrubbing just the marker-array span from the lib's body at carrier-detection
time instead of excluding the whole file. Separately, the marker strings
parsed from the bash array were never checked against the file they identify
— a stale marker (renamed function, edited signature) used to yield zero
carriers and a vacuous Rule R pass, the same silent-green class as the
mutation-before-test and full-line-anchor bugs above, one layer up in the
tooling. Fixed: markers must be found inside `CANONICAL_SOURCE`'s own body,
arity pinned to exactly two, both array regexes anchored (this doc's
original Key Insight, applied to a validator script), multi-match
declarations treated as errors.

**A silencing anti-pattern worth flagging on sight.** Mid-review, the
SELF_FILES exclusion above was found with its Rule S ledger stamp deleted —
and the validator's own error message had pointed that way: it reads
`council-roster.json "prose_sites" lists "<file>", which no longer restates
the roster — remove the entry`. That message is correct about the symptom
(the file no longer restates the roster, because it had just been excluded
from the walk) but "remove the entry" is a coverage-change instruction, not
a green light — deleting the entry "fixed" the validator error by removing
what it was checking, not by fixing the coverage gap. The eventual fix
(scrub-the-span) restores the stamp. General lesson: when a validator's own
error message tells you to delete its own tracking entry, that message is
describing a coverage change, not authorizing one — the question to ask is
why the file stopped being scanned, before deleting anything.

**Basename-keyed extraction can compare a carrier against itself twice.**
Body files are keyed by the carrier's basename; two carriers sharing a
basename would silently overwrite the first's bodies with the second's, and
the identity gate would then compare the survivor's bodies twice while never
touching the overwritten file's actual content. Fixed: basename uniqueness
is asserted before extraction. Path-keyed naming is tracked as follow-up,
since no current carrier set collides.

**Carrier discoverability closes the loop from the PR #781 Update above.**
Both reviewer agents now carry a provenance comment above their copy of the
program (matching council.md's sites), and AGENTS.md's validation matrix now
routes any carrier-file edit to the bats gate.

**Components (this Update):**
`plugins/yellow-council/tests/lib/extract-redaction-bodies.awk`,
`plugins/yellow-council/tests/lib/extract-redaction-awk.bash`,
`plugins/yellow-council/tests/redaction.bats`,
`plugins/yellow-council/tests/extract.bats`,
`scripts/validate-council-roster.js`,
`plugins/yellow-council/agents/review/gemini-reviewer.md`,
`plugins/yellow-council/agents/review/opencode-reviewer.md`, `AGENTS.md`.
