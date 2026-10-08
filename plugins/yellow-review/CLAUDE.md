# yellow-review Plugin

Multi-agent PR review with adaptive agent selection, parallel comment
resolution, and sequential stack review. Graphite-native workflow.

## Conventions

- Use the active stacked-PR provider (see `/stack:status`) for all branch
  management and PR creation — never raw `git push` or `gh pr create`
- Use conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`,
  `chore:`
- Agents report findings — they do NOT edit project files directly. The
  `memory: project` frontmatter auto-enables Read/Write/Edit per Claude Code
  docs (so agents can persist learnings to `.claude/agent-memory/<name>/`),
  but the prompt-level "report findings only" rule remains in force; the
  orchestrating command applies all fixes
- Orchestrating commands apply fixes sequentially to avoid conflicts
- **Confidence gating is orchestrator-only for the four recall personas.**
  `agent-native-reviewer`, `agent-cli-readiness-reviewer`,
  `cli-readiness-reviewer`, and `thermonuclear-reviewer` report every
  in-scope finding with a confidence anchor and severity — no persona-side
  `< 75` filter. They cap at 40 findings; overflow is dropped silently and
  is not orchestrator-suppressed. Other persona reviewers still apply their
  own anchor floors before Step 6 (including
  `plugin-contract-reviewer`). `/review:pr` Step 6 and `/review:all`
  Step 8 item 9 (the Aggregate-findings confidence gate) are the sole
  gates for those four (suppress below 75 except P0 at 50+; count only
  findings the gate actually removes as `suppressed` — surviving
  P0-at-50+ exceptions are not suppressed). Pre-existing findings are
  gated before the Pre-existing section. If a recall persona would
  exceed 40 findings, rank gate-surviving items first (anchors 75/100)
  by severity then confidence, then remaining findings, and drop the
  lowest-ranked overflow — never emit partial JSON.
- All shell scripts follow POSIX security patterns (quoted variables, input
  validation, `set -eu`)
- Working directory must be clean before running any review command
- Commit messages: `fix: address review findings from <agents>` or
  `fix: resolve PR #<num> review comments (<n> files)`. `/review:resolve`
  always adds a new commit via `commit-resolve-fixes` (explicit `git add`,
  then a new commit — never an amend)
- Always confirm with user via `AskUserQuestion` before pushing changes — never
  auto-push without human approval. **Exceptions** (commands that intentionally
  run unattended and suppress every push gate by design):
  - `/review:resolve-stack` — walks a Graphite stack invoking
    `/review:resolve --non-interactive` per PR (which may file up to 3
    follow-up issues per PR unattended)
  - `/review:sweep` — invokes `/review:pr --non-interactive` then
    `/review:resolve --non-interactive` on a single PR with no gates
  - `/review:sweep-all` — loops `/review:sweep` over every open non-draft PR
    you authored; only the one upfront M3 confirmation is interactive
  
  The default `/review:pr` and `/review:resolve` paths (no flag) keep every
  gate. The `--non-interactive` flag opts a single invocation in to the
  unattended behavior.

## Plugin Components

### Commands (8)

- `/review:setup` — Validate GitHub, jq, Graphite, yellow-core and the
  review-ledger prerequisites (flock, realpath, git 2.31+, optional
  universal-ctags) before reviewing PRs
- `/review:pr` — Adaptive multi-agent review of a single PR with automatic fix
  application; persists every reported-but-unapplied finding to the
  review-findings ledger. Accepts `--non-interactive` to suppress its Step 9
  push-confirmation prompt and its Step 9b "save learnings" prompt (used by
  `/review:sweep`)
- `/review:resolve` — Parallel resolution of unresolved PR review threads
  (outdated included) via GraphQL. Every attempted thread ends with a
  disposition — `fixed`, `addressed`, `oos` (follow-up issue), or
  `disagree`/`unclear` (reply, left open as blocking) — per
  `references/resolve/dispositions.md`. Threads skipped by the cluster cap or
  the interactive first-10 choice stay open and count as blocking. Every stop
  after the PR number is known (Steps 2a-2c included) ends with the `Resolve:`
  contract line; usage errors before it print only their error. Accepts
  `--non-interactive` to suppress its spawn-cap, CONFLICT, issue-filing,
  verify-command, and push-confirmation gates (used by
  `/review:resolve-stack` and `/review:sweep`)
