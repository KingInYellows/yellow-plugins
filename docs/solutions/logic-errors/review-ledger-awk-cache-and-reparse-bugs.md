---
title:
  'Review-Findings Ledger: Literal-Text awk, Silent Cache-Write Failure, and
  Fold Re-Parse Bugs'
date: 2026-09-25
category: logic-errors
track: bug
problem:
  'awk -v backslash-escape expansion, empty git-diff cache read as exact, and
  per-call fold re-parse in review-ledger.sh line mapper and dedup'
tags:
  - awk-environ
  - git-diff-cache
  - set-u-shift-guard
  - greedy-alias-assignment
  - scope-fingerprint-redaction
  - gh-timeout
  - jq-exit-status
  - cli-usage-synopsis
  - bash-hardening
  - yellow-review
module: plugins/yellow-review
date_status: resolved
---

# Review-Findings Ledger: Literal-Text awk, Silent Cache-Write Failure, and Fold Re-Parse Bugs

## Problem

`plugins/yellow-review/lib/review-ledger.sh` -- the durable store backing
`/review:pr`'s reopen/dismiss/reverify workflow -- accumulated ten bugs found
across a full multi-persona `/review:pr` pass on PR #873. Three were P1 (silent
misclassification of findings as fixed or reproduced); seven were P2 (hangs,
mis-assignment, weak identity, and readability). All ten are fixed on
`agent/fix/review-ledger-review-pass`.

These are recurring patterns in bash scripts that pass untrusted/dynamic text
through `awk`, cache subprocess output, and re-derive per-call state from a
larger data structure -- worth checking for in any bash tool with similar shape.

## Root Cause Analysis

### P1-1: `awk -v` Silently Expands Backslash Escapes in Literal Text

**File:** `lib/review-ledger.sh`, `rl_window_match` / `rl_window_alias` (around
line 1024)

**Bug:** Anchor-line re-verification compared a stored finding's text against
the current file's content by passing the text into `awk` via `-v t="$text"`.
POSIX awk expands backslash escape sequences (`\n`, `\t`, ...) inside `-v`
assignments, so a stored anchor line like `printf "hello\n"` arrived in awk as
`printf "hello<newline>"` -- a value that can no longer equal the same literal
line read fresh from the file with `getline`/`$0`.

```bash
# BROKEN: -v expands \n, \t, etc. inside $text before awk ever sees it
awk -v t="$text" '{ if ($0 == t) print NR }' "$content"
```

**Impact:** Strict re-verification treated an unmodified anchor as changed.
Depending on the call site this either reopened a correctly-dismissed finding or
marked a still-broken finding as fixed (`reverify`/`publication` read the
mismatch as "line moved," not "still exact") -- a false positive/negative in the
safety check the ledger exists to provide.

**Fix:** Route the literal text through the environment instead of `-v`, which
does not escape-process `ENVIRON` values:

```bash
RL_AW_T="$text" awk -v c="$c" -v r="$r" -v excl="$excl" "$RL_AWK_NORM"'
  BEGIN { t = ENVIRON["RL_AW_T"]; ... }
  NR >= c - r && NR <= c + r && norm($0) == t { print NR; exit }
'
```

**Rule:** Never pass caller-controlled or file-derived text into awk through
`-v`. Use `ENVIRON["NAME"]` (exported/prefixed shell var) for any string that
must be compared byte-for-byte, and comment the reason inline -- the escape
behavior is easy to reintroduce in a future edit that "simplifies" the call back
to `-v`.

### P1-2: A Failed `git diff` Left an Empty Cache File Read as "Exact"

**File:** `lib/review-ledger.sh`, `rl_map_line` (around line 703)

**Bug:** `rl_map_line` caches each `git diff -U0 <old-blob> <new-blob>` in a
per-run temp file (`diffs-$from-$to` manifest + `diff-$from-$to-$n` body) so
repeated line-mapping calls for the same file pair are cheap. When the
`git diff` invocation itself failed (bad blob, corrupt pack, OOM), the redirect
still created an empty `$dfile`, and nothing recorded that the write had failed.
A later cache hit on that same file pair read the empty file, found no `@@`
hunks, and returned `exact` -- "the line didn't move" -- rather than signaling
that the diff was never computed.

