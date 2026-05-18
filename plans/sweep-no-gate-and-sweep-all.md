---
status: ready-to-implement
date: 2026-05-18
plugin: yellow-review
bump: minor (3.1.4 → 3.2.0)
brainstorm: docs/brainstorms/2026-05-18-sweep-command-human-gate-removal-brainstorm.md
---

# Feature: Gateless `/review:sweep` + new `/review:sweep-all`

## Problem Statement

`/review:sweep` currently pauses at a Step 3 `AskUserQuestion` boundary gate
between `/review:pr` and `/review:resolve`, defeating its "wrapper that runs
both in one invocation" purpose. The user wants:

1. Single-PR sweep that runs fully unattended after invocation — no boundary
   gate, no internal push prompts.
2. A new batch command, `/review:sweep-all`, that enumerates the user's open
   non-draft PRs and runs the (now-unattended) sweep on each sequentially —
   with a single upfront M3 confirmation, skip-and-continue on per-PR failure,
   an end-of-loop summary table, and one `/workflows:compound` pass at the end
   to capture learnings from the batch.

## Current State

- `plugins/yellow-review/commands/review/sweep.md` — 179 lines; Step 3 is the
  boundary gate (lines 100–126); Step 4 calls `Skill(skill: "review:resolve",
  args: "<PR#>")` without `--non-interactive`; Step 2 calls `Skill(skill:
  "review:pr", args: "<PR#>")`. Sweep's `allowed-tools` includes
  `AskUserQuestion` (line 8) only because of Step 3.
- `plugins/yellow-review/commands/review/review-pr.md` — 856 lines; Step 9
  (lines 710–723) has a hardcoded `AskUserQuestion` push gate; Step 9b (line
  762) has a conditional "Save review learnings to memory?" prompt. No
  `--non-interactive` flag exists.
- `plugins/yellow-review/commands/review/resolve-pr.md` — already supports
  `--non-interactive` (lines 30–53); flag suppresses Step 4 spawn-cap, Step 5
  CONFLICT, and Step 6 push gates.
- `plugins/yellow-review/commands/review/review-all.md` — provides the
  canonical PR enumeration pattern (`scope=all`, lines 57–63) and sequential
  loop with skip+continue (lines 96–302); is **not** the target — sweep-all
  delegates to sweep per PR rather than inlining the review pipeline.
- `plugins/yellow-review/.claude-plugin/plugin.json` — version `3.1.4`; **no
  `commands` array** (auto-discovery); no manifest change required for the
  new command.
- `plugins/yellow-review/CLAUDE.md` — Commands count `(6)`; "Always confirm
  with user via `AskUserQuestion` before pushing" convention has one exception
  (`/review:resolve-stack`); needs expansion for the new behavior.