- `/review:resolve-stack` — Walk the current Graphite stack bottom-up and run
  `/review:resolve --non-interactive` on every open PR fully autonomously (no
  prompts), pushing and restacking as it goes. It ends the walk, and exits 1,
  on a dirty tree or a changed ignored `yellow-plugins.local.md` after a PR, a
  rate limit, or a PR whose output has no valid `Resolve:` contract line
  (`no contract`); the summary table has a `blocking` column
- `/review:all` — Sequential review of multiple PRs (Graphite stack, all open,
  or single PR)
- `/review:sweep` — Wrapper that runs `/review:pr --non-interactive` then
  `/review:resolve --non-interactive` on the same PR with no gates in
  between — fully unattended — then `/review:triage --non-interactive`
  (reconcile only) and a Ledger line in its summary
- `/review:sweep-all` — Run `/review:sweep` on every open non-draft PR you
  authored sequentially, with one upfront confirmation, skip-and-continue per
  PR, end-of-loop summary (with `Blocking` and `Residual` pending/attention
  columns). Each PR stages its learnings for the compound-staging drain;
  there is no end-of-loop compounding pass. A rate limit, a
  dirty tree or a missing `Resolve:` contract line ends the batch and exits 1;
  a PR-specific stop (`Sweep: skipped`) is skipped and the batch continues. It lists the ledgers of PRs
  missing from an all-authors open-PR query and deletes them via
  `/review:triage --prune` only after the confirmation (a prune-only prompt
  when there is nothing to sweep); it skips pruning when that query fails
  or may be truncated
- `/review:triage` — Own the review-findings ledger's lifecycle for one PR:
  `reconcile` against the fetched head, then attended Apply / Dismiss (with
  `depends_on`) / Restore file / Skip. `--non-interactive` applies nothing
  and never prunes, even for a PR that closed mid-run (used by
  `/review:sweep`); attended triage of a closed PR asks before pruning.
  `rl prune` — via `--prune <PR#>` (used by `/review:sweep-all`) or that
  confirmed prompt — is the only ledger deletion path

### Agents (17)

**Review** — parallel code analysis specialists (report findings, do NOT edit):

- `project-compliance-reviewer` — CLAUDE.md/AGENTS.md compliance, naming,
  project-pattern adherence (always selected)
- `correctness-reviewer` — Logic errors, edge cases, state bugs, error
  propagation (always selected)
- `maintainability-reviewer` — Premature abstraction, dead code, coupling,
  naming (always selected)
- `reliability-reviewer` — Production reliability: error handling, retries,
  timeouts, cascades (selected when diff touches I/O/async)
- `project-standards-reviewer` — Frontmatter, references, cross-platform
  portability (always selected; complements
  `project-compliance-reviewer`)
- `adversarial-reviewer` — Constructed failure scenarios across boundaries
  (selected for diffs >200 lines or trust boundaries)
- `plugin-contract-reviewer` — Breaking changes to plugin public surface
  (subagent_type renames, command/skill/MCP-tool renames, manifest field
  changes, hook contract changes); selected when diff touches
  `plugins/*/.claude-plugin/plugin.json`, `plugins/*/agents/**/*.md`,
  `plugins/*/commands/**/*.md`, `plugins/*/skills/**/SKILL.md`, or
  `plugins/*/hooks/`. Sister to `pattern-recognition-specialist`
  (yellow-core) — pattern-rec catches new convention drift,
  plugin-contract catches breaks to existing surface.
- `cli-readiness-reviewer` — Conditional persona that reviews CLI command
  surface for autonomous-agent invocability (interactive prompts without
  bypass, missing structured output, vague errors, unsafe retries, ANSI
  in pipes). Selected on the same plugin-authoring globs as
  `plugin-contract-reviewer`; concerns are disjoint.
- `agent-cli-readiness-reviewer` — Conditional persona using a 7-principle
  Blocker/Friction/Optimization rubric for CLI agent-readiness (non-interactive
  defaults, structured output, actionable errors, safe retries, bounded
  output, composability, discoverability). Adapted from upstream CE
  v3.3.2; deeper than `cli-readiness-reviewer` for design-doc audits and
  full-CLI evaluations.
