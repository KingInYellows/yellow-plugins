# Feature: `/review:sweep` — Wrapper Command Chaining `/review:pr` → `/review:resolve`

> **Status: Implemented (PR #304, merged)** — Command shipped at `plugins/yellow-review/commands/review/sweep.md`. Subsequent hardening: rounds 2+3+bot threads (`459a43d5`).

## Problem Statement

After running `/review:pr` on a PR, users still need to manually invoke
`/review:resolve` to clear bot and human reviewer comment threads on the same
PR. Both commands operate on a single PR and share the same `gh`/Graphite auth
context, so the two-step invocation is friction with no benefit. A single
wrapper command should run both in sequence on the same PR.

## Current State

- `plugins/yellow-review/commands/review/review-pr.md` — multi-agent AI code
  review with autonomous P0/P1 fix loop. Accepts PR#, GitHub URL, branch name,
  or empty (auto-detect). At Step 9, prompts user to push fixes via
  `gt submit`. **Decline path produces only prose** ("changes remain
  uncommitted for manual review"), no exit code or machine-readable signal.
- `plugins/yellow-review/commands/review/resolve-pr.md` — parallel resolution
  of unresolved GitHub review threads (bot and human). Accepts numeric PR# or
  empty. Does NOT accept URL or branch name.
- `plugins/yellow-review/commands/review/review-all.md` — chains
  `/review:pr` across multiple PRs by **inlining the entire pipeline**, not
  by Skill-invoking `/review:pr`. Deliberate choice noted in the file.

**Critical finding from research:** the `Skill` tool does not surface exit
status from invoked commands. There is no programmatic way for a wrapper to
detect "review-pr errored" vs "user declined Step 9 push" vs "review-pr
completed cleanly with changes pushed." Detection must happen via user prompt
at the wrapper boundary, not via inspecting Skill output.

<!-- deepen-plan: external -->
> **Research:** Confirmed by Anthropic Claude Code docs (`code.claude.com/docs/en/skills`) and community reverse-engineering: the `Skill` tool is a context-injection mechanism, not a function call. It expands the target skill's body into Claude's context but returns no exit code, success flag, or error text. The only documented pattern for cross-command status detection is a sentinel file written by the sub-command — which is unavailable here because the brainstorm forbids modifying `/review:pr`. Source: <https://code.claude.com/docs/en/skills>; community analysis at <https://mikhail.io/2025/10/claude-code-skills/>.
<!-- /deepen-plan -->

<!-- deepen-plan: codebase -->
> **Codebase:** Direct precedent for `Skill`-invoking `review:pr` already exists at `plugins/yellow-core/commands/workflows/review.md:54` (uses `skill: "review:pr"` with no downstream status inspection). This is a closer analog than the `linear/work.md` reference cited later — same target skill, same no-status pattern. Confirms our design matches existing convention.
<!-- /deepen-plan -->

## Proposed Solution

Create `plugins/yellow-review/commands/review/sweep.md` — a thin orchestration
command. Sequence:

1. Resolve PR number once from the wrapper's argument (mirrors `/review:pr`'s
   accept-anything arg shape: PR#, URL, branch, empty). Convert URL/branch to
   numeric PR# so the same value can be passed to `/review:resolve` (which
   only accepts numeric).
2. Invoke `/review:pr <PR#>` via the `Skill` tool. Skill returns control when
   `/review:pr` exits its execution.
3. Use `AskUserQuestion` to confirm clean completion before proceeding:
   "Did `/review:pr` complete successfully (review finished, fixes pushed or
   not needed)? Proceed to resolve open comment threads on PR #X?"
   - **Yes** → proceed to step 4.
   - **No** → stop. Print summary "Resolve step skipped — re-run
     `/review:resolve <PR#>` manually when ready."
4. Invoke `/review:resolve <PR#>` via the `Skill` tool.
5. Print final summary: PR number, review outcome (per user), resolve outcome
   (from Skill output).

**Why this design satisfies the brainstorm's "stop on review failure"
requirement (choice B):** since no programmatic signal exists, the user
becomes the failure-boundary signal at step 3. They have just observed
`/review:pr`'s output and know whether it errored or whether they declined
the push. One question, two choices, no friction beyond a single confirmation.

