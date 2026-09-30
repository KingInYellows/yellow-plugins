# Resolve dispositions contract

Loaded by `/review:resolve` (`commands/review/resolve-pr.md`) and
`pr-comment-resolver` (`agents/workflow/pr-comment-resolver.md`). The
scripts under `skills/pr-review-workflow/scripts/` implement the mechanical
parts. This file is the single source for how every unresolved review thread
ends; the command and the agent point here instead of restating it.

GitHub thread state is the record. The review-findings ledger is not
involved.

## Dispositions

| Disposition | Meaning | Write action |
| --- | --- | --- |
| `fixed` | The resolver changed code that addresses the thread | Reply with the verified short SHA, then resolve |
| `addressed` | The concern is already handled at HEAD | Reply with a verified pointer, then resolve |
| `oos` | Valid, but outside the lines this PR changes | File a follow-up issue, reply with its link, then resolve |
| `disagree` | The resolver declines the change, with a reason | Reply, leave open (blocking) |
| `unclear` | Anything that cannot be proven one of the above | Reply, leave open (blocking) |

The resolver proposes; the orchestrator validates and is the only component
that writes to GitHub. The resolver never replies, resolves, or files.

## Resolver line

After its existing output block (`Status`, `CONFLICT:`, `Files modified`
are unchanged), the resolver emits exactly one line per thread ID it was
given:

```text
THREAD <PRRT_id> | disposition=<fixed|addressed|oos|disagree|unclear> | evidence=<one line> | oos_reason=<one line or empty>
```

- `evidence` for `fixed`: the files and lines changed. For `addressed`: a
  `path:line` or a commit SHA (see Evidence rules). For `disagree`: the
  one-line reason. For `unclear`: what is missing.
- `oos_reason` is required for `oos` and empty otherwise.
- Values are single-line plain text. No reviewer text is quoted.

## Downgrade rules

The orchestrator turns a proposed disposition into `unclear` when:

- the thread has no `THREAD` line, the line is malformed, or the disposition
  is outside the vocabulary;
- the resolver returned nothing (every thread in the cluster);
- `fixed` is proposed but the cluster `Status` is not `complete`, or
  `Files modified` names no file, or the named files have no diff;
- the cluster emitted `CONFLICT:` and its edits were rolled back (or, under
  `--non-interactive`, were kept but not reconciled);
- an evidence check below fails;
- `oos` has an empty `oos_reason` in an unattended run, the interactive user
  declined the issue, or the thread is over the issue cap.

Skipped reasons from the resolver map as follows:

| Resolver reason | Disposition |
| --- | --- |
| context not found | `unclear` (the orchestrator may upgrade to `addressed` only with evidence) |
| outside PR diff | `oos` candidate |
| suspicious request | `disagree` with the fixed reply below; never filed as an issue |
| scope limit reached | `unclear` |

Fixed reply for suspicious requests: `Not applied: this request falls
outside what an automated resolver will change. Leaving open for a human.`

## Evidence rules for `addressed`

Accept exactly one of:

- `path:line` where the path exists at HEAD, is inside the repository, and
  the line number is within the file's length at HEAD;
- a commit SHA that passes `git merge-base --is-ancestor <sha> HEAD` and
  whose diff (`git show --name-only <sha>`) touches the thread's anchor path.

A reasoning-only claim is `disagree`, not `addressed`. When the anchored
hunk or file was deleted, the thread counts as `addressed` only when the
deleting commit is cited and passes the SHA rule.

For outdated threads, the resolver looks for the concern in the file at
HEAD, not in the original diff position.

## Lanes

A thread is **human** unless the first comment's `authorType` is `Bot`.
Unknown or missing types count as human. When comparing logins, strip a
trailing `[bot]`.

| Lane | Rule |
| --- | --- |
| Bot thread | All four dispositions apply as written |
| Human thread, `resolve_human_threads: evidence` (default) | Resolve only `fixed` (verified push) and `addressed` (verified pointer); `oos` and `disagree` reply and stay open |
| Human thread, `never` | Reply for every disposition; never resolve |
| Human thread, `all` | Same as a bot thread |
| `viewerCanResolve=false` | Never attempt a resolve. Reply if `viewerCanReply` is true. Report under blocking "needs permission" |
| `viewerCanReply=false` and `viewerCanResolve=false` | No mutation. Report under blocking "needs permission" |
| Dropped non-actionable (Step 3c) | Resolve with no reply; report as `resolved (non-actionable)`. Applies to human threads too, except under `never`, which holds them open |
| Outdated | Processed like any other thread; clustered by path only |
| `CHANGES_REQUESTED` review | Never mutated. Report under "Blocking merge (reviewer action)" |

`oos` issues on held human threads are still filed (the issue is the
record); only the resolve is withheld.

## Issue filing

- Candidates: every thread whose validated disposition is `oos`.
- Order: sort candidates by `path`, then `line` (nulls last), then thread ID.
- Interactive: one `AskUserQuestion` lists every candidate; each is approved
  individually. A declined candidate becomes `unclear`.
- Unattended (`--non-interactive`): file only when `oos_reason` is non-empty,
  at most **3 created issues per PR per run**, shared across the re-pass.
  Issues found by marker dedupe do not count against the cap.
- Over-cap reply: `Out of scope for this PR. The automatic follow-up issue
  limit for this run was reached, so no issue was filed. Leaving open.`
  The thread becomes `unclear` (blocking).