- `plugins/yellow-core/commands/workflows/compound.md` — accepts `$ARGUMENTS`
  as a free-text hint; uses last 25 turns of conversation as primary input;
  exits non-zero if `docs/solutions/` absent (graceful-skip from caller's POV).

## Proposed Solution

Four file changes inside `yellow-review`:

1. **Add `--non-interactive` flag to `/review:pr`** so the sweep wrapper can
   suppress its Step 9 push gate and Step 9b "save learnings" prompt.
2. **Modify `/review:sweep`** — remove Step 3 boundary gate, pass
   `--non-interactive` to both `/review:pr` and `/review:resolve` in Steps 2
   and 4, drop `AskUserQuestion` from `allowed-tools`, clean up stale prose.
3. **Create `/review:sweep-all`** — new command following the
   `resolve-stack.md` loop pattern (pre-flight → enumerate → M3 → loop with
   skip+continue → summary → conditional compound).
4. **Update plugin docs** — `CLAUDE.md` Component Catalog (Commands `(6)` →
   `(7)`, sweep entry rewritten, sweep-all entry added, convention exception
   list expanded), `README.md` command table.

Plus: one changeset + version sync.

## Linear Issues

None — this is a self-directed feature.

## Implementation Plan

### Phase 1: `/review:pr` `--non-interactive` flag

- [ ] **1.1 — Update `review-pr.md` frontmatter:**
  - Line 4 `argument-hint`: change `'[PR# | URL | branch]'` →
    `'[PR# | URL | branch] [--non-interactive]'`
- [ ] **1.2 — Update Step 1 (lines 32–49) to parse `--non-interactive`:**
  - Add a "Flag parsing" preamble that splits `$ARGUMENTS` on whitespace,
    extracts `--non-interactive` if present, sets non-interactive mode ON,
    and removes it from the token list. Unknown `--` tokens become a
    `[review:pr] Error: unknown flag <token>.` and stop.
  - Mirror the exact prose pattern from `resolve-pr.md:30–53` for consistency.
- [ ] **1.3 — Guard Step 9 (lines 710–723) on non-interactive mode:**
  - Wrap the `AskUserQuestion` at line 715 with: "If non-interactive mode is
    ON, skip the AskUserQuestion and proceed directly to the push commands
    below (gt modify + gt submit). If non-interactive mode is OFF, run the
    AskUserQuestion as currently specified."
- [ ] **1.4 — Guard Step 9b's optional P2-only prompt (lines 762–763):**
  - The conditional "If P2 findings exist but no P0/P1: use AskUserQuestion"
    becomes: "If P2 findings exist but no P0/P1: in non-interactive mode,
    skip (do not record). In interactive mode, use AskUserQuestion as
    specified."
- [ ] **1.5 — Add a "Non-interactive mode" prose block** after Step 1's flag
  parsing, mirroring `resolve-pr.md:48–53`:
  > "Non-interactive mode suppresses the Step 9 push-confirmation gate and
  > the Step 9b P2-only 'save learnings' prompt — so the command runs
  > unattended. It is set automatically when `/review:sweep` invokes this
  > command; an interactive user can also pass `--non-interactive`
  > explicitly. When the flag is absent, every gate behaves exactly as
  > before."
- [ ] **1.6 — Verify `AskUserQuestion` remains in `allowed-tools`:**
  - It is still used in the interactive code path. Do not remove from
    frontmatter.

### Phase 2: `/review:sweep` gate removal + flag forwarding

- [ ] **2.1 — Remove Step 3 (sweep.md lines 100–126) entirely:**
  - Delete the heading `### Step 3: Confirm clean completion (failure-boundary
    gate)` and all body content through the "Then stop. Do not proceed to
    Step 4 or Step 5." sentence.
- [ ] **2.2 — Renumber remaining steps:**
  - Current Step 4 → Step 3 (`/review:resolve` invocation)
  - Current Step 5 → Step 4 (final summary)
- [ ] **2.3 — Update Step 2 (`/review:pr` invocation, ~line 93)** to pass the
  flag: `Skill(skill: "review:pr", args: "<PR#> --non-interactive")`. Add a
  one-sentence comment matching the existing review:resolve comment block
  pattern (sweep.md:131–134): "The `--non-interactive` flag suppresses
  /review:pr's Step 9 push prompt and Step 9b 'save learnings' prompt so the
  wrapper runs unattended."
- [ ] **2.4 — Update Step 3 (was Step 4, `/review:resolve` invocation, ~lines
  130–134)** to pass the flag: `Skill(skill: "review:resolve", args: "<PR#>
  --non-interactive")`. The existing block already names the flag's effects;
  expand its rationale to mention that sweep's removed gate is what justifies
  the unattended invocation.
- [ ] **2.5 — Fix Step 4 (was Step 5, ~lines 144–145) preamble:**
  - Replace "Reached only when the user selected **Proceed** at Step 3 and
    Step 4 ran." with "Reached after Step 2 (/review:pr) and Step 3
    (/review:resolve) have run."
- [ ] **2.6 — Remove the stale error-handling bullet (~lines 173–175):**
  - Delete the bullet referring to "`/review:pr` failed or push declined ...
    surfaced via the user-confirmed Step 3 gate."
- [ ] **2.7 — Update Step 1 dirty-tree rationale comment (~line 70):**
  - Replace "eliminates the ambiguity at the Step 3 gate before it appears"
    with prose framing the check as a pre-flight guard for the unattended
    pipeline.
- [ ] **2.8 — Drop `AskUserQuestion` from `allowed-tools` (sweep.md:8):**
  - The only usage was the removed Step 3 gate. Verify with
    `grep -n AskUserQuestion plugins/yellow-review/commands/review/sweep.md`
    after the edit (expect zero matches in the body, only the changelog/git
    history).

### Phase 3: New `/review:sweep-all` command

- [ ] **3.1 — Create `plugins/yellow-review/commands/review/sweep-all.md`** with
  frontmatter:
  ```yaml
  ---
  name: review:sweep-all
  description: 'Run /review:sweep on every open non-draft PR authored by the current user, sequentially, with one upfront confirmation. Use when you want to clear review + resolve backlog across all your open PRs in one batch.'
  argument-hint: ''
  allowed-tools:
    - Bash
    - AskUserQuestion
    - Skill
  ---
  ```
- [ ] **3.2 — Write `## Workflow` body with these sections:**
  - **`### Step 1: Pre-flight checks`** — verify `gh` installed, `gh auth
    status` succeeds, `jq` installed, `git status --porcelain` empty. Each
    check exits non-zero with a named `[review:sweep-all] Error: ...` message.
    Pattern: copy the shape from `resolve-stack.md:44–67`, omit the `gt`
    check (sweep itself invokes gt — pre-flight at the sweep-all level should
    not duplicate it).
  - **`### Step 2: Enumerate open non-draft PRs`** — one Bash block:
    ```bash
    gh pr list --author @me --state open --limit 1000 \
      --json number,headRefName,isDraft,title \
      --jq '[.[] | select(.isDraft == false)] | sort_by(.number)'
    ```
    Note: `title` is added vs. review-all.md's existing query (which omits it);
    sweep-all needs titles for the M3 gate display.
    - If the result is `[]` (empty): print
      `[review:sweep-all] No open non-draft PRs found. Nothing to sweep.` and
      exit 0. Do NOT show the M3 gate.
  - **`### Step 3: Upfront M3 confirmation gate`** — AskUserQuestion showing:
    ```
    Found N open non-draft PRs authored by you. Run /review:sweep on each
    sequentially?

    PRs to sweep:
      #<num> — <title>
      ...
    ```
    Options: `"Proceed — sweep all N PRs"` / `"Cancel"`. On Cancel, print
    `[review:sweep-all] Cancelled. No sweeps run.` and exit 0.
  - **`### Step 4: Sequential sweep loop`** — For each PR in the sorted list,
    in order:
    1. Print `[review:sweep-all] Sweeping PR #<num> (<i>/<N>)`.
    2. Invoke `Skill(skill: "review:sweep", args: "<PR#>")`. The skill name is
       `review:sweep` (the `name:` value of `sweep.md`) — NOT `review:sweep-all`
       (would silently fail). Add the same explicit warning comment block as
       `sweep.md:131–134`.
    3. Record an outcome row: `swept` if the Skill call returned, or
       `skipped — <reason>` if a pre-Skill or post-Skill check detected an
       error. Failure = any exception thrown by the surrounding Bash blocks,
       NOT the Skill call itself (Skill returns no exit code per
       `sweep.md:18–19`).
    4. Continue to the next PR. No pauses, no AskUserQuestion inside the loop.
    
    `$VAR` rule applies: the PR number from each iteration must be substituted
    inline in each Bash block (variables don't survive across blocks). Print
    the PR number with `printf` and instruct the LLM to use it as a literal
    in subsequent blocks within the iteration.
  - **`### Step 5: End-of-loop summary table`** — print a pipe-delimited
    markdown table:
    ```
    | PR# | Title (truncated) | Outcome | Skip Reason |
    |-----|-------------------|---------|-------------|
    ```
    Followed by totals: `Swept: N | Skipped: M | Total: N+M`.
  - **`### Step 6: Knowledge compounding (conditional)`** — explicit skip
    guard as the first line of the step: "If `swept_count == 0`, skip this
    step entirely — do NOT invoke compound. Print
    `[review:sweep-all] Skipping /workflows:compound — no PRs swept.`"
    Otherwise:
    1. Invoke `Skill(skill: "workflows:compound", args: "sweep-all: swept PRs
       <comma-separated swept PR numbers>")`. The args string is a free-text
       hint; compound reads the conversation context (last 25 turns) for the
       actual extraction.
    2. If compound exits non-zero (e.g., `docs/solutions/` missing), log
       `[review:sweep-all] Warning: compound failed; learnings not captured`
       and continue (do NOT fail the command — sweep-all succeeded).
  - **`## Error Handling`** — table of pre-flight failure codes, plus a note:
    "Running sweep-all concurrently with another sweep or review command may
    cause dirty-tree failures inside the loop; avoid concurrent invocations."
- [ ] **3.3 — Normalize line endings** (WSL2 Write tool produces CRLF):
  ```bash
  sed -i 's/\r$//' plugins/yellow-review/commands/review/sweep-all.md
  ```

### Phase 4: Documentation updates

- [ ] **4.1 — Update `plugins/yellow-review/CLAUDE.md`:**
  - Commands header: `### Commands (6)` → `### Commands (7)`
  - Rewrite the `/review:sweep` entry — remove "with a user-confirmed boundary
    gate between them"; new text: "Wrapper that runs `/review:pr
    --non-interactive` then `/review:resolve --non-interactive` on the same
    PR with no gates in between — fully unattended."
  - Add `/review:sweep-all` entry after sweep:
    "Run `/review:sweep` on every open non-draft PR authored by the current
    user sequentially, with one upfront confirmation, skip-and-continue per
    PR, end-of-loop summary, and a single `/workflows:compound` pass at the
    end."
  - Expand the "Always confirm with user via AskUserQuestion before pushing"
    convention exception list: add `/review:sweep` (every push is now
    auto-confirmed inside the wrapper) and `/review:sweep-all` (only the
    upfront M3 is interactive; per-PR pushes are auto-confirmed via the
    sweep wrapper's flag forwarding).
  - Add a `/review:sweep-all` row to the "When to Use What" section after
    the `/review:sweep` row.

- [ ] **4.2 — Update `plugins/yellow-review/README.md` command table** — add
  a row for `/review:sweep-all` after `/review:sweep`. Match the existing
  pipe-table format.

- [ ] **4.3 — No change to `plugins/yellow-core/commands/setup/all.md`:** this
  is an internal yellow-review command, not a new plugin. Verified.

- [ ] **4.4 — No change to `plugins/yellow-review/.claude-plugin/plugin.json`
  `commands` array:** the plugin uses filesystem auto-discovery; no `commands`
  field exists. Verified.

### Phase 5: Validation, changeset, commit, submit

- [ ] **5.1 — Run validators:**
  ```bash
  pnpm validate:agents
  pnpm validate:plugins
  pnpm validate:schemas
  pnpm test:unit
  pnpm lint
  pnpm typecheck
  ```
- [ ] **5.2 — Create changeset:** `pnpm changeset` — select `yellow-review`,
  choose **minor** (new command + sweep behavior change are both additive
  from the user's perspective; no breaking interface change).
  Suggested changeset summary:
  > "Remove the human gate from /review:sweep and add /review:sweep-all for
  > unattended batch sweeping of all open PRs. /review:pr gains a
  > `--non-interactive` flag (used internally by sweep)."
- [ ] **5.3 — Verify three-way version sync after `pnpm apply:changesets`:**
  `package.json` → `plugin.json` → `marketplace.json` all at `3.2.0`. Run
  `pnpm validate:versions`.
- [ ] **5.4 — `gt commit create -m "feat(yellow-review): ..."` + `gt stack
  submit`.** Use the gt-workflow `smart-submit` skill if a multi-agent audit
  is desired before submission.

## Technical Details

### Files to Modify

- `plugins/yellow-review/commands/review/review-pr.md` (4 edits: frontmatter,
  Step 1 flag parsing, Step 9 guard, Step 9b guard)
- `plugins/yellow-review/commands/review/sweep.md` (8 edits: remove Step 3,
  renumber, add `--non-interactive` to both Skill calls, fix Step 4
  preamble, remove stale error bullet, update dirty-tree comment, drop
  AskUserQuestion from allowed-tools)
- `plugins/yellow-review/CLAUDE.md` (Commands count, sweep rewrite,
  sweep-all add, convention exception expansion, "When to Use" row)
- `plugins/yellow-review/README.md` (one new table row)

### Files to Create

- `plugins/yellow-review/commands/review/sweep-all.md` (new command, ~120–160
  lines following resolve-stack.md pattern)
- `.changeset/<hash>.md` (auto-generated by `pnpm changeset`)

### Files NOT to Modify (confirmed by research)

- `plugins/yellow-review/.claude-plugin/plugin.json` — no `commands` array
- `plugins/yellow-core/commands/setup/all.md` — not a new plugin
- Any TypeScript packages — no code changes

### Skill-Invocation Names Reference

| Invocation | `name:` to pass | File backing it |
|---|---|---|
| `Skill(skill: "review:pr", ...)` | `review:pr` | `review-pr.md:2` |
| `Skill(skill: "review:resolve", ...)` | `review:resolve` | `resolve-pr.md:2` |
| `Skill(skill: "review:sweep", ...)` | `review:sweep` | `sweep.md:2` |
| `Skill(skill: "workflows:compound", ...)` | `workflows:compound` | `compound.md:2` |

The `name:` value — NOT the filename — is what `Skill` resolves on. Using
`review:resolve-pr`, `review:sweep-all` (instead of sweep), or
`workflows/compound` would silently fail.

## Acceptance Criteria

1. **`/review:pr` accepts `--non-interactive`:** Step 1's flag-parsing prose
   handles the token; Step 9's `AskUserQuestion` is wrapped in an
   `if non-interactive mode is OFF` guard; Step 9b's P2-only prompt has the
   same guard. `pnpm validate:agents` passes.

2. **`/review:sweep` Step 3 boundary gate is removed:** `grep -n
   AskUserQuestion plugins/yellow-review/commands/review/sweep.md` returns
   zero matches in the body. The body proceeds from Step 2 (`/review:pr
   --non-interactive`) directly to Step 3 (`/review:resolve
   --non-interactive`) to Step 4 (final summary) with no user prompts.

3. **`/review:sweep` forwards `--non-interactive` to both inner commands:**
   `grep -n "args: \"<PR#>" plugins/yellow-review/commands/review/sweep.md`
   shows both Skill calls passing `<PR#> --non-interactive`.

4. **`/review:sweep-all` exists and satisfies:**
   - Pre-flight checks: `gh` installed, `gh auth status`, `jq` installed,
     `git status --porcelain` empty (each with a named error message and
     non-zero exit)
   - Enumerates via `gh pr list --author @me --state open --json
     number,headRefName,isDraft,title` with jq filter `isDraft == false` and
     sort by PR number ascending
   - Exits 0 with `[review:sweep-all] No open non-draft PRs found.` if the
     enumerated list is empty; does NOT show the M3 gate in this case
   - Shows one upfront `AskUserQuestion` M3 confirmation listing PR count
     and per-PR `#<num> — <title>` titles; options "Proceed" / "Cancel"
   - Exits 0 with `[review:sweep-all] Cancelled.` on Cancel; does NOT run
     any sweep
   - Loops sequentially over PRs invoking `Skill(skill: "review:sweep",
     args: "<PR#>")` per PR — never pauses inside the loop
   - Logs per-PR outcome (`swept` or `skipped — <reason>`); a Skill call that
     returns is `swept`; an exception in the surrounding Bash blocks is
     `skipped`
   - Prints an end-of-loop pipe-delimited summary table with columns
     `PR# | Title | Outcome | Skip Reason` plus totals
   - Invokes `Skill(skill: "workflows:compound", args: "sweep-all: swept PRs
     ...")` exactly once after the summary, ONLY if `swept_count >= 1`;
     gracefully logs and continues if compound exits non-zero

5. **`plugins/yellow-review/CLAUDE.md` Component Catalog reflects the new
   state:** Commands count `(7)`; sweep entry rewritten without "boundary
   gate"; sweep-all row added; convention exception list mentions
   `/review:sweep` and `/review:sweep-all`; "When to Use What" includes
   sweep-all.

6. **`plugins/yellow-review/README.md` command table includes the
   `/review:sweep-all` row.**

7. **Changeset present and version sync clean:** `.changeset/<hash>.md`
   exists; after `pnpm apply:changesets`, `package.json`, `plugin.json`, and
   `marketplace.json` all read `"version": "3.2.0"`; `pnpm validate:versions`
   passes.

8. **CI baseline passes:** `pnpm validate:schemas && pnpm test:unit && pnpm
   lint && pnpm typecheck` exits 0.

## Edge Cases

- **PR closed/merged between enumeration and sweep invocation:** sweep's own
  Step 1 PR-state check will detect this and abort that PR's sweep with a
  clear error. sweep-all logs the outcome as `skipped — PR no longer open`
  and continues.
- **Dirty working tree appears mid-loop:** sweep's Step 2 dirty-tree check
  catches it. sweep-all marks the PR `skipped — dirty tree` and continues
  (the user will need to inspect and clean up before re-running).
- **`docs/solutions/` directory missing:** compound exits non-zero; sweep-all
  logs a warning and exits 0 (sweep-all's job is to sweep, not to compound;
  compound is a nice-to-have).
- **User authored zero open non-draft PRs:** empty-list early exit; no M3
  gate shown.
- **N=1 PR:** the M3 gate still fires per the project's "no count threshold"
  rule. The single-PR case is a 1-iteration loop.
- **`gh pr list` returns &gt;50 PRs:** no rate-limit special-casing in v1.
  Document in Error Handling that very large PR sets may take significant
  time; user can Ctrl-C and re-run after the merge queue catches up.
- **`/review:pr` push gate (post-flag) failure:** with `--non-interactive`,
  the push runs unattended. If `gt submit` itself fails (network, lock,
  remote rejection), `/review:pr`'s existing error handling reports it; sweep
  surfaces it as a Skill-side error message; sweep-all logs `skipped` and
  continues.
- **Concurrent sweep-all invocations:** no explicit lock; the dirty-tree
  guard in each per-PR sweep provides natural serialization (the second
  invocation's first PR will fail-fast on a dirty tree if the first is
  mid-operation).

## Risks Accepted (Inherited from Brainstorm)

- **Resolve runs on a broken /review:pr result:** with the boundary gate
  removed, if /review:pr fails silently (e.g., agent crash, network glitch),
  /review:resolve still runs. The user accepts post-hoc cleanup.
- **sweep-all pushes commits to N branches with one upfront confirmation:**
  the M3 gate before the loop is the only checkpoint. Confirming a list of 8
  PRs pushes review fixes + resolve fixes to all 8 without further
  interaction. (Previously, `/review:pr`'s own push gate was a per-PR
  safety net; with the new `--non-interactive` flag, that safety net is
  intentionally bypassed inside the sweep wrapper.)
- **`/review:pr` `--non-interactive` removes the only interactive push
  checkpoint when invoked standalone with the flag:** interactive users who
  don't pass the flag retain the current behavior. The flag's existence is
  for sweep's use; documenting it in `argument-hint` exposes it to
  intentional manual use too.

## References

- **Brainstorm:** `docs/brainstorms/2026-05-18-sweep-command-human-gate-removal-brainstorm.md`
- **SpecFlow scope expansions** (Findings 1 & 2): adding `--non-interactive`
  to both `/review:pr` and the inner `/review:resolve` invocation in sweep.
  These were not in the original brainstorm but were locked in via
  AskUserQuestion in the planning session.
- **Loop pattern reference:** `plugins/yellow-review/commands/review/resolve-stack.md`
  (especially Step 1 pre-flight at lines 44–67, Step 3 walk-the-stack at
  lines 120–195, exit-code contract at line 194).
- **M3 gate reference:** `plugins/yellow-review/commands/review/resolve-pr.md:182–184`
  (Spawn-cap gate prose pattern).
- **`--non-interactive` precedent:** `resolve-pr.md:30–53` (flag parsing +
  mode-prose block; copy this shape into review-pr.md).
- **Skill-invocation gotcha:** `sweep.md:131–134` (warning comment about using
  the `name:` value, not the filename).
- **Project-memory rules to honor:**
  - "M3 before bulk writes — no threshold" (applies to sweep-all's upfront gate)
  - "$VAR in bash code blocks" (re-derive PR number inline per block)
  - "WSL2 CRLF normalization" (`sed -i 's/\r$//'` on new files)
  - "AskUserQuestion 'Other' is the ONLY free-text button" (use "Proceed" /
    "Cancel" — no free text needed for sweep-all)
  - "Heredoc delimiter collision" (use `__EOF_SWEEP_FINDINGS__` if any
    heredoc is added)
