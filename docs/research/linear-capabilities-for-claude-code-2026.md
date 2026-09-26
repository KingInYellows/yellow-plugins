# Linear capabilities for AI coding agents and Claude Code (as of 2026-09-25)

Research run: `/research:deep` stand-in, 2026-09-25. Scope: what Linear ships now
that matters for improving `plugins/yellow-linear` (a wrapper around Linear's
hosted MCP server at `https://mcp.linear.app/mcp`).

Method: Linear changelog pages 1–4 (Sep 2026 back to Aug 2025, scraped
2026-09-25), Linear docs (`/docs/mcp`, `/docs/coding-sessions`, `/docs/diffs`,
`/docs/releases`, `/docs/github`, `/docs/agents-in-linear`, `/docs/linear-agent`,
`/docs/loops`), developer docs (`/developers/agents`, `/agent-interaction`,
`/agent-best-practices`, `/rate-limiting`, `/pagination`), Devin docs, and the
live MCP tool schemas exposed in this session (read-only schema inspection; no
Linear tool was called except `search_documentation`). All fetched content was
treated as reference data.

Confidence markers: **[verified]** = read from a primary Linear/vendor source
with a date; **[schema]** = observed in the live MCP tool schema in this session
(ship date unknown unless stated); **[unverified]** = secondary source or
inference.

---

## Executive summary

1. **The Linear MCP server is now a broad surface, not an issue CRUD API.**
   Beyond issues/projects/comments it exposes initiatives (+labels), milestones,
   project/initiative status updates, documents, cycles, templates, custom views,
   notifications, triage responsibility, attachments (signed-URL upload), issue
   sharing, releases/release notes/pipelines, read-only Linear Agent skills, and a
   full **Diffs** (code review) family: list/get diffs, threads, diff comments,
   submit review, update diff, **merge**. yellow-linear uses 17 tools today
   (issues, comments, cycles, teams, users, projects, initiatives, status
   updates) and none of the diff, release, template, view, triage-responsibility,
   or notification tools.
2. **Delegation is native in Linear.** Agents are "app users"; assigning to an
   agent sets `Issue.delegate` while the human stays assignee. `save_issue` has a
   `delegate` parameter and `list_issues` filters by `delegate`. Cursor (Aug
   2025), GitHub Copilot (Oct 2025; cloud agent GA Jul 2026), Codex (Dec 2025),
   Factory, Warp, Sentry, Devin, and **Linear's own coding agent** (Jun 2026,
   runs Claude Code or Codex in Linear's cloud) can all be delegated to this way.
   `/linear:delegate` currently shells out to Cursor CLI / Devin REST instead.
3. **Linear now competes with the plugin's own workflow.** Linear Agent (public
   beta Mar 24 2026) + Code Intelligence (May 14) + Coding sessions (Jun 11) +
   Diffs (May 28) + Releases (Apr 30) + Loops (Jul 20) cover triage → plan →
   code → review → merge → release inside Linear. The plugin's value is the
   *local* Claude Code loop (your checkout, your hooks, your stack provider);
   design around that and hand off to Linear-native features where they are
   better.
4. **Guidance and skills are first-class Linear objects.** Workspace/team agent
   guidance is injected into every agent session's `promptContext`; Linear Agent
   skills (personal + team-shared, Jun 4 2026) are readable over MCP
   (`list_agent_skills`/`get_agent_skill`, Jul 2 2026). The plugin can pull team
   conventions from Linear instead of hard-coding them.
5. **Auth options widened.** OAuth 2.1 + DCR (default), bearer API key or OAuth
   token in `Authorization`, a `/mcp/readonly` endpoint, and Okta
   enterprise-managed authorization (Jul/Aug 2026). `/sse` was removed
   (deprecation announced Feb 5 2026; third-party listings cite removal date
   2026-04-08).

---

## 1. Linear MCP server

### 1.1 Endpoint, transport, auth [verified]

Source: https://linear.app/docs/mcp (fetched 2026-09-25).

