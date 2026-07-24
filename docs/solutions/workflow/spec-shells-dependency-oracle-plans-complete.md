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

---

## Update — 2026-07-17

Observed while expanding `claude-code-codex-plugin-pilot-02-codex-tooling`,
whose dependency (`...-01-neutral-generation`) was already archived in
`plans/complete/`. Two follow-ups to the "Diverged archives" pitfall above:
what to do once divergence is confirmed, and a related order-of-operations
lesson for resolving a survey subagent's "open question."

### Absorb low-risk divergence in-plan; escalate only spec-level conflicts

The "Diverged archives" pitfall says `expand-shell` must re-verify each
`Consumes` against the live codebase, not just the archive — but it doesn't
say what to do once a mismatch is found. In this case the archived
dependency shell had, by its own design, delivered a simplified placeholder
for a field the parent spec's Design section already documented in a richer
shape (a plain boolean where Design expected an object). Since the archived
shell cannot be edited (`expand-shell`'s rules forbid touching completed
plans), the correction has nowhere to land except the current shell's plan —
even if the current shell's own `Produces` list never itemized it.

Two paths exist once divergence is confirmed:

- **Absorb it in the current plan** when the fix is a mechanical, value-only
  migration that stays inert until a later shell turns it on, and doesn't
  touch any contract the archived shell's own output already proved (e.g. a
  byte-identity guarantee on a code path the migration doesn't read from).
  Add it as an explicit task under the current shell's Produces/steps, citing
  the parent-spec requirement it grounds, and rerun the plan's consistency
  checks. If that traceability cannot be established, escalate via
  `AskUserQuestion` instead of absorbing the work silently.
- **Escalate via `AskUserQuestion`** when the two sources disagree on intent
  (not just interim-vs-final shape), or the correction could touch behavior
  the archived shell's contract depends on.

The dividing line is risk and reversibility, not surprise — a mismatch being
unexpected doesn't by itself make it escalation-worthy.

### Check the spec's own Requirements/Design text before escalating a subagent's open question

Research subagents surveying the codebase before shell expansion sometimes
flag "open questions" about design choices that look ambiguous from the code
alone. Before treating one as a real gap needing user input, re-read the
parent spec's own Requirements/Design sections first — a subagent scoped to
codebase survey wasn't necessarily handed the full spec text, and the spec
frequently pre-answers exactly what it raised. A shell's own
"Open Questions: None" section is not proof no answer exists elsewhere; it
only means the shell author didn't carry one forward.

---

## Update — 2026-07-23

While expanding shell 05 of the Claude Code + Codex dual-host pilot
(`claude-code-codex-plugin-pilot-05-yellow-ci-pilot`), the shell's own
"Open Questions: None" had missed a genuine conflict between two of the
parent spec's own requirements (config-path retention vs. the Codex
exposure lint — see
[the resolution](../integration-issues/codex-config-retention-exposure-lint-conflict.md)).
Two lessons for `expand-shell` itself, not the underlying Codex conflict:

### A shell's "Open Questions: None" can hide a real conflict, not just a false one

The 2026-07-17 update above covered the opposite case: a subagent-raised
"open question" that turned out to be pre-answered by the parent spec and
shouldn't have been escalated. This is the mirror case — the shell
explicitly declared no open questions, but a genuine cross-requirement
conflict existed in the parent spec's own text that no prior shell had
surfaced. Verify against the spec text and the actual enforcing code before
either dismissing or escalating a subagent's framing.

### A verified spec conflict is a legitimate expand-shell gate, not "re-opening a settled decision"

Step 5 forbids re-opening settled design decisions. A newly *verified*
conflict between two of the parent spec's own requirements is not that —
it belongs in the same category as the existing spec-drift (Step 2) and
Consumes-failure (Step 3) gates, distinguished by: has the conflict been
confirmed against the actual enforcing source, not merely asserted by a
survey subagent's "blocking" label?
