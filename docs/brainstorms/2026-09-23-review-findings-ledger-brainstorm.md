# Durable Review-Findings Ledger for yellow-review

**Date:** 2026-09-23 **Research basis:**
`docs/research/review-findings-persistence.md` (~70 sources + GitHits OSS-code
addendum) **Motivating failure:** `/review:sweep-all` on yellow-plugins PR #840
— 9 reviewers produced 10 residual findings (one P1 @ confidence 100, two
verified-accurate P2 doc errors), none were `safe_auto`, so none were applied,
none posted to GitHub, none persisted. `/review:resolve` only touched the 4
pre-existing bot threads. In an unattended sweep, every residual finding
evaporates with the transcript.

## What We're Building

A durable, append-only JSONL ledger of residual review findings (everything
`/review:pr` reports but does not apply: Step 7's P2/P3 `safe_auto` residue,
`gated_auto`/`manual` findings, Step 8's code-simplifier findings, and Step
6.9's report-only queue — `advisory` plus anything owned by `human` or
`release`, including P0s — stored as `report_only` and never eligible for
automatic application) that survives past the end of any `/review:pr`,
`/review:sweep`, or `/review:sweep-all` run — regardless of which worktree or
Claude session touches the PR next. Triage never rewrites finding records: it
appends `transition` records (`{finding_id, state, reason, head_sha, at}`), and
every reader folds by `finding_id` and takes the latest state, so an earlier
`open` record never reads as pending. `reopened` and `applied` (fixed locally,
not yet pushed) project to pending exactly like `open`: the pending set is
latest state ∈ {`open`, `reopened`, `applied`}, and every count, including
`<pr>.pending`, uses that one definition. `report_only` records (human- or
release-owned findings, P0s included) are never auto-applied but must not go
invisible either, so they form a second "attention" count kept beside the
pending count: latest state ∈ {`report_only`, `stale`}. `stale` entries are in
it too, whatever their origin, because a finding whose anchor no longer matches
needs a human look before it can be closed, and nothing else surfaces it. The
sweep summary and the SessionStart hook show both counts. `finding_id` is fixed
at first observation (the fingerprint at that time, deterministic, never a
random per-record ID) and never changes. Anchor content is versioned per
observation instead: a later observation first tries an exact fingerprint match,
then an alias rematch (same `file`, normalized `category`, `rule` and enclosing
scope, anchor near the stored line hint and above a similarity threshold on the
normalized lines) and reuses the original `finding_id`, so an edited anchor or a
slightly varied recurrence still folds under the same key.