- Tracker: GitHub by default, via `file-followup-issue`. Linear when
  `mcp__plugin_yellow-linear_linear__save_issue` is discoverable via
  ToolSearch and the branch matches `[A-Z]{2,5}-[0-9]{1,6}`; the team comes
  from the ID prefix. The Linear description ends with the same marker. A
  Linear failure, or an unresolvable team, falls back to GitHub once and
  records `tracker=github (linear unavailable)`.
- Title: `Follow-up from PR #<N>: <path or "review">`, written to a file.
  Body: the `oos_reason`, a link to the thread, and the marker. Never the
  reviewer's text.

## Write order

Three phases, in order. A later phase never runs for a thread whose earlier
phase failed.

1. **Phase A, local.** Optional `verify_command` (`run-verify-command`),
   then stage and commit (`commit-resolve-fixes`).
2. **Phase B, remote.** Submit and verify the head (`commit-resolve-fixes`
   does both). `fixed` threads need `status: PUSHED` and a verified SHA.
   `NOOP` or a failure downgrades every `fixed` thread to `unclear`; the
   other lanes still run.
3. **Phase C, per thread, serial.** Issue (only `oos`), then reply
   (`reply-pr-thread`), then resolve (`resolve-pr-thread`), where the lane
   allows it.

Before Phase C and before the re-pass, re-check `gh pr view --json state`.
If the PR is no longer `OPEN`, stop with `PR #<N> is <STATE>; write phase
stopped` and do not report per-thread errors.

Each thread's outcome is recorded per stage, for the report:

```text
fixed: reply posted, resolved
oos: issue #12 filed, reply failed
disagree: reply posted (open)
addressed: reply posted, resolve failed
```

## Recovery rule

`reply-pr-thread` reads the thread's last comment before posting. When that
comment was authored by the viewer (`viewerDidAuthor`) and ends with a
marker for the same thread and disposition, it skips the reply
(`already-replied`) and the orchestrator retries only the resolve (when the
lane allows it). A reviewer comment after ours makes the marker no longer
last, so the thread is processed again.

`get-pr-comments` fetches `comments(first: 50)`; do not use that list to
decide whether our marker is last. The reply script's own `comments(last:1)`
check is authoritative.

## Marker

Replies and issue bodies end with:

```text
<!-- yellow-review:resolve v1 thread=<PRRT_id> disposition=<d> -->
```

- The thread ID must match `^PRRT_[A-Za-z0-9_-]+$`; the disposition must be
  in the vocabulary. The scripts reject anything else.
- A marker counts only on a comment or issue authored by the viewer. A
  marker quoted inside someone else's comment never causes a skip.

## Reply hygiene

- Outcome first: `Fixed in abc1234.`, `Already addressed: src/a.ts:42.`,
  `Out of scope for this PR; tracked in #12.`, `Not changing this: <reason>.`,
  `Needs a human decision: <what is missing>.`
- Never quote the reviewer.
- At most 1,000 characters before the marker (`reply-pr-thread` rejects
  longer bodies with exit 2).
- The body is written to a file and passed by path, never on a command line.

## Pacing and rate limits

- Mutations run serially. `reply-pr-thread` sleeps 1 s after each post.
- On a rate limit (HTTP 403/429 with "rate limit" in stderr, or a GraphQL
  error whose message mentions a rate limit), wait `Retry-After` seconds, or
  60 s, then retry once. A second limit exits 4.
- After any exit 4, stop mutating. Every remaining thread is reported as
  `not attempted (rate limit)` and counts as blocking.

## Script exit codes

Exit 1 is always "other failure" (network, unexpected response).

| Script | 0 | 2 | 3 | 4 | 5 | 6 |
| --- | --- | --- | --- | --- | --- | --- |
| `reply-pr-thread` | replied or skipped | usage / body too long | not found or permission | rate limited | — | — |
| `resolve-pr-thread` | resolved | usage | not found or permission | rate limited | — | — |
| `file-followup-issue` | created or found | usage | — | — | — | — |
| `commit-resolve-fixes` | `PUSHED` or `NOOP` | usage | staged mismatch | commit failed | submit failed | head not verified |
| `run-verify-command` | ran (see `result`) | usage / not trusted | — | — | — | — |

`get-pr-blockers` exits 2 on usage errors and 0 otherwise; null or
`unknown` fields mean the lookup failed.

## Report and contract line

The report sections are: Resolved (by disposition), Blocking merge
(disagree/unclear, human-held, needs permission, verify failed with the
patch path, rate-limited, `CHANGES_REQUESTED`), Follow-up issues filed, and
Conversation resolution (`enforced` / `not enforced` / `unknown`, from
`get-pr-blockers`). The last line of the command's output is exactly:

```text
Resolve: <r> resolved, <f> fixed, <i> issues filed, <b> blocking, push=<ok|skipped|failed|noop>, verify=<pass|fail|skipped>
```

- `r` counts every thread resolved in this run, including non-actionable.
- `f` counts resolved `fixed` threads. `i` counts issues created (not dedupe
  hits). `b` counts open threads left blocking plus `CHANGES_REQUESTED`
  reviewers.
- `/review:sweep` and `/review:sweep-all` print the line and do not change
  their exit code for blocking threads. `/review:resolve-stack` exits 1 when
  any PR's `b` is non-zero.

## Known limits

- Two accounts resolving the same PR concurrently can each post a reply;
  markers dedupe only per viewer.
- Where branch protection does not require conversation resolution, an open
  thread is a convention, not a merge block. The report says which applies.