- Streamable HTTP at `https://mcp.linear.app/mcp`. Claude Code setup:
  `claude mcp add --transport http linear-server https://mcp.linear.app/mcp`,
  then `/mcp` to authenticate.
- Interactive auth is **OAuth 2.1 with dynamic client registration**.
- **Bearer auth**: "The MCP server supports passing OAuth token and API keys
  directly in the `Authorization: Bearer` header instead of using the
  interactive authentication flow" — usable as an `app` user, with a restricted
  read-only API key, or with an existing OAuth app.
- **Read-only**: `https://mcp.linear.app/mcp/readonly` exposes only read tools;
  alternatively request only the `read` OAuth scope on `/mcp`.
- **Multiple workspaces**: each workspace needs its own auth context (e.g.
  separate `MCP_REMOTE_CONFIG_DIR`); reconnecting does not switch workspaces.
- **SSE removed**: changelog 2026-02-05 "Deprecation of `/sse` MCP endpoint …
  Linear MCP is fully removing SSE support"
  (https://linear.app/changelog/page/3). The docs FAQ still mentions `/sse` as a
  WSL fallback, which conflicts with the changelog; a third-party directory
  (https://simtheory.ai/mcp-servers/linear/) shows "REMOVAL DATE 2026-04-08
  (past)". **Treat `/sse` as gone [verified changelog; docs stale].**
- **Enterprise-managed authorization (Okta)**: 2026-07-02 ("Centrally manage
  access to Linear's MCP server in Claude") and 2026-08-13 (Enterprise
  workspaces with Okta SAML; "When employees connect from a supported Anthropic
  agent, Linear verifies their identity through Okta")
  (https://linear.app/changelog).
- OAuth reliability fixes: MCP OAuth disconnect after ~1 day fixed and OAuth
  redirect hang fixed (April 2026 entries, https://linear.app/changelog/page/2).
- Third-party app approvals for admins on paid plans: 2026-09-03.

### 1.2 Rate limits and pagination

- MCP-specific rate limits are **not documented [unverified]**. The MCP server
  sits on the GraphQL API; GraphQL limits are
  (https://linear.app/developers/rate-limiting, fetched 2026-09-25):
  API key 2,500 req/hr/user; OAuth app 5,000 req/hr/user-or-app-user;
  unauthenticated 600/hr/IP. Complexity: API key 3,000,000 pts/hr, OAuth
  2,000,000 pts/hr, max 10,000 pts per query; default page size 50.
  Headers: `X-RateLimit-Requests-*`, `X-RateLimit-Complexity-*`, endpoint
  headers `X-RateLimit-Endpoint-*`. Linear explicitly discourages polling —
  use webhooks.
- Pagination: GraphQL is Relay cursor-based (`first/after`, `pageInfo`)
  (https://linear.app/developers/pagination). MCP list tools use
  `cursor`, `limit` (default 50, **max 250**), `orderBy` (`createdAt|updatedAt`,
  default `updatedAt`) **[schema]**. `list_comments` gained cursor pagination on
  2026-03-24 [verified].
- Relative date filters: list tools accept ISO-8601 durations like `-P1D`
  for `createdAt`/`updatedAt` **[schema]**.
- Unknown parameters now **return a validation error** instead of being
  silently dropped (2026-05-14) [verified] — plugin prompts that pass stale
  parameter names will now fail loudly.
- `list_issues` accepts a `fields` projection (e.g. `gitBranchName`,
  `delegate`, `triageIntel`, SLA fields) to shrink payloads **[schema]**.

### 1.3 Tool families (live schema in this session) and ship dates

| Family | Tools observed | Shipped / changed (source) |
|---|---|---|
| Issues | `list_issues`, `get_issue`, `save_issue`, `get_issue_status`, `list_issue_statuses`, `extract_images` | `create_issue`+`update_issue` merged into **`save_issue`** 2026-02-26; SLA status in responses 2026-02-26; relations (blocking/related/duplicate) 2026-01-22; `assignee`/`delegate` nullable 2026-01-29 [verified]. `save_issue` now supports `template`, `patch` (anchored partial description edits), `addLabels/removeLabels`, `addReleases/setReleases`, `blocks/blockedBy/relatedTo`, `links`, `delegate` [schema]. |
| Comments | `list_comments`, `save_comment`, `delete_comment` | pagination 2026-03-24; comments on archived issues 2026-06-11 [verified] |
| Labels | `list/create/save/retire/restore_issue_label`, `list/save/retire/restore_project_label`, `list/create/save/retire/restore_initiative_label` | Initiative labels are part of "Initiative properties" 2026-07-02 [verified product; MCP tool date unverified]. Label archiving (retire) product 2025-10-09 [verified]. |
| Projects | `list_projects`, `get_project`, `save_project`, `list_project_labels` | slug lookup 2026-02-26; members/resources 2026-02-13; durable human-legible project/initiative IDs (e.g. `P-ENG-123`, `I-123`) 2026-09-24 [verified]. |
| Initiatives | `list_initiatives`, `get_initiative`, `save_initiative` | added 2026-02-05 ("Linear MCP for product management"); multiple parents 2026-03-24 [verified] |
| Milestones | `list_milestones`, `get_milestone`, `save_milestone` | 2026-02-05 [verified] |
| Status updates | `get_status_updates`, `save_status_update`, `delete_status_update` | 2026-02-05; available without prior update history 2026-06-18 [verified]. `health`: onTrack/atRisk/offTrack [schema]. |
| Documents | `list_documents`, `get_document`, `save_document` | create/update in project 2026-01-22; team docs 2026-06-11; `initiative`/`cycle` params 2026-05-14; GitHub PR URLs converted to diff mentions 2026-05-21 [verified] |
| Cycles | `list_cycles` | long-standing; no write tool observed [schema] |
| Teams/users/workspace | `list_teams`, `get_team`, `list_users`, `get_user`, `get_workspace` | `get_user` accepts "me" 2025-10-02; `list_teams`/`get_team` report `visibility`,`retiredAt` 2026-09-14 [verified] |
| Templates | `list_templates`, `get_template` | issue/project/document templates; `save_issue template=` applies server-side [schema]; ship date **unverified** |
| Custom views | `list_custom_views`; `list_issues customView=` | ship date **unverified** [schema] |
| Notifications | `get_notifications`, `mark_notification` | ship date **unverified**; Linear Agent "can now manage inbox notifications" 2026-07-20 [verified product] |
| Triage responsibility | `get_triage_responsibility` | who is on triage now + rotation shifts; ship date **unverified** [schema]. PagerDuty shift schedules 2026-06-18 [verified product]. |
| Attachments | `get_attachment`, `create_attachment`, `delete_attachment`, `prepare_attachment_upload`, `create_attachment_from_upload` | signed PUT URL, expires in 60 s, one file at a time [schema]; base64 whitespace/`data:` tolerance 2026-07-20 [verified] |
| Sharing | `share_issue`, `unshare_issue` | share private-team issues 2026-02-13 (product) [verified]; MCP tool date unverified |
| Releases | `list_releases`, `get_release`, `save_release`, `list_release_notes`, `get_release_note`, `save_release_note`, `list_release_pipelines` | "Added support for managing releases, release notes, and release issue associations through the MCP server" 2026-07-02 [verified] |
| Agent skills | `list_agent_skills`, `get_agent_skill` (read-only) | "Added read-only MCP tools for listing and retrieving Linear Agent skills" 2026-07-02 [verified] |
| Diffs (code review) | `list_diffs`, `get_diff`, `get_diff_threads`, `save_diff_comment`, `delete_diff_comment`, `resolve_diff_thread`, `submit_diff_review`, `update_diff`, `merge_diff` | Product: Diffs 2026-05-28. MCP tool ship date **not found in changelog [unverified]**; third-party proxies note these have "no public GraphQL backing" (https://glama.ai/mcp/servers/wiklob/linear-mcp-lean). |
| Customer needs | `save_customer_need` | Mentioned in changelog 2026-07-02 ("source URL support") but **not present** in this session's tool list [verified mention; availability unverified] |
| Docs search | `search_documentation` | available [schema] |

Diff tool details [schema]: `list_diffs` filters by `author`, `reviewer` +
`reviewState` (pending/approved/changesRequested/commented/dismissed),
`owner`, `repo`, `status`, `query`; `get_diff` accepts Linear review URL, GitHub
PR URL, identifier, UUID or slug; `update_diff` edits title/description,
reviewer requests (users, external users, GitHub teams), **issue links with
relationship `closes|contributes|links|reopens`**, and status
(`markReadyForReview|convertToDraft|close|reopen`); `merge_diff` merges or
enqueues with `MERGE|REBASE|SQUASH`; `submit_diff_review` decision
`approved|changesRequested|commented`.

---

## 2. Linear for Agents / agent platform

### 2.1 Platform primitives [verified]

- **Linear for Agents** launched 2025-05-20; Agent Interaction Guidelines + SDK
  2025-07-30 (https://linear.app/changelog/page/5,
  https://linear.app/changelog/2025-07-30-agent-interaction-guidelines-and-sdk).
  Still labelled "Developer Preview" on https://linear.app/developers/agents.
- Agents are **app users** (`actor=app` OAuth), not billable seats. Scopes
  `app:assignable`, `app:mentionable`, plus `customer:*`, `initiative:*`.
- **Delegation vs assignment**: "Assigning an issue to your app now sets it as
  the `delegate`, not the `assignee`—so humans maintain ownership while agents
  act on their behalf." (https://linear.app/developers/agents). The
  backwards-compat shim mirroring `delegate` into `assignee` was removed
  2025-09-18 [verified].
- **AgentSession** states: `pending, active, error, awaitingInput, complete,
  stale`; created on mention or delegation, or proactively via
  `agentSessionCreateOnIssue` / `agentSessionCreateOnComment`. `externalUrls`
  (label+url) on the session; PR URLs go there.
  (https://linear.app/developers/agent-interaction)
- **AgentActivity** types: `thought`, `elicitation`, `action`
  (action/parameter/result), `response`, `error`; user `prompt`. Ephemeral
  thought/action; optional **signals**; **Agent Plans** (tech preview) —
  full-array checklist with `pending|inProgress|completed|canceled`.
- **Timing contract**: first activity within 10 s of `created`; webhook 5 s
  response; session stale after 30 min without activity (recoverable)
  (https://linear.app/developers/agent-best-practices).
- **Best practices**: move a delegated issue to the team's first `started`
  state when work begins; set self as delegate if none; if an automation
  delegated, leave in triage; finish with `response` or `elicitation`/`error`;
  read Agent Activities rather than (editable) comments.
- `promptContext` on `created` webhooks (added 2025-12-17) includes issue,
  threads, and `<guidance>` rules (workspace/team origin).
- `issueRepositorySuggestions` query ranks candidate repos for an issue
  (2026-01-22).
- Mentioning a third-party agent in a comment now sends a follow-up to its most
  recent session on that issue (2026-09-24).
- Agent session mobile viewing/steering 2026-03-12; delegated issues section in
  My Issues 2026-07-30.

### 2.2 Agent guidance [verified]

https://linear.app/docs/agents-in-linear: workspace guidance + team guidance
(team wins on conflict), markdown with history, at Settings > Agents >
Additional guidance. Passed to every agent; interpretation depends on the
agent. Security setting controlling who can edit workspace guidance: 2025-11-13.
Linear Agent has separate workspace/team/personal guidance and a Slack-specific
guidance field (https://linear.app/docs/linear-agent).

No MCP tool reads agent guidance **[schema: none observed]**.

### 2.3 Linear's own AI [verified]

- **Product Intelligence → Triage Intelligence**: auto-apply triage suggestions
  (team, assignee, labels, duplicates) 2025-09-18; renamed Triage Intelligence.
  `list_issues` returns "active Triage Intelligence suggestions for issues in
  triage" via `triageIntel` field [schema].
- **Issue discussion summaries** 2025-10-02; **Pulse** (feed of updates) with
  mobile 2025-11-13 and one-sentence takeaways (Apr 2026).
- **Linear Agent** public beta 2026-03-24 (chat ⌘J, `@Linear` in comments,
  Slack, Teams); skills + triage automations. **MCP connectors for Linear
  Agent** 2026-04-23. **Code Intelligence** (repo-aware Q&A) 2026-05-14.
  **Shared skills** 2026-06-04. **Agent-assisted project updates** ("Write with
  Agent") 2026-06-18. **Agent-assisted document editing + text attribution**
  2026-07-23. **Priority inbox** and **project composer with Agent** 2026-09-03.
- **Coding sessions** 2026-06-11: "Linear Agent can now write code using Claude
  Code and Codex" in a managed cloud sandbox; returns a diff; triage
  automations can auto-attempt fixes. Default model "Claude Opus 4.8"; supported
  Claude Fable 5, Opus 5, Opus 4.8, Sonnet 5, GPT-5.6 Sol, GPT-5.5, GPT-5.4
  (https://linear.app/docs/coding-sessions, fetched 2026-09-25). Environments,
  browser testing, token-at-cost pricing + $0.25 per 20-min sandbox 2026-08-20;
  signed commits 2026-07-30; adaptive routing, env secrets, open-weight (GLM)
  models 2026-09-24. Repos' Claude Code / Codex setup and a `skills.md` file are
  used as guidance.
- **Loops** 2026-07-20 (recurring/event-triggered agent workflows, Business &
  Enterprise, AI credits); more triggers (project/initiative/cycle), doc
  editing and Slack posting 2026-09-14; team triggers 2026-09-24
  (https://linear.app/docs/loops).
- **Deeplink to AI coding tools** 2026-02-26: open an issue in Claude Code,
  Codex, Cursor etc. with a customizable prompt template; more launchers
  2026-03-12 (supports `issue.branchName` variable); custom coding-tool
  integrations April 2026.

### 2.4 Third-party coding agents in Linear [verified]

| Agent | Date | Source |
|---|---|---|
| Cursor background agents | 2025-08-21 | https://linear.app/changelog/page/4 |
| Sentry Agent (root cause) | 2025-10-02 | changelog page 4 |
| Factory | 2025-10-16 | changelog page 4 |
| GitHub Copilot agent | 2025-10-28; Copilot cloud agent for Linear GA announced by GitHub 2026-07-23 (Linear changelog entry 2026-07-30) | changelog; https://github.blog/changelog/2026-07-23-copilot-cloud-agent-for-linear-is-now-generally-available/ |
| OpenAI Codex agent | 2025-12-04 | changelog page 3 |
| Warp | 2025-12-11 | changelog page 3 |
| Vercel Eve (build-your-own) | 2026-06-18 | changelog page 1 |
| Devin | date not found; uses agent sessions, plan UI, stop signal, playbook labels (`!plan`, `!implement`) and edge-triggered automations | https://docs.devin.ai/integrations/linear, https://linear.app/integrations/devin |
| Linear Agent coding sessions (Claude Code / Codex) | 2026-06-11 | changelog page 2 |

**Official Claude integration**: Linear is a Claude connector (Team/Enterprise
and Free/Pro) and there is an official Claude Code plugin
`linear@claude-plugins-official` (https://claude.com/plugins/linear; ~39.8k
installs per https://composio.dev/content/top-claude-code-plugins, date of
count unverified). No "Claude" delegate agent app inside Linear was found —
Claude enters Linear via coding sessions or via MCP from Claude clients
**[unverified that none exists]**.

---

## 3. Product areas

- **Diffs / Reviews** (2026-05-28; private beta "Linear Code Reviews"
  2026-01-22): review GitHub PRs in Linear, bidirectional sync, merge from
  Linear, merge queue, Review inbox, Guided Reviews (GA 2026-07-30, Business+),
  GitHub team reviewers, agent iteration from the diff, rich previews
  2026-09-03, `linear.review/owner/repo/pull/N` URL rewrite. Requires GitHub
  integration with code access + personal GitHub connection
  (https://linear.app/docs/diffs). AI can generate or suggest an issue from a
  PR (2026-07-30).
- **Releases** (2026-04-30, Business+): pipelines (continuous/scheduled,
  path filters), `linear/linear-release-action` + `linear-release` CLI with a
  pipeline access key (personal API keys not accepted), release status
  automations ("Merged" on PR merge, "Done" on release completion), release
  notes via Linear Agent, pipeline changelogs 2026-06-18
  (https://linear.app/docs/releases).
- **Agent Skills**: see 2.3. Readable via MCP; not writable.
- **Customer requests / Asks**: Asks web forms 2026-04-02 (Enterprise); Asks
  agent in Slack 2026-05-21; form templates 2025-11-20; customer data sync
  2025-09-04; Intercom/Zendesk/Gong agent 2025-12-11.
- **Initiatives & updates**: MCP support 2026-02-05; multiple parents
  2026-03-12; team initiatives + private-team initiatives 2026-08-13;
  initiative properties (proposed/canceled status, priority, labels)
  2026-07-02; updates tab 2025-10-02; update webhooks carry `diffMarkdown`
  (2026-02-26).
- **Cycles**: loops triggers on cycle created/started/completed 2026-09-14;
  `CycleCreate/Update` reject overlaps 2026-07-23. MCP is read-only for cycles.
- **Triage**: Triage rules (add to project Aug 2025), Triage Intelligence,
  triage responsibility (rotation, PagerDuty/external schedules), agent triage
  automations (coding sessions on new bugs).
- **SLAs**: Business plan 2025-10-16; `startMode` (on create vs escalation)
  2026-09-03; `save_issue` can set `slaBreachesAt`/`slaType` [schema].
- **Templates**: form templates 2025-11-20; template suggestions in composer
  2026-07-23; MCP `list_templates/get_template` + `save_issue template=`.
- **Custom views**: shared filtered views 2026-07-02; view subscriptions to
  Slack/Inbox 2026-08-20; MCP `list_custom_views` + `list_issues customView=`.
- **Git integration** (https://linear.app/docs/github): branch-name linking
  (`Cmd/Ctrl+Shift+.` copies `gitBranchName`), issue ID in PR title, magic
  words — closing: `close(s/d/ing), fix(es/ed/ing), resolve(s/d/ing),
  complete(s/d/ing), implement(s/ed/ing), linear issue`; non-closing: `ref(s),
  references, part of, contributes to, toward(s)`; relation: `relates to,
  related to` (no status change, 2026-08-13); `skip`/`ignore ENG-123`;
  `{TEAM}-NEW` creates an issue from a PR; `updates` magic word for
  Contributes links 2026-09-24; `Implements` 2026-04; commit linking needs a
  webhook. Status automation: on branch push / PR open / review / merge. Git
  automations keep unassigned triage issues in triage unless the merged change
  closes them (2026-06-18). GitLab supported; GitHub Enterprise Cloud
  2026-05-21 (Enterprise).
- **Linear CLI**: only the `linear-release` CLI (release pipelines) is
  official; **no general-purpose official Linear CLI found [unverified]**.
- **Webhooks**: agent session, inbox notification, permission change, OAuth
  revoke, ProjectLabel, project milestone/relation; outbound IP list published
  at `https://linear.app/.well-known/appspecific/app.linear.ips.json`
  (2026-09-03); signing secret rotation (2026-01-22).
- **GraphQL / SDK**: GraphQL subscriptions (2026-03-24); `AgentSkill` types
  replacing `AiPrompt` (2026-05-21); `Team.visibility` replaces `Team.private`;
  `Issue.stateHistory` (2025-12-04); `client_credentials` grant (2025-09-18);
  RFC 7009 revoke (2026-01-22); OAuth application manifests (2026-06-18).

---

## 4. Best practices for Linear + Claude Code / agentic coding

- Linear's MCP docs publish example prompts whose common pattern is: **show the
  proposed changes before writing**, match notes to issues only on strong
  evidence, **"assign or delegate work only when the requested owners or agents
  are explicitly specified"**, flag ambiguity rather than invent structure
  (https://linear.app/docs/mcp).
- Linear's coding-session docs recommend **well-scoped issues** naming files,
  existing patterns, expected behaviour, and explicit non-goals — "Information
  that reduces ambiguity or codebase exploration helps Linear reach an
  implementation faster" (https://linear.app/docs/coding-sessions).
- Agent guidance should carry repo choice, commit/PR reference conventions and
  review process (https://linear.app/docs/agents-in-linear).
- Status conventions for agents: move to first `started` state when work
  begins; keep automation-delegated issues in triage; consider "Merged" on PR
  merge and "Done" on release completion (docs/releases).
- Community practice: some users skip MCP and let the agent call GraphQL
  directly as a skill (https://www.reddit.com/r/Linear/comments/1q6wo4q/) —
  anecdotal [unverified].

---

## Capability table

| Capability | Available via MCP? | Shipped | Relevance to yellow-linear |
|---|---|---|---|
| `save_issue` unified create/update (+`patch`, `template`, `delegate`, releases, relations) | Yes | 2026-02-26 (merge); later params | High — `create`, `sync`, `work` should use `template`, `patch`, `addLabels` |
| Native delegation to agent app users | Yes (`save_issue delegate`, `list_issues delegate`) | Platform 2025-05-20 | **High** — `/linear:delegate` could set delegate to installed Cursor/Devin/Codex/Copilot/Linear agent instead of CLI/REST |
| Linear coding sessions (Claude Code/Codex in cloud) | Indirect (delegate to "Linear") | 2026-06-11 | High — new delegate target; no local setup |
| Diffs: list/get/threads/comment/review/update/merge | Yes | Product 2026-05-28; MCP date unverified | **High** — `sync` link-PR via `update_diff addedIssueLinks`; `sync-all` via `list_diffs status`; new review command |
| Releases, release notes, pipelines | Yes | Product 2026-04-30; MCP 2026-07-02 | Medium — `sync-all` could stop at "Merged" and let releases close; release-note drafting |
| Agent skills (read) | Yes, read-only | 2026-07-02 | Medium — import team skills/conventions into `work`/`plan` |
| Agent guidance (workspace/team) | **No** | 2025 | Medium — gap; must be pasted into CLAUDE.md or fetched manually |
| Templates | Yes | unverified | High — `create` should honour team templates/form templates |
| Custom views | Yes | unverified | Medium — `triage`/`status` can run against saved views |
| Triage responsibility | Yes | unverified | Medium — `triage` can show who's on rotation |
| Triage Intelligence suggestions | Yes (`list_issues` `triageIntel`) | 2025-09-18 | High — `triage` should surface/accept suggestions rather than re-derive |
| Notifications inbox | Yes | unverified | Low–Medium — optional inbox digest |
| Status updates (project/initiative, health) | Yes | 2026-02-05 | Already used by `status` |
| Initiatives, labels, multiple parents | Yes | 2026-02-05 / 2026-07-02 | Already used partly by `status` |
| Milestones | Yes | 2026-02-05 | Medium — `plan-cycle` / `work` breakdowns |
| Documents (project/team/initiative/cycle) | Yes | 2026-01-22 → 2026-06-11 | Medium — `work` can save plans as Linear docs |
| Cycles write | No (read-only `list_cycles`) | — | `plan-cycle` can assign issues via `save_issue cycle=` but cannot create cycles |
| Attachments upload | Yes (signed URL, 60 s) | 2026 (unverified) | Low — screenshots/logs from local runs |
| Issue sharing | Yes | 2026-02-13 product | Low |
| SLA fields | Yes | 2026-02-26 | Low–Medium — triage prioritization |
| Customer needs | Changelog says yes; not in this session | 2026-07-02 mention | Low |
| Loops | No | 2026-07-20 | Low — overlaps `sync-all`; document as alternative |
| Agent sessions/activities | No (GraphQL/webhooks only) | 2025-05-20 | Only if the plugin becomes a Linear agent itself |
| Read-only endpoint `/mcp/readonly` | N/A (endpoint) | 2026 (date unverified) | Medium — safe mode for explorer/status |
| Bearer API key auth | N/A | documented 2026 | Medium — headless/CI setups |
| Okta enterprise-managed auth | N/A | 2026-07-02 / 08-13 | Low (Claude-client specific) |
| Durable project/initiative IDs (`P-ENG-123`, `I-123`) | Yes (accepted by tools) | 2026-09-24 | Medium — store IDs, not names |
| Magic words incl. `relates to`, `updates`, `{TEAM}-NEW` | N/A (Git) | 2026-04 → 2026-09-24 | High — `sync` PR body generation |

---

## Gaps and uncertainties

- **MCP ship dates** for diff tools, templates, custom views, notifications,
  triage responsibility, attachment upload and share tools were not found in the
  changelog pages read (Aug 2025–Sep 2026). They exist in the live schema today.
- **MCP rate limits** are undocumented; GraphQL limits used as proxy.
- **`/sse` status**: changelog says removed; docs FAQ still references it.
- **`save_customer_need`** is in the changelog but absent from this session's
  tool list (may be scope- or plan-gated).
- **Agent guidance** is not exposed via MCP (inference from absent tools).
- **Devin integration date** and whether Devin appears as a delegate app user in
  all workspaces were not confirmed from a Linear changelog entry.
- **Official general Linear CLI** — none found.
- Coding-session model names (e.g. "Claude Opus 4.8", "Claude Fable 5") are
  quoted from Linear docs as fetched on 2026-09-25 and may change.
- Install counts for the official Claude Code Linear plugin come from secondary
  blogs.
- Changelog pages were read via scraping; entries between listed dates may have
  been missed where the scraper truncated media-heavy sections.

---

## Sources

- https://linear.app/changelog (pages 1–4, fetched 2026-09-25)
- https://linear.app/changelog/2025-05-01-mcp
- https://linear.app/changelog/2025-07-30-agent-interaction-guidelines-and-sdk
- https://linear.app/changelog/2026-02-05-linear-mcp-for-product-management
- https://linear.app/changelog/2026-03-24-introducing-linear-agent
- https://linear.app/changelog/2026-04-30-releases
- https://linear.app/changelog/2026-05-27-linear-diffs
- https://linear.app/changelog/2026-06-11-coding-sessions
- https://linear.app/changelog/2026-07-20-introducing-loops
- https://linear.app/changelog/2026-09-24-new-controls-for-linear-coding-agent
- https://linear.app/docs/mcp
- https://linear.app/docs/coding-sessions
- https://linear.app/docs/diffs
- https://linear.app/docs/releases
- https://linear.app/docs/github
- https://linear.app/docs/agents-in-linear
- https://linear.app/docs/linear-agent
- https://linear.app/docs/loops
- https://linear.app/docs/slack
- https://linear.app/developers/agents
- https://linear.app/developers/agent-interaction
- https://linear.app/developers/agent-best-practices
- https://linear.app/developers/rate-limiting
- https://linear.app/developers/pagination
- https://docs.devin.ai/integrations/linear
- https://docs.devin.ai/release-notes/2026
- https://linear.app/integrations/devin
- https://github.blog/changelog/2026-07-23-copilot-cloud-agent-for-linear-is-now-generally-available/
- https://claude.com/plugins/linear
- https://composio.dev/content/top-claude-code-plugins
- https://glama.ai/mcp/servers/wiklob/linear-mcp-lean
- https://simtheory.ai/mcp-servers/linear/
- Live Linear MCP tool schemas in this session (2026-09-25), read-only inspection
