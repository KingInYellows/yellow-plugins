---
title: 'Classification tier mutual exclusivity, guard branch coverage, and CRLF normalization boundary'
date: 2026-07-08
category: logic-errors
track: bug
problem: 'Unreachable PARTIAL clause, incomplete zero-output guard, and per-regex CRLF patching all stem from unfinished generalization of an identical fix'
tags: [setup-all, classification, guard-completeness, crlf, validator, exhaustiveness]
components: [yellow-core]
pr: '#625'
---

# Classification tier mutual exclusivity, guard branch coverage, and CRLF normalization boundary

## Problem

A 20-persona review of PR #625 (`fix(yellow-core): setup:all accuracy audit +
validator hardening`) found zero P0/P1 issues, but three P2 findings shared
one underlying failure class: a fix applied to one branch, tier, or regex of
a conditional was not generalized to the sibling cases that share the exact
same failure mode — even though the identical fix had *already* been applied
elsewhere in the same file. Generalizing a one-off fix does not happen
automatically; it has to be checked for deliberately.

## Symptoms

1. **Correctness** (`plugins/yellow-core/commands/setup/all.md`): yellow-ci's
   newly-added PARTIAL clause ("all other READY conditions hold but
   `yellow-linear` is NOT INSTALLED") was dead code — top-down classification
   always matched READY first, because READY didn't exclude the
   yellow-linear-missing case. The identical bug had already been fixed for
   yellow-debt earlier in the same file (yellow-debt's READY already excluded
   the yellow-linear-missing case) before yellow-ci's clause was even added.
2. **Reliability / adversarial** (same file): Step 2 classification had a
   halt guard for `plugin_cache: NOT FOUND` but not for the sibling
   `plugin_cache_warning: unable to inspect plugin cache` branch (missing
   python3/jq). Both branches emit zero installed-status lines, so both make
   "plugin absent from output" ambiguous with "plugin not installed" — but
   only one branch was guarded.
3. **CLI-readiness** (`scripts/validate-setup-all.js`): new `$`-anchored
   bullet regexes broke on CRLF input — the exact failure class the same
   file's frontmatter regex (`/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/`) had
   already been hardened against, one function earlier in the same file.

## What Didn't Work

- Fixing the PARTIAL clause's wording without touching READY's exclusion
  list — the new prose was correct but unreachable given top-down evaluation
  order.
- Keying the halt guard to one specific console message
  (`plugin_cache: NOT FOUND`) instead of the general condition it represents
  ("Step 1 emitted zero installed-status lines").
- Hardening individual regexes for CRLF one at a time as they were found,
  instead of normalizing the input once at the file-read boundary.

## Solution

**1. Classification tiers must be provably mutually exclusive, not just
individually documented.** For any top-down tier classification (READY /
PARTIAL / NEEDS SETUP), every condition that grants a *lower* tier must be
explicitly excluded from every tier ranked above it — a reader cannot infer
"READY excludes X" just because "PARTIAL says X" reads correctly in
isolation. Fix (mirrors the already-correct yellow-debt block in the same
file):

```
**yellow-ci:**

- READY: `gh` OK AND `jq` OK AND `ssh` OK AND `gh_auth` OK AND
  `.claude/yellow-ci.local.md` exists AND `yellow-linear` installed
- PARTIAL: `gh` OK AND `jq` OK AND config exists, but `ssh` is missing or
  `gh_auth` is not authenticated — OR all other READY conditions hold but
  `yellow-linear` is NOT INSTALLED (optional — only `/ci:report-linear`
  needs it)
- NEEDS SETUP: `gh` missing OR `jq` missing OR config missing
```

Verification technique: for every PARTIAL/fallback clause, check whether its
trigger condition's negation appears in that same block's READY condition.
If it doesn't, the clause is unreachable under top-down evaluation.

**2. A guard added for one zero-output branch must cover every branch with
the same output shape, not just the one that triggered the finding.** Step
1's cache probe has two failure branches that both emit zero
installed-status lines (`plugin_cache: NOT FOUND` — cache dir missing, and
`plugin_cache_warning: unable to inspect plugin cache` — dir exists but
python3/jq unavailable to inspect it). Both make "no installed-status line
for plugin X" ambiguous between "not installed" and "couldn't be
determined." Fix:

```
If Step 1 printed `plugin_cache: NOT FOUND` OR `plugin_cache_warning: unable
to inspect plugin cache`, STOP before classifying: in both branches no
installed-status lines were emitted, so installed state is unknown for every
plugin — do NOT read the absence of a plugin's line as `NOT INSTALLED`.
Report the matching cause ...
```

Verification technique: identify a guard by its *output shape* ("this branch
emits zero X"), not by the specific message that prompted the fix, then grep
the surrounding code for every other branch that produces the same output
shape.

**3. Normalize CRLF once at the read boundary, not per-consumer.**
`scripts/validate-setup-all.js` had already special-cased CRLF in its
frontmatter regex before this PR added new `$`-anchored bullet regexes that
broke on the same CRLF input. Fix — normalize once where the file enters the
program, so every regex written afterward is CRLF-safe by construction:

```js
// Normalize CRLF once so every $-anchored line regex downstream stays
// correct if a file picks up Windows line endings (documented WSL2
// hazard — see CLAUDE.md "Cross-platform file portability").
setupAll = readText(SETUP_ALL_PATH).replace(/\r\n/g, '\n');
references = readText(REFERENCES_PATH).replace(/\r\n/g, '\n');
```

This is the same underlying hazard as
[wsl2-crlf-pr-merge-unblocking.md](../workflow/wsl2-crlf-pr-merge-unblocking.md)
(WSL2's Write tool produces CRLF files) surfacing in a different consumer —
a Node parser's regexes, not git's merge machinery. The fix pattern
generalizes: once CRLF-fragility is found in one regex, normalize the input
at the file-read call site instead of patching that one regex.

## Why This Works

All three findings share the same shape: a partial fix (one classification
arm, one guard branch, one regex) had already proven the failure class was
real and worth fixing elsewhere in the identical file — but the fix wasn't
generalized to the sibling cases with the same shape. Checking "does this
fix's precondition also apply to the other branches/tiers/regexes in this
file" during self-review would have caught all three before the 20-persona
pass did.

## Prevention

- When adding a PARTIAL/fallback classification clause, verify its trigger
  condition is excluded from every tier ranked above it in the same block
  (top-down evaluation means an unexcluded condition makes the clause
  unreachable).
- When adding a guard for a zero-output/failure branch, search the
  surrounding function for sibling branches with the same output shape (not
  just the same error message) before considering the guard complete.
- When a regex breaks on CRLF, don't patch that regex in isolation —
  normalize line endings once at the file-read boundary
  (`readText(...).replace(/\r\n/g, '\n')`) so every regex written after that
  point inherits the fix.
- Self-review checklist item: "I just fixed this bug in one
  branch/tier/regex — does the identical bug exist in this file's other
  branches/tiers/regexes?"

## Related Documentation

- [setup-classification-probe-coupling.md](../code-quality/setup-classification-probe-coupling.md) —
  same file (`setup/all.md`), a different coupling failure (probe list
  drift) in the same classification system
- [wsl2-crlf-pr-merge-unblocking.md](../workflow/wsl2-crlf-pr-merge-unblocking.md) —
  the git-level CRLF hazard sharing a root cause with this PR's
  validator-level CRLF fix
