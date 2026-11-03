# Themes — `/review:pr` thematic triage grouping

Loaded by `/review:pr` Step 6 "Number and group". Ported from Compound
Engineering's `skills/ce-code-review/references/finish-review.md` Stage 5 step 6
(pin `b405537`). Groups let the reader triage a few themes instead of many
items.

**Grouping is not deduplication.** A group never merges findings and never
changes a finding's severity, confidence, route, owner, ledger record or `#`.
The severity tables in Step 10 still list every finding.

## Numbering

Number the findings once, after the quality gates and the ledger write have
dropped findings, in sub-step 10's sort order: `#` is the 1-based position
across every surviving finding in that order (severity tables first, then
Pre-existing). Step 10's `#` column uses these numbers. They never change for
the rest of the run, including after Steps 7 and 8.

## Mode

`review_grouping` in `yellow-plugins.local.md`:

- `auto` (default): build groups only when the findings span distinct concerns.
  The trigger is distinct concerns, not a count. Prefer no groups over
  decorative single-item groups. When every finding is about one thing, emit no
  Themes section.
- `off`: never group; emit no Themes section.
- `always`: group whenever at least two findings share a signal below.

Any other value warns
`[review:pr] Warning: review_grouping <value> unknown; using auto` and uses
`auto`.

## Building groups

Put findings in one group when they share one of these signals:

- a shared root cause
- the same affected subsystem
- the same user-facing failure mode
- an overlapping fix path, where one change resolves several
- a dependency order, where one must be fixed before another
- repeated symptoms of one design choice

Each finding belongs to at most one group. A group needs at least two findings.
Pre-existing findings may join a group only with each other.

Each group has:

- a short title
- the finding numbers it holds
- one line of context: what ties them together
- the preferred resolution, and why. When one fix resolves several findings,
  name it and say which finding to handle first.

A group may mention that a finding still needs verification
(`requires_verification: true`), but never tells a fixer to apply an unverified
claim.

Order groups by their highest-severity finding, then by their lowest `#`.

## Re-partition after Steps 7 and 8

After Step 7 applies fixes and Step 8's simplifier findings are added:

- drop applied findings from their groups
- when a group lost some findings, say so in its context line
  (`partly resolved: #3 applied`)
- drop any group left with fewer than two findings
- for each surviving group that lost a finding, rewrite its preferred
  resolution and its "handle #n first" from the remaining findings; never
  recommend an applied fix or cite an applied `#` there
- simplifier findings may join an existing group when they share its signal;
  they are numbered after the last existing `#`

In report-only mode nothing is applied, so the groups stand as built.

## Render

Step 10 renders the groups as a `### Themes` section above the P0 table:

```markdown
### Themes

1. **<title>** — #<n>, #<n>, #<n> <context line> Fix: <preferred resolution> —
   <why>; handle #<n> first.
```

Omit the section when there are no groups.
