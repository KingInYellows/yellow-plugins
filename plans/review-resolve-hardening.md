# Feature: Review Resolve Hardening

Source brainstorm: `docs/brainstorms/2026-09-30-review-resolve-hardening-brainstorm.md`

## Overview

`/review:resolve` and `/review:resolve-stack` should leave every unresolved
review thread in an honest, durable state. That supports an org rule of "no
merge until all comments are resolved; file a follow-up issue only when a
comment is clearly out of scope." GitHub thread state is the record. The
review-findings ledger is not involved.

## Problem Statement

### Current Pain Points

- **Unstaged fixes can be lost.** Step 6 (Graphite) runs
  `gt modify -m` without staging anything first.
  - Resolver edits can be silently left out while their threads are still
    marked resolved. One batch lost 19 fixes this way; see
    `docs/solutions/workflow/gt-modify-no-c-flag-silent-unstaged-miss.md`.
  - `-m` also amends and renames the previous commit, which destroys the
    reviewer's "changes since my last review" view.
- **Step 7 marks the wrong threads resolved.** It resolves any cluster
  without `CONFLICT:`, ignoring the resolver `Status`, so `skipped` and
  `partial` clusters get resolved.
- **"Already addressed" can never be resolved.** Step 7 is skipped when
  nothing was committed.
- **Replies and issues are missing.** The command cannot reply to a thread
  or file a follow-up issue.
- **Some threads never get handled.** These are:
  - outdated unresolved threads, which are filtered out yet still block merge;
  - bare LGTM and nit threads, which are dropped and left open forever;
  - `CHANGES_REQUESTED` reviews, which are never reported.
- **Agents keep saving the same two memory lessons.**
  - `gt modify -c` avoids folding fixes into the previous commit.
  - The push guard blocks inline shell it cannot parse, so complex shell has
    to go in script files.

  Both are command defects.

### User Impact

Threads are closed without a fix, reviewers lose incremental diffs, and in a
stack walk, fixes left on disk carry over onto the next PR.

## Proposed Solution

### Key Design Decisions

Decisions from the brainstorm and the planning round:

- **Four dispositions, decided per thread.**
  - The resolver proposes a disposition for each thread.
  - The orchestrator validates it, and is the only component that writes to
    GitHub.
  - The four outcomes:
    - `fixed`: reply with the verified SHA, then resolve.
    - `addressed`: reply with a mechanically verified pointer, then resolve.
    - `oos`: file an issue, reply with the link, then resolve.
    - `disagree` or `unclear`: reply and leave open (blocking).
- **Resolve last.** A thread is resolved only after its reply posts, except
  dropped non-actionable threads, which resolve with no reply unless
  `resolve_human_threads: never` holds them open. For `fixed`, the verified
  push must also have landed. Anything malformed, missing, skipped or
  partial becomes `unclear`.
- **Human-reviewer threads** resolve only on hard evidence (`fixed` with a
  verified push, or `addressed` with a verified pointer).
  - `oos` and `disagree` on human threads reply and stay open.
  - The key is `resolve_pr.resolve_human_threads: evidence|never|all`,
    default `evidence`.
  - A thread is human unless its opener's `author.__typename` is `Bot`.
    Unknown authors count as human.

<!-- deepen-plan: external -->
> **Research:** All of these report `author.__typename == "Bot"` in GraphQL:
> Copilot code review, CodeRabbit, Greptile, and github-actions. GraphQL logins
> have no `[bot]` suffix (`copilot-pull-request-reviewer`, `coderabbitai`,
> `greptile-apps`), while REST adds `[bot]` or uses `Copilot`. Classify by
> typename, and strip a trailing `[bot]` before comparing logins.
> - Evidence that Copilot is `Bot`: cli/cli's fixture
>   https://github.com/cli/cli/blob/trunk/api/queries_pr_test.go
> - Login variants:
>   https://github.com/github/awesome-copilot/tree/main/skills/copilot-pr-autopilot
> - Copilot can now submit approvals that count toward required reviews:
>   https://github.blog/changelog/2026-09-01-copilot-code-review-can-now-approve-pull-requests
<!-- /deepen-plan -->
- **Issue-filing gate.**
  - Interactive runs show one `AskUserQuestion` listing every proposed issue,
    each approved individually. A declined issue turns its thread into
    `unclear`.
  - Unattended runs file automatically only when the resolver gives a
    one-line reason, capped at 3 issues created per PR per run.
  - Candidates are sorted by path, line and threadId. Issues found by marker
    dedupe do not count against the cap.
  - Over-cap threads become `unclear`.
  - Issues go to GitHub by default. They go to Linear when
    `mcp__plugin_yellow-linear_linear__save_issue` is discoverable and the
    branch matches `[A-Z]{2,5}-[0-9]{1,6}`. A Linear failure falls back to
    GitHub once.
- **Non-actionable threads dropped by Step 3c** (bare LGTM, thanks, nit,
  emoji) are resolved with no reply and reported as `resolved
  (non-actionable)`.
- **`viewerCanResolve=false`** means no resolve attempt. Reply if
  `viewerCanReply` is true, then list the thread under blocking "needs
  permission".
- **`CHANGES_REQUESTED`** reviews are reported under "Blocking merge (reviewer
  action)", using `latestOpinionatedReviews`. They are never mutated.
- **Commit and push** go through one script:
  - `git add -- <files>`, then check that the staged set matches the
    expected set;
  - `gt modify -c -m` (or `git commit` for GitHub);
  - `gt submit --no-interactive --no-edit` (or the `github-stack-runtime.js`
    submit);
  - verify that the local HEAD matches `ls-remote` and `headRefOid`.

  The script never runs `git push`.
- **`verify_command`** is opt-in, from `yellow-plugins.local.md`.
  - Unattended runs execute it only when the file is not tracked by git
    (`git ls-files --error-unmatch` fails). Otherwise they print
    `verify skipped (tracked config)` and hold `fixed` threads open as
    blocking.
  - Interactive runs show the command and ask before running it.
  - On failure: save a patch, revert the resolver-touched files, assert a
    clean tree, and leave `fixed` threads open.
