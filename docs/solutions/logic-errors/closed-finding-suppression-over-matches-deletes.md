---
title: 'Suppressing re-audit findings against closed todos: over-matching and over-deleting'
date: 2026-10-02
category: logic-errors
track: bug
problem: 'yellow-debt wont-fix matching hid unrelated findings and the pending wipe deleted closed todos named pending'
tags: [yellow-debt, wont-fix, fingerprint, audit-synthesizer, data-loss-prevention, silent-failure]
components:
  [
    plugins/yellow-debt/lib/validate.sh,
    plugins/yellow-debt/agents/synthesis/audit-synthesizer.md,
    plugins/yellow-debt/commands/debt/status.md,
  ]
---

## Problem

PR #977 added a `wont-fix` todo status to yellow-debt, plus matching so a
re-audit does not resurface findings the user already closed. Review found two
opposite failures in the same feature: the matcher suppressed findings it
should not (hidden debt), and the "wipe pending todos before re-audit" step
deleted todos it should not (lost user decisions).

## Symptoms

- A closed todo named `NNN-pending-...` (legacy `wont_fix` spelling set by
  hand in the frontmatter) was deleted by the next `/debt:audit`.
- One closed finding hid every later finding of that category in the same file.
- A kept todo hid new findings whose line range merely contained its anchor.
- A completed todo hid new code that landed on the lines the fix had changed.
- The printed repair recipe failed for two of the three legacy spellings it
  named.

## What Didn't Work

- Trusting the file name as the state. The name is a cache of the frontmatter
  `status`; a hand edit makes them disagree, and the wipe acted on the name.
- Fingerprinting a finding with no line range. The key degraded to
  category plus path, which covers the whole file.
- Rehashing an older kept todo from the current tree. For a `complete` todo
  the fix already changed those lines, so the hash describes the fixed code,
  not the flagged code.
- A loose anchor fallback ("range contains the anchor line"). Any wider
  finding over the same line matched.

## Solution

All in `plugins/yellow-debt/lib/validate.sh`, called from the synthesizer:

1. `debt_pending_todos` lists a file only when the name AND the frontmatter
   status both say pending; a mismatch is reported on stderr and left alone.
2. `debt_fingerprint` requires a line range. A finding without one cannot
   fingerprint, so it resurfaces instead of matching.
3. The anchor fallback needs the kept todo's `anchor_hash` to equal the first
   substantive line of the new range, and is skipped for `security-debt`.
   Only a unique match suppresses; a tie or no match resurfaces.
4. `complete` todos are never rehashed from the tree. `wont-fix` and
   `deleted` todos are stamped with `fingerprint` and `anchor_hash` inside
   `transition_todo_state`, at close time, while the code still matches.
5. The printed repair recipe and `validate_transition` accept the same set
   (`wont_fix`, `wontfix`, `wont fix`), and a test runs the recipe.

## Why This Works

Suppression is a claim that "this finding is the same as something a human
closed". Every shortcut widened that claim: a whole-file key, a contains-match,
a tree hash taken after the code changed. The fixes make identity come from
data captured when the human decided, require it to be narrow, and make any
doubt (no range, tie, unreadable todo) fall toward resurfacing the finding.
A destructive step keyed on a derived label (file name) must re-read the
source of truth (frontmatter) first.

## Prevention

- Fail-open direction: when matching decides what to hide or delete, every
  uncertain branch must show the item or leave the file, never the reverse.
- Stamp identity at the moment of the decision, not later from mutable state.
- Before any delete or wipe keyed on a name pattern, check the field the
  pattern is supposed to mirror.
- If a recipe is printed for the user, a test must execute it, and the
  transition table it relies on must be asserted to match its text.
- Related: `docs/solutions/logic-errors/stale-sweep-deletes-hand-authored-file.md`,
  `docs/solutions/logic-errors/periodic-rebuild-wipes-incremental-cache-state.md`.

---

## Update — 2026-10-02

Second review round on PR #977 (fixed in `d00e1229`) found four more faults in
the same feature.

- **Status source disagreed between functions.** A matcher took a todo's status
  from its file name while the delete step took it from the frontmatter, so a
  closed legacy todo named `pending` survived the wipe but never suppressed its
  finding. Every function that decides what is closed must read the frontmatter
  status, and legacy spellings are mapped once.
- **The fuzzy anchor tier was too wide.** It matched `complete` and `deleted`
  todos, so a fixed function that regrew, or a later real finding on the same
  line, stayed hidden. The tier now applies only to statuses whose code is
  expected to be unchanged, and needs a substantive line (20+ bytes).
- **An exact-identity tie was treated as ambiguous.** Two kept todos with the
  same fingerprint made a finding closed twice come back every audit. An exact
  fingerprint is unambiguous: suppress on one or more. Keep the uniqueness rule
  for the fuzzy tier only.
- **Delete ran before the fallible matcher.** A matcher failure then left
  neither the old nor the new todos. The audit now runs the read-only matcher
  first and deletes afterwards, and stops if listing pending todos fails.

**Prevention additions:**

- [ ] Order read-only, fallible steps before destructive ones.
- [ ] Apply "uncertain means resurface" only to fuzzy matching. Exact identity
      is not uncertain, and treating a tie there as doubt re-opens closed work.
- [ ] Decision logic that appears in several functions (what counts as closed)
      should have one reader of the source-of-truth field.
- See also the installed-layout lesson in
  `docs/solutions/code-quality/cross-plugin-shared-skill-pattern.md`
  ("Update — 2026-10-02").
