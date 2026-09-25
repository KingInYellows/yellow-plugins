# Review-findings ledger — write points for `/review:pr` and `/review:all`

Loaded by `/review:pr` (commands/review/review-pr.md) and by `/review:all`
(commands/review/review-all.md Step 4), which run the same sequence. Each
section below names the step it belongs to. The ledger is an append-only JSONL
file per PR inside the clone's git dir, managed by `lib/review-ledger.sh`;
`/review:triage` owns its other transitions.

## Conventions

- Library: `RL="${CLAUDE_PLUGIN_ROOT}/lib/review-ledger.sh"`. Shell variables do
  not survive between Bash calls: re-declare `RL` in every call and write the
  literal values recorded below (PR number, SHAs, run id, finding ids) into each
  command. Never interpolate model-authored text into a command line; pass
  findings on stdin from a file.
- Values recorded once per PR, at Step 3e:
  - `PR` — the PR number.
  - `REVIEWED_HEAD` — set only after Step 3e's head-verification succeeds
    (never the raw `git rev-parse HEAD` from Step 3's checkout, which may
    be stale by the time Step 3e runs). Every `observe` anchors on this
    commit.
  - `BASE_OID` — `baseRefOid` from Step 3's `gh pr view`.
  - `RUN_ID` — `"$RL" new-run-id`.
  - `SOURCE` — `review-pr` in `/review:pr`, `review-all` in `/review:all` (pass
    it as `--source` to `observe` and as `--actor` to `transition` and
    `settle`).
- **Failure policy.** The review never aborts on a ledger error. When a library
  call exits non-zero, log
  `[review:pr] Warning: ledger <section> failed (exit N)` to stderr, add
  "Ledger: write failed at <section> (exit N)" to Coverage, and continue. Exit 5
  means the PR closed or merged mid-review; exit 4 means another review holds
  the PR's lock. The findings are still in the Step 10 report, so a failed write
  stays visible.
- The library prints JSON. Read counts and ids from it; do not echo ledger text
  into the terminal unless you strip control bytes first.

## Step 3e — dismissed-findings context

**Verify the head before setting `REVIEWED_HEAD`.** A stale local checkout
or a force-push between Step 3's `gh pr view` and this step would
otherwise anchor a dismissal, and every later observation, to a revision
GitHub no longer serves as the PR head:

```bash
RL="${CLAUDE_PLUGIN_ROOT}/lib/review-ledger.sh"
if REMOTE=$("$RL" remote-head <PR>); then
  LOCAL=$(git rev-parse HEAD)
  [ "$REMOTE" = "$LOCAL" ] && REVIEWED_HEAD="$LOCAL"
fi
```

`remote-head` re-reads `headRefOid` from `gh pr view` at call time — not
Step 3's snapshot — fetches `refs/pull/<PR>/head`, and retries with
backoff until the two match, so its printed OID is the current remote
head. If it exits non-zero (exit 6: a shallow repository, a missing
object, or the ref never matching), or its output disagrees with
`git rev-parse HEAD`, the head is **unverifiable**: leave `REVIEWED_HEAD`
unset, skip every ledger read and write for this run — this section's
`dismissed-context` call and every write point below through Step 10's
`settle` — add "Ledger: head unverifiable" to Coverage, and continue the
review with no ledger persistence.

Only once `REVIEWED_HEAD` is set, run:

```bash
RL="${CLAUDE_PLUGIN_ROOT}/lib/review-ledger.sh"
"$RL" dismissed-context <PR> --head <REVIEWED_HEAD> --fenced
```

stdout is the complete fenced block, or empty when no dismissal still applies.
The library has already substituted this block's delimiters and the pr-context,
file-line-counts and learnings-context delimiters out of every value,
XML-escaped them, and dropped any entry whose title or reason starts a line with
`IGNORE PREVIOUS`, `system:` or `assistant:`. Do not rebuild or reformat the
block. The final stderr line reports `injected=N filtered=M`; keep both counts
for Coverage.

Prepend the block, unchanged, to every reviewer prompt in Step 5, next to the
learnings-context block. Skip it in legacy mode (`review_pipeline: legacy`),
exactly as the learnings block is skipped.

## After Step 6 — observe every reported finding

Run this after Step 6's partition and quality gates, before Step 7 edits
anything, so an interrupted run loses nothing.

1. Build one JSON array holding every finding in the three queues (fixer,
   residual actionable, report-only). Leave out findings with
   `pre_existing: true` and findings the confidence gate suppressed; they were
   never reported as this PR's work. Each element is the finding's
   compact-return object plus:
   - `reviewers`: every reviewer that flagged it after Step 6.2's merge.
   - `queue`: `fixer`, `residual` or `report_only`.
   Before the next step, redact any credential-shaped substring inside
   `title`, `suggested_fix`, `migration`, or other free-text field (AGENTS.md's
   Security & Prompt-Injection Rules) — the raw finding can quote a value the
   reviewer copied from the diff, and this file is written before the
   ledger's own redaction pass runs.
