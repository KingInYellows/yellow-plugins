# Persisting AI Code-Review Findings Beyond the Chat Transcript (2025-2026)

**Date:** 2026-09-23 **Sources:** Parallel Task deep research (pro), Perplexity
Sonar Deep Research, Tavily research + targeted search/extract (docs.github.com,
code.claude.com, cursor.com, docs.coderabbit.ai, greptile.com, graphite.com,
developers.openai.com, docs.sourcery.ai, docs.cubic.dev, beads docs), Ceramic
lexical search (low relevance; one useful hit). EXA deep research was skipped
because it returned HTTP 410.

> [research-conductor] Source skipped: EXA deep_researcher — unavailable (HTTP
> 410 on start).

---

## TL;DR

- **Treat the transcript as a log. Keep a separate system of record for
  findings.** Every mature pipeline uses the same split. An event-sourced
  findings ledger holds **identity and history**. GitHub threads, Check Runs,
  SARIF and sticky comments are **projections** for humans. Task trackers
  (Claude Code Tasks, beads, Linear, GitHub Issues) hold **work**, not evidence.
  No vendor publishes a stable cross-tool fingerprint schema, so if you need to
  guarantee "never re-raise a dismissed finding", you have to own the
  fingerprint and disposition store yourself.
- **Where the ledger lives is a noise-versus-portability trade.** Committed
  JSONL/markdown is portable but adds PR noise and merge conflicts. Git notes
  stay out of the diff, but they are not fetched by default, not shown in the
  GitHub UI, and follow commit identity, which breaks on rebase unless
  `notes.rewriteRef` is set. `${CLAUDE_PLUGIN_DATA}`
  (`~/.claude/plugins/data/{id}/`) or `$XDG_STATE_HOME` is quiet and
  conflict-free, but machine-local. It is deleted on plugin uninstall unless
  `--keep-data` is passed, and it is currently broken or session-scoped in
  Cowork desktop.
- **On GitHub, SARIF is the only surface with built-in fingerprint lifecycle.**
  `partialFingerprints.primaryLocationLineHash` drives it: alerts auto-close on
  fix, can be dismissed with a reason, and can be reopened. Review threads have
  machine-readable `isResolved`/`isOutdated` via GraphQL and are the best place
  for human conversation. Check Runs cap annotations at 50 per request. Sticky
  comments (a hidden-marker upsert) are the conventional rollup.
- **Vendors deduplicate with heuristics plus learned suppression, not durable
  IDs.**
  - CodeRabbit: "incremental review" re-reads its own prior comments. "Full
    review" discards them.
  - Greptile: marks a comment "addressed" when a later commit touches the same
    file.
  - Bugbot: inline comments get an LLM "resolution check" on re-review. Its
    dashboard "resolved" metric is computed only at merge and is independent of
    GitHub thread resolution.
  - cubic: `resolve_threads_when_addressed`.
  - All of them learn from reactions and replies to suppress future noise.
    Community bug reports show false resolutions and stale summaries.
- **For an unattended multi-PR sweep, use Claude Code-native pieces as plumbing
  and the ledger as truth.**
  - Run headless `claude -p --output-format json --json-schema` per PR, which
    returns `structured_output`.
  - Validate the output, then append to an out-of-tree JSONL ledger keyed by
    `(repo, pr, head_sha, fingerprint)`.
  - Publish idempotently: hidden-marker sticky summary, plus reuse of existing
    threads.
  - Write non-auto-fixable items to a triage queue: GitHub Issues/Linear/beads,
    or a `CLAUDE_CODE_TASK_LIST_ID`-scoped task list.
  - Do not rely on `SessionEnd` for the only flush. Its default timeout is 1.5
    s, and plugin-hook timeouts do not raise that budget.

---

## 1. Durable findings ledgers: in-repo vs git notes vs out-of-tree state

### What a ledger record should contain

Parallel's deep research and the vendor evidence agree on the minimum record:

- stable `finding_id` and `fingerprint`
- tool/agent, rule/category, severity/priority, confidence
- repo, PR number, `base_sha`, `head_sha`
- normalized path, line range, enclosing symbol, short code excerpt
- explanation, evidence, proposed fix, and an `auto_fixable` flag
- **publication handles**: review-thread node ID, comment ID, SARIF alert
  number, check-run ID, task/issue ID
- a **disposition history** (event list)

Store immutable _observations_ (one per review run) separately from the mutable
_current state_ projection. JSONL is a better raw format than Markdown: it is
line-oriented, easy to append, and easy to query with `jq`. Markdown works well
as a generated human view.

### Option A: committed in the repo (e.g. `.review/findings.jsonl`, `docs/reviews/*.md`)

- **Pros:** travels with every clone, worktree and CI runner. Auditable and
  reviewable. Survives machine loss.
- **Cons:** every review adds diff noise to the PR under review, or needs a
  separate commit. Parallel branches or sweeps conflict on the same file.
  Findings about PR N committed on PR N's branch disappear if the PR is
  abandoned, and duplicate across stacked branches.
- **Mitigations:** one file per finding or per PR (avoids same-line conflicts),
  deterministic key ordering, a custom merge driver, or a dedicated orphan
  branch (`review-ledger`), as suggested in the beads HN thread.
- **Beads as the cautionary case study.** Early beads stored issues as
  git-tracked `.beads/issues.jsonl` with hash IDs (`bd-a1b2`) to avoid merge
  collisions. From v0.50 it moved to **Dolt**, a version-controlled SQL database
  with cell-level merge. Sync now uses `bd dolt push/pull` against
  `refs/dolt/data` on the git remote, and `.beads/issues.jsonl` is "an export
  for viewers and interchange, not the source of truth or a backup". The
  migration broke some users' JSONL-based sync. Lesson: committing a
  line-oriented file works until concurrency grows, and then you need real merge
  semantics.

### Option B: git notes (`refs/notes/*`)