**Why not inline the `/review:pr` pipeline** (like `review-all.md` does):
inlining would duplicate ~700 lines of orchestration logic that already lives
in `review-pr.md`, and any future change to `/review:pr` would need to be
mirrored here. The wrapper is meant to be a thin convenience, not a fork.
Skill-invocation + boundary prompt accepts one extra question in exchange for
keeping the wrapper at ~50 lines.

## Implementation Plan

### Phase 1: Foundation

- [x] **1.1** Create `plugins/yellow-review/commands/review/sweep.md` with
  frontmatter:
  - `name: review:sweep`
  - `description:` single-line "Use when..." trigger clause
  - `allowed-tools: Bash, Skill, AskUserQuestion`
  - `argument-hint: [pr-number | github-url | branch-name | (empty for current branch)]`
- [x] **1.2** Add the standard "What it does" + "When to use" prose at top of
  body (matches existing review command style).

### Phase 2: Implementation

- [x] **2.1** Arg-parsing block (mirror `review-pr.md` lines 31–40):
  - If `$ARGUMENTS` numeric → use as PR#.
  - Else if matches `github.com.*\/pull\/[0-9]+` → extract PR#.
  - Else if non-empty → treat as branch name, run
    `gh pr view "$ARGUMENTS" --json number -q .number`.
  - Else → auto-detect from current branch:
    `gh pr view --json number -q .number`.
  - Validate result is numeric and non-empty. If not, exit with error.

<!-- deepen-plan: codebase -->
> **Codebase:** Original draft used `gh pr list --head "$BRANCH" --json number -q '.[0].number'` for the branch case. The actual `review-pr.md` (lines 31–40) uses `gh pr view "$ARGUMENTS" --json number -q .number` — passes the branch name directly to `gh pr view`. The simpler form is what reviewers expect to see and is what the wrapped command uses, so the wrapper should mirror it exactly. Plan corrected above.
<!-- /deepen-plan -->
- [x] **2.2** Invoke `/review:pr <PR#>` via the `Skill` tool with
  `skill: "review:pr"` and `args: "<PR#>"`. Wait for completion.
- [x] **2.3** `AskUserQuestion` boundary gate:
  - Question: `"/review:pr finished. Did it complete cleanly (review
    succeeded, fixes pushed or not needed)? Proceed to resolve open comment
    threads on PR #<PR#>?"`
  - Options: `Proceed`, `Stop`. Treat any non-`Proceed` outcome (Stop,
    dismiss, timeout, no response, non-interactive environment) as Stop.
  - _Note (post-implementation correction):_ an earlier draft included an
    `Other` (free-text) option, but per the MEMORY.md anti-pattern
    "AskUserQuestion 'Other' is the ONLY free-text button" and the
    prompt-injection surface that prose-driven intent parsing on user-typed
    text creates, the `Other` option was dropped before merge. The Edge
    Cases section below has been updated to match.
- [x] **2.4** On `Stop`: print `[review:sweep] Resolve step skipped. Re-run
  /review:resolve <PR#> manually when ready.` Exit 0.
- [x] **2.5** On `Proceed`: invoke `/review:resolve <PR#>` via the `Skill`
  tool with `skill: "review:resolve"` and `args: "<PR#>"`.

