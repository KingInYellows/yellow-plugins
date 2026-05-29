---
title: 'Plan lifecycle management: status dashboard + two-gate archival'
date: 2026-05-28
category: workflow
track: knowledge
problem: 'No machine-readable signal for plan completion; manual git mv archival is error-prone and gives no audit trail when work has not actually shipped'
tags: [yellow-core, validators, gh-cli, graphite, slug-derivation]
---

## Context

Plans live as markdown in `plans/` (open) and `plans/complete/`
(archived). Pre-2026-05 the only archival mechanism was a manual
`git mv plans/foo.md plans/complete/foo.md` commit. Six such commits
landed in 48 hours (2026-05-08), confirming the friction was real.
There was no authoritative way to ask "which plans are open?", "is this
plan ready to archive?", or "did the work actually ship?". The
underlying corpus also accumulated 38 of 71 archived files (54 %)
containing stray unchecked task boxes (`- [ ]`) — a naive whole-corpus
gate would have blocked CI from day one.

## Decision

Two commands plus one PR-diff-scoped CI validator, all under
yellow-core. Zero migration, zero new file format, zero LLM in the
loop.

- **`/plan:status`** (yellow-core): read-only dashboard of `plans/` +
  `plans/complete/` with per-file `[ <checked>/<total> ]` rendering.
  100 %-complete open plans annotated `-- ready to complete`.
- **`/plan:complete <plan>`** (yellow-core): two gates plus
  `gt`-managed archival.
- **`scripts/validate-plans.js`** (root-level): PR-diff-scoped CI gate
  that enforces no-stray-checkbox on `plans/complete/*.md` files added
  or modified in the diff. Wired as a 6th matrix target in
  `.github/workflows/validate-schemas.yml`.

### Load-bearing design choices (recorded so future readers can skip the rationale)

