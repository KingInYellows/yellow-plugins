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

Only the literal `Other` label opens free-text input, so
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

---

## Update — 2026-07-19

Gate C evolved beyond the single-tier design above. The "Decision" §3
snippet ("single `gh` call, no agent") is now the **strict tier only**
— two more tiers were added on top, each still a single deterministic
API call, no agent:

- **Loose token-coverage tier (PR #651, undocumented until now):**
  when the strict tier finds zero matches — routine, since real branch
  names rarely carry the full plan slug — Gate C scores the 100 most
  recently created merged PRs (`gh pr list --state merged --limit 100`,
  which orders by creation time, not merge time) by slug-token coverage
  over branch + title. A UNIQUE PR covering all slug tokens but one (all
  of them for slugs of ≤3 tokens) auto-passes, recorded via a
  `Plan-Verifier-LooseMatch:` trailer. Ambiguous or zero matches still
  prompt.

- **File-provenance tier (PR #656, this update):** runs FIRST, before
  strict and loose. Both slug-match tiers pattern-match a merged PR's
  branch name/title against the derived slug — text-similarity
  heuristics, blind to what the PR's diff actually touched. That blind
  spot is routine, not theoretical: a plan expanded from a shell and
  implemented in the same PR (`/workflows:expand-shell` +
  `/workflows:work` bundled into one PR) gets a branch name derived
  from the FEATURE, not the plan slug. Confirmed case: plan slug
  `claude-code-codex-plugin-pilot-02-codex-tooling` merged via branch
  `agent/feat/codex-pilot-02-codex-tooling`, sharing only 4 of the
  slug's 7 tokens — below even the loose tier's all-but-one threshold,
  despite the PR being unambiguous completion evidence.

  The provenance tier sidesteps text matching entirely: it asks git +
  GitHub directly "which merged PR last touched this exact file?"

  ```bash
  TRUNK=$(gt trunk 2>/dev/null | tr -d '[:space:]' || true)
  [ -n "$TRUNK" ] || TRUNK=$(gh repo view --json defaultBranchRef -q .defaultBranchRef.name 2>/dev/null || true)
  [ -n "$TRUNK" ] || TRUNK=main
  FILE_SHA=$(git log -1 --format=%H "origin/$TRUNK" -- "plans/$CLEAN_ARG")
  PULLS=$(gh api "repos/$OWNERREPO/commits/$FILE_SHA/pulls" \
    --jq '[.[] | select(.state == "closed") | {number, title, url: .html_url}]')
  ```

  A UNIQUE merged PR associated with that commit (`PCOUNT == 1`)
  auto-passes without prompting — skipping strict, loose, and the
  override prompt entirely — recorded via a
  `Plan-Verifier-FileProvenance: pr=#<N> sha=<FILE_SHA>` commit
  trailer. `PCOUNT == 0` (uncommitted file, or `git fetch`/`gh api`
  failure) or `PCOUNT >= 2` (rebase/cherry-pick history) falls through
  to the strict tier unchanged — uniqueness is the same safety valve
  the loose tier already relies on.

  This is still consistent with §3's original design collapse — one
  provenance lookup API call, no agent, no 8-row truth table — just
  querying `commits/{sha}/pulls` instead of `pr list --search`. The
  rejected approach was an *agent* scoring multiple signals; the
  provenance tier is one more deterministic `gh api` call slotted
  ahead of the existing ones, same shape as strict and loose.

Gate C is now three tiers, evaluated in order: **provenance → strict →
loose → AskUserQuestion override**, with provenance and loose short-circuiting
only on unique matches; strict passes on any match. At most one of the three
trailers appears per archival commit.

---

## Update — 2026-09-18

All three Gate C tiers were exercised for the first time against a PR that
merged through Graphite's merge queue (not a direct squash-merge) — and all
three returned zero evidence, including the file-provenance tier the
2026-07-19 update above added specifically to sidestep the other two tiers'
text-matching blind spots.

### Graphite MQ merges are invisible to all three tiers, not just strict/loose

**Confirmed case:** PR #808 — draft, then `gh pr ready 808`, then `gt merge`
(queued as MQ PR #811, ~20s Graphite cache delay before the queue picked it
up), landed on `main` as squash commit `80f125dd`. `gh pr view 808` shows
`state: CLOSED`, `mergedAt: null`, `mergeCommit: null` — indefinitely, not a
propagation-lag artifact that clears on retry.

- **File-provenance tier** — `gh api repos/{owner}/{repo}/commits/{sha}/pulls
  --jq '[.[]|select(.state=="closed")]'` against the squash commit returned 0
  PRs, unchanged on a retry ~15s later. GitHub's commit→PR association
  endpoint does not link a Graphite-MQ squash commit back to its source PR —
  this lines up with
  [merge-queue-closed-pr-null-mergedat-detection.md](../integration-issues/merge-queue-closed-pr-null-mergedat-detection.md)'s
  finding that `mergeCommit`/`mergedAt` never populate for MQ merges: there is
  nothing for this endpoint to return regardless of how long you wait.
- **Strict tier** (`gh pr list --state merged` slug search) — 0 matches.
  `--state merged` filters on PR *state*; an MQ-closed PR's state is
  `closed`, never `merged`, independent of slug/title.
- **Loose tier** (100 most-recent `--state merged` PRs, scored by
  slug-token coverage) — 0 matches for the same root cause: the PR never
  enters either tier's candidate set before scoring starts.

For a Graphite-MQ-merged PR, expect the full provenance → strict → loose →
override fallthrough every time — this is the normal path for that merge
type, not a rare edge case.

### Verifying an MQ merge when Gate C has nothing: diff-stat equality

With a PR number already known from context (not discovered by search),
diff-stat equality between the squash commit and the reviewed branch head is
fast corroboration before taking the override path:

```bash
git diff --stat "$SQUASH_SHA"^ "$SQUASH_SHA"       # squash commit's own diff
git diff --stat "$MERGE_BASE" "$BRANCH_HEAD_SHA"    # branch diff vs. its merge-base
# both must report identical files-changed / insertions / deletions
```

This is corroborating evidence, not proof — treat it as sufficient only when
paired with an independently-known candidate PR number, never as a blind
filter to search for "which PR merged" among candidates with no other
supporting reason. Record the result through Gate C's existing override path
(`Plan-Verifier-Override: user-confirmed-no-pr-evidence (pr=#<N>)`) — no new
trailer format needed for this case.

### Stale main-clone trunk breaks Phase 6 *and* Phase 8, distinct from a Graphite API outage

Separately, in the same session: Phase 6 (`gt checkout --trunk` / sync) can
fail for a reason unrelated to Gate C — a shared main clone's local `main`
had untracked files that collided with paths a just-merged PR had committed,
so `git pull --ff-only` refused to update. Archiving from a disposable
worktree tracked straight off `origin/main` instead
(`git worktree add -b plan/archive-<slug> <path> origin/main` +
`gt track --parent main --force`) unblocks the *commit*, but not the
*submit*: `gt submit --no-interactive` still aborted with "Aborting submit
because trunk branch is out of date and could not be updated," and after
falling back to a manual `git push` + `gh pr create`, `gt merge` reported
"The following branches do not have associated PRs" for a PR that
demonstrably existed (PR #812).

Treat either message as `gt`'s local trunk cache being stale relative to
GitHub — not something to retry. This is a different failure mode from
[the Graphite API outage fallback](./graphite-api-outage-fallback.md): that
one is the Graphite API itself returning 503s with local git fully healthy;
this one is the Graphite API reachable but local git state `gt` refuses to
trust. The same fallback shape resolves both — skip `gt` for push/create/merge
and go direct to GitHub:

```bash
git push -u origin "$BRANCH"
gh pr create --title "..." --body "..." --base main
gh pr merge <number> --squash
```

(PR #812 landed this way as squash commit `22cfd85b`.)