<!-- deepen-plan: codebase -->
> **Codebase:** Original draft incorrectly used `skill: "review:resolve-pr"`. The actual frontmatter `name:` field at `plugins/yellow-review/commands/review/resolve-pr.md:2` is `review:resolve` (the file is named `resolve-pr.md` but the slash command name is `review:resolve`). Using `review:resolve-pr` would silently fail to invoke the skill. Plan corrected above. **This is a hard requirement — the implementor must use `skill: "review:resolve"` exactly.**
<!-- /deepen-plan -->
- [x] **2.6** Final summary block: PR number, review-pr outcome (as reported
  by user at boundary), resolve-pr outcome (echo Skill summary or "no
  threads found" if applicable).

### Phase 3: Quality

- [x] **3.1** Ensure no `Bash` block references variables defined in another
  block (functions don't survive bash blocks — re-define in each, per memory
  rule). Slug regex check on PR#: `^[0-9]+$`.
- [x] **3.2** Confirm `allowed-tools` lists every tool used in body (Skill,
  AskUserQuestion, Bash). Run `pnpm validate:plugins`.
- [x] **3.3** Add a changeset: `pnpm changeset` → minor bump for
  yellow-review (new command = additive change).
- [x] **3.4** Update `plugins/yellow-review/CLAUDE.md` — current text reads
  "Commands (4)" with each command listed by name. Bump to "Commands (5)"
  and add a description line for `/review:sweep`.

<!-- deepen-plan: codebase -->
> **Codebase:** Confirmed: `plugins/yellow-review/CLAUDE.md` enumerates the four current commands (`/review:setup`, `/review:pr`, `/review:resolve`, `/review:all`) and prefixes the section with "Commands (4)". Both the count and the enumeration must be updated atomically — count drift is a known anti-pattern in this repo (see MEMORY.md "Multi-file MCP count drift"). No `output-styles` directory entries need updating; that surface is shared across commands.
<!-- /deepen-plan -->
- [x] **3.5** Update `plugins/yellow-review/README.md` (or top-level docs) to
  mention `/review:sweep` alongside `/review:pr` and `/review:resolve`.

## Technical Details

### Files to Create

- `plugins/yellow-review/commands/review/sweep.md` — the wrapper command
  (~80–120 lines).

### Files to Modify

- `plugins/yellow-review/CLAUDE.md` — add `/review:sweep` to command list (if
  it enumerates).
- `plugins/yellow-review/README.md` — add a one-line mention.
- `.changeset/<auto>.md` — minor bump for `yellow-review`.

### Files NOT to Modify

- `plugins/yellow-review/commands/review/review-pr.md` — unchanged.
- `plugins/yellow-review/commands/review/resolve-pr.md` — unchanged.
- `plugins/yellow-review/.claude-plugin/plugin.json` — no `commands` array
  exists; commands are auto-discovered by Claude Code from the directory
  layout. No registration step.

### No Dependencies Added

The wrapper uses only tools already available in the plugin: `Bash`, `Skill`,
`AskUserQuestion`. No new MCP servers, no new agents, no new skills.

## Acceptance Criteria

1. Running `/review:sweep 123` invokes `/review:pr 123`, prompts the user
   at the boundary, and (on approval) invokes `/review:resolve 123`.
2. Running `/review:sweep <github-url>` and `/review:sweep <branch>` both
   resolve to the correct numeric PR# and behave identically to (1).
3. Running `/review:sweep` with no args auto-detects PR from the current
   branch.
4. If the user selects "Stop" at the boundary, `/review:resolve` is NOT
   invoked, and the user sees a clear "skipped — run X manually" message.
5. If `/review:resolve` finds zero unresolved threads, the wrapper reports
   "No open threads to resolve" rather than treating it as a failure.
6. `pnpm validate:plugins` passes; `pnpm validate:schemas` passes.
7. The plugin's changeset is recorded as a minor bump for `yellow-review`.

## Edge Cases

- **PR not found from branch:** `gh pr view "$ARGUMENTS"` returns an
  error or non-numeric output → wrapper exits with
  `[review:sweep] Error: no PR found for branch <X>` before invoking
  `/review:pr`.
- **Invalid arg:** non-numeric, non-URL, non-branch (e.g. fails the
  `^[A-Za-z0-9/_.-]+$` charset guard) → exit with descriptive error.
  `$ARGUMENTS` is sanitized before being echoed in the error to prevent
  terminal escape injection.
- **`/review:pr` completes with no findings and no changes to push:** user
  selects "Proceed" at boundary; wrapper continues to resolve. This is the
  expected happy path for already-clean PRs that just have human/bot threads
  to clear.
- **`/review:resolve` errors mid-run:** Skill returns; wrapper prints
  whatever summary it can and exits non-zero. (No retry logic — YAGNI.)

<!-- deepen-plan: external -->
> **Research:** GitHub's `resolveReviewThread` GraphQL mutation requires `contents: write` permission on the GitHub App/token, **not just `pull_requests: write`**. The default `gh auth login` token has both, but custom GitHub Apps often request only the latter and silently fail with "Resource not accessible by integration." This is a `/review:resolve` concern (the wrapper just delegates), but worth verifying that `/review:resolve`'s setup docs or error handling surface this clearly. If they don't, file a follow-up issue against `/review:resolve` rather than expanding this plan. Source: <https://github.com/orgs/community/discussions/44650>.
<!-- /deepen-plan -->

<!-- deepen-plan: external -->
> **Research:** Community convention for bot-thread auto-resolution (drawn from `gh-aw` reference, reviewdog issue #1720): filter on `author.__typename == "Bot"` AND `comments.totalCount == 1` before mass-resolving — i.e., resolve only solo bot threads with no human reply. This is `/review:resolve`'s concern, not the wrapper's. The brainstorm confirms `/review:resolve` already routes each thread through a `pr-comment-resolver` agent that decides fix-vs-FP-response per thread; the wrapper inherits that behavior. Source: <https://github.github.com/gh-aw/reference/safe-outputs-pull-requests/>.
<!-- /deepen-plan -->
- **User dismisses boundary question (Escape, timeout, non-interactive
  environment, no response):** treat as Stop and follow the Stop path.
  The implementation has only `Proceed` and `Stop` buttons (no `Other`
  free-text option — see step 2.3 note); any non-`Proceed` outcome must
  be treated as Stop to avoid silently advancing to `/review:resolve` on
  an un-confirmed review state.

## YAGNI Boundary

This plan deliberately excludes:

- A `--no-confirm` flag to skip the boundary question. If users find the
  question annoying, that's a follow-up; for now the question is the only
  reliable failure-boundary signal.
- Modifying `/review:pr` to emit a structured exit signal (state file,
  sentinel string). The brainstorm explicitly forbids changing existing
  commands.

<!-- deepen-plan: external -->
> **Research:** A community-documented pattern for cross-`Skill` status detection is the sentinel-file approach — the producer (`/review:pr`) writes a state file the consumer (`/review:sweep`) reads — but it requires both sides to coordinate on a shared format. Since the brainstorm forbids modifying `/review:pr`, this option is closed. The `AskUserQuestion`-at-boundary design is the YAGNI-correct fallback. If a future decision opens up modifying `/review:pr`, revisit this plan to swap the boundary prompt for a sentinel-file read. Third-party reference (treat as community observation, not Anthropic guidance): <https://www.mindstudio.ai/blog/claude-code-skill-collaboration-chaining-workflows/>.
<!-- /deepen-plan -->
- Inlining the `/review:pr` pipeline (~700 lines duplicated). Skill
  invocation is sufficient.
- A second iteration after resolve completes (e.g., re-running `/review:pr`
  on the now-fixed PR). Out of scope.
- Stack-aware sweeping (running across multiple stacked PRs). That's
  `/review:all`'s job; do not overlap.

## References

- Brainstorm: `docs/brainstorms/2026-04-30-review-pr-chain-resolve-brainstorm.md`
- Existing commands:
  - `plugins/yellow-review/commands/review/review-pr.md`
  - `plugins/yellow-review/commands/review/resolve-pr.md`
  - `plugins/yellow-review/commands/review/review-all.md`
- Plugin manifest: `plugins/yellow-review/.claude-plugin/plugin.json`
- Skill-tool delegation precedents:
  - `plugins/yellow-core/commands/workflows/review.md:54` — closer analog,
    invokes `skill: "review:pr"` directly
  - `plugins/yellow-linear/commands/linear/work.md:183` — generic Skill
    invocation pattern

<!-- deepen-plan: codebase -->
> **Codebase:** No precedent in this repo for `AskUserQuestion` used as a control-flow gate between two delegated `Skill` invocations. Existing `AskUserQuestion` calls handle input disambiguation, destructive-action confirmation, and routing — never sequential-skill boundary gating. The pattern in this plan is novel for this codebase. Architecturally sound, but implementors should not expect a copy-paste template. The closest reference is the M3-confirmation pattern documented in MEMORY.md.
<!-- /deepen-plan -->

<!-- deepen-plan: codebase -->
> **Codebase:** Changeset precedent — both existing yellow-review changesets in `.changeset/` (`learnings-researcher-sentinel-fix.md`, `changelog-3-segment-and-cache-refresh-doc.md`) record `"yellow-review": patch`. A new command is correctly classified as `minor` per project semver conventions (per `docs/CLAUDE.md` "minor — new command, skill, or agent"), but no existing yellow-review changeset uses `minor` — this will be the first. No conflict, but reviewers may flag for double-check.
<!-- /deepen-plan -->
- Memory rules referenced:
  - `feedback_agent_file_size.md` (line counts are guidelines)
  - Bash-block isolation: functions don't survive subprocess boundaries
  - `allowed-tools` must enumerate every tool used in body
  - Skill descriptions must be single-line