2. Write the redacted array with the Write tool to a file under a fresh
   `mktemp -d` directory, and remember the element order: the library reports
   results by 1-based ordinal.
3. Run:

   ```bash
   RL="${CLAUDE_PLUGIN_ROOT}/lib/review-ledger.sh"
   "$RL" observe <PR> --head <REVIEWED_HEAD> --base <BASE_OID> --step 6 \
     --run-id <RUN_ID> --source <SOURCE> <"<findings-file>"
   ```

   Remove the `mktemp -d` directory immediately after this command returns,
   on both success and failure — it held reviewer-authored text and must not
   outlive the call.

4. From the JSON result, keep `findings[]` (`ordinal` → `finding_id`) for
   Steps 7 and 9, and `new`, `merged`, `reopened`, `suppressed_dismissed` and
   `rejected` for Step 10. A `rejected` entry names only an ordinal and a
   reason; list the ordinals in Coverage. Before Step 7 touches anything,
   drop every ordinal whose `findings[]` entry has `status: "suppressed"`
   from the fixer, residual and report-only queues — it names a dismissed
   finding a reviewer merely repeated, and fixing or transitioning it makes
   the ledger's `dismissed -> applied` step illegal.

## Step 7 — record each applied fix

After each fix Step 7 applies, append `applied` for that finding's id:

```bash
RL="${CLAUDE_PLUGIN_ROOT}/lib/review-ledger.sh"
"$RL" transition <PR> <finding_id> applied --head <REVIEWED_HEAD> \
  --actor <SOURCE> --reason "auto-applied safe_auto fix"
```

## After Step 8 — observe the simplifier's findings

Normalize the code-simplifier's findings (Step 6 sub-step 0), add
`reviewers: ["code-simplifier"]` and `queue: "residual"`, write them to a file
as above, and run `observe` with `--step 8 --anchor-source worktree` and the
same `--head <REVIEWED_HEAD>`. The worktree source anchors them on the post-fix
files; the library requires each path to be tracked at HEAD. Skip this section
when the simplifier returned nothing.

## Step 9 — fix SHA, published head, settle

Only when Step 7 applied at least one fix and Step 9 commits it.

1. **Commit exists, before submission.** Split Step 9's commit from its submit:
   run the resolved provider's commit line from Step 9 first (not its submit),
   then record the fixing commit for every finding Step 7 applied:

   ```bash
   RL="${CLAUDE_PLUGIN_ROOT}/lib/review-ledger.sh"
   FIX=$(git rev-parse HEAD)
   for id in <finding_id> <finding_id>; do
     "$RL" transition <PR> "$id" applied --fix-sha "$FIX" --actor <SOURCE>
   done
   ```

   Then run the provider's submit command.

2. **Submission reported success.** Confirm the published head, record it, and
   settle:

   ```bash
   RL="${CLAUDE_PLUGIN_ROOT}/lib/review-ledger.sh"
   if REMOTE=$("$RL" remote-head <PR>); then
     for id in <finding_id> <finding_id>; do
       "$RL" transition <PR> "$id" applied --published-head "$REMOTE" --actor <SOURCE>
     done
     "$RL" settle <PR> --remote-head "$REMOTE" --actor <SOURCE> \
       --ids-json '["<finding_id>", "<finding_id>"]'
   else
     RC=$?
     echo "[review:pr] Warning: ledger remote-head failed (exit $RC)" >&2
   fi
   ```

   `remote-head` fetches `refs/pull/<PR>/head` (fork PRs included) and retries
   until it equals `headRefOid`; exit 6 means it never matched (or `gh` could
   not read `headRefOid`), so leave the findings `applied` and route the
   failure through Conventions' failure policy — add "Ledger: write failed at
   remote-head (exit N)" to Coverage instead of exiting silently. `settle`
   moves each finding to `fixed` only when the fix is proved published
   (ancestor or `git patch-id`) and no longer reproduces at the remote head; an
   abandoned fix (unreachable from any ref) becomes `reopened`; a proved fix
   whose anchor still matches, and anything unverifiable, stays `applied` for
   `/review:triage`.

3. **Push declined, failed, or skipped** (the interactive gate was rejected, or
   the provider returned an error): append nothing more. The findings stay
   `applied`, which counts as pending, so the fix that exists only in this
   worktree is not lost.

## Step 10 — the Ledger line

Add one line to Step 10's Coverage section, built from the `observe` and
`settle` results and a final `"$RL" fold <PR> | jq -c '{pending, attention}'`
(never print the full fold; it carries stored ledger text):

```
- Ledger: <new> new, <merged> carried over, <reopened> reopened, <pending> pending, <attention> need attention
```

Also add, when non-zero: "Dismissed findings injected: N (M filtered)", the
rejected ordinals, and every "Ledger: write failed" line.

When Step 3e marked the head unverifiable, none of the above ran: emit only
"Ledger: head unverifiable" (already added to Coverage at Step 3e) and skip
the `<new>/<merged>/<reopened>/<pending>/<attention>` line entirely — there
is no fold to report.
