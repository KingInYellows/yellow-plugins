# Archived Solution Entries

This directory holds `docs/solutions/` entries that have been superseded
by a consolidated or replacement entry, or whose cited code has been
removed entirely. Archive moves are performed by the
[`compound-lifecycle`](../../../plugins/yellow-core/skills/compound-lifecycle/SKILL.md)
skill (`/yellow-core:compound-lifecycle`).

## Layout

`archived/` mirrors the live catalog's subdirectory layout:

```text
docs/solutions/archived/<original-category>/<slug>.md
```

Each archived entry retains its original frontmatter and adds a
`superseded_by:` field pointing to the new canonical entry's path
(absolute from repo root) — or `superseded_by: null` when the entry
was archived because the cited code no longer exists and no successor
was written.

## Why archive instead of delete

`docs/solutions/` entries are referenced from external systems (Linear
issues, Slack threads, PR descriptions). Deleting and relying on git
history breaks every external link. Archiving keeps the file present
and citable. The intent is for archived entries to remain out of the
live `learnings-researcher` search path, though that exclusion is not
yet implemented (see below).

The `learnings-researcher` agent searches `docs/solutions/` broadly
and does not currently exclude `docs/solutions/archived/**` by default.
To intentionally search archived entries, query the path directly
(e.g., `Grep -r ... docs/solutions/archived/`).

## How to restore an archived entry

If an archive turns out to have been over-eager — e.g., a Consolidate
collapsed two entries that should have stayed separate — restore by:

1. `git mv docs/solutions/archived/<category>/<slug>.md docs/solutions/<category>/<slug>.md`
2. Remove the `superseded_by:` field from frontmatter
3. Update the canonical entry's body (if any) to remove the
   over-claimed scope
4. Open a `chore: restore docs/solutions entry` PR with rationale

To prevent a restored entry from being immediately re-flagged as
stale, bump its `updated:` frontmatter field to today's date after
restoring. The skill's composite staleness score weights
`days_since_modified` (via `updated:` or file mtime), so a freshly
updated entry will score below the stale threshold on the next run.