Confirmed today (`git rev-parse --git-common-dir` inside this worktree resolves
to `/home/kinginyellow/workspaces/yellow-harness_workspace/yellow-plugins/.git`,
the shared clone's git dir, not a per-worktree path):

- **Location & format:**
  `$(git rev-parse --git-common-dir)/yellow-review/findings/<pr>.jsonl` — one
  append-only JSONL file per PR, shared automatically across every worktree of
  the same clone (the shared value is `git-common-dir`, not `git-dir`).
  Invisible to `git status`/PR diffs (lives inside `.git`), no
  `${CLAUDE_PLUGIN_DATA}`/`~/.claude` write, so no protected-dir confirmation
  prompt (anthropics/claude-code#41156) blocking unattended writes. Trade-offs
  accepted: lost if the clone is deleted, single-machine only.
- **Owner & consumer:** a new `/review:triage` command (mirroring
  `/debt:triage`'s pending→ready→fixed lifecycle) is the only writer of
  lifecycle transitions and the only pruner, with one exception: when
  `review-pr.md`'s write step re-observes a `fixed`, `stale`, or no-longer-
  applicable `dismissed` finding, it appends the `reopened` transition itself,
  so a direct `/review:pr` run never leaves a reproduced defect hidden. It is
  also not the only reader or writer: `review-pr.md` reads the ledger
  (dismissed-findings context) and appends new finding records (Approach A).
  `/review:resolve` stays untouched — GraphQL/GitHub-threads-only, as today.
- **Attended vs. unattended semantics:** the `safe_auto`/`gated_auto`/`manual`
  gate exists to protect _unattended_ runs (no human to catch a bad auto-apply).
  Attended `/review:triage` shows each verified finding with its proposed change
  and applies only what the human approves (an "approve all" choice is fine, but
  presence alone never bypasses `autofix_class`). When invoked non-interactively
  (from `sweep.md`/`sweep-all.md`), it applies nothing: every ledger entry is
  residue that `review-pr.md` already declined to auto-apply (its P0/P1
  `safe_auto` fixes are applied in Step 7; P2/P3 `safe_auto` are held for a
  human), so an unattended apply would bypass that severity gate. It only
  re-verifies, marks `stale`, refreshes counts and prunes, and leaves the rest
  for next time.
- **Discoverability:** no GitHub-visible surface at all (no sticky comment, no
  Check run, no SARIF) — avoids Codex/Cursor bot reply-loops. Instead:
  `sweep-all.md`'s summary table gains a "Residual" count column, and a new
  SessionStart hook (yellow-debt's cheap-count pattern) prints one line when any
  open PR in this repo has pending ledger findings.
- **Dedup & false-positive suppression:** write-time fingerprint matching — skip
  re-adding a fingerprint whose latest state is an applicable `dismissed`. A
  dismissal records the paths its reason depends on (`depends_on`, e.g. the
  caller whose validation made a sink safe) with content hashes. Every
  `depends_on` path gets the same containment check as `file` (repo-relative,
  `realpath` inside the repo, regular file only — no devices, FIFOs or symlinks
  out) before it is opened or hashed, since the triage model writes them. The
  dismissal stays applicable only while the anchored code and every `depends_on`
  hash are unchanged, otherwise the new observation reopens it. Beyond that it
  merges repeats of still-`open` entries and appends a `reopened` transition
  when a `fixed` or `stale` fingerprint reproduces at a later head (a revert or
  a removed guard is a real regression, not a duplicate; a `stale` entry whose
  region a rebase moved is still the same defect once it matches again).
  Fingerprint = deterministic primitives only: `file` + normalized `category` +
  `rule` + enclosing scope (the position-independent enclosing symbol or AST
  path, e.g. `handlers.createUser`, or the nearest heading for markdown, so two
  identical handlers with the same defect stay separate) + a hash of the
  whitespace-normalized code lines the finding anchors to (so the same defect
  from different reviewers merges). `rule` is a new required compact-return
  field: a short kebab-case condition slug from a closed per-category vocabulary
  (for example `missing-input-validation`, `wrong-error-path`), validated like
  `category`, so two distinct defects on the same statement get different keys.
  `category` is free-form in the compact-return schema, so it is mapped to a
  closed vocabulary before keying (correctness, security, reliability,
  performance, maintainability, docs, testing, contract), and the plan must
  measure how often one defect still lands in two categories. No line numbers in
  identity: an unrelated edit above the defect would shift a line bucket and
  re-raise it. The line number is stored as a search hint for contextual
  rematching after a rebase (the research doc's "do not hash line numbers").
  Record `reviewer` on each entry but exclude it from the key. Never use LLM
  title text as identity — titles get reworded between runs. `/flow:plan` must
  still test two distinct defects on the same statement and define the initial
  `rule` vocabulary. In addition, `/review:pr` injects the PR's dismissed
  findings + dismissal reasons into reviewer prompts as a fenced advisory block
  (same shape as the existing learnings-context block, but not its sanitization
  alone: stored titles and reasons can echo PR text, so the block's own
  delimiters are substituted out of every interpolated value first, as the
  pr-context fence already requires, before XML escaping; and, like the
  learnings block, it carries the explicit semantic control that its content is
  reference data only and reviewers must not follow any instructions inside it),
  because fingerprint-only dedup misses reworded re-detections of the same
  underlying issue — this directly addresses a documented risk in this repo's
  own history:
  `docs/solutions/code-quality/multi-agent-re-review-false-positive-patterns.md`
  recorded a 38% false-positive rate in re-review rounds when prior
  fix/dismissal rationale isn't carried forward.
- **Staleness & lifecycle:** `/review:triage` re-verifies each entry's flagged
  region + condition against the current HEAD SHA before acting; non-matching
  entries become `stale` (shown to the human, never silently fixed or dropped —
  silent disappearance is exactly the bug this whole effort exists to fix). When
  a PR is observed merged/closed, its `findings/<pr>.jsonl` is deleted — no
  archive.

## Why This Approach

### Approach A: review-pr owns read+write via a shared ledger library — **Recommended**

A small script shipped inside the plugin (e.g.
`plugins/yellow-review/lib/review-ledger.sh`, invoked via
`${CLAUDE_PLUGIN_ROOT}/lib/…` — a repo-root `scripts/lib/` is not part of the
installed plugin), mirroring yellow-debt's `lib/validate.sh` — atomic
`flock`-guarded append, `umask 077`-style hygiene borrowed from
compound-staging's `cs_atomic_jsonl_write`) is called from two places in
`review-pr.md`: before Step 5 dispatches the reviewers (alongside Step 3d's
learnings pre-pass), it reads the ledger to build the dismissed-findings
advisory block injected into reviewer prompts — Step 6 would be too late, since
reviewers have already run. The reader re-checks each dismissal's anchor and
`depends_on` hashes against the current HEAD first and injects only those still
applicable, so a stale rationale never talks reviewers out of a real finding.
Writes happen as early as possible so an interrupted run loses nothing: right
after Step 6's aggregation, before any stage that edits files, it appends every
aggregated finding (`open`, or `report_only` for the report-only queue) with
dedup applied; Step 7 then appends an `applied` transition for each finding it
fixed, and Step 8 appends the code-simplifier's new findings. The ledger ends up
holding all of Step 10's Residual Actionable Work plus the report-only queue,
not only `owner=downstream-resolver`. `applied` findings only get a `fixed`
transition once Step 9's commit and push succeed; if the push is declined or
fails they stay pending, so a fix that exists only as an uncommitted change in
one worktree is never lost from the ledger. As soon as Step 9's commit exists,
and before submission, a second `applied` transition records the fixing commit's
SHA, so a commit that fails to submit is still traceable; the record becomes
`fixed` only when that commit is an ancestor of the remote PR head
(`gh pr view --json headRefOid` plus `git merge-base --is-ancestor`). A restack
rewrites the SHA (Graphite restacks diverged branches), so after a successful
submission the writer records the published head SHA too, and triage accepts two
fallbacks when the recorded SHA is not an ancestor: a commit on the remote PR
branch with the same `git patch-id`, or a content check showing the finding no
longer reproduces at the remote head. Either proves publication. Triage never
marks an `applied` record `stale` because its old anchor no longer matches local
`HEAD`: a local-only commit is exactly the unpublished case. The compact-return
schema keeps only `file` and `line`, and Step 7's auto-fixes can shift lines, so
the helper snapshots each finding's anchored code right after Step 6's
aggregation (a hash for identity plus the normalized lines for rematching, with
the lines passed through the same `redact_secrets` patterns before storage; if a
line cannot be redacted safely, only the hash and the line hint are kept, so an
anchor on a hard-coded token never copies it into `.git`), before Step 7 edits
anything. The Step 8 write uses those snapshots; simplifier findings, which only
exist after Step 8, are anchored against the post-fix file. That write step also
appends `reopened` when it re-observes a `fixed`, `stale`, or
no-longer-applicable `dismissed` finding. `/review:triage` is the only other
component that touches the file (read + append other transitions + prune).
`sweep.md`/`sweep-all.md` need only cosmetic changes: the Residual-count column,
`sweep.md` optionally invoking `/review:triage --non-interactive` at the end,
and `sweep-all.md` invoking `/review:triage --prune <pr>` for ledgers whose PR
is absent from the all-open-PR query.

**Pros:**

- Single source of truth — every `review-pr` caller (a human directly,
  `sweep.md`, `sweep-all.md`, anything invoking it in the future) gets full
  ledger persistence for free. No caller can "forget" to persist, which is
  exactly how PR #840's findings were lost.
- Smallest total footprint: one shared lib, one new command, one hook script,
  two small edits to existing sweep commands.
- Matches yellow-debt's own precedent almost exactly (shared lib + SessionStart
  hook + dedicated triage/fix command), so it reads as "the way this codebase
  already does durable findings," not a new pattern.

**Cons:**

- Touches `review-pr.md` — a stable, heavily-used command — in two places
  (context injection, write-after-partition).
- Slightly widens `review-pr`'s responsibility beyond pure
  detection/partitioning.

**Best when:** elegance and avoiding duplicated plumbing matter more than
keeping `review-pr.md` a pure read-only detector — which matches the stated goal
(minimal new surface, reuse existing patterns) better than isolating persistence
elsewhere.

### Approach B: Persistence via a SubagentStop hook, review-pr untouched for writes

Leave `review-pr.md`'s step list alone except for the unavoidable read-side
context injection (a single new fenced block, same minimal-touch shape as the
existing learnings-context block). All ledger _writes_ happen in a new
`SubagentStop` hook — matching compound-staging's own hook-driven capture
pattern — that fires whenever a `review-pr` task subagent completes, parses its
compact-return JSON, and appends residual findings to the ledger.

**Pros:** zero footprint inside `review-pr.md`'s visible step list for the write
path; reuses an established yellow-core extension mechanism (hooks) instead of
editing steps.

**Cons:** yellow-review ships **zero hooks today** (confirmed by reading the
plugin catalog) — this approach introduces a new category of infrastructure
(hook registration, `plugin.json` changes) for a single use case; hook-based
capture is harder to observe/debug than an explicit step (nothing visible in the
command transcript); the compact-return JSON isn't guaranteed to be cleanly
available to a `SubagentStop` hook in the exact shape needed — it would likely
have to re-parse chat output rather than call a lib function directly, which is
more fragile plumbing for the same outcome as Approach A.

**Best when:** you specifically want zero lines changed in `review-pr.md`'s step
list and are willing to invest in hook infrastructure yellow-review doesn't have
yet. Not recommended here — it's more total surface, not less, for the same
result.

### Approach C: `/review:triage` re-runs detection itself, review-pr untouched entirely

Don't touch `review-pr.md` at all — not even for reads. `/review:triage`
re-invokes a lightweight subset of review-pr's own reviewer logic (or re-parses
the last run's raw transcript) on demand to reconstruct residual findings, then
writes the ledger just-in-time.

**Cons (why this is not viable given the decisions already made):** re-running
LLM-based detection is expensive and non-deterministic — findings could differ
between the original run and triage's reconstruction, reintroducing a version of
the "results evaporate" problem from a different angle. It also can't satisfy
the dismissed-findings context-injection decision above, which requires
`review-pr` itself to be context-aware at generation time, not reconstructed
after the fact. Included here only to show why "touch nothing in review-pr.md"
isn't actually on the table once dismissed-context injection is required.

### Recommendation

**Approach A.** It is the only one of the three that is simultaneously
consistent with every decision already locked in during this brainstorm
(dismissed-context injection requires `review-pr` to read the ledger; uniform
write-on-every-call requires `review-pr` to write it too) while adding the least
new infrastructure — no new hook category, no re-run-detection risk, and a shape
that mirrors yellow-debt's existing lib+hook+command pattern closely enough that
a future maintainer will recognize it immediately.

## Key Decisions

| #   | Decision                                                                                                                                                                                                                | Rationale                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Ledger at `$(git rev-parse --git-common-dir)/yellow-review/findings/<pr>.jsonl`, JSONL, one file per PR                                                                                                                 | Shared across worktrees of the same clone by construction (verified: `git-common-dir` ≠ per-worktree `git-dir`); invisible to git status/PR diff; no protected-dir prompt. Research doc explicitly warns against keying by cwd/worktree path — this sidesteps that failure mode without introducing a new out-of-tree location.                                                                                                                                                                                                                                                                            |
| 2   | New `/review:triage` command owns lifecycle transitions and pruning, except `review-pr.md` appends `reopened` on re-observation (`review-pr.md` still reads and appends findings); `/review:resolve` stays GraphQL-only | Keeps `resolve-pr.md`'s existing, working GitHub-thread contract stable; avoids conflating "GitHub-visible unresolved threads" with "locally-tracked residual findings," which are genuinely different data sources with different lifecycles. A direct `/review:pr` run must not hide reproduced defects when triage is skipped.                                                                                                                                                                                                                                                                          |
| 3   | Attended = fix every verified finding the human approves; unattended = apply nothing                                                                                                                                    | The safe/gated/manual gate is a proxy for "is a human reviewing this change." Explicit approval (per finding, or approve-all) provides that review; mere presence does not. Unattended triage applies nothing because every ledger entry is residue `review-pr.md` already held for a human (including P2/P3 `safe_auto`), so applying it would nullify the Step 7 severity gate.                                                                                                                                                                                                                          |
| 4   | No GitHub-visible surface; local-only discovery (sweep-all Residual column + SessionStart one-liner)                                                                                                                    | Matches yellow-debt's own discovery pattern; avoids Codex/Cursor bot reply-loop triggers entirely by never posting anything for them to react to.                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 5   | Write-time dedup (fingerprint: file, normalized category, rule, code-context hash; line kept as a rematch hint; reviewer recorded but not keyed) + dismissed-findings prompt injection                                  | `rule` (closed per-category vocabulary) separates distinct defects on the same statement; the code-context hash merges cross-reviewer repeats of the same anchored defect. Leaving line numbers out keeps identity stable when unrelated edits shift lines. Fingerprint alone still misses reworded re-detections (LLM titles vary run to run); prompt injection closes that gap using the fenced-advisory pattern already used for learnings-context. Plan must define the initial `rule` vocabulary and test that different `rule` values stay separate while the same `rule` from two reviewers merges. |
| 6   | Re-verify against current HEAD SHA before acting; mark non-matching entries `stale` (visible, not silently dropped); prune ledger file on PR merge/close                                                                | Force-pushes are tolerated (PR number is stable, fingerprint ignores exact line), but code can drift enough that a fix no longer applies cleanly — silently forcing it or silently dropping it both recreate the "findings vanish" problem this whole effort targets.                                                                                                                                                                                                                                                                                                                                      |

## Suggested Stack Decomposition

For `/flow:plan` to pick up, in dependency order:

1. **Ledger library + schema** — `plugins/yellow-review/lib/review-ledger.sh`
   (called via `${CLAUDE_PLUGIN_ROOT}`): the `<pr>` key accepted only as a
   canonical positive integer (`^[1-9][0-9]*$`) before it is used in any path
   (`.jsonl`, `.pending`, `.state`, lock, corrupt-tail, prune), so a malformed
   `/review:triage` target can never reach outside `findings/`; one `flock` per
   PR held across each append or transition, the fold, and the atomic (`mv`)
   sidecar replacement, so overlapping sweeps cannot publish a stale count; each
   record written as one complete line in a single write ending in `\n`, and,
   under the same lock before any append or fold, a tail check: if the file does
   not end in `\n`, a final record that is still valid JSON gets its newline
   completed, and an unparseable one (short write, full disk, crash) is moved to
   `<pr>.jsonl.corrupt-<timestamp>` and the file truncated to the last newline,
   so one interrupted append never becomes permanent mid-file corruption; a path
   validator applied at write and at read (repo-relative, contained after
   `realpath`, and on a tracked-file allowlist: `file` and every `depends_on`
   path must exist in the PR head or base tree, checked with
   `git cat-file -e <sha>:<path>`, with a regular-file Git mode (`100644` or
   `100755` from `git ls-tree <sha> -- <path>`; symlinks `120000` and submodules
   `160000` are rejected before anything is dereferenced), so an untracked or
   ignored file such as a local `.env`, or a tracked symlink pointing at one, is
   never read, snapshotted or hashed) so a model-produced `file` can never point
   triage outside the repo or at local secrets. A path the PR deletes is valid
   when it exists in the base tree; because its parent directory may be gone too
   (a whole-directory deletion), such a base-only path skips `realpath` and is
   normalized lexically against the canonical repo root instead (no leading `/`,
   no `..` after collapsing `./`), then relies on the base-tree mode and blob
   checks above; the observation records the base SHA and its anchor is
   snapshotted from the base blob, so a finding on a deleted file is kept rather
   than rejected; credential redaction of every model-authored string (`title`,
   `suggested_fix`, dismissal reasons) and every anchor-snapshot line before it
   is appended, with the same patterns as yellow-core's `redact_secrets`
   (`lib/compound-staging.sh`); when a snapshot line cannot be redacted safely,
   persist only its hash and the line hint so a secret echoed from the diff
   never lands in `.git` or gets re-injected into prompts. Because
   `redact_secrets` does not know every credential shape (it misses assignments
   such as `DEVIN_ORG_ID=...`), a fail-closed pass runs on the model-authored
   strings after it: any string that still contains an environment-style
   assignment to a `*_KEY`, `*_TOKEN`, `*_SECRET`, `*_ID` or `*_PASSWORD` name,
   or a long high-entropy token, is replaced wholesale with
   `[withheld: possible credential]`, keeping the finding but not the text;
   fingerprint function (`file` + normalized `category` + `rule` + enclosing
   scope + whitespace-normalized code-context hash; line kept as a rematch hint,
   `reviewer` stored but not keyed), dedup/state-check function,
   dismissed-findings reader (for context injection), prune-on-close function
   that removes both `<pr>.jsonl` and `<pr>.pending` under the PR's `flock` and
   leaves a `<pr>.closed` tombstone; every writer takes that lock and, before
   appending, checks the tombstone and rechecks the PR state
   (`gh pr view <pr> --json state`), refusing to write for a closed PR, so a
   `/review:pr` run that outlives its PR cannot recreate a pruned ledger. If the
   live state is `OPEN` while a tombstone exists (the PR was reopened), the
   writer removes the tombstone under the same lock and starts a fresh ledger;
   and a per-PR `findings/<pr>.pending` sidecar in the form
   `<pending> <attention> <bytes>` (pending count, attention count = latest
   state ∈ {`report_only`, `stale`}, and the JSONL byte size they were computed
   from) refreshed after folding the JSONL by `finding_id` to latest state.
   Include test fixtures for: two distinct defects on the same statement
   (different `rule`, same `file`/`category`/anchor — must stay separate), one
   defect raised by two reviewers (same `rule` — must merge), the same `rule` in
   two different enclosing scopes such as two identical handlers (must stay
   separate), and a finding whose line hint moves without the anchored code
   changing (rematch behavior). This is the one piece everything else depends
   on.
2. **`review-pr.md` integration** — add the dismissed-context read before Step
   5's reviewer dispatch, next to Step 3d (fenced advisory block into reviewer
   prompts, with delimiter substitution on every interpolated value); add the
   ledger writes at three points: every aggregated finding right after Step 6
   (before any stage that edits files; the report-only queue marked
   `report_only`), `applied` transitions after Step 7, and the simplifier's
   findings after Step 8, appending `reopened` when a write step re-observes a
   `fixed`, `stale`, or no-longer-applicable `dismissed` finding, refreshing
   `<pr>.pending` after each append, and an `applied` transition carrying the
   fixing SHA right after Step 9 commits, before submission. Making `rule`
   required means every producer must emit it in the same change: every reviewer
   that emits the compact-return schema (yellow-review's personas and the
   yellow-core ones `review-pr.md` dispatches), and Step 6's legacy
   prose-to-compact converter (which assigns an explicit `unclassified` rule
   rather than dropping the finding). Otherwise `review-pr.md` drops every
   return that lacks the field. The closed per-category `rule` vocabulary ships
   in this step too. The same producers also emit a required `scope` field (the
   enclosing symbol or AST path the reviewer is looking at, e.g.
   `handlers.createUser`, or the nearest markdown heading), because a generic
   shell helper cannot derive scope reliably across languages. The helper
   canonicalizes it before it enters the key: it keeps the full dotted path of
   enclosing symbols (`handlers.createUser` and `admin.createUser` stay
   distinct), accepts a path only if each segment occurs in the anchored file,
   expands a bare innermost name (`createUser`) to its full path only when that
   name is unique in the file (otherwise the finding is `unscoped`), and maps
   generic values (`module`, `file`, `global`, `top-level`) and anything it
   cannot verify to `unscoped`; the converter also assigns `unscoped`. An
   `unscoped` finding has no reliable identity, so its fingerprint also includes
   the line hint (less stable across edits, but it never merges two separate
   sites); the plan tests that two identical handlers stay separate both with
   different `scope` values and through converter output.
3. **`/review:triage` command** — new command file mirroring `/debt:triage`'s
   structure: first resolve the target PR
   (`gh pr view <pr> --json headRefName,headRefOid`) and require the checked-out
   `HEAD` to equal `headRefOid` and a clean tree (`git status --porcelain`
   empty, the same gate the review commands use) before any re-verification or
   edit, so it never edits over, or mistakes for a fix, someone's uncommitted
   work (check it out through the stacked-PR provider, as `review-pr.md` does,
   or refuse). Without that checkout it re-verifies read-only against the PR
   head (`git show <headRefOid>:<file>` after a fetch), never against an
   unrelated worktree's `HEAD`. Every stored model-authored field (titles,
   reasons, suggested fixes, which derive from an untrusted PR diff) goes
   through the same delimiter substitution and untrusted-content fence, with the
   reference-only instruction, before triage interprets it. Then: read ledger,
   re-verify against that head SHA, mark `stale` on mismatch, validate every
   stored `file` path before any `Read`, `Edit` or shell use (repo-relative, no
   absolute paths, `..` traversal, leading `-` or control characters; every
   character in the conservative allowlist `[A-Za-z0-9._/@+-]` so shell
   metacharacters such as `$()`, backticks, `;` or wildcards are rejected
   outright; and every command that takes a path gets it as a separate argv
   element after `--`, never interpolated into a shell string; the checked-out
   worktree entry itself must be a regular file and not a symlink (`test -f` and
   `! test -L`, checked before `realpath`), because the Git tree mode says
   nothing about what is on disk; and a `realpath` inside the repo root so
   symlinks cannot escape; in the read-only fallback the same lexical checks
   apply, but existence and file type are checked against the target commit tree
   instead (`git cat-file -e <headRefOid>:<file>` and a regular-file mode from
   `git ls-tree`, never a symlink), so a file only the PR adds is not wrongly
   marked `stale`. A deletion finding keeps its recorded base blob only for
   anchor recovery; whether the PR still deletes the path is decided against the
   current base itself, not the merge base: the path must exist in the current
   base tree (`git cat-file -e <currentBase>:<path>`, with `<currentBase>` from
   `gh pr view --json baseRefOid`) and be absent at `<headRefOid>`. If the base
   branch deleted the path on its own after the PR diverged, the merge base
   would still hold it and wrongly report a deletion, so a base that already
   lacks the file retires the finding instead of keeping it actionable, and it
   is not marked `stale` just because the head no longer has the file; reject
   the entry as `stale` otherwise — reviewer paths are model-produced from PR
   content), attended = apply each finding the human approves, then the same
   publication contract as `review-pr.md` (`applied` on edit, a second `applied`
   carrying the fixing SHA once committed, `fixed` only after the ancestor check
   confirms it is on the remote PR head) / `--non-interactive` = apply nothing
   (re-verify, mark `stale`, prune when the target PR is merged/closed),
   `--prune <pr>` = skip re-verify and apply; call
   `gh pr view <pr> --json state` and delete `<pr>.jsonl`, `<pr>.pending`, and
   `<pr>.state` only when state is `MERGED` or `CLOSED` (the only ledger
   deletion path — `/review:sweep-all` delegates here), append transition
   records (`open`/`reopened`/`report_only`→`applied` for an approved fix,
   `open`→`fixed`/`dismissed`/`stale`, and the same terminal transitions for
   `reopened`; `stale`→`dismissed` when a human confirms an obsolete finding,
   and `stale`→`reopened` when it rematches later; `applied`→`fixed` once the
   ancestor check (or its patch-id / content fallback) shows the fix is
   published; `applied`→`reopened` when the fix is abandoned or invalid (the
   edit was discarded or the commit dropped), because the defect itself is still
   there; `dismissed` stays reserved for an explicit decision that the finding
   is not actionable; and for `report_only` once a human fixes or dismisses one
   or re-verification finds it stale, without ever making it auto-applicable;
   never rewrite finding rows), refresh `<pr>.pending` after each fold.
4. **`sweep.md` / `sweep-all.md` integration** — add the "Residual" count column
   to the summary table; `sweep.md` optionally invokes
   `/review:triage --non-interactive` as a final step; `sweep-all.md` runs the
   all-open-PR query and calls `/review:triage --prune <pr>` for each ledger
   whose PR is absent.
5. **SessionStart hook** — declared in `catalog/plugins/yellow-review.json`
   (`hooks.SessionStart` with an explicit `"timeout": 3`, as yellow-debt does;
   when the fold fallback would exceed it the hook reports "pending unknown")
   and emitted by `pnpm generate:manifests`, never a hand-written
   `hooks/hooks.json` or hand-edited `plugin.json`. **Codex hook exposure:** set
   `targets.codex.includeHooks: false` (skills-only Codex target; the hook is
   Claude-session local discovery, matching yellow-core's precedent). **Cursor
   hook exposure:** none — the generator has no Cursor hook emission path
   (`docs/cursor-distribution.md`). A new lightweight hook script (yellow-debt's
   cheap-count pattern, not full JSONL parsing) that ignores any sidecar whose
   `<pr>.jsonl` no longer exists. Scanning the directory cannot tell an open PR
   from one closed outside triage, so reconciliation is guaranteed elsewhere:
   `/review:sweep-all` runs its own failure-checked query of every open PR (all
   authors, drafts included:
   `gh pr list --state open --limit 1000 --json number`, skipped entirely if the
   call fails or may be truncated, instead of its own `--author @me` non-draft
   sweep list). For each ledger whose PR is absent from it, sweep-all calls
   `/review:triage --prune <pr>`, which confirms the PR is closed or merged with
   `gh pr view <pr> --json state` before deleting, so triage stays the only
   pruner. Every ledger writer records `<pr>.state` (last-seen PR state and
   time). The hook counts a sidecar only when that cached state is `OPEN` and
   under 7 days old; otherwise it names the PR as unverified ("run
   `/review:triage <pr>`") instead of counting it. It then sums each open PR's
   `findings/<pr>.pending` sidecar (kept current by the ledger write step and
   `/review:triage` after folding by `finding_id`) and emits a `systemMessage`
   when the pending or attention total is > 0 or at least one ledger is
   unverified, so stale-cache ledgers are still named rather than silently
   dropped from a zero total. Append-only JSONL stays non-empty after
   `fixed`/`dismissed`/`stale` transitions — the hook must not treat file
   non-emptiness as pending findings. Writers hold the per-PR `flock` across
   append, fold and sidecar replacement, so a sidecar is never older than the
   JSONL it describes unless a writer was interrupted. The sidecar stores both
   counts and the JSONL byte size they were computed from
   (`<pending> <attention> <bytes>`). The hook reads that snapshot, the size
   `stat` and any fallback fold under a shared `flock` on the same per-PR lock
   with a short wait, so it cannot pair a pre-append size with a pre-append
   sidecar while a writer is mid-update; if the lock is not free within its
   budget it reports "pending unknown". When the sidecar is missing or its size
   doesn't match the JSONL's current size (one `stat`, immune to coarse mtime
   resolution), the hook folds that one file (bounded by its timeout) or reports
   "pending unknown" instead of trusting the count.
6. **Setup and docs** — `/review:setup` gains checks for the helper's new
   binaries, `flock` and `realpath` (neither is guaranteed on macOS; `flock`
   comes from util-linux or `brew install flock`), and yellow-review's README
   and CLAUDE.md list them as prerequisites, so a missing binary fails at setup
   rather than during review persistence. The same README and CLAUDE.md updates
   also document everything user-facing in this stack: the new `/review:triage`
   command and its modes (attended, `--non-interactive`, `--prune`), the ledger
   location and lifecycle states, `/review:pr`'s new persistence behaviour, and
   the SessionStart hook and its message, as the repo's documentation contract
   requires for behaviour changes.
7. **Changeset** — a `yellow-review` `minor` changeset (`pnpm changeset`) for
   the new `/review:triage` command and SessionStart hook, as CI's changeset
   gate requires for any `plugins/` change.
8. **Tests** — a Bats suite under `plugins/yellow-review/tests/` for the ledger
   helper and the hook: concurrent writers under `flock`, fold and pending /
   attention counts, tail repair (unparseable tail and missing newline), path
   validation (traversal, metacharacters, symlinks, untracked files, deleted
   files), every fingerprint fixture from step 1, tombstone and reopen, and the
   hook's `systemMessage` JSON, stale-sidecar fallback and timeout ("pending
   unknown"). Per AGENTS.md, the hook is also tested manually in a real session
   before the PR merges.

## Open Questions

- Exact JSONL record field names/schema (title, severity, category, file, line,
  confidence, autofix_class, owner, fingerprint, state, dismissal_reason,
  created_at, reviewer, pr_head_sha at write time, etc.) — needs to be nailed
  down at plan time, informed by review-pr's existing 10-field compact-return
  schema.
- Exact mechanics of "re-verify against current HEAD SHA" — is this a targeted
  re-read of the flagged file region and a heuristic content match, or something
  more structured? Not resolved here; a plan-level implementation detail.
- How `/review:triage` detects "PR merged/closed" to trigger pruning —
  `gh pr view --json state` at the start of a normal or `--non-interactive` run,
  plus a dedicated `--prune <pr>` mode invoked by `/review:sweep-all` for
  ledgers whose PR is absent from the all-open-PR list.
- Should the optional `plugin-contract-reviewer` extension fields
  (`breaking_change_class`, `migration_path`) be persisted in ledger entries, or
  dropped at write time since they're supplementary?
- Eval coverage for `/review:triage`'s model-driven parts (re-verification
  judgement, attended approval flow). The deterministic parts are covered by
  stack step 8's Bats suite; the plan should decide whether the model-driven
  parts get a `claude plugin eval` suite.
- Fingerprint collision coverage: the initial per-category `rule` vocabulary,
  and a test that two distinct defects on the same statement (different `rule`)
  stay separate while one defect raised by two reviewers (same `rule`) merges.
- Whether attended `/review:pr`'s Step 10 chat report should visually
  distinguish "just written to the ledger this run" from "carried over from a
  prior sweep" — a UX nicety not resolved here.