- `agent-native-reviewer` — Conditional persona reviewing agent-native
  parity: every UI action has an agent tool equivalent, agents see the
  same data users see, shared workspace, primitives over workflows,
  dynamic context injection. Adapted from upstream CE v3.3.2.
- `thermonuclear-reviewer` — **Opt-in only, never auto-selected.** Strict
  structural-quality lane: code-judo restructurings, spaghetti-condition
  growth, weak type/module boundaries, misplaced ownership, evidence-gated
  file-size threshold crossings. Enable by naming it in
  `reviewer_set.include` in `yellow-plugins.local.md`; it appears in neither
  dispatch table. Runs opus/xhigh, so it is not free. Preloads the
  `yellow-thermonuclear-review` skill, adapted from Cursor's MIT-licensed
  `thermo-nuclear-code-quality-review`. Unreachable under
  `review_pipeline: legacy`, which has its own fixed persona list and never
  reads `reviewer_set`.
- `pr-test-analyzer` — Test coverage and behavioral completeness
- `comment-analyzer` — Comment accuracy and rot detection
- `code-simplifier` — Simplification preserving functionality (runs as final
  pass)
- `type-design-analyzer` — Type design, encapsulation, invariants
- `silent-failure-hunter` — Silent failure and error handling analysis

**Workflow** — orchestration helpers:

- `pr-comment-resolver` — Implements one fix per cluster of review comments
  (spawned in parallel) and proposes a per-thread disposition; it has no Bash
  tool, and the orchestrator validates and writes everything to GitHub

### Skills (3)

- `pr-review-workflow` — Internal reference for adaptive selection, output
  format, error handling, and Graphite integration (not user-invocable)
- `stack-traversal` — Internal reference for the bottom-up Graphite
  stack-traversal procedure shared by `/review:all` and
  `/review:resolve-stack` (not user-invocable)
- `yellow-thermonuclear-review` — Portable structural-quality rubric
  preloaded by `thermonuclear-reviewer`; carries its own report-only safety
  rails and inline MIT attribution so the rules survive on hosts with no
  tool restriction (not user-invocable)

### Scripts (12)

- `get-pr-comments [--include-outdated] <owner/repo> <pr>` — Fetch unresolved
  PR review threads via GitHub GraphQL API (non-outdated only unless the flag
  is set), with thread permissions, comment author type and a per-thread
  `commentsTruncated` flag (a truncated thread is never resolved); exits 3
  (partial array on stdout) when the thread list is truncated (page cap, missing
  cursor or the 270 s fetch deadline)
- `get-pr-blockers <owner/repo> <pr>` — Report CHANGES_REQUESTED reviews,
  `reviewDecision`, whether conversation resolution is enforced (read from the
  base branch and the default branch), and `lookupReason` when a lookup failed
- `reply-pr-thread <PRRT_id> <disposition> <body-file>` — Reply to a thread
  with an idempotency marker (skips when our latest recent comment has a
  marker for the thread, any disposition, and only bot comments follow it), with
  one rate-limit retry and a per-call `gh` timeout, enforced when `timeout(1)` or
  `gtimeout(1)` is installed (without either `gh` runs unbounded, so unattended
  calls can hang; see
  `references/resolve/dispositions.md`)
- `resolve-pr-thread <PRRT_id>` — Resolve a single review thread via GitHub
  GraphQL mutation; exit 3 (`reason=permission|not-found`) and 4 (rate limit,
  or a timed-out `gh` call, which may have changed state; same for
  `reply-pr-thread`, whose re-run skips via its pre-check) are distinct from
  exit 1
- `file-followup-issue <owner/repo> <pr> <PRRT_id> <title-file> <body-file>` —
  File (or find) the follow-up issue for an out-of-scope thread, deduped by a
  viewer-authored marker; `--find <owner/repo> <PRRT_id>` only looks, never
  files. The issue gate asks per candidate when interactive; unattended
  runs file at most 3 per PR per run (`/review:resolve` Step 5; see
  `references/resolve/dispositions.md`)
- `check-resolve-text <file>...` — Refuse resolver-written text that looks
  like a credential, or has an image, an `@` mention or a foreign URL (for
  text posted outside the resolve scripts); exits 6
- `pr-changed-ranges <pr>` — The PR's changed files and new-side line ranges
  from the files API (`/review:resolve` resolver envelope)