1. **No frontmatter convention.** Slug is derived at runtime from the
   filename:

   ```bash
   basename "$PLAN" .md | sed 's/^[0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}-//'
   ```

   The `plans/` vs `plans/complete/` directory split is the single
   source of truth for state. An earlier plan draft proposed a
   `slug:`/`created:` frontmatter convention with a 47-file backfill
   migration; PR review (#494) collapsed it in favour of runtime
   derivation. Filename slug survives renames as long as the rename is
   deliberate.

2. **Validator scopes to PR-touched files, not the whole corpus.**
   The validator runs `git diff --name-status -z "$BASE_REF...HEAD"`
   and inspects only added (`A`) or modified (`M`) entries plus
   rename (`R<score>`) destination paths under `plans/complete/`.
   Legacy stray-checkbox files are never re-touched, so the validator
   never sees them. No escape-hatch frontmatter needed. The
   stray-box ratio worsened from 36 % (16 / 44) to 54 % (38 / 71)
   between 2026-05-09 and 2026-05-28, which strengthens this choice:
   any future whole-corpus gate would be progressively harder to
   enable.

3. **Gate C is a single `gh` call, no agent.** Pattern:

   ```bash
   MERGED=$(gh pr list \
     --search "in:title \"$SLUG\"" \
     --state merged \
     --limit 100 \
     --json number,title,headRefName,url \
     --jq '[.[] | select(.headRefName | test("(^|[/_-])'"$SLUG"'($|[/_-])"))]')
   COUNT=$(printf '%s' "$MERGED" | jq 'length')
   ```

   PASS if `COUNT >= 1`. NO-EVIDENCE prompts the user via
   `AskUserQuestion`; the override is captured as a commit trailer
   (see below). An earlier plan draft proposed a 3-check
   `plan-verifier` agent with an 8-row PR/commit/file truth table;
   PR review (#494, #496) collapsed it because the single `gh` call
   covers the same surface with no token spend.

### Word-boundary post-filter on `headRefName`

GitHub's `in:title` qualifier is **token-based, case-insensitive, and
hyphens act as token separators** (GitHub Community Discussion #17956).
A query `in:title "foo-bar"` tokenizes to `[foo, bar]` and matches a
PR titled `foo bar`. There is no exact-string mode for issue/PR title
search even with quotes. So the title search is a coarse pre-filter
only; the authoritative match is the `--jq` post-filter that requires
`$SLUG` to be separated from surrounding characters in `headRefName`
by `^`, `$`, `/`, `_`, or `-`. This blocks short or generic slugs
(`refactor`, `fix`, `wip`) from matching unrelated branches whose
names contain the slug as a substring inside another word.

Server-side `--state merged` is preferred over reading `mergedAt`:
per [merge-queue-closed-pr-null-mergedat-detection.md](../integration-issues/merge-queue-closed-pr-null-mergedat-detection.md),
`mergedAt` can be null for recently MQ-merged PRs during propagation
lag. `--state merged` filters on PR state, which is authoritative
once the upstream API has caught up.

### `Plan-Verifier-Override:` commit trailer

When Gate C finds zero matches and the user confirms via the
`AskUserQuestion` "Other" free-text option, the archival commit
captures the decision:

```
docs(plans): archive completed <slug> plan

Verified by /plan:complete: user-confirmed override.

Plan-Verifier-Override: user-confirmed-no-pr-evidence (pr=#<OVERRIDE_PR_NUM>)
```

The trailer is grep-discoverable via
`git log --grep='Plan-Verifier-Override'` for future audit. The
default (Gate C PASS) commit omits the trailer.

### `Other` is the only AskUserQuestion free-text label

Per MEMORY.md "AskUserQuestion 'Other' is the ONLY free-text button",
the label of the override option in `/plan:complete` Phase 4 MUST be
the literal string `Other`. Earlier drafts labelled it
`Confirm with PR number`; that label shows as a click-only option and
does NOT open the text-input affordance. This is enforced by prose in
the command body; the bats smoke tests do not exercise the
AskUserQuestion flow.

### Commit invocation: plain `git commit -m -m`, not `gt commit create -m -m`

Bottom-of-stack PR #556 (validate-plans validator) empirically observed
that `gt commit create -m "$SUBJECT" -m "$BODY"` concatenates the two
`-m` values with a literal comma (`"subject,body line 1..."`). The
plan task spec was patched to use plain `git commit -m "$SUBJECT" -m "$BODY"`
which, per git docs, "concatenates as separate paragraphs" (subject
+ blank line + body). Graphite picks up the commit via the next
`gt submit`.

## Consequences

- **No migration risk.** No existing plans are touched by either
  command. Adding `/plan:status` is a pure read; `/plan:complete`
  only acts on the plan the user explicitly named.
- **CI gate is opt-in by design.** PRs that do not touch
  `plans/complete/` are unaffected (the matrix-target case branch
  no-ops). PRs that do trigger the gate at the < 2-minute timeout
  inherited from the existing matrix shape.
- **Override trailer makes "trust me" archival auditable.** Future
  questions about "why was this plan archived without a matching
  merged PR?" have a `git log --grep` answer.
- **Token-based title search caveat is documented inline.** Anyone
  modifying Gate C should preserve the word-boundary post-filter; if
  the validator ever drops the regex check, short slugs become
  vulnerable to false-positive matches.

## References

- Plan: [`plans/plan-lifecycle-management.md`](../../plans/plan-lifecycle-management.md)
  (refreshed + deepen-plan-annotated 2026-05-28)
- Bottom-of-stack PR: #556 — `scripts/validate-plans.js` validator,
  catalog entry, integration tests, CI wiring
- PR #484 review issues driving the design collapse: #494 (P0/P1
  design), #496 (YAGNI scope reductions)
- Merge-queue propagation gotcha:
  [`docs/solutions/integration-issues/merge-queue-closed-pr-null-mergedat-detection.md`](../integration-issues/merge-queue-closed-pr-null-mergedat-detection.md)
- Validator template reference: `scripts/validate-solutions.js` (#553)
