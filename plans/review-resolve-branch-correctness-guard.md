# Feature: `/review:resolve` correct-branch precondition guard

## Problem Statement

`/review:resolve` (`plugins/yellow-review/commands/review/resolve-pr.md`)
resolves a target PR number, checks the working tree is clean (Step 2), then
spawns resolver agents that **edit the working tree**, runs `gt modify` (which
amends the **current** branch's commit), and `gt submit` (which pushes it).

Nothing between "resolve the PR number" and "mutate" verifies that the
checked-out branch actually corresponds to the target PR. So:

> Run `/review:resolve 123` while sitting on `main` (or any unrelated branch),
> where PR #123's branch is `feature/xyz`. The resolvers edit files on the
> current branch, `gt modify -m "fix: resolve PR #123 review comments"` amends
> **that** branch, `gt submit` pushes it, and Step 7 marks #123's threads
> resolved on GitHub — **without the fixes ever reaching PR #123.**

This is not hypothetical. `plugins/yellow-review/commands/review/sweep.md`
Step 2a (lines 101–119) already guards against exactly this failure, but only
as an **external** check inside the `sweep` wrapper — its own comment says
"If `/review:pr` errored mid-way or a tool checked out a different branch,
`/review:resolve` would commit fixes against the wrong PR." Direct interactive
use of `/review:resolve`, and `/review:resolve-stack`, have **no such guard**.

**Who benefits:** anyone running `/review:resolve <PR#>` directly (the common
interactive path), plus the `resolve-stack` walk, which currently trusts its
preceding `gt checkout` unconditionally.

## Current State

- **`resolve-pr.md` Step 1** (line 48) already resolves the PR from the current
  branch via `gh pr view --json number -q .number` **when no PR# is passed**.
  The gap is the **explicit-`<PR#>` path**, which never cross-checks the branch.
- **Step 2** (lines 61–66) is the only precondition before Step 3 fetches
  comments and Step 4+ mutates: `git status --porcelain` must be clean.
- **`sweep.md` Step 2a** implements a weaker, name-comparison version of the
  check (`gh pr view <N> --json headRefName` vs `git rev-parse --abbrev-ref
  HEAD`) as a pre-dispatch guard external to `/review:resolve`.
- **`resolve-stack.md` Step 3** does `gt checkout <branch>` then invokes
  `/review:resolve <N> --non-interactive`; **`review-all.md` Step 4.1** does the
  same checkout before its Step 12 resolve. Both are branch-safe by
  construction but rely on that ordering, not on any assertion.

## Proposed Solution

**Internalize the branch-correctness guard into `resolve-pr.md`** as a new
mode-independent hard-error precondition, so every caller inherits it. The
mechanism is **number-resolution, not name-comparison**, and it **skips** the
no-arg path.

### Mechanism (decided via research — see Open Decisions)

Reuse the exact call Step 1 already makes: run `gh pr view --json number -q
.number` against the **current** branch and assert it equals the target `<N>`.

Why number-resolution over `sweep.md`'s name comparison: name comparison has a
**dangerous false-positive** — a wrong branch that coincidentally shares PR
#N's `headRefName` (plausible across forks or reused branch names) passes the
check, and `gt modify` + `gt submit` then corrupt the wrong PR. It also
false-negatives on `gh pr checkout -b <custom>` / renamed branches. Number
resolution reuses gh's own owner-scoped resolver, matches the code path Step 1
already trusts, and its "no PR for this branch → exit 1" is a free precondition.
(Sources: `cli.github.com/manual/gh_pr_view`; empirically confirmed `gh` 2.93.0
exits 1 with `no pull requests found for branch "<name>"`; clig.dev;
`agent-cli-readiness-reviewer.md` Principles 3–4.)

### Behavior: three outcomes, hard-stop in both modes

The check runs **only when `<N>` was passed explicitly**. When Step 1 *derived*
`N` from the current branch (no explicit token), **skip the check** — the branch
already maps to `N` by construction, and re-querying would add a transient-error
abort to a known-good happy path.

When `<N>` is explicit, classify (capturing stderr + exit code explicitly, never
piped — see `docs/solutions/logic-errors/bash-pipe-head-exit-code-masking.md`,
mirroring `resolve-stack.md` Step 3):

| Outcome | Condition | Action |
|---|---|---|
| **Match** | exit 0 AND resolved PR == `<N>` | proceed to Step 3 |
| **Wrong branch** | exit 0 AND resolved PR ≠ `<N>` | hard error: "current branch maps to PR #<got>, not #<N>; checkout #<N>'s branch first (`gt checkout <branch>` / `gh pr checkout <N>`)". Stop. |
| **No PR on branch** | exit ≠ 0 AND stderr matches `no pull requests found` / `no open pull requests` / `no pull requests associated` | hard error: "current branch has no associated PR; checkout #<N>'s branch first". Stop. |
| **API error** | exit ≠ 0, any other stderr | fail-closed hard error: "could not verify branch for PR #<N> (gh error): <stderr>". Stop. |

The distinct **API-error** outcome (G2) is essential: without it, a transient
auth/rate-limit/network failure would masquerade as "wrong branch" — the exact
false alarm this feature exists to prevent. Reuse `compound.md`'s exact stderr
match strings (lines 75–121), not ad-hoc ones.

This is a hard error, **not** a suppressible `AskUserQuestion` gate — it fires
identically with and without `--non-interactive`. It therefore sits outside the
`--non-interactive` contract (like the existing "unknown flag" hard error) and
requires **no change** to `docs/plugin-scope-mode-protocol.md` Interface 1.

### Placement

New **Step 2b** immediately after Step 2 (clean-tree), before Step 3 (GraphQL
fetch) and any mutation.

## Open Decisions (recommended defaults — confirm or override)

1. **Verification mechanism → number-resolution (RECOMMENDED).** Alternative:
   mirror `sweep.md`'s `headRefName` name-comparison for consistency. Rejected
   because it carries the false-positive corruption risk above; research is
   unambiguous. If overridden, the whole step text changes.
2. **On mismatch → hard-stop in both modes (RECOMMENDED MVP).** Alternative /
   **v2 enhancement**: in interactive mode only, offer an `AskUserQuestion`
   "checkout #<N> and continue?" before mutating; `--non-interactive` stays a
   hard fail. Deferred — adds a suppressible gate (touches Interface 1) and
   silent/assisted branch-switching is discouraged for a command that then
   pushes. Ship hard-stop first.

## Implementation Plan

### Phase 1: Command + skill change

- [x] Add **Step 2b: Verify Correct Branch** to `resolve-pr.md` after Step 2,
      implementing the skip-on-no-arg rule and the 3-outcome classifier above,
      with explicit temp-file stderr + exit-code capture (no pipe).
- [x] Add a named entry to `resolve-pr.md`'s **Error Handling** section
      (parallel to "Dirty working directory") for the branch-mismatch and
      branch-verify-error cases.
- [x] In Step 2b prose, state explicitly that a hard-exit here does **not**
      abort `resolve-stack`/`sweep` walks (the `Skill` tool returns no exit
      status; the walk's own self-verify flags the PR as residual), pre-empting
      "does this break the gateless walk?".
- [x] Record the precondition as **canonical convention** in
      `plugins/yellow-review/skills/pr-review-workflow/SKILL.md` — add a
      "Wrong branch for PR" row to its **Error Handling → Git/Graphite Errors**
      table (~lines 254–261) and a line under **Graphite Integration**. This is
      the shared reference other review commands/agents load, so the convention
      belongs here, not only in the command file (the user asked for the
      "command/skill"). Describe the **implemented** 3-outcome hard-stop — not
      aspirational prose — to avoid this repo's "doc describes unenforced
      behavior" drift.

### Phase 2: Docs + changeset

- [ ] (Optional) Update the `/review:resolve` one-liner in
      `plugins/yellow-review/CLAUDE.md` (lines 47–49, 138–140) and
      `plugins/yellow-review/README.md` (line 29) to mention the branch guard.
      Optional because the one-liner describes function, not preconditions.
- [ ] (Optional follow-up, NOT this change) Note that `sweep.md` Step 2a is now
      redundant defense-in-depth using the weaker mechanism — candidate to drop
      or delegate later. Leave it as-is here (no double-abort; it stops before
      `/review:resolve` is invoked).
- [ ] (Optional follow-up) Confirm whether `review-all.md` Step 12 delegates to
      `/review:resolve` (inherits the check) or reimplements inline; file a
      note either way. Not blocking — Step 4.1's checkout makes it branch-safe
      regardless.
- [x] `pnpm changeset` → **patch** bump for `yellow-review` (behavior change
      inside an existing command; not a new command/skill/agent). Commit the
      `.changeset/*.md`.

### Phase 3: Validate + normalize

- [x] `pnpm validate:agents` (`validate-agent-authoring.js` — the gate for
      command `.md`) and `pnpm validate:schemas`.
- [x] Normalize LF endings on any edited file: `sed -i 's/\r$//'
      plugins/yellow-review/commands/review/resolve-pr.md` (WSL2 CRLF guard).
- [x] Manual review verification against the Acceptance Criteria below (no
      runtime harness exists for command markdown).

## Technical Details

**Files to modify**
- `plugins/yellow-review/commands/review/resolve-pr.md` — new Step 2b + Error
  Handling entry (the only functional/runtime change).
- `plugins/yellow-review/skills/pr-review-workflow/SKILL.md` — canonical
  convention: "Wrong branch for PR" row in the Git/Graphite Errors table
  (doc-only; must describe the implemented 3-outcome hard-stop).
- (Optional) `plugins/yellow-review/CLAUDE.md`, `plugins/yellow-review/README.md`
  — description one-liner.

**No frontmatter/manifest change** — `Bash` is already in `allowed-tools`
(resolve-pr.md line 6). No new tool, no schema field.

**Reference implementations to mirror**
- Exit-code-safe capture: `resolve-stack.md` Step 3 (temp file + `$?` before
  parsing).
- stderr classification strings: `compound.md` lines 75–121.
- The check being internalized: `sweep.md` Step 2a (lines 101–119) — but with
  number-resolution instead of name-comparison.

## Acceptance Criteria (reviewable assertions — no runtime test warranted)

Command markdown is LLM-interpreted prose validated only statically; extracting
to a script solely for testability would be scope creep. Verify by review:

1. New step sits literally **after Step 2 (clean-tree), before Step 3**.
2. No-arg path **explicitly skips** the check (not "runs, trivially passes").
3. **Three** outcome messages present verbatim; each remedy tells the user to
   `gt checkout` / `gh pr checkout` the correct branch; the **API-error message
   is distinct** from both wrong-branch messages.
4. Classifier reuses `compound.md`'s exact stderr match strings.
5. Exit code captured explicitly (temp-file pattern), checked before any string
   comparison — no pipe.
6. Hard-stop fires **identically** in interactive and `--non-interactive` modes;
   no mode-branching for this check (unlike Steps 4/5/6).
7. `docs/plugin-scope-mode-protocol.md` Interface 1 **unchanged** — the reasoning
   (non-suppressible precondition, out of scope of `--non-interactive`) is stated.
8. New entry present in `resolve-pr.md` Error Handling.
9. No frontmatter/manifest change; `pnpm validate:agents` + `validate:schemas`
   pass; changeset (patch) committed; LF endings.
10. **Skip vs. runs-and-passes distinction holds:** the check is *skipped* only
    on the no-arg path. Under `resolve-stack` (post-`gt checkout`) and `sweep`
    (post-Step-2a) it **runs and passes — it must NOT be skipped there**; an
    implementer must not add caller-detection to bypass it in the stack/sweep
    paths, or the safety net over a silently-wrong checkout is lost.

## Edge Cases & Error Handling

- **Transient `gh` failure (auth/rate-limit/network)** — separated into the
  fail-closed "API error" outcome; must NOT collapse into "no PR" (G2).
- **Detached HEAD** — likely moot (`gt modify` at Step 6 fails regardless);
  verify `gh`'s actual stderr empirically during implementation rather than
  assuming it lands in the "no PR" bucket.
- **Branch associated with >1 PR** — `gh pr view` picks the current-branch PR;
  equality against `<N>` still holds if that PR is `<N>`.
- **Wrong branch AND dirty tree** — Step 2 fires first ("stash"); mildly less
  precise message but non-blocking (ordering is deliberate: cheap local check
  before any network call).
- **Do NOT re-affirm before push (Step 6).** The "verify before dispatch AND
  before push" learning ([[pr362-review-verification-patterns]]) assumed branch
  drift during long dispatch; `pr-comment-resolver` agents only edit files
  (never `gt`/`git checkout`) and concurrent invocation is unsupported, so the
  premise doesn't hold. Skip per YAGNI.

## Caller Coverage

| Caller | Path to `/review:resolve` | Effect of Step 2b |
|---|---|---|
| Direct interactive `/review:resolve <N>` | — | **Primary fix** — catches wrong-branch |
| Direct `/review:resolve` (no arg) | — | **Skipped** (branch derived the PR) |
| `/review:resolve-stack` | `gt checkout` → `<N> --non-interactive` | **Runs and passes (does not skip)** — safety net over a silently-wrong checkout |
| `/review:sweep` / `sweep-all` | Step 2a → `<N> --non-interactive` | **Runs and passes**; Step 2a stays as pre-dispatch defense |
| `review-all.md` Step 12 | Step 4.1 `gt checkout` → resolve flow | Branch-safe via checkout; delegate-vs-inline TBD (follow-up) |

**Behavior delta to note for reviewers:** the check adds one `gh pr view` call
per explicit-`<N>` invocation — one extra call per PR under `resolve-stack` /
`sweep` walks. If it fails-closed under a rate-limit, that PR is flagged residual
by the walk's own self-verify (correct degradation, not a walk abort — the
`Skill` tool returns no exit status). The skip-on-no-arg rule keeps the no-arg
happy path free of the extra call.

## References

- `plugins/yellow-review/commands/review/resolve-pr.md` — Step 1 (line 48,
  existing `gh pr view` no-arg), Step 2 (61–66), insertion point + Error Handling
- `plugins/yellow-review/commands/review/sweep.md:101-119` — external guard to
  internalize (weaker name-comparison mechanism)
- `plugins/yellow-review/commands/review/resolve-stack.md` — Step 3 exit-safe
  capture pattern; no-op safety
- `plugins/yellow-core/commands/workflows/compound.md:75-121` — stderr
  classification strings to reuse
- `docs/plugin-scope-mode-protocol.md` — Interface 1 (line 34) — unchanged
- `docs/solutions/logic-errors/bash-pipe-head-exit-code-masking.md` — no-pipe rule
- `cli.github.com/manual/gh_pr_view` — no-arg resolution; empirical `gh` 2.93.0
  exit-1 on PR-less branch
- clig.dev, 12-factor-agents Factor 7, `agent-cli-readiness-reviewer.md`
  Principles 3–4 — fail-fast-with-actionable-errors over silent auto-checkout
- Past learnings: [[pr362-review-verification-patterns]] (branch-swap),
  [[session-level-review-command-patterns]] (keep the check self-contained,
  don't delegate branch fixup)
