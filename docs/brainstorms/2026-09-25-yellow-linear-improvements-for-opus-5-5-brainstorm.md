# yellow-linear Improvements for Opus 5.5 — Brainstorm

**Date:** 2026-09-25
**Status:** Brainstorm — ready for `/flow:plan`
**Approach chosen:** A — Local loop + native handoff (phased P0 → P1 → P2)
**Research:** [docs/research/linear-capabilities-for-claude-code-2026.md](../research/linear-capabilities-for-claude-code-2026.md)

## What We're Building

A phased upgrade of `plugins/yellow-linear` (currently v2.0.3, 9 commands,
3 agents, 1 skill, 17 of Linear's MCP tools in use). By late 2026 Linear
covers triage, delegation to coding agents, cloud coding sessions, code review
(Diffs) and releases on its own. The plugin's value that Linear can't
replicate is the **local loop**: your checkout, the stacked-PR provider,
yellow-core's plan/work/review flow, and the two-tier write-safety model. The
upgrade makes that loop sharper for long-running Opus 5.5 sessions and defers
to Linear where Linear's own feature is stronger.

User constraints from the dialogue:

- Scope: all three areas (work loop, agent platform, PM), ranked by impact.
- Repo setup: a **committed per-repo config file**, written by `/linear:setup`.
- Write-back: **summaries at milestones** (plan summary when work starts,
  wrap-up when the PR opens) with no per-post prompt only when the committed
  repo policy allows them **and** the current user has opted in locally;
  sub-issues, new issues and anything else still ask first.
- Workspace: **solo / mostly solo**. Keep triage and cycle features light; no
  multi-team, SLA or customer-request investment.

### Review findings on the current plugin (inputs to P0)

1. **Team detection is brittle.** It assumes Linear team name == GitHub repo
   name (case-sensitive exact match) and asks on every mismatch. No per-repo
   config exists.
2. **Branch ID regex misses Linear's own branch names.** Its pattern is
   `[A-Z]{2,5}-[0-9]{1,6}` and it is case-sensitive. Linear's `gitBranchName`
   (what Cmd/Ctrl+Shift+. copies) is lowercase, e.g. `user/eng-123-title`.
   The plugin also builds its own branch format instead of reading the
   issue's `gitBranchName`.
3. **Some checks hardcode status names, against the plugin's own rule.**
   `work.md` Step 2 checks for "Done/Cancelled/In Review" by name. `status.md`
   counts a "Blocked" status, but Linear has no blocked state type; blocking
   comes from issue relations.
4. **Setup is out of date.** `/linear:setup` only checks for `gt`, not the
   active stack provider (`/stack:status`). The README still lists Graphite as
   a prerequisite and describes `/linear:delegate` as "Devin" only.
5. **Stale MCP usage.** Since 2026-05-14 the MCP server rejects unknown tool
   parameters. Every parameter name in the prompts needs checking against the
   live schema: `save_issue` merged create/update and now takes `delegate`,
   `template`, `patch` and relations. `list_issues` supports `fields`,
   `customView`, `limit` up to 250 and relative dates.
6. **`delegate.md` is 667 lines**, over the 500-line RULE 21 ceiling. It
   calls the Cursor CLI and the Devin REST API directly, which Linear's native
   delegation now covers.
7. **Test coverage is thin.** The only bats suite is `delegate.bats`. Nothing
   tests issue-ID extraction or config parsing.
8. **Headless auth isn't documented.** The README says OAuth needs a browser.
   Linear now accepts `Authorization: Bearer <api key>` and has a
   `/mcp/readonly` endpoint, both relevant to cloud/remote Claude Code sessions.
9. **Remote content persisted without credential redaction.** `/linear:work`
   writes issue descriptions and comments into `docs/brainstorms/` with fencing
   only. Fencing changes model interpretation, not stored bytes — credential
   detection and `--- redacted credential at line N ---` replacement must run
   before any remote content is written to the worktree (AGENTS.md).

## Why This Approach

- **B (register Claude Code as a Linear agent app)** was rejected. It needs a
  hosted webhook service with Linear's timing rules (first activity within 10s,
  webhook response within 5s). Linear's own coding sessions already run Claude
  Code in its cloud. That's too much to operate for a solo workspace.
- **C (thin skills over the official `linear@claude-plugins-official`
  plugin)** was rejected because it drops the stack-provider, review-agent and
  safety-model integration that sets this plugin apart.