**Impact:** `reverify`/`publication` treat `exact` as license to compare the
stored line directly. A finding whose diff failed to compute would be silently
re-verified against stale content and could be marked reproduced (or fixed)
without ever having been diffed.

**Fix:** Mark the failure beside the cache entry, and make every reader check
for the marker before trusting an empty diff body:

```bash
if ! git diff "${RL_DIFF_FLAGS[@]}" -U0 "$from:$p" "$to:$np" >|"$dfile" 2>/dev/null; then
  : >|"$dfile.fail"
fi
...
if [ -e "$dfile.fail" ]; then
  printf 'unmapped\x1f0\x1f%s' "$np"
  return 0
fi
```

**Rule:** When caching a subprocess's stdout to a file for reuse, cache the
subprocess's exit status too (a sentinel file, a suffix, a second field --
anything checkable independent of "is the body empty"). An empty successful
output and a failed invocation are not the same state, and treating them
identically converts a transient failure into a wrong answer instead of a loud
one.

### P1-3: An Alias-Branch Helper Re-Parsed the Whole Fold Per Call, Undoing the Per-Run Index

**File:** `lib/review-ledger.sh`, `rl_index_set` / `rl_sibling_lines` /
`rl_index_row` (around lines 959-1013)

**Bug:** `rl_observe_locked` builds a per-run index once (`rl_index_set`, one
`jq` pass over the fold, `\x1f`-delimited rows written to `$(rl_tmp)/index`)
specifically so downstream matching passes don't re-derive state from the full
JSON fold on every call. The alias-branch helper that finds sibling findings
sharing an anchor (`rl_sibling_lines`) originally needed a field the index row
didn't carry (the verified-scope hash), and the quickest fix at the time was to
re-parse the fold JSON directly inside the loop -- once per sibling check, once
per candidate. On a PR with many findings in one file this turned an O(n)
per-run index build into an O(n^2) re-parse, and reintroduced the exact cost the
index existed to eliminate.

**Impact:** Not a correctness bug by itself, but a performance regression severe
enough to threaten the lock-hold timeout on `observe` for large folds -- and a
design smell: the fix silently bypassed the index contract instead of extending
it.

**Fix:** Add the missing field as a new column in `RL_INDEX_JQ` (documented in
the column-number comment block above the index builder) instead of re-deriving
it ad hoc:

```
#   10 scope key (hash of the raw verified scope)
```

`rl_sibling_lines` now reads column 10 straight off `$(rl_tmp)/index` like every
other field.

**Rule:** When a per-run index/cache is missing a field a new caller needs,
extend the index schema and re-run the single build pass -- don't have the new
caller fall back to re-deriving state from the source of truth. A one-line
schema addition is cheaper than an O(n^2) regression, and keeps "the index is
the only place that reads the fold" true.

### P2-1: `shift 2` With No Value Spins the Argument Parser Forever Under `set -u`

**File:** `lib/review-ledger.sh`, every subcommand's option loop (e.g. around
line 1553)

**Bug:** Flag parsing used `shift 2` unconditionally after reading `${2:-}` for
value-taking flags. The script runs under `set -u` but not `set -e`, so if the
last token on the command line is a value-taking flag with nothing after it,
`shift 2` fails (only one positional argument remains) _without shifting
anything_, and the enclosing `while [ $# -gt 0 ]; do case "$1" in ...` loop
re-enters on the same unconsumed `$1` forever.

**Fix:** Guard every value read with `rl_need_val "$@"` (die with a usage error)
before the flag is consumed, so a value-taking flag given last always dies
instead of looping:

```bash
--run-id) rl_need_val "$@"; run="${2:-}"; shift 2 ;;
```

**Rule:** Under `set -u` without `set -e`, `shift N` failing is a silent no-op,
not a fatal error -- any `while [ $# -gt 0 ]` loop that shifts a fixed count per
flag needs an explicit argument-count check (`[ $# -ge 2 ] || die usage`) before
it shifts, or a malformed trailing flag hangs the process.

### P2-2: Greedy Best-Alias Assignment Computed Per-Candidate Lost the Second Candidate's Next-Best Match

**File:** `lib/review-ledger.sh`, Pass C alias matching in `rl_observe_locked`
(around lines 1416-1444)