- **One bounded re-pass** after a successful write phase.
  - Poll every 20 s up to `resolve_pr.repass_wait_seconds` (default 120,
    range 0–600, where 0 disables it).
  - Resolve only threads not seen in round 1, sharing the issue cap.
  - There is never a round 3.
- **Idempotency markers.** Replies and issue bodies end with
  `<!-- yellow-review:resolve v1 thread=<PRRT_id> disposition=<d> -->`.
  - A marker counts only on a comment where `viewerDidAuthor` is true.
  - Issue dedupe scans `gh issue list --state all` bodies, not search.
    Search indexing lags by seconds to minutes.
- **Mutation pacing.** Mutations are serial with about 1 s between them.
  `retry-after` (or 60 s) is honoured with one retry; after that, the
  remaining threads are `not attempted (rate limit)`.

<!-- deepen-plan: external -->
> **Research:** `gh api` exits 1 for every HTTP or GraphQL error, so the exit
> code alone cannot identify a rate limit.
> - Detect it from stderr (`gh: You have exceeded a secondary rate limit ...
>   (HTTP 403|429)`). With `gh api -i`, you can also read the stdout status line
>   and headers; headers are canonicalized to `Retry-After` and
>   `X-Ratelimit-Reset`, so match case-insensitively and strip `\r`.
> - A GraphQL secondary limit can come back as HTTP 200 with an error message.
>   Match on the message substring, not on the error `type`.
> - Backoff order: `retry-after`, then `x-ratelimit-reset` when
>   `x-ratelimit-remaining` is 0, then 60 s.
> - Sources: https://github.com/cli/cli/blob/trunk/pkg/cmd/api/api.go and
>   https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api
<!-- /deepen-plan -->
- **Machine summary line.** The command prints exactly one line of the form
  `Resolve: <r> resolved, <f> fixed, <i> issues filed, <b> blocking,
  push=<ok|skipped|failed|noop>, verify=<pass|fail|skipped>,
  ratelimited=<0|1>`.
  - `ratelimited=1` means a script exited 4 and mutations stopped;
    `/review:resolve-stack` and `/review:sweep-all` stop mutating and report
    remaining PRs as `not attempted (rate limit)`.
  - `/review:sweep` and `/review:sweep-all` print it and do not change their
    exit code for blocking threads.
  - `/review:resolve-stack` exits 1 when anything blocks.
- **Mechanics live in scripts plus one reference file.**
  `resolve-pr.md` is 466 of 500 lines.

<!-- deepen-plan: codebase -->
> **Codebase:** A `references/` directory is already in use:
> `plugins/yellow-review/references/review-pr/{ledger,legacy-fallback,knowledge-compounding}.md`
> exist, and `review-pr.md:322,436,1073` reads them as
> `${CLAUDE_PLUGIN_ROOT}/references/...`. `references/resolve/dispositions.md`
> follows the same pattern. RULE 21 ceilings (500 for commands, 300 for agents)
> only warn (`scripts/validate-agent-authoring.js:261-262`).
<!-- /deepen-plan -->

### Trade-offs Considered

- **Ledger-backed dispositions (rejected).** The ledger is local to one
  clone, anchored to findings the tool itself discovers, and reconciles
  against git rather than `isResolved`. The ledger brainstorm's Key Decision
  #2 keeps resolve GitHub-only.
- **A separate `/review:merge-ready` gate:** deferred. It does not conflict
  with this plan.

## Implementation Plan

### Phase 1: Contract and scripts

- [x] 1.1: Create `plugins/yellow-review/references/resolve/dispositions.md`.
  It is the single contract that `resolve-pr.md`, the resolver agent, and the
  scripts all refer to. It covers:
  - the disposition vocabulary and the per-thread resolver line:
    `THREAD <id> | disposition=<d> | evidence=<one line> | oos_reason=<one line or empty>`;
  - downgrade rules to `unclear`: a missing or malformed line; a `fixed`
    thread whose cluster `Status` is not `complete` or names no modified
    file; a failed evidence check;
  - skipped-reason mapping:
    - context not found → `unclear`;
    - outside PR diff → `oos` candidate;
    - suspicious request → `disagree` with a fixed reply, never auto-filed;
  - evidence rules for `addressed`:
    - `path:line` must exist at HEAD, or
    - a SHA must pass `git merge-base --is-ancestor <sha> HEAD` and touch
      the anchor path;
    - a reasoning-only claim is `disagree`;
    - a deleted hunk or file counts as addressed only when the deleting
      commit is cited;
  - the lane table: bot, human (by `resolve_human_threads`),
    `viewerCanResolve=false`, dropped non-actionable, outdated,
    `CHANGES_REQUESTED`;
  - write-order phases:
    - A, local: verify, stage, commit;
    - B, remote: submit and verify head;
    - C, serial per thread: issue, then reply, then resolve.

    Each is followed by a per-stage failure record, such as
    `oos: issue #12 filed, reply failed`;
  - the recovery rule: a thread whose last comment is ours with a matching
    marker and no newer comment retries only the resolve;
  - the marker format and anti-spoofing rule (`viewerDidAuthor` only; a
    quoted marker never causes a skip);
  - reply hygiene: outcome first, never quote the reviewer, cap at 1,000
    characters;
  - issue-cap ordering and the over-cap reply wording;
  - pacing and rate-limit behaviour;
  - the `Resolve:` contract line;
  - known limit: two accounts running concurrently may post duplicate
    replies.
- [x] 1.2: Extend `skills/pr-review-workflow/scripts/get-pr-comments`.
  - Add an `--include-outdated` flag, which drops only the `isOutdated ==
    false` clause in the thread filter. The default filter is unchanged.
  - Add these fields to each thread: `isOutdated`, `viewerCanResolve`,
    `viewerCanReply`, `commentCount` and `commentsTruncated` (true when more
    than the 50 comments fetched exist; a truncated thread is never resolved).
  - Add these fields to each comment: `id`, `createdAt`, `viewerDidAuthor`,
    `authorType` (`author.__typename`).
  - Existing fields and their order stay the same.
  - Before coding, confirm the field names with a `gh api graphql`
    introspection.

