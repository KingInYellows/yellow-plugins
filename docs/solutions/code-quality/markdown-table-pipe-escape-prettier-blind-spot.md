---
title:
  'An Unescaped Pipe Inside a Markdown Table Cell Breaks the Table While
  `prettier --check` Still Passes'
date: '2026-09-10'
category: 'code-quality'
track: 'bug'
problem:
  "A regex alternation (`(?:x|y)`) written inline in a GitHub-Flavored-Markdown
  table cell split the row into extra columns; prettier's table formatter padded
  the separator row to match the broken row instead of flagging it, so `prettier
  --check` reported the file clean while GFM renderers reject the malformed
  table"
tags:
  - markdown
  - gfm
  - prettier
  - table-formatting
  - format-check-blind-spot
  - contract-authoring
components:
  - docs/yellow-jules/contract-v1.md
---

# An Unescaped Pipe Inside a Markdown Table Cell Breaks the Table While `prettier --check` Still Passes

## Context

PR #793 (`docs(yellow-jules): PR1 provider-CLI contract set`) added an
identifier-allowlist table to `docs/yellow-jules/contract-v1.md` mapping
vendor-supplied identifiers to validation patterns. One row's "Pattern or rule"
cell contained a regex alternation written directly as prose:
`^\[yellow:(jl-[0-9a-f]{32})\](?:|$)` — an unescaped `|` inside the `(?:...)`
group. A 13-persona `/review:pr` pass (`adversarial`, `comment-analyzer`,
`correctness`, `maintainability`, and `silent-failure-hunter` all independently
flagged it) found that the pipe had split the table row: everything after the
alternation's `|` spilled into the next column, off-by-one-shifting every
subsequent cell in that row, and the separator row two lines above
(`| --- | --- | --- |`) was three columns while the broken row rendered as four.
The file had already passed `prettier --check` in this same PR's review cycle.

## Root Cause

GFM tables use unescaped `|` as the universal cell delimiter; a `|` belonging to
cell _content_ (a regex, a shell pipeline example, a type-union signature) must
be written `\|` or the parser treats it as a new column boundary — this is
standard GFM behavior, not a project-specific rule.

Prettier's markdown table formatter does not require the header separator row
and every data row to have the same column count to consider a table
"formatted." When one data row has more raw `|`-delimited cells than the
separator row, Prettier's printer widens/pads the separator row's column count
to match the wider content row it just parsed, then re-emits a `--check`-clean
file — the file looks internally consistent to Prettier because Prettier derives
the "correct" column count from the very row that broke it, rather than from the
table's declared header. `prettier --check` therefore returns 0 (a formatting
round-trip, not a structural validity check) on a table that GFM itself will
refuse to render as intended, or will render with visibly shifted columns.

## What Didn't Work

Trusting a clean `prettier --check` (or a clean `pnpm lint`/`validate:schemas`
run, neither of which parses Markdown table structure) as evidence the table was
well-formed. Neither tool asserts "every row in this table has the same cell
count as its header" — that invariant sits entirely outside their scope.

## Solution

- Never write a raw regex, shell pipe, or any string containing literal `|`
  directly inside a Markdown table cell. Escape it as `\|`, or move the value
  out of the table into a fenced code block referenced by name from the cell.
- When a row that copy-paste-carries a technical value (a regex, a type union, a
  CLI pipeline) is added or edited in a table, count that row's `|`-delimited
  cells against the header/separator row by eye, or render the file and visually
  confirm the table did not grow a column.
- Treat `prettier --check` passing on Markdown as "the file matches Prettier's
  own re-derived formatting," not as "every table in this file is structurally
  valid GFM." They are different claims; only the second one is what a reader
  (or a downstream doc generator) needs.

## Why This Matters

A prose contract's tables are often the part implementers copy-paste directly
into code (as this identifier-allowlist row was meant to be) — a silently
shifted column swaps which cell holds the pattern and which holds the source
citation, so an implementer who trusts the table structure copies the wrong
value with no visible sign anything is wrong. The bug is invisible in a diff
review that reads prose meaning rather than counting delimiters per row, and a
green `prettier --check` in CI actively reinforces the false confidence that the
table is fine.

## When to Apply

- Reviewing or authoring any Markdown table whose cells contain regexes, shell
  pipelines, TypeScript union types, or other content that can carry a literal
  `|`.
- After any tool reports a Markdown file "clean" — remember that covers
  formatting round-trip, not GFM structural validity; a table needs its own
  row/column-count check.