**Bug:** Each candidate independently picked its single nearest existing finding
as an alias and claimed it immediately. When two candidates' nearest alias was
the same existing finding, the second candidate (processed later) had already
lost its true best option -- it either matched nothing or fell back to a worse
pairing, even though a better assignment existed if the second candidate's
_next-best_ match had been considered.

**Fix:** Compute every `(distance, candidate, existing)` triple up front, sort
by distance, and assign greedily across the whole set -- so a candidate whose
first choice is taken still gets its next-nearest available alias:

```bash
# nearest pairs first, so a candidate whose best alias is taken still gets
# its next-nearest one
while IFS=$'\t' read -r dist i eid; do
  [ -n "${match[$i]:-}" ] && continue
  [[ "$claimed" == *" $eid "* ]] && continue
  match[$i]=$eid via[$i]=alias
  claimed="$claimed$eid "
done < <(printf '%s' "$pairs_c" | sort -n -k1,1)
```

**Rule:** Greedy per-item "pick your best, claim it" assignment is only correct
when items are processed in an order that guarantees no conflict. When multiple
items can plausibly want the same resource, compute the full candidate-pair
list, sort by the ranking criterion, and assign globally -- otherwise the item
processed later loses ground it should have kept.

### P2-3: Verified Scope Was Redacted Before Fingerprinting, So Different Scopes That Redact Alike Merged

**File:** `lib/review-ledger.sh`, finding fingerprint construction (around lines
1284-1296)

**Bug:** A finding's identity fingerprint included the verified scope text, but
the value fed into the fingerprint was the already-redacted (secret masked)
display copy. Two genuinely different scopes that both contain a secret-shaped
substring redact to the same placeholder, so their fingerprints matched and the
ledger merged them into one finding.

**Fix:** Key identity on a hash of the _raw_, unredacted scope value; redact
only the separate display copy that a human or verifier reads back:

```bash
# identity uses a hash of the raw verified scope; only the display copy
# is redacted, so two scopes that redact alike never merge
scope_key=$(printf '%s' "$scope" | rl_sha256)
scope=$(rl_redact "${scope:0:200}")
```

**Rule:** Redaction is a display transform, not an identity transform. Anything
used to compute equality, dedup keys, or fingerprints must be keyed on the
pre-redaction value (or a hash of it); apply redaction only on the copy that
gets displayed or logged.

### P2-4: `gh pr view` Ran With No Timeout While Holding the Per-PR flock

**File:** `lib/review-ledger.sh`, `rl_...` PR-state check (around line 229)

**Bug:** A `gh pr view "$pr" --json state` call used to detect closed/merged PRs
ran with no timeout, while the caller held the per-PR `flock`. A hung or slow
GitHub API call blocked every other `review-ledger.sh` invocation for that PR
indefinitely.

**Fix:** Wrap the call in `timeout` when the binary is available:

```bash
if command -v timeout >/dev/null 2>&1; then
  out=$(timeout "${RL_GH_TIMEOUT:-15}" gh pr view "$pr" --json state 9>&- 2>/dev/null) || return 1
else
  out=$(gh pr view "$pr" --json state 9>&- 2>/dev/null) || return 1
fi
```

**Rule:** Any network call made while holding a lock needs a bounded timeout,
even a generous one -- the lock's own timeout (`rl_writer_gate`'s lock-acquire
timeout, in this script) only protects against a _second_ process's wait; it
does nothing to bound the _first_ process's hold time.

### P2-5: `while read ... done < <(jq ...)` Never Checked jq's Exit Status

**File:** `lib/review-ledger.sh`, index build (around line 986)

**Bug:** A process-substitution read loop
(`while IFS= read -r c; do ...; done < <(jq ...)`) consumed `jq`'s stdout line
by line but never checked `jq`'s exit status -- process substitution runs in a
subshell whose exit code the parent shell doesn't see by default. If `jq` failed
partway through (malformed input, OOM), the loop simply stopped early on
whatever partial output had been flushed, and the caller had no signal that the
finding list was incomplete.

**Fix:** Materialize the stream to a temp file with `>|`, check the redirect's
own exit status, then read from the file:

```bash
jq -r "$RL_INDEX_JQ" "$(rl_tmp)/fold.json" >|"$(rl_tmp)/index" || return 1
```