- `poll-new-threads --wait <s> ...` — Step 8 re-pass poll for threads that
  appeared after round 1; always fetches at least once
- `commit-resolve-fixes` — Stage the resolver files, add a new commit,
  submit through the provider, verify the remote head; never pushes itself.
  Refuses paths outside the PR, deny-listed paths, credential-shaped added
  lines and (`--unattended`) runner files; every provider call is a registry
  operation (`commitOrAmend`, `submitStack`, `rebaseUpstack`, `abortConflict`);
  exits 2, 3 and 4 are refusals and 5 and 6 keep the local commit
- `run-verify-command` — Run `resolve_pr.verify_command` under a timeout;
  on failure save a patch, revert the files and report the tree state
  (`--unattended` skips runner files and requires `--ignored-since
  <marker-file>`, which refuses when a gitignored file is newer than the marker;
  `--revert-only` reverts the listed files; `--revert-dirty` reverts every change in the tree and takes no
  file list; `--check-ignored --ignored-since <marker-file>` runs only the
  gitignored-file guard, for a resolve with no verify command.
  `/review:resolve-stack` and `/review:sweep-all` run it after a
  dirty resolve only when every dirty path is owned by the run (a PR file
  or trusted-config path); otherwise they run `--revert-only` on the owned
  trusted-config paths, which leaves unrecognized changes in place, so the
  tree can stay dirty and the walk stops
  (`references/review-resolve-stack/dirty-tree-cleanup.md`); both reject `--timeout`, `--command-file`,
  `--trusted` and `--unattended`). The verify gate: interactive runs ask
  first, unattended runs need `verify_unattended: true` and an untracked
  config

`commit-resolve-fixes` and `run-verify-command` refuse a `git`, `gh`, or
`jq` whose canonical file is inside the worktree, and they exec only the
absolute path outside it.

- `guard-local-config snapshot | check <dir> <digest> | clear <dir>` — Snapshot the
  ignored `yellow-plugins.local.md` (printing the path and a `digest=<hex>`
  line the caller holds), then detect and restore a resolver edit
  to it (changed, created or deleted; `git status` cannot see it); exit 3
  means changed and restored, 4 means the snapshot failed validation or its
  digest check (live config untouched) or a restore failed (the change may
  still be live), and a symlinked
  config is refused at snapshot (exit 2).
  `/review:resolve-stack` snapshots per PR (after its checkout, before the resolve), checks after it and clears before the next PR once the check exited 0 or 3 (on exit 4 the snapshot is kept and its path printed)
- `file-line-counts <diff-base-ref>` — Authoritative base/head line counts per
  changed file for `thermonuclear-reviewer`'s size-threshold rule; the
  header and footer rows are its completeness signal

`reply-pr-thread`, `file-followup-issue` and `check-resolve-text` source
`lib/resolve-text.sh` (text screen) before posting and exit 6 on a refusal.
`reply-pr-thread` and `file-followup-issue` exit 7 on a permanent GitHub
refusal (not authenticated; for the issue script also no permission or Issues
disabled). `reply-pr-thread` and `resolve-pr-thread` also source
`lib/gh-graphql.sh`.
`commit-resolve-fixes` and `run-verify-command` source `lib/resolve-paths.sh`
and `lib/verify-run.sh`.

All live at `skills/pr-review-workflow/scripts/` and are invoked as
`${CLAUDE_PLUGIN_ROOT}/skills/pr-review-workflow/scripts/<name>`. Exit codes
and markers for the resolve scripts are in
`references/resolve/dispositions.md`.

### Resolve references

`references/resolve/` holds the `/review:resolve` mechanics loaded by step:
`dispositions.md` (the contract: vocabulary, downgrade and evidence rules,
lanes, write order, issue cap, `Resolve:` line), `clusters.md` (clustering and
the one edit-bounds table), `envelope.md` (resolver prompt and sanitization),
`branch-check.md` and `memory-recall.md`. The dirty-tree ownership check and
revert lives at `references/review-resolve-stack/dirty-tree-cleanup.md`;
`references/review-sweep-all/dirty-tree-cleanup.md` is its byte-identical copy
for `/review:sweep-all` (offloaded detail stays under each command's own
`references/<slug>/`; `skill-content.bats` fails when the copies differ). Its
`previous_filename` lookup validates each file name inside the `--jq`
expression and fails closed, so a newline in a name cannot forge an owned
path. The
caller-side `Resolve:` contract works the same way: `/review:sweep`,
`/review:sweep-all` and `/review:resolve-stack` each Read their own
byte-identical `resolve-contract.md` (`references/review-sweep/`,
`references/review-sweep-all/`, `references/review-resolve-stack/`), which
carries the anchored line and the `Reading ratelimited (callers)` rule from
`dispositions.md`.

