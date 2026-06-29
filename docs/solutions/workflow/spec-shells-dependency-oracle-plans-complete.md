---
title: 'Spec-Shells Dependency Oracle: plans/complete/ Exact-Match'
date: 2026-06-29
category: workflow
track: knowledge
problem: 'Turbo spec-shells port: a shell depends_on slug is satisfied by exact anchored match against plans/complete/ filenames, not substring containment'
tags:
  - yellow-core
  - workflows
  - plans
  - spec-flow
  - dependency-resolution
  - turbo-port
  - shells
---

# Spec-Shells Dependency Oracle: `plans/complete/` Exact-Match

## Context

Yellow-core's `spec → decompose → expand-shell → pick-next-shell → work`
pipeline ports Turbo's (`tobihagemann/turbo`) spec-then-shells decomposition
model into the existing yellow plan lifecycle. A "shell" is a structured
decomposition artifact — one unit of work for a separate session — that
declares `depends_on` other shells.

Turbo marks a shell dependency satisfied when the dependency's plan file has
`status: done` in its YAML frontmatter. Yellow plans have **no frontmatter
convention**: the only machine-readable completion signal is the filesystem
split between `plans/` (open) and `plans/complete/` (archived by
`/plan:complete`). So Turbo's three-state `draft → ready → done` plan-frontmatter
progression collapses to yellow's two-state `plans/ → plans/complete/`.

## Guidance

A shell's `depends_on: <dep-slug>` entry is **satisfied** when a file exists in
`plans/complete/` whose basename matches this anchored regex:

```
^([0-9]{4}-[0-9]{2}-[0-9]{2}-)?<dep-slug>\.md$
```

That is: exact slug match after stripping an optional `YYYY-MM-DD-` archival
prefix (which `/plan:complete` may prepend). **NOT** substring containment.

### Why exact-match, not substring

The original porting brief said "match by slug substring." Read literally, that
lets `depends_on: auth` falsely satisfy against `plans/complete/oauth-flow.md`
(because `auth` is a substring of `oauth`). The anchored regex is the correct
sharpening: it requires the dependency slug to be the *whole* slug (modulo the
date prefix), so `auth` matches only `auth.md` or `2026-06-29-auth.md`, never
`oauth-flow.md`.

### Why this reuses existing machinery

Because the oracle is "a file with this slug exists in `plans/complete/`", it
reuses the existing `/plan:complete` Gate A (no unchecked boxes) + Gate C
(merged-PR evidence) archival machinery as the completion oracle with **zero
changes** to it. The shell author (`/workflows:decompose`) is responsible for
emitting `depends_on` values as exact shell-slugs (machine-readable, derived
from the shell filenames it generates) — never prose descriptions — so the
reading side (`pick-next-shell`, `expand-shell`) can match them precisely.

## Pitfalls

- **Slug form must agree across writer and readers.** `decompose` writes shell
  slugs as `^[a-z0-9]+(-[a-z0-9]+)*$` (no underscores/dots). `pick-next-shell`
  and `expand-shell` match against that same form. A malformed slug on the
  writing side silently produces an unsatisfiable dependency later.
- **Split state.** If a shell was expanded (its `plans/<slug>.md` exists) but
  its shell file was not cleaned up, `pick-next-shell` must skip it AND exclude
  it from deadlock detection — otherwise a topological pass over the remaining
  shells reports a false cycle.
- **Diverged archives.** A dependency archived as "done" but since refactored
  away passes the filename oracle yet fails reality; `expand-shell` re-verifies
  each `Consumes` against the live codebase, not just the archive.

## References

- `plugins/yellow-core/commands/workflows/{spec,decompose,expand-shell,pick-next-shell}.md`
- `plugins/yellow-core/commands/plan/complete.md` — the slug regex + Gate A/C
  archival oracle this reuses.
- `docs/brainstorms/2026-06-28-spec-shells-decomposition-brainstorm.md` — the
  decision record for the port.
- Turbo source: `tobihagemann/turbo` `claude/skills/{draft-spec,draft-shells,expand-shell,pick-next-shell}/SKILL.md`.