- Notes attach metadata to commits without changing hashes. The default ref is
  `refs/notes/commits`. git-appraise stores reviews as line-oriented JSON under
  `refs/notes/devtools`.
- **Cons:**
  - Not pushed or fetched by default. You need an explicit
    `git push origin refs/notes/*` and a fetch refspec.
  - Not rendered in the GitHub web UI.
  - Notes are keyed to commit SHAs, so **rebase or force-push orphans them**
    unless `notes.rewriteRef` / `notes.rewrite.rebase` is configured. That
    config only works for rewrites done locally; it cannot follow a force-push
    made on another machine or by a bot.
  - Concurrent writers to one notes ref need `git notes merge`.
- **Best use:** commit-exact annotations such as "reviewed at SHA X by agent Y".
  Notes are a poor sole store for findings that must survive PR rewrites.

### Option C: out-of-tree state (`${CLAUDE_PLUGIN_DATA}`, `$XDG_STATE_HOME`, `~/.claude/...`)

- **`${CLAUDE_PLUGIN_DATA}`** resolves to `~/.claude/plugins/data/{id}/`. `{id}`
  is the plugin identifier with characters outside `[A-Za-z0-9_-]` replaced by
  `-`; for example `formatter@my-marketplace` becomes
  `formatter-my-marketplace`. It is created on first reference and survives
  plugin updates. The documented uses are dependencies, generated code and
  caches. `claude plugin uninstall --keep-data` preserves it; otherwise
  uninstall from all scopes deletes it. It is also available as a hook-script
  placeholder alongside `${CLAUDE_PLUGIN_ROOT}` and `${CLAUDE_PROJECT_DIR}`.