**Rule:** `done < <(cmd)` cannot observe `cmd`'s exit status through normal `$?`
/ `||` chaining. When the command's success matters (not just "did it produce
some output"), write its output to a file with a checked exit status first, then
read the file -- or capture the subshell's status explicitly (`wait $!`,
`PIPESTATUS`) if streaming must be preserved.

### P2-6: Usage Synopsis Listed `--ids-json` Before the Positional Argument the Parser Reads First

**File:** `lib/review-ledger.sh`, `rl_usage` (around line 2207)

**Bug:** The batch form of `transition` accepts `--ids-json` in place of a
positional `finding_id`, but the usage synopsis showed it as a trailing flag on
the single-finding line
(`transition <pr> <finding_id> <state> ... [--ids-json ...]`), which reads as an
optional add-on rather than the alternate calling convention it is -- the parser
actually expects `-` as the positional placeholder when `--ids-json` is used,
not the omission of a positional at all.

**Fix:** Give the batch form its own usage line:

```
transition <pr> <finding_id> <state> [--reason R] [--fix-sha S] ...
transition <pr> - <state> --ids-json '["<id>", ...]' [same flags]   (all-or-nothing; a
        fix-sha/published-head batch skips ids no longer applied and lists them)
```

**Rule:** When a CLI subcommand has two distinct calling conventions (not one
convention with an optional flag), give each its own synopsis line rather than
folding the alternate form's flags onto the primary line -- an agent or human
reading the usage string should be able to construct a valid invocation from
either line alone.

### P2-7: Scripted Rewrite Left Stale Duplicate Doc Comments Above Renamed Functions

**File:** `lib/review-ledger.sh`, various

**Bug:** An earlier large mechanical rewrite (renaming/restructuring several
helper functions) left the old doc comments in place above their renamed or
merged replacements, so some functions carried two overlapping -- and in places
contradictory -- comment blocks.

**Fix:** Delete the superseded comment block after any scripted large rewrite;
keep only the comment that describes the function's current contract.

**Rule:** A scripted rewrite (sed/awk-driven rename, bulk restructure) should
include a manual pass over doc comments immediately above every touched symbol
-- automated renames move code but not prose, and stale prose next to correct
code is worse than no comment, because it actively misleads the next reader.

## Prevention

- [ ] Grep any script for `awk -v \w+="\$` passing a shell variable that holds
      file-derived or user-derived text -- route it through `ENVIRON` instead,
      with a comment explaining why
- [ ] When caching subprocess stdout to a file for reuse, always cache (or
      check) the subprocess's exit status alongside the body -- an empty
      successful run and a failed run must be distinguishable
- [ ] When a per-run index/cache is missing a field a new caller needs, extend
      the index schema in one place rather than re-deriving state ad hoc inside
      the new caller
- [ ] Audit every `shift N` (N > 1) inside a `while [ $# -gt 0 ]` argument
      parser under `set -u` (no `-e`) for a value-count guard before the shift
- [ ] When multiple items can want the same limited resource (alias match, slot
      assignment), compute the full candidate list and assign globally by sorted
      rank -- never per-item greedy claim-and-move-on
- [ ] Never fingerprint/dedup/key equality on a redacted value; key on a hash of
      the raw value and redact only the display copy
- [ ] Wrap any network call made while holding a lock in `timeout`
- [ ] Never trust `done < <(cmd)` to propagate `cmd`'s exit status; check it
      explicitly or materialize to a file first
- [ ] After a scripted bulk rewrite, manually re-read doc comments above every
      touched symbol for staleness

## Related Documentation

- `docs/solutions/code-quality/unhandled-outcome-defaults-to-success-bucket.md`
  -- the general shape of "a failure/edge state has no slot of its own and falls
  into a default bucket," same mechanism family as P1-2 here
- `docs/solutions/logic-errors/bash-pipe-head-exit-code-masking.md` -- another
  case of a shell construct masking a subprocess's real exit status
- `docs/solutions/code-quality/prettier-description-wrap-silent-truncation.md`
  -- the companion finding from this same `/review:pr` pass (frontmatter
  `description:` truncation in `commands/review/triage.md`), documented
  separately since it is a Prettier/frontmatter issue, not a `review-ledger.sh`
  bug