### Library

- `lib/resolve-paths.sh` (bash, sourced by `commit-resolve-fixes` and
  `run-verify-command`) — canonical-path check, the case-insensitive
  resolver deny list (agent-tool config dirs and instruction files
  included), the runner-file list (files a git hook or verify command would
  execute) and `rp_tree_changes`; a `git config` failure other than exit 1
  fails closed
- `lib/resolve-text.sh` (POSIX sh, sourced by `reply-pr-thread`,
  `file-followup-issue`, `check-resolve-text`, `commit-resolve-fixes` and
  `run-verify-command`) — the text screen for
  resolver-written text; a match means the text is never posted. Two functions
  share one convention (0 clean, 1 a hit, 2 the scan did not run):
  `rt_text_clean <file>` for text posted publicly (credential shapes plus a
  markdown image, `@` mention or foreign URL) and `rt_code_clean [--strict]
  <file>` for code, diffs and logs, where those are ordinary (credential rules
  only; `--strict` keeps the high-precision ones). On 1 they set `RT_HIT_RULE`
  and `RT_HIT_LINE`, and `rt_report_refusal` prints a `resolve-text:` stderr
  line (never the text): `refused rule=<rule> line=<n>` for a hit, `scan
  failed` when the scan did not run. The posting scripts exit 6 on a refusal;
  callers key on the code and keep the line as detail. The one URL host
  allowed is `RT_ALLOWED_HOST`, else `GH_HOST`, else `github.com`.
- `lib/resolve-gh.sh` (POSIX sh, sourced by `file-followup-issue`,
  `get-pr-blockers` and `get-pr-comments`) — runs `gh` through `rg_gh` under
  `YELLOW_REVIEW_GH_TIMEOUT` (default 30 s, clamped to 60 s) and returns 124 on
  a timeout, but only when `timeout(1)` or `gtimeout(1)` is installed; without
  either `gh` runs unbounded. It also holds the failure classifiers
  (`rg_is_rate_limited`, `rg_is_auth_failure`, `rg_is_permission_denied`) the
  scripts share; test a rate limit before a permission failure, since a
  secondary rate limit is also an HTTP 403.
- `lib/gh-graphql.sh` (POSIX sh, sourced by `reply-pr-thread` and
  `resolve-pr-thread`) — the shared GraphQL call (bounded by
  `YELLOW_REVIEW_GH_TIMEOUT`), rate-limit wait and not-found/permission
  classification behind their exit codes 3 and 4
- `lib/verify-run.sh` (bash, sourced by `run-verify-command` and
  `commit-resolve-fixes`) — timeout,
  process-group and redacted-log helpers for the verify run; `vr_timeout_bin`
  accepts only a `timeout`/`gtimeout` that supports `--kill-after`
- `lib/sibling-plugin.sh` (bash, sourced by `review-ledger.sh` and
  `resolve-paths.sh`) — `sp_sibling_file`, the one lookup of a file in a
  sibling plugin: the source tree first, then the newest numeric version in
  the installed cache. `review-ledger.sh` checks `RL_CORE_LIB` before calling
  it; the helper itself has no override.
- `lib/review-ledger.sh <subcommand>` — the durable review-findings ledger
  (plans/complete/review-findings-ledger.md): an append-only JSONL file
  per PR at
  `$(git rev-parse --git-common-dir)/yellow-review/findings/<pr>.jsonl`,
  shared by every worktree of the clone. Subcommands `observe`, `transition`,
  `fold`, `dismissed-context`, `reverify`, `publication`, `validate-path`,
  `prune`, `refresh-state`, `summary`, `new-run-id`, `remote-head`, `settle`,
  `reconcile`, `restore`, `cards`, `resolve-path`; JSON on stdin/stdout, exit
  codes 2 usage / 3 invalid / 4 lock timeout / 5 PR closed / 6 unverifiable.
  The rule vocabulary is `lib/review-ledger-vocab.json`.
