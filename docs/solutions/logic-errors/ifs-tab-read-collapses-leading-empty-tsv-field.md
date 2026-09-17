---
title: Bash IFS Set to Tab Still Collapses a Leading Empty jq @tsv Field
date: 2026-09-16
category: logic-errors
track: bug
problem: IFS=$'\t' read still treats tab as IFS whitespace, so a leading empty jq @tsv column is stripped instead of assigned, shifting every field left
tags: [bash, shell, ifs, jq, tsv, field-splitting, shell-scripting]
components:
  - plugins/yellow-ruvector/hooks/scripts/session-start.sh
---

# Bash `IFS=$'\t' read` Collapses a Leading Empty Field When Splitting jq @tsv Output

## Problem

Splitting `jq -r '[...] | @tsv'` output with `IFS=$'\t' read -r a b c`
silently drops a leading empty field instead of assigning it as an empty
string — every variable after it is bound to the wrong column.

## Symptoms

- A parsed row's values are shifted left of what the jq filter produced,
  for any row where a leading, middle, or trailing column is empty — not
  only a leading one, though a leading empty column is the case observed
  here.
- Rows where every column is non-empty parse correctly, so the bug survives
  code review and manual testing unless a row with at least one empty
  column is exercised explicitly.
- A branch keyed on the shifted variable (e.g. `if [ -z "$store_kind" ]`)
  silently never matches, because the variable now holds what was meant for
  a different column.

## Root Cause

Bash classifies **space, tab, and newline** as "IFS whitespace" characters,
but that treatment is conditional on membership in `IFS` — a character only
gets whitespace-splitting behavior when it is actually present in `IFS`.
When `IFS` consists *only* of characters from that whitespace set (as
`IFS=$'\t'` does), `read` applies the same collapsing rules as the default
`IFS=$' \t\n'`: runs of consecutive delimiter characters count as a single
boundary, and leading or trailing delimiter characters are stripped rather
than producing an empty field. `jq @tsv` represents an empty column as two
adjacent tabs (or a tab at the very start or end of the row); under
whitespace-only `IFS` that adjacency collapses, silently absorbing the
empty field and shifting every later value left — whether the empty column
was first, in the middle, or last. Assigning `IFS` to "just tab" does not
opt out of this collapsing; it is *non-whitespace* `IFS` (e.g. `IFS='|'`,
where tab is no longer a member of `IFS` at all) that switches to strict,
single-delimiter splitting, under which an empty field between two
delimiters is preserved.

So `read -r a b c <<< $'\tvalue2\tvalue3'` (empty first column) assigns
`a=value2 b=value3 c=` instead of the intended `a= b=value2 c=value3`. This
is invisible whenever the first field happens to be non-empty, which is why
it slips past casual testing.

Concretely, in `session-start.sh`'s embedder-provenance parse:

```bash
prov_tsv=$(jq -r '[(.embeddingProvenance.embedderKind // ""), ...] | @tsv' "$INTEL_JSON")
IFS=$'\t' read -r store_kind store_dim <<< "$prov_tsv"
```

A store with no `embeddingProvenance` stamp produces `\t64` (empty kind,
dimension 64). The intended split is `store_kind="" store_dim=64`, but the
leading empty field collapses and `read` instead assigns `store_kind=64
store_dim=` — the legacy/unstamped branch, which checks
`[ -z "$store_kind" ]`, never matched for a store that actually needed it.

## Fix

Use a separator that is never classified as IFS whitespace — `|` (or any
non-whitespace byte absent from the data) — for both the jq join and the
`IFS` assignment:

```bash
prov_tsv=$(jq -r '[(.embeddingProvenance.embedderKind // ""), ((.embeddingProvenance.dimension // "?") | tostring), ([.memories[]? | select(((.embedding // []) | length) > 0)] | length | tostring)] | join("|")' "$INTEL_JSON")
IFS='|' read -r store_kind store_dim vec_count <<< "$prov_tsv"
```

With a non-whitespace `IFS`, `read` neither collapses runs nor strips
leading empty fields — an empty `store_kind` round-trips as an empty string.

## Why This Works

Non-whitespace IFS characters are treated as strict, individual delimiters:
each occurrence produces exactly one field boundary, and a field between two
consecutive delimiters (or before the first) is legitimately empty. Only the
space/tab/newline set gets the "collapse runs and trim ends" treatment. This
holds regardless of how many bytes `IFS` is assigned — even `IFS=$'\t\t'`
still inherits the whitespace behavior, because every character in the set
is itself IFS whitespace.

## Prevention

- Never assign `IFS` to a value composed solely of space, tab, and/or
  newline when the goal is strict, position-preserving field splitting —
  reach for a printable non-whitespace delimiter (`|`, `,` with proper
  quoting, `\x1f` unit separator) instead.
- When splitting `jq @tsv` output specifically, prefer `join("|")` (or
  another non-whitespace separator) over `@tsv` unless every field is
  guaranteed non-empty.
- Test the empty-leading-field case explicitly — it is the one case this bug
  class cannot surface in code review or a happy-path test run.
- Use `mapfile`/`readarray` with one JSON value per line (or NUL-delimited
  output); `jq -r '@sh'` emits one shell-quoted line and still requires
  parsing.

## Related

- `docs/solutions/logic-errors/bash-pipe-head-exit-code-masking.md` — another
  bash field/exit-code semantics pitfall that only surfaces on an edge-case
  input shape.
- `docs/solutions/integration-issues/ruvector-adr210-embedding-provenance-refusal.md`
  — the feature whose fix uncovered this bug.
</content>