- **Known issues (2026):**
  - Writes to `~/.claude/plugins/data/` trigger the protected-directory
    confirmation prompt, even in bypass mode (anthropics/claude-code #41156).
    This matters for unattended runs.
  - In Cowork desktop the variable resolves to a per-conversation or VM path
    that does not persist (#51398, #38163).
- **XDG:** `$XDG_STATE_HOME` (default `~/.local/state`) is meant for state that
  persists across restarts but is "not important or portable enough" for
  `$XDG_DATA_HOME`. That is a good fit for sweep checkpoints and indexes.
- **Pros:** zero PR noise, zero merge conflicts, fast appends. One store can
  cover all worktrees on a machine, because it is keyed by repo rather than
  worktree path.
- **Cons:** machine-local. Invisible to CI runners, other machines and teammates
  unless synced or exported. Needs a retention and secrets policy.
- **Worktree portability nuance:** Claude Code's auto memory keys
  `~/.claude/projects/<project>/memory/` by git repository, so all worktrees
  share it. Transcripts, by contrast, live per project-path under
  `~/.claude/projects/<normalized-path>/<session>.jsonl`. A plugin ledger should
  key by **repo remote plus PR**, not by cwd, to get the same worktree-agnostic
  property.

### Recommendation

Use an out-of-tree append-only JSONL event log as the primary store: plugin data
or XDG state, keyed by repo slug. Periodically export it to a shared sink:
GitHub (sticky comment/issues), a beads/Dolt database, or an orphan branch.
Commit a compact manifest in-repo only when you need an audit trail.

---

## 2. Publishing findings to GitHub

| Surface                                                                                                             | Strength                                                                 | Identity and lifecycle                                                                                                                                                                                                                                                                                       | Limits and gotchas                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PR review comments / threads** (REST `pulls/{n}/comments`, reviews API; suggestions via ` ```suggestion ` blocks) | Human discussion in context; one-click suggested patches                 | Thread node has `isResolved` and `isOutdated` (GraphQL `reviewThreads`). `resolveReviewThread` / `unresolveReviewThread` mutations. Replies via `in_reply_to`.                                                                                                                                               | Anchored to diff position and commit. Goes **outdated** when the line changes, including after a rebase. A resolved thread does not mean the code was fixed. `resolveReviewThread` needs Pull requests: write (community reports also require Contents: write for fine-grained tokens).                                                               |
| **Check Runs + annotations**                                                                                        | Inline, severity-levelled (`notice`/`warning`/`failure`), can gate merge | Per head SHA; a new run per commit                                                                                                                                                                                                                                                                           | **Max 50 annotations per request** (batch with PATCH). Payload size limits. No cross-commit identity.                                                                                                                                                                                                                                                 |
| **SARIF → code scanning**                                                                                           | Only GitHub surface with built-in **fingerprint dedup and lifecycle**    | `partialFingerprints`. GitHub "only uses the `primaryLocationLineHash`". The `upload-sarif` action computes it if missing (needs source present). REST uploads without it "may see duplicate alerts". Alerts **auto-close when fixed**, can be dismissed with a reason, reopened, and tracked per branch/PR. | Use `category` / `runAutomationDetails.id` per analysis, or a later upload **replaces** the earlier one for that commit. Editing the flagged line can close the old alert and open a new one. Rename/move matching is not documented (codeql#6367). Requires GHAS on private repos. Findings appear in the Security tab rather than the conversation. |
| **Sticky summary comment**                                                                                          | Single rollup: counts, links, triage instructions                        | Upsert by hidden marker, e.g. `<!-- review-ledger:v1 -->` (marocchino/sticky-pull-request-comment: `recreate`, `hide_and_recreate`, `only_update`, `hide_classify: OUTDATED`)                                                                                                                                | A projection only. Regenerate it from the ledger. claude-code-action has an open bug: the sticky lookup reads only the first page, so PRs with >30 comments get a new comment.                                                                                                                                                                        |
| **GitHub Issue**                                                                                                    | Outlives the PR; ownership, labels, milestones                           | Embed the fingerprint in the body and search before creating                                                                                                                                                                                                                                                 | Easy to duplicate across PRs; linked issues do not auto-close when SARIF alerts do                                                                                                                                                                                                                                                                    |

**Claude Code-native publishers:**

- **anthropics `code-review` plugin**
  - Five parallel agents: CLAUDE.md compliance, bugs, git-history context, prior
    PR comments, code comments.
  - Every issue gets a 0–100 confidence score; only issues ≥80 are posted.
  - Skips closed, draft, automated and **already-reviewed** PRs.
  - Posts only with `--comment`, using
    `mcp__github_inline_comment__create_inline_comment` with `confirmed: true`,
    and full-SHA permalinks.
  - It has **no ledger**: prior PR comments are its only memory.
- **`claude-code-action`**
  - `use_sticky_comment` (historically incompatible with inline comments, #955).
  - `classify_inline_comments` (default true) **buffers inline comments that
    lack `confirmed: true` and classifies them with Haiku after the session
    ends** before posting.
  - Exposes `structured_output` when you pass a JSON schema.
  - Durability lesson from its issue tracker: "a single malformed line in the
    inline-comment buffer crashes the entire post step, losing every valid
    buffered comment". Buffers should be validated line by line and must never
    be the only copy.

---

## 3. Task trackers as sinks

- **Claude Code Tasks** (TaskCreate / TaskGet / TaskUpdate / TaskList)
  - Replaced the in-memory TodoWrite. Per ClaudeLog, Tasks were introduced in
    v2.1.16 (2026-01-22) and became the default around v2.1.19.
  - A Reddit report says Task tools replaced TodoWrite "by default" as of
    v2.1.142. Treat the exact version as unverified and detect the capability at
    runtime. `CLAUDE_CODE_ENABLE_TASKS` and `CLAUDE_CODE_ENABLE_TODO_TOOLS`
    toggle between the two.
  - Tasks persist on disk under `~/.claude/tasks/` with `subject`,
    `description`, `activeForm`, `status` (pending/in_progress/completed),
    `blocks`/`blockedBy`, and delete via TaskUpdate (v2.1.20+).
  - **`CLAUDE_CODE_TASK_LIST_ID=<name>`** makes sessions, subagents, `claude -p`
    and the Agent SDK share one named list with live updates. The official
    interactive-mode docs, as cited by Parallel, say it maps to a named
    directory under `~/.claude/tasks/`.
  - Hooks `TaskCreated` / `TaskCompleted` fire on changes and can block.
  - **Fit:** an excellent machine-local work queue for a sweep, e.g.
    `CLAUDE_CODE_TASK_LIST_ID=review-sweep-<date>`. It is still machine-local,
    has a small schema with no severity, SHA or fingerprint fields, and no UI
    dashboard, so keep the full finding in the ledger and store the `finding_id`
    in the task description.
- **beads (`bd`)**
  - Formerly steveyegge/beads, now gastownhall/beads; Dolt-backed since v0.50.
    Positioned as a "distributed graph issue tracker for AI agents".
  - Hash IDs give zero-collision creation across branches and agents.
  - Dependency graph with `bd ready` for unblocked work and atomic `--claim`.
    Link types include `discovered-from`, `duplicates`, `supersedes` and
    `relates-to`, which map directly onto finding lifecycle.
  - Semantic compaction ("memory decay") of closed issues.
  - Sync via Dolt remotes; export/sync to GitHub, Jira and Linear
    (`bd github sync --push-only`, `bd linear sync --push`).
  - An open issue (#1361) asks for native sync with Claude Code task lists via
    `CLAUDE_CODE_TASK_LIST_ID`.
  - **Fit:** the strongest _agent-native_ durable queue, with cross-machine
    sync, dedup-friendly links and JSON output. Costs: an extra toolchain
    (Dolt), migration churn (the SQLite → Dolt break), and repo metadata
    (`.beads/`).
- **Linear / GitHub Issues**
  - Hosted and shared, with ownership, custom workflow states, notifications and
    SLAs.
  - cubic auto-creates tickets in Jira, Linear, Asana and Notion and
    **auto-resolves them when the fix merges**. Sourcery has
    `@sourcery-ai create issue` from a review thread. CodeRabbit pulls
    Linear/Jira context in as a Knowledge Base input.
  - **Fit:** the human triage destination after an unattended sweep. Weak as a
    raw evidence store: diffs, SHAs and re-review history don't fit in an issue
    body, and tickets duplicate unless the fingerprint is embedded and searched.

---

## 4. Fingerprint dedup and finding lifecycle across re-reviews, rebases and force-pushes

### Lifecycle states

| State        | Meaning                                                                                                |
| ------------ | ------------------------------------------------------------------------------------------------------ |
| `open`       | Reproduced on the current head; no disposition yet                                                     |
| `fixed`      | Not reproduced by a later analysis, ideally confirmed by re-analysis rather than "file touched"        |
| `dismissed`  | Won't-fix or false positive, with actor and reason. **Suppresses re-raising while the anchored code is unchanged.** |
| `stale`      | The anchor disappeared or couldn't be matched after a rewrite. Keep for audit; don't show as active.   |
| `superseded` | Replaced by a newer finding (link both ways, as with beads `supersedes`)                               |
| `reopened`   | A fixed finding reproduced again at a new head, or a dismissed one whose anchored code changed at a new head |

GitHub code scanning is the reference implementation: fixed → auto-closed,
dismissed with a reason, reopenable, branch-specific.

### Fingerprint design

Hash this tuple:

```text
(tool, rule_id/category, normalized_path, enclosing symbol / AST context,
 normalized message template, normalized code snippet)
```

Do **not** hash line numbers or LLM prose.

After a rebase or force-push, match in this order:

1. exact fingerprint
2. same rule + symbol + fuzzy snippet
3. otherwise mark the old observation `stale`

The ledger should never key on GitHub comment IDs. Store them as publication
handles. SARIF's `primaryLocationLineHash` shows the limitation of pure
line-content hashing: editing the flagged line creates a "new" alert.

### How vendors handle "resolved" and avoid re-raising (public evidence)

| Tool                                          | Publication                                                                                                                    | "Resolved" detection                                                                                                                                                             | Avoiding re-raise / learning                                                                                                                                                                                                                                                                                                                                                    | Rebase / force-push notes                                                                                                                                         |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CodeRabbit**                                | Walkthrough/summary comment, inline threads, severity labels (critical/major/minor/trivial), findings snapshot per head commit | `@coderabbitai resolve` / `approve`; the Autofix finishing touch (Feb 2026; inline-scoped Aug 2026) acts on **unresolved CodeRabbit threads**                                    | **Incremental review** considers all its comments since the last full review and reviews only new changes. **Full review** disregards prior comments. **Learnings** from chat replies (repo/org scoped, editable). **Security Repository Learnings** suppress equivalent accepted-risk findings when behavior and scope match. `auto_pause_after_reviewed_commits` (default 5). | "A full re-review produces a new snapshot and moves the ground under" existing threads. Autofix stops on merge conflicts.                                         |
| **Cursor Bugbot**                             | Inline comments plus summary; a check whose findings default to `neutral` (opt-in fail-on-unresolved)                          | Inline comments get a **resolution check during re-review**. The dashboard "Issues resolved" is an **LLM analysis at merge time**, independent of GitHub "Resolve conversation". | **Learned rules** from reactions, replies and human reviewer comments (candidates promoted/disabled by signal; backfill), `@cursor remember`, `.cursor/BUGBOT.md`. Community request to filter previously dismissed issues answered with "add a BUGBOT.md rule". Option to run only once per PR.                                                                                | Hides outdated comments but doesn't resolve them. Bug reports: prior findings marked resolved after an unrelated commit; summary comment not updated after fixes. |
| **Greptile**                                  | Inline comments with P0/P1/P2 severity badges, summary with "Last reviewed commit" and review counter                          | Comment `addressed: true` when **a later commit modifies the relevant file** (MCP docs); `reviewAnalysis.reviewCompleteness`; comments resolve when the fix is pushed            | Memory and learning from 👍/👎 (only those two emojis train it), replies, team comments, and first-vs-last-commit addressed analysis. Suppresses categories the team ignores.                                                                                                                                                                                                   | File-touch heuristic: coarse, prone to false "addressed"                                                                                                          |
| **Graphite Agent** (Diamond renamed Oct 2025) | Inline comments with committable suggestions; status panel                                                                     | Acceptance = the suggested change was committed                                                                                                                                  | Exclusions and custom rules with per-rule acceptance and up/down-vote analytics                                                                                                                                                                                                                                                                                                 | No public doc on re-anchoring after restack/force-push (a notable gap for a stacked-PR tool)                                                                      |
| **OpenAI Codex review**                       | Standard GitHub review; **flags only P0/P1** in GitHub; `@codex review` or automatic reviews                                   | Not publicly documented                                                                                                                                                          | `AGENTS.md` `## Code Review Rules` (nearest-file scoping). The open-source review prompt emits JSON findings with `priority` 0–3 and an "overall correctness" verdict.                                                                                                                                                                                                          | Not documented                                                                                                                                                    |
| **Sourcery**                                  | PR description summary, reviewer's guide, inline comments, **`Sourcery review` status check** (can gate merge)                 | `@sourcery-ai resolve` resolves open comments; `dismiss` dismisses the status check; IDE Resolve/Unresolve                                                                       | Learns from interactions (dismissal patterns, per secondary sources), explicit review rules, per-PR re-review counter reset by `review`                                                                                                                                                                                                                                         | Not documented                                                                                                                                                    |
| **cubic**                                     | Inline comments, summary ("all issues addressed" instead of a score), Slack notice with a copyable fix prompt                  | **`reviews.resolve_threads_when_addressed: true`** in `cubic.yaml` auto-resolves threads once addressed; incremental reviews                                                     | Learns from senior devs' PR comment history; plain-English custom agents                                                                                                                                                                                                                                                                                                        | CLI `cubic review --output-format stream-json` emits NDJSON events for findings, retries, heartbeats and completion, which a sweep can ingest into a ledger       |

**Takeaway:** vendors expose outcomes (resolved, addressed, learned rule), not
durable identity. "Addressed" ranges from "file touched" (Greptile) to "LLM
judged at merge" (Bugbot). A pipeline that must guarantee no re-raise of
dismissed findings needs its own fingerprint → disposition table. Feed
dismissals back as rules (BUGBOT.md, CodeRabbit learnings, AGENTS.md review
rules, CLAUDE.md) as a second layer.

---

## 5. How fix/resolve loops consume findings

- **GitHub-thread-first loop** (what most vendors and ad-hoc agents do)
  - Steps: query GraphQL
    `pullRequest.reviewThreads { isResolved isOutdated comments {...} }`, filter
    unresolved bot threads, fix, push, then `resolveReviewThread`.
  - Vendor examples: CodeRabbit Autofix ("unresolved CodeRabbit review
    threads"), Greptile MCP (`list_merge_request_comments addressed:false`,
    `hasSuggestion`, `suggestedCode`), Greptile/Bugbot/cubic "Fix in Claude Code
    / Cursor / Codex" buttons that hand the agent file, line and suggestion
    context.
  - **Risks:** thread state is human-mutable (someone clicks Resolve without
    fixing). Outdated threads lose anchors after a force-push. Bot text isn't
    structured.
- **Ledger-first loop**
  - The agent reads `open` findings for the current head from the ledger, checks
    existing dispositions and tasks, fixes, re-runs the analyzer, then appends a
    new observation and transitions the finding (`fixed` / `reopened` /
    `stale`).
  - Deterministic and schema-stable, with no scraping. Needs reconciliation with
    GitHub.
- **Recommended hybrid**
  - The ledger is canonical for identity and history; GitHub is canonical for
    the conversation.
  - A reconcile step maps each finding to its thread IDs.
  - If a thread is resolved but the finding still reproduces, flag a conflict
    and reopen. If a thread is unresolved but the finding is gone, resolve it
    with a "fixed in `<sha>`" reply.
- **Human-approval gating**
  - Vendors gate by _mode_: Bugbot Autofix pushes to the same branch _or a new
    branch_, and an admin sets the default mode. CodeRabbit offers `autofix`
    (direct commit) vs `autofix stacked pr`. Graphite and GitHub suggestions
    need a human click. Cursor forum threads report "Bugbot auto-fixes when it
    should not", which argues for conservative defaults.
  - The `auto-apply` restrictions govern unattended runs. In attended runs, a
    human may apply any verified finding after review, regardless of
    `autofix_class`.
  - Pattern: mark each finding `auto_fixable` plus a `risk_class`. Only
    mechanical, low-risk fixes with passing tests and a clean re-review may
    auto-apply, preferably as a **stacked PR** or separate branch rather than a
    direct push.
  - Security, authorization, data-migration, public-API and ambiguous-intent
    findings produce a task plus a proposed patch and wait for approval.
  - Never treat "thread resolved" as proof of correctness.

---

## 6. Claude Code-native mechanisms

- **Hooks** (code.claude.com/docs/en/hooks)
  - **Events:** Setup, SessionStart, UserPromptSubmit, the tool loop (PreToolUse
    / PostToolUse / PostToolBatch / SubagentStart / SubagentStop / TaskCreated /
    TaskCompleted), Stop / StopFailure, TeammateIdle, PreCompact / PostCompact,
    SessionEnd, and async events such as WorktreeCreate/Remove and CwdChanged.
  - **Stop** receives `last_assistant_message`, `stop_hook_active`,
    `background_tasks` and `session_crons`. The docs say to prefer
    `last_assistant_message` over reading `transcript_path`, because the
    transcript is written asynchronously. It can return `decision:"block"` with
    a `reason` to force continuation (for example "you haven't written the
    findings file yet"). Continuation is capped after 8 consecutive blocks.
    `additionalContext` injects a system reminder.
  - **SubagentStop** adds `agent_id`, `agent_type` (matcher) and
    `agent_transcript_path`. This is the right place to validate and append each
    reviewer subagent's structured findings.
  - **PreCompact** receives `trigger` and `custom_instructions` and can block
    compaction. Use it to flush in-flight findings before context is summarized.
  - **SessionEnd** has no decision control, and its **default timeout is 1.5
    s**. The budget rises to the largest per-hook `timeout` in settings files
    (max 60 s), but **timeouts set on plugin-provided hooks don't raise the
    budget**. A plugin cannot rely on SessionEnd for a slow flush, such as a
    network publish.
  - Placeholders: `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}`,
    `${CLAUDE_PROJECT_DIR}`.
- **Plugin data dir:** see §1. Machine-local, update-surviving,
  uninstall-deleted unless `--keep-data`, with protected-directory prompt
  friction (#41156).
- **Memory**
  - CLAUDE.md / CLAUDE.local.md for instructions.
  - Auto memory at `~/.claude/projects/<repo>/memory/MEMORY.md` plus topic
    files. Only the first 200 lines / 25 KB load at start. Shared across
    worktrees of one repo. Disable with `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`.
  - Subagents support a `memory` frontmatter field for persistent agent memory.
  - Use memory for **review policy and learned dismissals** ("don't flag X in
    generated code"), never as the per-PR findings ledger.
- **Background agents / subagents**
  - Subagent frontmatter supports `background`, `isolation` (worktree) and
    `memory`.
  - Background subagents are included in the final `-p` output and can keep a
    headless run waiting.
  - With parallel reviewers, the parent must own the write protocol: each child
    writes to its own namespace, and the parent merges by fingerprint before
    publishing. This avoids duplicate comments from racing children.
- **Headless**
  - `claude -p --output-format json` returns `result`, `session_id` and
    metadata. `--output-format stream-json` (with `--verbose` and
    `--include-partial-messages`) gives progress and crash forensics.
  - **`--json-schema`** constrains output into a `structured_output` field.
    `--bare` skips auto-discovery of hooks, plugins, memory and CLAUDE.md for
    reproducible runs.
  - `--resume <session-id|transcript-path>` reattaches.
  - This is the **serialization boundary, not the persistence boundary**:
    validate the output, then write it to the ledger before any GitHub call.
- **Artifacts and transcripts**
  - Transcripts at `~/.claude/projects/<normalized-path>/<session-id>.jsonl`;
    `/export <file>` writes a text dump.
  - Useful as forensic backup keyed by `session_id`, which you should store in
    each ledger observation. Too unstructured to serve as the store itself.

---

## 7. Trade-offs for an unattended sequential multi-PR sweep

**Design goals:** restartability over conversational continuity, idempotent
sinks, and a zero-human loop that ends in a triage queue.

1. **Run record per PR**, keyed
   `(repo, pr, head_sha, reviewer_version, policy_version)`, with a phase
   checkpoint:
   `DISCOVERED → ANALYZED → LEDGER_WRITTEN → PUBLISHED → TASKS_RECONCILED → (FIX_PROPOSED | HUMAN_TRIAGE) → DONE`.
   Write the checkpoint to out-of-tree state after every phase. On restart, skip
   PRs whose `head_sha` is unchanged and whose phase is DONE. This is the same
   "skip already-reviewed" rule the code-review plugin uses, but made durable.
2. **One headless process per PR**
   (`claude -p --json-schema ... --output-format json`) instead of one long
   interactive session. This avoids compaction losing findings, gives crash
   isolation, and yields a `session_id` per PR for forensics. If one long
   session is unavoidable, use PreCompact and SubagentStop hooks to flush. Treat
   SessionEnd as best-effort only (1.5 s default; plugin timeouts don't extend
   it).
3. **Ledger before publish.** Append observations first. Publish with
   idempotency: sticky summary by hidden marker (paginate the lookup, to avoid
   the >30-comment bug), inline threads reused when the fingerprint matches,
   check-run annotations batched in groups of 50, and SARIF only if GHAS is
   available. A crash between publish and checkpoint is recovered by searching
   markers and fingerprints before creating anything.
4. **Noise budget.** Unattended sweeps amplify noise, and N PRs × M findings
   becomes notification spam. Options:
   - Post only high-confidence, high-severity inline comments (the plugin's ≥80
     threshold; Codex posts only P0/P1).
   - Put everything else in the sticky summary and the ledger.
   - Or post nothing and queue for triage ("dry-run sweep"), publishing only
     after human triage.
5. **Force-push between sweep and triage.** Re-validate against the current
   `head_sha` at triage time. Re-match fingerprints and mark `stale` rather than
   surfacing dead line numbers.
6. **Autofix policy.** Default off in unattended mode. At most, generate
   proposed patches as artifacts (in the ledger or as stacked branches/PRs)
   behind an explicit per-risk-class allowlist, with a mandatory re-review and
   tests. Graphite/CodeRabbit-style stacked PRs keep the original PR clean.
7. **Triage view.** Group by fingerprint _across PRs_, so a repo-wide defect
   appears once. For each group, show severity, confidence, first and last seen
   SHA, whether it reproduces at the current head, thread state, proposed patch,
   and task link. The natural sinks are:
   - a `CLAUDE_CODE_TASK_LIST_ID`-scoped task list (local, agent-consumable)
   - beads (agent-native, syncable)
   - GitHub Issues/Linear (team-visible)
8. **Portability.** If the sweep might run on another machine or in CI, the
   out-of-tree ledger must be exported: to an orphan branch, beads/Dolt remote,
   GitHub artifacts, or issues. Otherwise the "durable" findings die with the
   laptop.
9. **Permission friction.** Headless writes to `~/.claude/plugins/data/` may
   prompt (#41156), which blocks an unattended run. Either pre-authorize the
   path or write to `$XDG_STATE_HOME/<tool>/` through a hook or script instead
   of the model's Write tool.

---

## Comparison table: approaches to persisting findings

| Approach                                       | PR noise           | Merge-conflict risk                                            | Worktree portability           | Machine/CI portability         | Survives rebase/force-push                       | Built-in dedup/lifecycle                           | Human visibility      | Best role                                           |
| ---------------------------------------------- | ------------------ | -------------------------------------------------------------- | ------------------------------ | ------------------------------ | ------------------------------------------------ | -------------------------------------------------- | --------------------- | --------------------------------------------------- |
| Committed JSONL/MD in repo                     | High               | Medium–high (mitigate with per-file records or a merge driver) | High                           | High                           | Yes if keyed by fingerprint                      | None (DIY)                                         | Medium (diff)         | Audit manifest; shared ledger for small teams       |
| Orphan ledger branch                           | None in PR         | Low (single writer)                                            | High                           | High (push/fetch)              | Yes                                              | DIY                                                | Low                   | Portable ledger without PR noise                    |
| Git notes                                      | None               | Low (needs `git notes merge` for concurrency)                  | High (same repo)               | Low–medium (explicit refspecs) | **No** unless `notes.rewriteRef` + local rewrite | DIY                                                | None in GitHub UI     | Commit-exact "reviewed-at" stamps                   |
| `${CLAUDE_PLUGIN_DATA}` / XDG state            | None               | None                                                           | High if keyed by repo, not cwd | **Low**                        | Yes (fingerprint-keyed)                          | DIY                                                | None                  | Primary event log and checkpoints for a local sweep |
| Claude Code Tasks (`CLAUDE_CODE_TASK_LIST_ID`) | None               | None                                                           | High                           | Low (local `~/.claude/tasks`)  | N/A                                              | Status only                                        | Low (terminal)        | Agent work queue during and after a sweep           |
| beads / Dolt                                   | `.beads/` metadata | Low (hash IDs, cell-level merge)                               | High                           | High (Dolt remote)             | Yes                                              | Links: duplicates / supersedes / discovered-from   | Medium (CLI; exports) | Agent-native durable triage queue                   |
| PR review threads                              | High               | N/A                                                            | High                           | High                           | Anchors go outdated                              | `isResolved` / `isOutdated` only                   | High                  | Actionable human conversation                       |
| Check Run annotations                          | Medium             | N/A                                                            | High                           | High                           | Per-SHA only                                     | None                                               | Medium                | Per-commit inline status and merge gate             |
| SARIF / code scanning                          | Low (Security tab) | N/A                                                            | High                           | High                           | Mostly (line-hash caveats)                       | **Yes**: fingerprints, auto-close, dismiss, reopen | Medium                | Machine-tracked findings with lifecycle             |
| Sticky summary comment                         | Low (one comment)  | N/A                                                            | High                           | High                           | Regenerated                                      | None (projection)                                  | High                  | PR-level rollup and triage instructions             |
| GitHub Issues / Linear                         | None in PR         | N/A                                                            | High                           | High                           | Yes                                              | Workflow states                                    | High                  | Team triage and ownership                           |
| Transcript JSONL                               | None               | None                                                           | Per path                       | Low                            | N/A                                              | None                                               | None                  | Forensics only                                      |

---

## Sources

### Claude Code (official)

- [Plugins reference](https://code.claude.com/docs/en/plugins-reference):
  `${CLAUDE_PLUGIN_DATA}` → `~/.claude/plugins/data/{id}/`, id sanitization,
  survives updates, `uninstall --keep-data`
- [Hooks reference](https://code.claude.com/docs/en/hooks): event lifecycle,
  Stop/SubagentStop fields, PreCompact, SessionEnd 1.5 s default timeout and the
  plugin-timeout caveat
- [Run Claude Code programmatically (headless)](https://code.claude.com/docs/en/headless):
  `-p`, `--output-format json|stream-json`, `--json-schema` →
  `structured_output`, `--bare`
- [Memory](https://code.claude.com/docs/en/memory): CLAUDE.md, auto memory
  location, 200-line/25 KB load, worktree sharing
- [Subagents](https://code.claude.com/docs/en/sub-agents): frontmatter incl.
  `memory`, `background`, `isolation`
- [Interactive mode](https://code.claude.com/docs/en/interactive-mode): Tasks
  and `CLAUDE_CODE_TASK_LIST_ID` (as cited by Parallel)
- [anthropics/claude-code code-review plugin README](https://github.com/anthropics/claude-code/blob/main/plugins/code-review/README.md)
  and
  [command](https://github.com/anthropics/claude-code/blob/main/plugins/code-review/commands/code-review.md):
  5 agents, confidence ≥80, skip already-reviewed, `--comment`,
  `confirmed: true`
- [Code Review plugin page](https://claude.com/plugins/code-review)
- [claude-code-action usage](https://github.com/anthropics/claude-code-action/blob/main/docs/usage.md):
  `use_sticky_comment`, `classify_inline_comments`, `structured_output`
- [claude-code-action issues](https://github.com/anthropics/claude-code-action/issues):
  sticky lookup >30 comments bug; buffer crash loses all comments;
  [#955](https://github.com/anthropics/claude-code-action/issues/955) sticky vs
  inline; [#419](https://github.com/anthropics/claude-code-action/issues/419)
  sticky for review mode with force-push/stacks
- [anthropics/claude-code #41156](https://github.com/anthropics/claude-code/issues/41156):
  protected-dir prompt on plugin data;
  [#51398](https://github.com/anthropics/claude-code/issues/51398) and
  [#38163](https://github.com/anthropics/claude-code/issues/38163): Cowork
  non-persistent `CLAUDE_PLUGIN_DATA`
- [ClaudeLog: What are Tasks](https://www.claudelog.com/faqs/what-are-tasks-in-claude-code)
  (secondary): v2.1.16 intro, `~/.claude/tasks`, `CLAUDE_CODE_TASK_LIST_ID`
  across `-p`/SDK
- [claude-code-ultimate-guide task-management](https://github.com/FlorianBruniaux/claude-code-ultimate-guide/blob/main/guide/workflows/task-management.md)
  (secondary): TodoWrite vs Tasks, `CLAUDE_CODE_ENABLE_TASKS`
- [r/ClaudeCode TodoWrite replacement](https://www.reddit.com/r/ClaudeCode/comments/1uy3d4p/todowrite_replacement)
  (unverified version claim v2.1.142)

### GitHub

- [SARIF support for code scanning](https://docs.github.com/en/code-security/reference/code-scanning/sarif-files/sarif-support):
  `partialFingerprints`, only `primaryLocationLineHash` used, duplicates without
  fingerprints
- [Upload a SARIF file](https://docs.github.com/en/code-security/how-tos/find-and-fix-code-vulnerabilities/integrate-with-existing-tools/upload-sarif-file):
  category/runAutomationDetails replacement semantics
- [Resolving code scanning alerts](https://docs.github.com/en/code-security/how-tos/manage-security-alerts/manage-code-scanning-alerts/resolve-alerts)
  and
  [Code scanning alerts concepts](https://docs.github.com/en/code-security/concepts/code-scanning/code-scanning-alerts):
  auto-close, dismiss, reopen, branch status
- [REST code scanning](https://docs.github.com/en/rest/code-scanning/code-scanning):
  update alert state and dismissal reason
- [github/codeql#6367](https://github.com/github/codeql/issues/6367):
  `primaryLocationLineHash` derivation undocumented
- [advanced-security/dismiss-alerts](https://github.com/advanced-security/dismiss-alerts):
  line edit → new alert
- [Check runs REST](https://docs.github.com/rest/checks/runs) and
  [Checks guide](https://docs.github.com/rest/guides/using-the-rest-api-to-interact-with-checks):
  50 annotations per request, levels
- [PR review comments REST](https://docs.github.com/rest/pulls/comments) and
  [reviews REST](https://docs.github.com/rest/pulls/reviews)
- [GraphQL pulls reference](https://docs.github.com/en/graphql/reference/pulls):
  `reviewThreads`, `isResolved`, `isOutdated`, `resolveReviewThread`,
  `unresolveReviewThread`
- [Community discussion on resolveReviewThread permissions](https://github.com/orgs/community/discussions/204269)
- [marocchino/sticky-pull-request-comment](https://github.com/marocchino/sticky-pull-request-comment)
- [reviewdog#568](https://github.com/reviewdog/reviewdog/issues/568):
  outdated-comment semantics

### Git / state conventions

- [git-notes documentation](https://git-scm.com/docs/git-notes):
  `refs/notes/commits`, `notes.rewriteRef`, `git notes merge`
- [Ken Muse: storing data in git notes](https://kenmuse.com/blog/storing-data-in-git-objects-with-notes)
- [google/git-appraise](https://github.com/google/git-appraise): reviews in
  `refs/notes/devtools`
- [XDG Base Directory Specification](https://specifications.freedesktop.org/basedir/latest/):
  `$XDG_STATE_HOME`

### Task trackers

- [beads (pkg.go.dev README)](https://pkg.go.dev/github.com/steveyegge/beads):
  Dolt backend, hash IDs, `refs/dolt/data`, JSONL is export-only
- [Beads FAQ](https://beads.gascity.com/reference/faq): hash-ID rationale,
  `--claim`, `discovered-from`, GitHub/Jira/Linear push
- [gastownhall/beads](https://github.com/gastownhall/beads) and
  [#1361](https://github.com/gastownhall/beads/issues/1361): Claude Code
  task-list sync request
- [HN: Beads](https://news.ycombinator.com/item?id=46075616): orphan-branch idea
  for ledger noise
- [Tiby Verse: I built a distributed issue tracker I didn't need](https://www.tibyverse.xyz/articles/i-built-a-distributed-issue-tracker-i-didnt-need):
  SQLite → Dolt migration breakage
- [Linear: issue status/workflows](https://linear.app/docs/configuring-workflows)

### Vendors

- CodeRabbit:
  - [review commands](https://docs.coderabbit.ai/reference/review-commands):
    autofix scope, resolve, approve
  - [commands guide](https://docs.coderabbit.ai/guides/commands): incremental vs
    full review semantics
  - [auto-review config](https://docs.coderabbit.ai/configuration/auto-review):
    `auto_incremental_review`, `auto_pause_after_reviewed_commits`
  - [glossary](https://docs.coderabbit.ai/reference/glossary): incremental
    review, learnings, Security Repository Learnings
  - [learnings](https://docs.coderabbit.ai/knowledge-base/learnings)
  - [findings](https://docs.coderabbit.ai/change-stack/findings): snapshot per
    head commit, hide resolved/outdated
  - [changelog](https://docs.coderabbit.ai/changelog): Autofix Feb 26 2026,
    scope change Aug 25 2026
- Cursor Bugbot:
  - [docs](https://cursor.com/docs/bugbot): learned rules, `@cursor remember`,
    Autofix, neutral check, run-once option
  - [learned rules blog](https://cursor.com/blog/bugbot-learning)
  - [Autofix blog](https://cursor.com/blog/bugbot-autofix)
  - forum:
    [issues resolved metric](https://forum.cursor.com/t/bugbot-issues-resolved/155436),
    [summary not updated](https://forum.cursor.com/t/bugbot-summary-comment-not-updated-after-fixes-are-pushed/154935),
    [false resolution after unrelated commit](https://forum.cursor.com/t/bugbot-appears-to-resolve-prior-inline-findings-after-an-unrelated-commit/154401),
    [filter dismissed issues request](https://forum.cursor.com/t/bugbot-should-filter-out-previously-resolved-dismissed-issues/147748),
    [outdated comments hidden not resolved](https://forum.cursor.com/t/bugbot-comments-are-hidden-but-not-resolved-when-outdated/138708),
    [resolve outdated comments discussion](https://forum.cursor.com/t/bugbot-should-resolve-outdated-comments/134050)
- Greptile:
  - [MCP auto-fix workflow](https://www.greptile.com/docs/mcp-v2/auto-fix):
    `addressed` = later commit touching the file; comment fields
  - [memory and learning](https://www.greptile.com/docs/how-greptile-works/memory-and-learning)
  - [nitpicks](https://www.greptile.com/docs/how-greptile-works/nitpicks)
  - [training](https://www.greptile.com/docs/code-review/training-the-learning-system)
  - [key features](https://www.greptile.com/docs/code-review/key-features)
  - [changelog](https://www.greptile.com/changelog): severity badges, review
    footer, v4
- Graphite:
  - [AI review customization](https://graphite.com/docs/ai-review-customization):
    exclusions and rules metrics
  - [review comments](https://graphite.com/docs/ai-review-comments)
  - [Graphite Agent launch](https://graphite.com/blog/introducing-graphite-agent-and-pricing):
    Diamond renamed Oct 2025
  - [Braintrust case study](https://www.braintrust.dev/customers/graphite):
    acceptance measured by commits
- OpenAI Codex:
  - [Codex code review in GitHub](https://developers.openai.com/codex/third-party/github):
    `@codex review`, automatic reviews, P0/P1 only
  - [Custom code review rules](https://developers.openai.com/blog/custom-code-review-rules-for-codex):
    AGENTS.md
  - [review prompt gist](https://gist.github.com/cbh123/ce4893a10ed2b87a89d9114b08118a08):
    JSON findings with priority
- Sourcery:
  - [commands](https://docs.sourcery.ai/Code-Review/Code-Reviews-on-Pull-Requests/Interacting-with-Sourcery):
    resolve, dismiss, create issue
  - [code reviews overview](https://docs.sourcery.ai/Code-Review/Overview):
    status check
  - [IDE reviews](https://docs.sourcery.ai/Code-Review/Code-Reviews-in-IDE/Overview)
  - [DEV Community article](https://dev.to/rahulxsingh/sourcery-github-integration-pr-review-setup-ej)
    (secondary): learns from dismissals
- cubic:
  - [changelog](https://docs.cubic.dev/changelog/changelog.md):
    `resolve_threads_when_addressed`, incremental reviews, CLI `stream-json`
    NDJSON, Slack
  - [cubic.dev](https://www.cubic.dev): background agents, tickets auto-resolved
    on merge
  - [cubic blog](https://www.cubic.dev/blog/who-offers-an-ai-native-code-review-platform-that-reduces-back-and-forth-clarification-comments):
    Jira/Linear/Asana/Notion ticketing

### Skipped

- EXA deep researcher: skipped (unavailable, HTTP 410)

## Addendum: GitHits open-source code evidence

- EveryInc/compound-engineering-plugin: yellow-review's upstream (locked SHA
  e5b397c9). Historical: ce:review wrote durable todos/ items for unresolved
  actionable findings; resolve_todo_parallel consumed them (file-todos skill,
  now legacy). Separates ephemeral run reports
  (`.context/compound-engineering/<skill>/<run-id>/`) from durable todos/.
  Current: per-run review.json/report.md + stages.jsonl + metadata.json under a
  run dir; skills/ce-code-review/references/findings-schema.json ~= our
  compact-return schema (+ evidence, validation_status/validation_reason).
  scripts/findings-mechanics.py: fingerprint=(file.lower, line, normalized
  title); conservative merge; 50->75->100 agreement promotion.
- usestrix/strix strix/report/sarif.py: SARIF 2.1.0;
  partialFingerprints.primaryLocationLineHash from deterministic primitives only
  (rule_id, uri:startLine, endpoint), never LLM title; \_class_fingerprint
  (rule + closed-vocab class) so dismissals survive renames; locationless
  findings get synthetic anchor.
- steveyegge/beads: convention "file follow-up work as beads issues, not hidden
  notes"; bd create + dep add --type discovered-from; bd prime injects context
  at session start.
- Claude Code hooks pattern (synthesized, not single canonical repo):
  Stop/SubagentStop -> append JSONL to ${CLAUDE_PLUGIN_DATA}/state/\*.jsonl
  mode 0600. No real plugin found persisting review findings this way.