- Stored file names are PR-controlled: command prose addresses findings by
  id and gets a checked absolute path from `resolve-path` for Read/Edit;
  it never copies a file name onto a command line. Batch writes use
  `transition <pr> - <state> --ids-json '[...]'` (all-or-nothing).
- Performance: redaction runs in two `cs_redact_secrets` batches per
  `observe` (text fields, then anchors), and the locked phases work from a
  per-run `\x1f`-separated index of the fold, never from the fold on the
  command line (Linux caps one argument at 128 KiB).
- Every model-authored string is redacted with yellow-core's
  `cs_redact_secrets` (hence the required `yellow-core` dependency) plus a
  fail-closed credential pass; without yellow-core the library withholds all
  model-authored text. Requires `jq`, `flock`, `realpath` and git >= 2.31;
  universal-ctags is optional (code scopes fall back to `unscoped`).
- `/review:pr` and `/review:all` call it at Step 3e (dismissed-findings
  context), after Step 6's partition (`observe --step 6`), Step 7
  (`applied`), after Step 8 (`observe --step 8 --anchor-source worktree`)
  and Step 9 (`--fix-sha`, `remote-head`, `--published-head`, `settle`).
  The procedure lives once in `references/review-pr/ledger.md`; both
  commands read it, so keep them in parity through that file. A ledger
  error never aborts a review — it is reported in Coverage.
- `lib/stage-learning.sh tmpfile | stage <pr> <file>` — stages an unattended
  `/review:pr` run's outcome narrative (Step 9a under `--non-interactive`) in
  yellow-core's compound-staging ledger via `cs_stage_entry`, as
  `review-pr-<owner>-<repo>-<pr>` (hashed when outside the promoter's
  64-character alphanumeric/underscore/hyphen contract) under the main
  checkout's project slug, for
  the drain to score and promote at a later session start. It replaces the
  `knowledge-compounder` spawn, whose confirmation gate stalls unattended.
  The `stage` subcommand always exits 0 with one success or
  `learning staging skipped (<reason>)` line; `tmpfile` creates a private
  empty file that must be read before Write populates it. The compound-staging ledger
  (`~/.claude/projects/<slug>/compound-staging/`) and the review-findings
  ledger above are separate stores; this script never touches the latter.

### Hooks (1)

- `SessionStart` → `hooks/scripts/session-start.sh` (timeout 3 s, declared in
  `catalog/plugins/yellow-review.json`, emitted by `pnpm generate:manifests`).
  Sums the review ledger's `<pr>.pending` sidecars for PRs whose
  `<pr>.state` is OPEN and under 7 days old. It names the other PRs as
  unverified, folds a sidecar whose byte count no longer matches (1.5 s total
  budget), and reports a PR as "pending unknown" when its lock is busy,
  its fold would overrun the budget, or the overall 2.3 s deadline passes
  before the hook reaches it. It
  prints `systemMessage` plus a factual `additionalContext` only when
  something is pending, needs attention, or is unverified or unknown. Each
  category names at most 10 PRs, then `+N more`; past its 2.3 s deadline
  the hook only counts the remaining ledgers as unknown (no per-file clock
  reads, locks or folds).
  Integers and PR numbers only; never ledger text. Always
  `{"continue": true}`, no `set -e`.

## When to Use What

- **`/review:setup`** — First install, after auth issues, or when review
  commands fail before agent analysis begins.
- **`/review:pr`** — Review a single PR with adaptive agent selection. Best for
  focused reviews of individual changes.
- **`/review:resolve`** — Address pending review comments on a single PR. Run
  after receiving feedback: it fixes, replies, resolves, files follow-up
  issues for out-of-scope threads, and lists what still blocks merge. Keeps
  all of its gates for interactive use.
- **`/review:resolve-stack`** — Resolve comments across an entire Graphite
  stack in one unattended pass. Walks base → tip, runs `/review:resolve` per PR
  with gates suppressed, pushes and restacks autonomously. Best when you have
  review feedback spread across a multi-PR stack and want it all cleared
  without per-PR prompts. Distinct from `/review:all scope=stack` (which runs
  the full review + resolve pipeline per PR) — `resolve-stack` is resolve-only.