- **A** keeps the local integration, fixes correctness first, and hands off to
  Linear features (native delegation, Triage Intelligence, templates, Diffs,
  release pipelines) rather than re-implementing them.

## Key Decisions

### P0 — Foundations (correctness + repo setup)

- **Per-repo config** `.yellow-linear.json` at the repo root, committed.
  It sits outside `.claude/` because many repos (this one included) gitignore
  `.claude/`, which would make the config vanish on fresh clones. Proposed
  fields: `team` (key), `defaultProject`, `defaultLabels`, `branchFormat`
  (`linear` = use the issue's `gitBranchName`, or a custom template),
  `writeBack` (`milestones` | `minimal` — **repo policy only**, whether
  milestone summaries are permitted in this repository), `readOnlyAgents`
  (bool). Every command reads it first. Without it, commands fall back to
  today's repo-name matching and suggest running `/linear:setup`.
- **`/linear:setup` becomes the repo setup wizard.** It checks MCP visibility
  and auth (OAuth or bearer API key), resolves the stack provider through
  `/stack:status` instead of probing `gt`, lets you pick the team and project,
  writes the committed config, records **per-user** milestone-summary consent
  outside the repo (in the user's Claude config dir, keyed by repo identity),
  and can add a short "Linear conventions" block to the repo's CLAUDE.md.
  That block fills the gap left by agent guidance, which the MCP server doesn't
  expose.
- **Issue-ID extraction** matches team keys case-insensitively and normalizes
  to uppercase before `get_issue`; the C1 validation is unchanged. It should
  also accept the configured team key.
- **Checks use state `type` instead of names** everywhere. "Blocked" is read
  from issue relations.
- **Check every MCP parameter** in commands and agents against the live schema,
  and add a validator or bats test that pins the tool names the plugin uses.
- **README and CLAUDE.md cleanup.** Provider-neutral prerequisites, correct
  delegate description, and headless auth documented.
- **Credential redaction before persisting remote content.** Run credential
  detection over every fetched issue, comment, attachment, and linked document
  before writing the context packet or any other worktree file. Replace hits
  with `--- redacted credential at line N ---` per AGENTS.md.
- **Fence markers can't be forged.** Redaction doesn't catch a Linear field
  that contains its own `--- end ... ---` line, which would close the fence
  early. The packet is later read by `/flow:plan`, which has Bash and Write.
  So each `/linear:work` run generates a random fence token
  (`--- begin linear-context-<token> ---`). Before writing, any existing
  `--- begin`/`--- end` lines in remote content are escaped, for example
  replaced with `[fenced: …]`, following the brainstorm-orchestrator
  learnings-fence pattern.

### P1 — Work loop for long Opus 5.5 sessions

- **Richer context from `/linear:work`.** It pulls parent and sub-issues,
  relations (blocks / blocked-by / duplicates), attachments and links, the
  project and milestone, linked Linear documents, and team Agent Skills
  (`list_agent_skills` / `get_agent_skill`), all fenced as untrusted. The
  brainstorm doc it writes becomes a full context packet, so a long session
  doesn't have to go back to Linear for it. Fencing only changes how the
  model reads the text; it doesn't remove anything. So before writing, run
  credential detection over every piece of remote content and replace each
  hit with `--- redacted credential at line N ---` (AGENTS.md). The packet
  lives in the worktree and can end up committed. Today's `/linear:work`
  already writes descriptions and comments without redaction, so this is a
  P0 fix too.
- **Uses the issue's branch name.** `/linear:work` reads `gitBranchName`
  (or the configured `branchFormat`) and passes it to the stack provider.
- **Milestone summaries (consented once, then automatic).** Two points,
  deduplicated like the existing PR-link comments:
  1. After `/flow:plan`, a short plan summary comment on the issue.
  2. When the PR opens (`/linear:sync --after-submit`), a wrap-up comment:
     what changed, tests, anything left open.

  These are externally visible writes, so AGENTS.md requires filtering and
  explicit user confirmation. The design meets that in three parts:
  - **Repo policy is committed; consent is per user.** `.yellow-linear.json`
    holds only whether milestone summaries are allowed (`writeBack:
    "milestones" | "minimal"`). It never records anyone's consent, because
    teammates who clone the repo or check out a branch would inherit it
    without agreeing.
  - **Automatic posts need both gates.** `/linear:setup` shows a sample
    summary and asks two questions: whether the repo should allow milestone
    summaries (writes repo policy) and whether *this user* wants them posted
    automatically (stores their "yes" outside the repo in
    `${CLAUDE_CONFIG_DIR:-~/.claude}` plugin data, keyed by repo). Summaries
    post without a per-post prompt only when the repo policy allows them
    **and** the current user has consented. Otherwise each summary is shown
    as a draft and posted only after confirmation.
  - **Content is filtered before every post.** Remove local absolute paths,
    environment values and anything matching credential patterns. Limit the
    summary to what the plan or PR already makes public.
- **PR linking through Diffs.** When Linear's Diffs are available, link with
  `get_diff` / `update_diff` (relationship `closes`/`contributes`) instead of
  a URL comment, and put the correct magic words in PR bodies (`Fixes`,
  `Implements`, `updates`). The URL comment stays as a fallback.
- **Sub-issues from a plan: ask first.** New `/linear:decompose` turns plan
  steps into sub-issues or milestones after confirmation (Tier 2).
- **SessionStart hook (optional, off by default).** On a branch that has an
  issue ID, inject a one-line issue summary. Opt-in via config so it never
  slows down unrelated sessions. The issue title and other fields are
  untrusted, and the hook injects them with no human in the loop. So the
  hook runs them through the same pipeline as the context packet before
  emitting its JSON `systemMessage`:
  1. Redact credentials.
  2. Escape fence markers.
  3. Cap the summary (ID, state type and title, at most 200 characters).
  4. Wrap it in a per-invocation fence marked reference-only.

### P2 — Native handoff and light PM

- **Delegation through Linear.** `/linear:delegate` hands off with
  `save_issue delegate=<agent>` (Cursor, Codex, Copilot, Devin, Linear
  Agent), and Linear tracks the session, plan and PR. The Cursor CLI and
  Devin REST paths remain as a fallback for workspaces without the
  integration. This change also brings the command under the 500-line
  ceiling.
- **`/linear:triage` shows Triage Intelligence.** It displays the
  `triageIntel` suggestions from `list_issues` instead of re-deriving them.
  It stays lightweight for solo use.
- **`/linear:create` uses templates** via `list_templates` +
  `save_issue template=`, with the config's default project and labels.
- **`/linear:sync-all` respects release pipelines.** If the workspace uses
  them, it doesn't mark issues Done on merge; the release automation does.
- **`/linear:status` supports custom views and milestones**, and posts
  project updates as well as initiative updates.
- **Read-only agents** (`linear-explorer`, `linear-issue-loader`) can use the
  `/mcp/readonly` endpoint when the config enables it.

### Explicitly deferred (YAGNI for a solo workspace)

- Registering Claude Code as a Linear agent app (Approach B).
- SLAs, customer requests, triage rotation, multi-team routing.
- A `/linear:review` command built on `submit_diff_review`/`merge_diff`
  (`merge_diff` is destructive). Revisit once Diffs ship dates are verified.

## Open Questions

1. Config name: a standalone `.yellow-linear.json` or a `linear:` section
   in a shared yellow config? Check whether other plugins already have a
   tracked per-repo config convention before planning. Either way it must
   live outside `.claude/`.
2. Can a single plugin declare both the full and `/mcp/readonly` MCP servers
   without a duplicate OAuth prompt? Needs a clean-install test.
3. When were the Diffs tools shipped and are they generally available?
   (Unverified in the research.) This decides whether P1 PR linking uses Diffs
   by default or only when detected.
4. Is the native `delegate` field enough for Cursor/Devin parity (repo, ref,
   model, billing display in `delegate.md` Steps 5–6), or does the fallback
   path stay primary for Cursor?
5. Where do milestone summaries hook in: yellow-core's `/flow:plan` and
   `/flow:work`, or only yellow-linear's own commands? The cross-plugin
   contract must degrade cleanly when yellow-linear isn't installed.
6. Does a one-time consent recorded per user (outside the repo) satisfy the
   AGENTS.md rule that externally visible mutations need explicit
   confirmation? Or does the safety model need an explicit new tier for
   consented automatic comments? Settle this in `/flow:plan` before
   implementation.
7. How does the P0 regex change interact with other plugins that extract
   Linear IDs from branch names (for example gt-workflow and yellow-review)?