<!-- deepen-plan: codebase -->
> **Codebase:** Confirmed. The filter is at `get-pr-comments:217` (line numbers
> refreshed against this PR's HEAD, after the new fields shifted them). The query
> already selects `isOutdated` (`:76`) but does not output it. The existing bats
> tests assert thread IDs and values, not exact key sets, so the new fields are
> safe.
>
> Caveat: the script fetches `comments(first: 50)`. Do not use that data to
> decide "our marker is the last comment" on threads with more than 50
> comments. The recovery rule must rely on `reply-pr-thread`'s own
> `comments(last:1)` pre-check.
<!-- /deepen-plan -->

<!-- deepen-plan: external -->
> **Research:** `viewerDidAuthor: Boolean!` is on the `Comment` interface, which
> `PullRequestReviewComment` implements (confirmed:
> https://docs.github.com/en/graphql/reference/interfaces). `viewerCanResolve` on
> `PullRequestReviewThread` was not re-verified in this pass. Confirm it in the
> introspection step.
<!-- /deepen-plan -->
- [x] 1.3: New script `skills/pr-review-workflow/scripts/get-pr-blockers
  <owner/repo> <PR#>` (POSIX sh, `set -eu`). It emits JSON with:
  - `changesRequested: [{login, reviewId}]` from `latestOpinionatedReviews`;
  - `reviewDecision`;
  - `conversationResolution: enforced|not_enforced|unknown`, which comes from:
    - classic `branches/{base}/protection` `.required_conversation_resolution.enabled`,
      where a 403 or 404 means `unknown`;
    - OR `rules/branches/{base}` `pull_request.parameters.required_review_thread_resolution`.

  It never fails the run: on error it exits 0 with `unknown` fields and
  writes a stderr note.

<!-- deepen-plan: external -->
> **Research:** The docs do not say whether `latestOpinionatedReviews` excludes
> DISMISSED reviews, and public code disagrees (ghdiff says DISMISSED can appear;
> git-spice filters by state). Filter client-side to
> `state in {APPROVED, CHANGES_REQUESTED}`. Select
> `author{__typename login} state submittedAt commit{oid}`.
> See https://docs.github.com/en/graphql/reference/pulls and
> https://github.com/abhinav/git-spice/blob/main/internal/forge/github/review.go
<!-- /deepen-plan -->
- [x] 1.4: New script `skills/pr-review-workflow/scripts/reply-pr-thread
  <PRRT_id> <disposition> <body-file>` (POSIX sh, modelled on
  `resolve-pr-thread`). It:
  - validates the `PRRT_` prefix and the disposition vocabulary;
  - reads the body from a file (no quoting of untrusted text on the command
    line), rejects bodies over 1,000 characters, and appends the marker;
  - pre-checks `comments(last:1){viewerDidAuthor body}` and skips with
    `{"replied":false,"skipped":"already-replied"}` when the matching marker
    is last;
  - posts with `addPullRequestReviewThreadReply`;
  - sleeps 1 s after the mutation;
  - retries once on 429 or a secondary limit, honouring `retry-after` or
    waiting 60 s;
  - outputs `{"replied":true,"commentId":...}`;
  - refuses a body that looks like a credential (`lib/resolve-text.sh`, see
    1.5a), never redacting and posting it;
  - exit codes: 2 usage, an over-long body, or credential-shaped or
    unscannable text; 3 not found or permission; 4 rate limited or a `gh`
    call timed out (`YELLOW_REVIEW_GH_TIMEOUT`; the reply may have posted).

<!-- deepen-plan: codebase -->
> **Codebase:** `resolve-pr-thread` exits 1 on every failure, including a 429.
> No script in the repo retries or parses `retry-after`; today retries happen in
> command prose (Step 8 waits 60 s). The pacing and retry logic is new code.
>
> Decide in Phase 1 either to give `resolve-pr-thread` the same 2/3/4 codes
> (and update `tests/resolve-pr-thread.bats`, which is not yet in the file
> list) or to have Step 7 treat any non-zero exit as a failure and match stderr.
<!-- /deepen-plan -->
- [x] 1.5: New script `skills/pr-review-workflow/scripts/file-followup-issue
  <owner/repo> <PR#> <PRRT_id> <title-file> <body-file>`. It:
  - dedupes by scanning `gh issue list --state all --limit 200 --json
    number,url,body` for `thread=<id>`, where the author is the viewer;
  - otherwise runs `gh issue create --body-file`, with the marker plus a
    link back to the PR thread;
  - outputs `{"number":N,"url":...,"created":true|false}`;
  - has a read-only `--find <owner/repo> <PRRT_id>` mode;
  - screens the title and body with `lib/resolve-text.sh`;
  - exit codes: 2 usage, credential-shaped or unscannable text, or a thread
    on a different pull request; 4 rate limited or a `gh` call timed out
    (`YELLOW_REVIEW_GH_TIMEOUT`; a create may have filed); 5 dedupe window
    full with no marker.

  GitHub only; Linear filing lives in command prose.
- [x] 1.5a: Shared credential screen. `lib/resolve-text.sh` (POSIX sh,
  sourced; awk without `{n,}` intervals for mawk) is the one credential-shape
  check behind `reply-pr-thread` and `file-followup-issue`; the new
  `skills/pr-review-workflow/scripts/check-resolve-text <file>...` exposes it
  for text posted outside those scripts (a Linear issue title and
  description). Both refuse and never redact; a refusal prints
  `resolve-text: refused rule=<rule> line=<n>` (or `scan failed`) on stderr,
  never the text. Covered by `tests/check-resolve-text.bats`.
- [x] 1.6: New script `skills/pr-review-workflow/scripts/commit-resolve-fixes
  --provider graphite|github --pr <N> --message <msg> -- <files...>`. It:
  - checks that each path is inside the repo and has a diff;
  - runs `git add --`, then checks `git diff --cached --name-only` equals the
    expected set;
  - Graphite: `gt modify -c -m`, then `gt submit --no-interactive --no-edit`;
  - GitHub: `git commit -m`, then `node .../github-stack-runtime.js submit`,
    parsing the JSON `status` (the process always exits 0);
  - verifies `git rev-parse HEAD` equals
    `git ls-remote origin refs/heads/<branch>`, and that `gh pr view
    --json headRefOid` matches, retrying 3× at 5 s;
  - asserts a clean tracked tree;
  - requires a conventional `fix` prefix in the message, and includes only
    counts and paths, never reviewer text;
  - outputs `{"status":"PUSHED|NOOP","sha":...,"branch":...}`;
  - exit codes: 2 usage, 3 staged mismatch, 4 commit failed, 5 submit
    failed, 6 verify mismatch;
  - never contains the string `git push`.

  Decide during implementation whether to pass `gt submit --update-only`.
  Add it only if a test shows it does not change which branches in the stack
  get submitted.

<!-- deepen-plan: codebase -->
> **Codebase:** `gt submit` 1.7.20 accepts `--no-interactive`, `-n/--no-edit`
> and `-u/--update-only`, and `gt modify -c` exists. Only `--no-interactive` is
> used elsewhere in the repo.
>
> `github-stack-runtime.js` `main()` always prints JSON and returns 0
> (`:623-626`), so parsing `status` is required.
>
> Model the head check on `review-ledger.sh` `cmd_remote_head` (`:2075-2104`):
> it fetches `refs/pull/<pr>/head`, compares with backoff, and exits 6 when the
> result cannot be verified.
>
> `tests/helpers/ledger-repo.bash` provides only a repo, a bare origin, a `gh`
> symlink and `commit_all`, and hardcodes `RL`/`LEDGER_DIR`. Write the `gt` and
> `node` mocks fresh.
<!-- /deepen-plan -->
- [x] 1.7: New script `skills/pr-review-workflow/scripts/run-verify-command
  --pr <N> --timeout <s> --command-file <f> -- <files...>`. It:
  - refuses unless the caller passes `--trusted`. The command sets
    `--trusted` after the tracked-file check or the interactive approval;
  - runs `bash -c "$(cat file)"` from the repo root under
    `timeout --kill-after=10`, with stdout and stderr capped into a log file;
  - on failure or timeout:
    - writes `git diff HEAD -- <files>` to
      `$(git rev-parse --git-common-dir)/yellow-review/resolve-patches/<pr>-<ts>.patch`
      (mode 0600, keeping the newest 10);
    - reverts the listed files (`git checkout --` for tracked files; deletes
      listed untracked files);
    - asserts a clean tree;
  - outputs `{"result":"pass|fail|timeout","patch":...,"log":...,"treeClean":true|false}`.

<!-- deepen-plan: codebase -->
> **Codebase:** `timeout --kill-after` is not portable. The repo guards it with
> `command -v timeout || command -v gtimeout` (`handoff.bats:227`,
> `context-observer.bats:252`, `yellow-review/hooks/scripts/session-start.sh:99`),
> and tests skip when `--kill-after` is unsupported
> (`setup-all-ruvector-probe.bats:80`).
>
> Storage precedent for the patch directory: `review-ledger.sh:105-123` uses
> `--git-common-dir`, `umask 077` and `chmod 700`. `git ls-files --error-unmatch`
> is already used for tracked-file checks (`debt-fixer.md:111`,
> `claude-web.md:141`).
<!-- /deepen-plan -->

<!-- deepen-plan: external -->
> **Research:** When neither `timeout` nor `gtimeout` exists, fall back to a
> watchdog:
> 1. Run `set -m` so the command gets its own process group, then start it in
>    the background.
> 2. Start a background watchdog with its stdio closed. It sleeps N seconds,
>    touches a marker file, then sends `kill -s TERM -- -$pid`, waits, and sends
>    `KILL`.
> 3. `wait` on the command, then kill the watchdog's own group.
> 4. If the marker file exists, return 124; otherwise return the command's exit
>    status.
>
> The marker file separates a real timeout from a command that happens to exit
> 124. Also add an INT trap that forwards to `-$pid`, because `set -m` removes
> the job from the foreground group. Test `kill -- -PGID` under bash and zsh in
> `tests/shell-compat`.
>
> See https://stackoverflow.com/questions/687948 and
> https://unix.stackexchange.com/questions/43340
<!-- /deepen-plan -->
- [x] 1.8: Bats tests in `plugins/yellow-review/tests/`, covering:
  - `get-pr-comments.bats`: the default output is unchanged; `--include-outdated`
    includes thread3; the new fields are present;
  - `get-pr-blockers.bats`: enforced, not enforced, and 403 → unknown;
  - `reply-pr-thread.bats`: the marker is appended; already-replied skip;
    a spoofed marker in a reviewer comment is not skipped; the size cap;
    the 429 retry;
  - `file-followup-issue.bats`: dedupe hit, create, and a marker authored by
    someone else is ignored;
  - `commit-resolve-fixes.bats`: a real temp repo via
    `tests/helpers/ledger-repo.bash` with mocked `gt`/`node`; covers
    unstaged-file staging, staged mismatch, NOOP, the head-mismatch exit 6,
    and a grep asserting no `git push`;
  - `run-verify-command.bats`: pass; fail → patch, revert and a clean tree;
    timeout; refusal without `--trusted`.

  Extend `tests/mocks/gh` with new `case` arms placed **before** the
  `*"number=..."*` arms. Add fixtures under `tests/fixtures/`.

<!-- deepen-plan: codebase -->
> **Codebase:** Place the new arms before the `*"PRRT_valid"*`,
> `*"PRRT_notfound"*` and `*"PRRT_resolved"*` arms too; otherwise a reply call
> for `PRRT_valid` returns `resolve-success-response.json`. Key the new arms on
> `addPullRequestReviewThreadReply`, `issue list` and `issue create`.
>
> The existing `*"pr view "*` arm (`MOCK_GH_HEAD_OID` and related variables) can
> be reused for `commit-resolve-fixes`. Add the new patterns to the mock's
> fallback usage text.
<!-- /deepen-plan -->

### Phase 2: Resolver agent and `/review:resolve`

- [x] 2.1: Update `agents/workflow/pr-comment-resolver.md`.
  - Add the per-thread `THREAD` lines after the existing output block. Keep
    `Status`, `CONFLICT:` and `Files modified` unchanged.
  - Add these rules:
    - `oos` only for work outside the lines this PR changes;
    - `addressed` needs a pointer;
    - suspicious requests are `disagree`;
    - for outdated threads, look for the concern in the file at HEAD;
    - never reply, resolve or file.
  - Point to `references/resolve/dispositions.md` rather than restating it.
    Stay under 300 lines.
- [x] 2.2: Update `commands/review/resolve-pr.md` Steps 1–4.
  - Step 1: add the issue-filing prompt to the gates that `--non-interactive`
    suppresses.
  - Step 3: call `get-pr-comments --include-outdated`. Run `get-pr-blockers`
    once.
  - Step 3c: keep dropped threads for the write phase (resolve, no reply).
  - Step 3d: cluster outdated threads by path only.
  - Add `mcp__plugin_yellow-linear_linear__save_issue` and
    `mcp__plugin_yellow-linear_linear__list_teams` to `allowed-tools`.

<!-- deepen-plan: codebase -->
> **Codebase:** Rewrite the Step 3c early exit (`resolve-pr.md:~235`: "If all
> threads are dropped, exit successfully ... do NOT proceed to Steps
> 3d/4/5/6/7/8"). A PR with only LGTM threads must still reach the write phase,
> resolve them, and print the `Resolve:` line.
<!-- /deepen-plan -->
- [x] 2.3: Replace Steps 5–9 of `resolve-pr.md` with:
  - **Step 5, Dispositions:**
    - parse `THREAD` lines and apply the downgrade and evidence rules;
    - apply the human-thread and `viewerCanResolve` lanes;
    - interactive `CONFLICT:` gate as today;
    - build the issue candidate list, run the gate (interactive) or apply
      the cap (unattended).
  - **Step 6, Verify, commit, push:**
    - resolve the provider with `stack-provider-router`;
    - run `verify_command` when set:
      - check whether the file is tracked;
      - interactive: show the command via `AskUserQuestion`;
      - unattended: run it only when the file is untracked;
    - keep the interactive push confirmation;
    - run `commit-resolve-fixes --provider <p>` with the union of resolvers'
      `Files modified`.
  - **Step 7, Write phase:**
    - serial per thread: issue (the GitHub script, or Linear `save_issue`
      with the marker in the description, falling back to GitHub), then
      `reply-pr-thread`, then `resolve-pr-thread`;
    - `fixed` threads only when Step 6 returned `PUSHED` with a verified SHA,
      whose short form goes in the reply;
    - non-`fixed` lanes run even when Step 6 was `NOOP` or failed;
    - dropped non-actionable threads resolve with no reply.
  - **Step 8, Bounded re-pass:**
    - skip when the tree is dirty, the push failed, or
      `repass_wait_seconds` is 0;
    - otherwise poll, then run Steps 3c–7 once for new threads only;
    - keep today's resolve-retry (up to 3 times) only for threads we
      attempted to resolve;
    - do not report open-by-design threads as errors.
  - **Step 9, Report:** sections for Resolved (by disposition), Blocking merge
    (disagree/unclear, human-held, needs permission, verify failed with the
    patch path, rate-limited, `CHANGES_REQUESTED`), Follow-up issues filed,
    and Conversation resolution (`enforced`/`not enforced`/`unknown`). Then
    the single `Resolve:` line.

  Move the procedural detail into the reference file so the command ends
  under 500 lines. Delete prose that restates the reference.

<!-- deepen-plan: codebase -->
> **Codebase:** `resolve-pr.md` has no handling for a PR that closes mid-run
> (`rg closed|merged` finds nothing); only `review-ledger.sh` has a closed-PR
> exit (5). Add a `gh pr view --json state` check before the write phase and
> again before the re-pass.
<!-- /deepen-plan -->
- [x] 2.4: Update `plugins/yellow-core/skills/local-config/SKILL.md`. Document
  these keys, each with a default, validation rule and warning fallback:
  - `resolve_pr.cluster_cap` (currently undocumented);
  - `resolve_pr.verify_command` (string);
  - `resolve_pr.verify_unattended` (default `false`, boolean; any value other
    than `true` warns and is treated as `false`, so unattended runs skip
    verify);
  - `resolve_pr.verify_timeout_seconds` (default 540, range 1–540);
  - `resolve_pr.repass_wait_seconds` (default 120, range 0–480);
  - `resolve_pr.resolve_human_threads` (`evidence|never|all`).

  Note that unattended runs skip `verify_command` when the file is tracked.

### Phase 3: Callers and shared docs

- [x] 3.1: `commands/review/resolve-stack.md`:
  - Self-verify uses `get-pr-comments --include-outdated` and parses the
    `Resolve:` line. `jq length` stays only as a cross-check and flags
    disagreement.
  - After each PR, run `git status --porcelain`. A dirty tree after resolve
    stops the walk with the file list, since continuing would carry edits
    onto the next branch.
  - Print each PR's row as it completes; a hard abort prints
    `aborted at PR #N`.
  - Add `blocking` and `issues` columns.
  - Exit 1 when anything blocks.

<!-- deepen-plan: codebase -->
> **Codebase:** `resolve-stack.md` already exits 1 when "Needs manual attention"
> is non-empty (`:276-280`), and it has a clean-tree check only at pre-flight
> (`:68`), so the per-PR check is additive.
>
> Its gate-list prose ("suppresses that command's spawn-cap, CONFLICT, and
> push-confirmation gates", around `:195`) will go stale; add it to the files
> to modify.
>
> The Skill tool returns no machine status (`:198`), so keep the `jq length`
> cross-check mandatory, not optional.
<!-- /deepen-plan -->
- [x] 3.2: `commands/review/sweep.md`:
  - Update the gate list at lines 131–135.
  - Replace the stale "posts a false-positive response" prose around lines
    143–145.
  - Step 4 prints the `Resolve:` line verbatim, with the existing fallback.
  - Blocking threads do not change the exit code.
- [x] 3.3: `commands/review/sweep-all.md`:
  - Add a `Blocking` column.
  - The confirmation shows the worst-case added wait: PR count × the
    `repass_wait_seconds` value.
  - Keep the clean-tree-between-PRs assumption at lines 319–325 true.
- [x] 3.4: `skills/pr-review-workflow/SKILL.md`:
  - Update the commit convention (lines 308–339): resolve uses
    `commit-resolve-fixes` (explicit `git add`, then a new commit through
    the provider); `/review:pr` and `/review:all` still amend,
    and a follow-up issue tracks that.
  - Update the GraphQL Scripts section (lines 403–412) for the new scripts
    and flag.
  - Replace the duplicated Verification Loop with a pointer to the reference.
- [x] 3.5: `docs/plugin-scope-mode-protocol.md` Interface 1:
  - Update line 34's gate list.
  - Note that unattended issue creation is deliberate and capped. It is the
    first non-interactive `gh issue create` in the repo; `test-reporter`
    stays gated.

<!-- deepen-plan: codebase -->
> **Codebase:** Confirmed. Every other `gh issue create` in the repo is gated
> (`test-reporter.md:122`, "NEVER create GitHub issues without user
> confirmation") or appears only in prose (`flow/plan.md:575-594`).
<!-- /deepen-plan -->

### Phase 4: Docs, release, follow-ups

- [x] 4.1: `plugins/yellow-review/CLAUDE.md`:
  - Scripts heading: 3 → 9, with one line per script (see the note below).
  - `get-pr-comments` wording.
  - The Testing section lists the new bats files.
  - The `/review:resolve` and "Exceptions" gate lists.
  - The "When to Use What" line naming `/review:sweep-all` as the sweeper
    for late comments.

<!-- deepen-plan: codebase -->
> **Codebase:** Correction: the scripts count goes from 3 to **9**, not 7 or 8
> (3 existing: `get-pr-comments`, `resolve-pr-thread`, `file-line-counts`; plus
> `get-pr-blockers`, `reply-pr-thread`, `file-followup-issue`,
> `check-resolve-text`, `commit-resolve-fixes`, `run-verify-command`).
> `check-resolve-text` already ships, so `plugins/yellow-review/CLAUDE.md:167`
> reads `### Scripts (7)` today; the heading reaches 9 only once
> `commit-resolve-fixes` and `run-verify-command` land. `validate-doc-counts.js` checks only root docs, so no
> validator will catch this.
<!-- /deepen-plan -->
- [x] 4.2: `plugins/yellow-review/README.md`: the command table and the
  scripts table, plus a short "Dispositions" section for users.
- [x] 4.3: Changesets:
  - `.changeset/review-resolve-hardening.md`, `'yellow-review': minor`;
  - `.changeset/local-config-resolve-keys.md`, `'yellow-core': patch`.
- [x] 4.4: Validate:
  - `pnpm validate:agents`
  - `pnpm lint:plugins`
  - `pnpm validate:shell-compat`
  - `pnpm check:shell-parse`
  - `pnpm validate:schemas`
  - `cd plugins/yellow-review && bats tests/`
  - `pnpm test:integration`, since the push-detector parity test must be
    untouched.
- [x] 4.5: Manual end-to-end on a scratch PR in a test repo with both a bot
  thread and a human thread. Cover:
  - `fixed`, `addressed`, `oos` and `disagree`;
  - an outdated thread;
  - one LGTM;
  - a re-run (no duplicate replies or issues);
  - `--non-interactive` with 4 `oos` candidates (3 filed, 1 blocking);
  - a failing `verify_command`, where a patch is saved and the tree is clean.
  - **2026-09-30 run on this stack's own PRs #950 and #952** (Codex bot
    threads; worktree scripts and resolver body, Graphite provider):
    covered `fixed`, `addressed`, `disagree`, `unclear` (malformed THREAD
    line and failed evidence), the outdated lane (4 outdated threads,
    resolved via GraphQL), a re-run posting no duplicates, a runner-rule
    refusal followed by `--revert-dirty` and patch restore, and new-commit
    semantics. Not covered (no such threads): `oos` and issue filing, the
    3-issue unattended cap, LGTM, human threads, a failing
    `verify_command`. Found and fixed: the unattended `*/scripts/*` runner
    rule was too broad (now root `scripts/` only), and a post-hook commit
    mismatch now undoes the local commit.
  - **2026-10-01 run on scratch PR KingInYellows/yellow-review-e2e#1**
    (worktree scripts and resolver body, Graphite provider, two
    `--non-interactive` runs, `verify_unattended: true` with an untracked
    config). Run 1 (`verify_command: exit 1`): LGTM dropped and resolved
    with no reply; 3 `oos` threads filed issues #2–#4 with the thread link
    and marker, replied and resolved; a suspicious `.github/` request got
    the fixed `disagree` reply and stayed open; verify failed, saved a 0600
    patch, left the tree clean and held the `fixed` thread open. Run 2
    (`verify_command: true`, 4 new `oos` asks): verify passed, the fix
    landed as a new commit (`PUSHED`), the `fixed` reply cited its SHA and
    resolved; 3 issues (#5–#7) filed and the 4th got the over-cap reply
    and stayed blocking; the repeated `disagree` reply was skipped as
    `already-replied`; the 20 s re-pass found no new threads. Not covered:
    human-reviewer threads — every seeded comment came from the resolving
    account, which the lane rule treats as bot, and a second account is
    out of scope by decision; the human lane relies on review of the lane
    table. Scratch PR and issues closed afterwards.
- [x] 4.6: File the follow-up issues (#957–#966):
  - `review-pr.md:1047` and `review-all.md:376` `gt modify -m` → stage + `-c`;
  - a sticky blocking-threads PR comment for repos without enforcement;
  - the CodeRabbit `@coderabbitai resolve` handoff;
  - the `/review:merge-ready` gate.

## Technical Specifications

### Files to Modify

- `plugins/yellow-review/commands/review/resolve-pr.md` — Steps 1–9 as above
- `plugins/yellow-review/commands/review/resolve-stack.md` — clean-tree stop,
  streaming rows, contract-line self-verify
- `plugins/yellow-review/commands/review/sweep.md`, `sweep-all.md` — contract
  line and Blocking column
- `plugins/yellow-review/agents/workflow/pr-comment-resolver.md` — `THREAD` lines
- `plugins/yellow-review/skills/pr-review-workflow/SKILL.md` — commit
  convention and script list
- `plugins/yellow-review/skills/pr-review-workflow/scripts/get-pr-comments` —
  flag and additive fields
- `plugins/yellow-review/tests/mocks/gh`, `tests/get-pr-comments.bats`
- `plugins/yellow-core/skills/local-config/SKILL.md` — new keys
- `docs/plugin-scope-mode-protocol.md` — Interface 1 gate list
- `plugins/yellow-review/CLAUDE.md`, `README.md`

### Files to Create

- `plugins/yellow-review/references/resolve/dispositions.md`
- `plugins/yellow-review/skills/pr-review-workflow/scripts/{get-pr-blockers,reply-pr-thread,file-followup-issue,commit-resolve-fixes,run-verify-command}`
- `plugins/yellow-review/tests/{get-pr-blockers,reply-pr-thread,file-followup-issue,commit-resolve-fixes,run-verify-command}.bats` plus fixtures
- Two changesets

### API Changes

- `get-pr-comments`: a new opt-in flag and additive fields. The default
  output fields and filter are unchanged.
- The `/review:resolve` output gains the `Resolve:` line.
- `--non-interactive` gains one more suppressed prompt (issue filing).

## Testing Strategy

- Bats covers every script: the mocked `gh`, plus a real temp git repo for
  `commit-resolve-fixes` and `run-verify-command`.
- Shell-compat validators cover every fenced block added to command prose.
  Use `>|` for redirects, and pass untrusted text through files, not
  arguments.

<!-- deepen-plan: codebase -->
> **Codebase:** `validate-shell-compat.js` scans fenced blocks in every
> `plugins/**/*.md` (`:152,159`), which includes the new
> `references/resolve/dispositions.md`. It does not lint extensionless scripts;
> `get-pr-comments` is `#!/bin/bash` and `resolve-pr-thread` is `#!/bin/sh`.
> In fenced blocks, avoid variables named `status` and `path` (reserved in zsh)
> and avoid `mapfile`.
<!-- /deepen-plan -->
- The manual end-to-end matrix in 4.5 covers GraphQL behaviour that mocks
  cannot prove: `viewerDidAuthor`, resolving outdated threads, and
  `latestOpinionatedReviews`.

## Acceptance Criteria

1. No thread is resolved unless its reply posted, except dropped
   non-actionable threads (held open under `resolve_human_threads: never`).
   A `fixed` thread also needs a push verified by `ls-remote` and
   `headRefOid`. Verify with bats (script exits) and the 4.5 run.
2. Resolver edits are always staged before the commit, and a staged-set
   mismatch aborts before the push (`commit-resolve-fixes` exit 3).
3. Each resolve pass adds a new commit. The previous commit's message and
   SHA are unchanged: `git log` in the 4.5 run.
4. Re-running `/review:resolve` on the same PR posts no duplicate replies or
   issues (4.5 run and bats).
5. Unattended runs file at most 3 issues per PR; the rest are listed as
   blocking.
6. Human threads with `oos` or `disagree` are never resolved by the agent
   under the default config.
7. Outdated unresolved threads and bare LGTM threads end up resolved or
   listed as blocking. Neither is silently ignored.
8. A failed `verify_command` leaves a clean tree and a saved patch, and pushes
   nothing. A tracked config file is never executed unattended.
9. `/review:resolve-stack` stops on a dirty tree after any PR, prints each row
   as it goes, and exits 1 when anything blocks.
10. `resolve-pr.md` ≤ 500 lines, `pr-comment-resolver.md` ≤ 300. All
    validators and bats suites pass.

## Edge Cases & Error Handling

- **PR closed or merged mid-run:** stop the write phase with a distinct line.
  Do not report per-thread errors.
- **`viewerCanReply=false` and `viewerCanResolve=false`:** list the thread as
  blocking "needs permission" and make no mutation.
- **Reviewer replies after our reply:** the marker is no longer last, so the
  thread is processed again.
- **Linear team not resolvable from the branch ID prefix:** fall back to
  GitHub and record `tracker=github (linear unavailable)`.
- **Resolver returns nothing:** every thread in the cluster becomes `unclear`.
- **Empty diff with `addressed` or `oos` threads:** Step 6 reports `NOOP`, and
  the write phase still runs for the non-`fixed` lanes.
- **Revert after verify failure leaves the tree dirty:** stop. In a stack
  walk, stop the whole walk.
- **CodeRabbit reopens a resolved thread during the re-pass:** report
  `reopened by bot` and do not loop.

<!-- deepen-plan: external -->
> **Research:** `resolveReviewThread` takes only `threadId` and places no limit
> on `isOutdated`. Several users report it resolving threads orphaned by a
> force-push, which the UI cannot resolve, so the outdated lane is workable via
> GraphQL. Outdated unresolved threads still block merge under conversation
> resolution.
> See https://docs.github.com/en/graphql/reference/mutations#resolvereviewthread
> and https://github.com/orgs/community/discussions/19206
<!-- /deepen-plan -->

## Security Considerations

- PR titles, bodies and comments stay fenced in resolver prompts, as today.
  Reply bodies never quote reviewer text.
- The marker carries only a validated `PRRT_` ID and a closed-vocabulary
  disposition. Markers count only when authored by the viewer.
- `verify_command` is untrusted when tracked. Unattended runs never execute
  a tracked value, and it runs in a `bash -c` child with a timeout.
- Commit messages carry counts and paths only.
- Scripts are invoked as plain commands, so the push guard stays in force.
  No script runs `git push`.

## Migration & Rollback

- The change is backwards compatible for callers. `get-pr-comments` defaults
  are unchanged, and `--non-interactive` still suppresses every prompt.
- Rollback is a revert of the PR. The new scripts are additive, and the
  patches directory is under the git common dir and safe to delete.

## References

- `docs/brainstorms/2026-09-30-review-resolve-hardening-brainstorm.md`
- `docs/solutions/workflow/gt-modify-no-c-flag-silent-unstaged-miss.md`
- `docs/solutions/code-quality/session-level-review-command-patterns.md`
  (Pattern 8, reply-and-defer)
- `docs/solutions/code-quality/graphite-merge-queue-agent-anti-patterns.md`
  (idempotency)
- `plugins/yellow-review/lib/review-ledger.sh` `cmd_remote_head` (lines
  2075–2104): the remote-head verification precedent
- `plugins/yellow-browser-test/agents/testing/test-reporter.md`: the gated
  `gh issue create` precedent
- `plugins/gt-workflow/hooks/scripts/lib/git-push-detector.js`: the push-guard
  scope (command text only)
- GitHub REST rate limits:
  https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
- GitHub rules API: https://docs.github.com/en/rest/repos/rules
- Graphite command reference: https://graphite.com/docs/command-reference


<!-- deepen-plan: external -->
> **Research:** Additional sources:
> - https://docs.github.com/en/graphql/reference/interfaces (`Comment.viewerDidAuthor`)
> - https://docs.github.com/en/graphql/reference/pulls (`latestOpinionatedReviews`, `isOutdated`)
> - https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api
> - https://github.com/cli/cli/blob/trunk/pkg/cmd/api/api.go (gh error format and `--include`)
> - https://github.com/github/awesome-copilot/tree/main/skills/copilot-pr-autopilot (Copilot bot logins)
> - https://github.com/orgs/community/discussions/19206 (resolving orphaned outdated threads)
<!-- /deepen-plan -->

## Stack Decomposition

<!-- stack-topology: linear -->
<!-- stack-trunk: main -->

### 1. agent/feat/resolve-thread-scripts
- **Type:** feat
- **Description:** Add the resolve dispositions contract and GitHub thread and issue scripts
- **Scope:** plugins/yellow-review/references/resolve/dispositions.md, plugins/yellow-review/skills/pr-review-workflow/scripts/get-pr-comments, plugins/yellow-review/skills/pr-review-workflow/scripts/get-pr-blockers, plugins/yellow-review/skills/pr-review-workflow/scripts/reply-pr-thread, plugins/yellow-review/skills/pr-review-workflow/scripts/file-followup-issue, plugins/yellow-review/tests/, docs/brainstorms/2026-09-30-review-resolve-hardening-brainstorm.md, plans/review-resolve-hardening.md, .changeset/
- **Tasks:** 1.1, 1.2, 1.3, 1.4, 1.5, 1.5a, 1.8, 4.3, 4.4
- **Depends on:** (none)

### 2. agent/feat/resolve-commit-verify-scripts
- **Type:** feat
- **Description:** Add commit-resolve-fixes and run-verify-command scripts
- **Scope:** plugins/yellow-review/skills/pr-review-workflow/scripts/commit-resolve-fixes, plugins/yellow-review/skills/pr-review-workflow/scripts/run-verify-command, plugins/yellow-review/tests/, .changeset/
- **Tasks:** 1.6, 1.7, 1.8, 4.3, 4.4
- **Depends on:** #1

### 3. agent/fix/resolve-dispositions
- **Type:** fix
- **Description:** Route /review:resolve through per-thread dispositions with staged new-commit fixes
- **Scope:** plugins/yellow-review/agents/workflow/pr-comment-resolver.md, plugins/yellow-review/commands/review/resolve-pr.md, plugins/yellow-review/skills/pr-review-workflow/scripts/resolve-pr-thread, plugins/yellow-review/tests/resolve-pr-thread.bats, plugins/yellow-core/skills/local-config/SKILL.md, .changeset/
- **Tasks:** 2.1, 2.2, 2.3, 2.4, 4.3, 4.4
- **Depends on:** #2

### 4. agent/feat/resolve-stack-callers
- **Type:** feat
- **Description:** Adopt the dispositions contract in resolve-stack, sweep, sweep-all and docs
- **Scope:** plugins/yellow-review/commands/review/resolve-stack.md, plugins/yellow-review/commands/review/sweep.md, plugins/yellow-review/commands/review/sweep-all.md, plugins/yellow-review/skills/pr-review-workflow/SKILL.md, docs/plugin-scope-mode-protocol.md, plugins/yellow-review/CLAUDE.md, plugins/yellow-review/README.md, .changeset/
- **Tasks:** 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6
- **Depends on:** #3

## Stack Progress
<!-- Updated by flow:work. Do not edit manually. -->
- [x] 1. agent/feat/resolve-thread-scripts (completed 2026-09-30)
- [x] 2. agent/feat/resolve-commit-verify-scripts (completed 2026-09-30)
- [x] 3. agent/fix/resolve-dispositions (completed 2026-09-30)
- [x] 4. agent/feat/resolve-stack-callers (completed 2026-10-01)