- **`/review:all scope=stack`** — Review entire Graphite stack in dependency
  order (base → tip). Best before submitting a stack for review.
- **`/review:all scope=all`** — Batch-review all your open non-draft PRs. Best
  for catching up on review backlog.
- **`/review:sweep`** — Run `/review:pr --non-interactive` then
  `/review:resolve --non-interactive` sequentially on a single PR with no
  gates anywhere. Best when you want both an AI review pass and cleanup of
  any open bot/human comment threads in one fire-and-forget invocation.
- **`/review:sweep-all`** — Loop `/review:sweep` over every open non-draft
  PR you authored, sequentially. One upfront M3 confirmation shows the PR
  list; after Proceed, runs unattended end-to-end. Skip-and-continue on
  per-PR failure and a summary table; each unattended `/review:pr`
  stages its learnings for the compound-staging drain. Best for clearing review + resolve backlog
  across multiple open PRs at once, and the re-entry sweeper for reviewer
  replies and late bot comments that arrive after a `/review:resolve` run.
  Distinct from `/review:all scope=all` (which runs the deeper review
  pipeline per PR with per-PR push gates) — `sweep-all` is the lighter,
  fully-unattended batch alternative.
- **`/review:triage`** — Work down the residual findings a review persisted
  but did not apply: after a sweep, or when the session-start notice
  reports pending findings. Distinct from `/review:resolve`, which only
  handles GitHub review threads and never reads the ledger.
- **`/flow:review`** (yellow-core) — Session-level review against a plan
  file. Evaluates plan adherence, cross-PR coherence, and scope drift.
  Complementary to `/review:pr` (per-PR code quality) — use both for full
  coverage.

## Cross-Plugin Agent References

When conditions warrant, commands spawn these agents via Agent tool (using
the three-segment `yellow-core:<dir>:<name>` subagent_type — e.g.
`yellow-core:review:security-reviewer`). The Wave 2 pipeline dispatches the
calibrated reviewer variants; the legacy fallback (`review_pipeline:
legacy` in `yellow-plugins.local.md`) keeps the deeper-audit variants.

- `security-reviewer` — for auth, crypto, and shell-script changes (Wave 2
  default; the deeper-audit `security-sentinel` is the legacy fallback)
- `architecture-strategist` — for large (10+ file) cross-module changes
- `performance-reviewer` — for query-heavy or high-line-count PRs (Wave 2
  default; the deeper-audit `performance-oracle` is the legacy fallback)
- `pattern-recognition-specialist` — for new pattern introductions and
  plugin authoring convention checks
- `code-simplicity-reviewer` — additional simplification pass for large PRs

Optional supplementary agent via Agent tool (using the three-segment
`yellow-codex:review:codex-reviewer` subagent_type):

- `codex-reviewer` — parallel review when yellow-codex is installed AND
  diff > 100 lines. Tags findings with `[codex]`. Silently skipped when
  yellow-codex is not installed.

yellow-review requires yellow-core for full review coverage. Without it,
cross-plugin agents (security-reviewer / security-sentinel,
architecture-strategist, performance-reviewer / performance-oracle,
pattern-recognition-specialist, code-simplicity-reviewer) silently
degrade — only yellow-review's own agents run.

### Prompt cache TTL

Five always-run `/review:pr` agents set `experimental.cacheTtl: 1h` in
frontmatter (nested under `experimental:`): the four always-selected
reviewers (`project-compliance-reviewer`, `correctness-reviewer`,
`maintainability-reviewer`, `project-standards-reviewer`) and the final-pass
`code-simplifier`. Conditional personas are intentionally omitted — they
dispatch too rarely for a longer TTL to matter.

Claude Code 2.1.259+ honors `5m` or `1h` on subagent files only, and only
when no `subagentPromptCacheTtl` setting or environment variable is set (that
setting overrides the frontmatter for every subagent — the opt-out). A `1h`
cache write bills at about 2x base input versus 1.25x for `5m`, so the
setting pays off only when a second review runs within the hour. While a
subscription is drawing on usage credits the setting may be ignored. Verify
with `cache_read_input_tokens` in the transcript (Ctrl-O) on a second
`/review:pr` run within the hour.

### MCP Tool Integration

- **yellow-linear** (optional) — `/review:resolve` files out-of-scope follow-up
  issues through yellow-linear's `save_issue`, `list_issues` and `list_teams`
  when ToolSearch finds `save_issue` and the branch name carries a Linear
  issue ID; the issue holds a generated title, the resolver's `oos_reason`, a
  thread link and a dedupe marker, never the reviewer's comment text.
  Otherwise, or when Linear fails, it files once on GitHub (the Resolve report
  names the tracker, e.g. `tracker=github (linear unavailable)`).

- **ruvector** — Recall past learnings at workflow start; tiered remember at
  workflow end (Auto for P0/P1 findings, Prompted for P2). Graceful skip if
  yellow-ruvector not installed.
- **morph** — Preferred for intent-based code search (blast radius, callers,
  similar patterns) in review agents. Discovered via ToolSearch at runtime;
  falls back to built-in Grep silently.
- **ast-grep** (yellow-research) — Optional structural code search for
  silent-failure-hunter and type-design-analyzer. Discovered via ToolSearch at
  runtime; falls back to Grep if yellow-research not installed.

## Codex and Cursor Distribution

`targets.codex.enabled: true` and `targets.cursor.enabled: true` in
`catalog/plugins/yellow-review.json`, each with a `skillAllowlist` of exactly
one entry: `yellow-thermonuclear-review`. Every command, agent, and other skill
in this plugin stays Claude-only, including the SessionStart hook
(`targets.codex.includeHooks: false`; the generator has no Cursor hook path).
See
[`docs/codex-distribution.md`](../../docs/codex-distribution.md) and
[`docs/cursor-distribution.md`](../../docs/cursor-distribution.md).

Generated artifacts (`pnpm generate:manifests`; checked by
`pnpm validate:generated`): `.codex-plugin/plugin.json`,
`.cursor-plugin/plugin.json`, `codex/skills/yellow-thermonuclear-review/SKILL.md`,
`cursor/skills/yellow-thermonuclear-review/SKILL.md`, plus the root
`.agents/plugins/marketplace.json` and `.cursor-plugin/marketplace.json`
entries. The host copies carry the canonical skill body byte-for-byte with
frontmatter normalised to `name` + `description`; edit
`skills/yellow-thermonuclear-review/SKILL.md` and regenerate, never the
copies. Because neither host applies the agent's `tools:` restriction or
`user-invocable: false`, the rails, the input contract, and the
explicit-invocation wording live in the skill body and description.

## Testing

`bats tests/` from the plugin directory:

- `get-pr-comments.bats`, `get-pr-blockers.bats`, `reply-pr-thread.bats`,
  `resolve-pr-thread.bats`, `file-followup-issue.bats`,
  `check-resolve-text.bats`, `pr-changed-ranges.bats`,
  `poll-new-threads.bats` — GraphQL fixtures in `tests/fixtures/`, fake
  `gh` in `tests/mocks/gh`
- `commit-resolve-fixes.bats`, `run-verify-command.bats` — a throwaway
  repository with a bare origin and stub `gt`/`node`/`gh`, built by
  `tests/helpers/resolve-repo.bash`
- `resolve-paths.bats` — unit tests for `lib/resolve-paths.sh`
- `file-line-counts.bats` — pins the thermonuclear line-count invariant
  alongside `skills/pr-review-workflow/scripts/file-line-counts`
- `review-ledger.bats` — throwaway repositories with a bare origin, built by
  `tests/helpers/ledger-repo.bash`; the two universal-ctags cases (CLAUDE-49)
  skip locally when ctags is absent and fail when `CI` is set, because CI
  installs ctags in `yellow-review-shell-tests`
- `session-start.bats` — the hook's counts, orphan and stale-state handling,
  fold fallback, held-lock and 5 MB budget
- `skill-content.bats` — pins load-bearing command and skill text

## Known Limitations

- GraphQL scripts require `gh` and `jq` to be installed
- Cross-plugin agents require the `yellow-core` plugin to be installed
- Very large PRs (1000+ lines) may cause agent context overflow — consider
  splitting
- Draft PRs are excluded from `/review:all scope=all` by default
- `gt track` may fail on non-Graphite PRs — falls back to raw git (degraded
  mode)
