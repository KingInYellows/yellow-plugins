# Plugin System Optimization Analysis — Phase 1

Date: 2026-07-01
Scope: benchmark the yellow-plugins Claude Code plugin system against two reference
skill systems and produce a candidate improvement list. Documentation only; no
plugin changes.

Reference material (cloned read-only, analyzed from source):

- **CE** = EveryInc/compound-engineering-plugin, cloned to
  `/tmp/compound-engineering-plugin` @ `db21ba2`. Citations `CE:<path>:<line>`.
- **turbo** = tobihagemann/turbo, cloned to `/tmp/turbo` @ `cdd947f`.
  Citations `turbo:<path>:<line>`.
- Uncited paths are relative to this repo's root.

**Method & verification.** Inventory numbers (file counts, line counts,
frontmatter fields, hook registrations) were generated mechanically with
`fd`/`wc`/`grep`/`jq` in this session. Deep-read findings were produced by four
parallel read-only research agents (one per reference repo, two over this repo);
every load-bearing claim relayed from an agent was independently re-verified in
this session by reading the cited lines (verified items include: the CE deletion
test, CE load stubs, CE run-artifact rationale, turbo ADDITIONS.md rules, turbo
SKILL-CONVENTIONS.md, turbo `self-improve` and `create-handoff`, this repo's
validator rule coverage, the `learnings-researcher` integration drift, the
memory-skill duplication, and `pick-next-shell`'s halt pattern). Claims not
independently re-verified are marked **[relayed]**.

---

## 1. Inventory

### 1.1 Plugins (17)

Source: `plugins/*/.claude-plugin/plugin.json` (versions, hooks, MCP via `jq`),
component counts via `fd`. 392 files under `plugins/` total.

| Plugin | Version | Commands | Agents | Skills | Hook events (from plugin.json) | MCP servers |
|---|---|---:|---:|---:|---|---|
| gt-workflow | 1.5.4 | 7 | 0 | 0 | PreToolUse, PostToolUse | graphite |
| yellow-browser-test | 1.1.4 | 4 | 3 | 2 | — | — |
| yellow-ci | 1.4.5 | 9 | 4 | 2 | SessionStart | — |
| yellow-codex | 0.2.4 | 4 | 3 | 1 | — | — |
| yellow-composio | 2.0.2 | 2 | 0 | 1 | SessionStart | composio-server |
| yellow-core | 1.22.0 | 16 | 21 | 18 | Stop, SessionStart | — |
| yellow-council | 0.2.4 | 2 | 2 | 1 | — | — |
| yellow-debt | 1.6.8 | 6 | 7 | 1 | SessionStart | — |
| yellow-devin | 2.3.5 | 10¹ | 1 | 1 | — | deepwiki, devin |
| yellow-docs | 1.3.5 | 6 | 10 | 1 | — | — |
| yellow-linear | 1.3.2 | 9 | 3 | 1 | — | linear |
| yellow-mempalace | 1.1.2 | 6 | 2 | 2 | — | mempalace |
| yellow-morph | 1.3.0 | 2 | 0 | 0 | SessionStart | morph |
| yellow-research | 3.2.3 | 4 | 2 | 2 | SessionStart | ast-grep, ceramic, exa, parallel, perplexity, tavily |
| yellow-review | 3.2.1 | 7 | 16 | 2 | — | — |
| yellow-ruvector | 1.1.5 | 6 | 2 | 3 | SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Stop | ruvector |
| yellow-semgrep | 4.1.1 | 5 | 2 | 1 | SessionStart | semgrep |
| **Total** | | **105** | **78** | **39** | | 16 servers |

¹ includes `commands/devin/README.md`, which sits in the commands directory.

Aggregate instruction surface: commands 24,777 lines; agents 13,938 lines;
skills 8,959 lines — **~47.7k lines of markdown instructions**, plus shell hooks
and `lib/` helpers.

### 1.2 Skills (39)

Lines/`user-invokable`/Use-when flags generated mechanically this session.
Supporting files from a full scan of `plugins/*/skills/*/` (non-SKILL.md files).

| Skill | Plugin | Lines | user-invokable | "Use when" in description | Supporting files |
|---|---|---:|---|---|---|
| agent-browser-patterns | yellow-browser-test | 93 | false | yes | — |
| test-conventions | yellow-browser-test | 127 | false | yes | — |
| ci-conventions | yellow-ci | 131 | false | yes | `references/` ×3 |
| diagnose-ci | yellow-ci | 93 | true | yes | — |
| codex-patterns | yellow-codex | 315 | false | yes (generic²) | — |
| composio-patterns | yellow-composio | 306 | false | yes (generic²) | — |
| agent-native-architecture | yellow-core | 119 | false | yes | — |
| agent-native-audit | yellow-core | 168 | false | yes | — |
| brainstorming | yellow-core | 134 | false | yes | — |
| compound-lifecycle | yellow-core | 414 | true | yes | — |
| create-agent-skills | yellow-core | 513 | true | yes | `references/quick-reference.md` |
| debugging | yellow-core | 274 | true | yes | — |
| git-worktree | yellow-core | 440 | true | yes | `troubleshooting.md`, `scripts/`, `tests/` |
| ideation | yellow-core | 345 | true | yes | — |
| local-config | yellow-core | 219 | false | yes | — |
| mcp-health-probe | yellow-core | 158 | false | yes | — |
| mcp-integration-patterns | yellow-core | 290 | false | yes | — |
| memory-recall-pattern | yellow-core | 156 | false | yes | — |
| memory-remember-pattern | yellow-core | 137 | false | yes | — |
| morph-discovery-pattern | yellow-core | 71 | false | yes | — |
| multi-host-fleet | yellow-core | 243 | true | yes | — |
| optimize | yellow-core | 461 | true | yes | `schema.yaml` (data) |
| security-fencing | yellow-core | 177 | false | **no** | — |
| session-history | yellow-core | 260 | true | yes | — |
| council-patterns | yellow-council | 398 | false | yes | — |
| debt-conventions | yellow-debt | 390 | false | yes | — |
| devin-workflows | yellow-devin | 226 | false | yes | `api-reference.md`, `error-codes.md` |
| docs-conventions | yellow-docs | 265 | false | yes | — |
| linear-workflows | yellow-linear | 256 | false | yes | — |
| mempalace-conventions | yellow-mempalace | 106 | false | yes (generic²) | — |
| palace-protocol | yellow-mempalace | 81 | false | yes | — |
| library-context | yellow-research | 244 | true | yes | `reference.md` |
| research-patterns | yellow-research | 184 | false | **no** | — |
| pr-review-workflow | yellow-review | 348 | false | yes | `scripts/` ×2 |
| stack-traversal | yellow-review | 134 | false | yes | — |
| agent-learning | yellow-ruvector | 123 | false | yes | — |
| memory-query | yellow-ruvector | 111 | false | yes | — |
| ruvector-conventions | yellow-ruvector | 211 | false | yes | — |
| semgrep-conventions | yellow-semgrep | 238 | false | yes | — |

² "Use when commands or agents need X integration context" — clause present but
boilerplate-generic (`plugins/yellow-codex/skills/codex-patterns/SKILL.md:3`,
`plugins/yellow-composio/skills/composio-patterns/SKILL.md:3`,
`plugins/yellow-mempalace/skills/mempalace-conventions/SKILL.md:3`).

Split: 10 user-invokable, 29 internal reference skills. 37/39 descriptions carry
an explicit "Use when" clause; the 2 without are `security-fencing/SKILL.md:3`
and `research-patterns/SKILL.md:4`. No folded-scalar descriptions exist
(`grep "^description: [>|]"` → 0 matches).

### 1.3 Commands and agents

Largest command files (`wc -l`, verified):

| Lines | File |
|---:|---|
| 879 | `plugins/yellow-review/commands/review/review-pr.md` |
| 846 | `plugins/yellow-research/commands/research/setup.md` |
| 844 | `plugins/yellow-core/commands/setup/claude-web.md` |
| 834 | `plugins/yellow-core/commands/setup/all.md` |
| 796 | `plugins/yellow-core/commands/workflows/work.md` |
| 639 | `plugins/yellow-devin/commands/devin/review-prs.md` |
| 584 | `plugins/yellow-core/commands/worktree/cleanup.md` |
| 577 | `plugins/yellow-devin/commands/devin/setup.md` |
| 549 | `plugins/yellow-core/commands/workflows/review.md` |
| 543 | `plugins/gt-workflow/commands/gt-cleanup.md` |

12 command files exceed 500 lines (the 10 above plus
`plugins/yellow-council/commands/council/council.md` at 527 and
`plugins/yellow-core/commands/statusline/setup.md` at 538) **[relayed]** for the
last two; the top 3 were re-measured directly.

Agents: 78 total; yellow-core (21) and yellow-review (16) hold nearly half. The
review personas across the two plugins are deliberately complementary, not
duplicated — cross-references confirm the split
(`plugins/yellow-core/agents/review/code-simplicity-reviewer.md:3` "pre-fix
pass... see code-simplifier (yellow-review)" vs
`plugins/yellow-review/agents/review/code-simplifier.md:3` "Final-pass... see
code-simplicity-reviewer (yellow-core)") **[relayed, pattern consistent with
plugin CLAUDE.md catalogs]**.

### 1.4 Hooks (context-injection surface)

`hooks/hooks.json` files are reference-only; `plugin.json` `hooks` blocks are
authoritative (e.g. `plugins/gt-workflow/hooks/hooks.json:2` says "REFERENCE
ONLY") **[relayed]**.

| Plugin | Event | Purpose |
|---|---|---|
| gt-workflow | PreToolUse(Bash) | block raw `git push`, force `gt submit` |
| gt-workflow | PostToolUse(Bash) | warn on non-conventional commit messages |
| yellow-ci | SessionStart | detect CI context, surface recent failures |
| yellow-composio | SessionStart | warn on non-HTTPS MCP URL |
| yellow-core | Stop | capture transcript tail → compound-staging pending JSONL |
| yellow-core | SessionStart | compound-staging drain dispatcher (threshold + reaper) |
| yellow-debt | SessionStart | remind about pending high/critical debt findings |
| yellow-morph | SessionStart | pre-warm morphmcp install |
| yellow-research | SessionStart | pre-warm context7 cache + credential-status.json |
| yellow-ruvector | SessionStart / UserPromptSubmit / PreToolUse / PostToolUse / Stop | full learning loop: init + recall injection + coedit context + edit recording + session-end export |
| yellow-semgrep | SessionStart | credential-status.json |

yellow-ruvector is the only plugin wired to all five lifecycle events, and its
`UserPromptSubmit` hook is the only in-turn context injection in the repo.

### 1.5 Learning artifacts on disk

`docs/solutions/` = 99 docs; `docs/brainstorms/` = 63; `plans/` = 3 open + 75
archived in `plans/complete/` (counted this session).

---

## 2. Reference Systems

### 2.1 CE — compound-engineering-plugin (27 skills, 0 agents, 558 files)

What it optimizes for: a **closed learning loop with aggressive progressive
disclosure**, authored once and converted to many harnesses.

- **Skills-only architecture.** No standalone agents; specialist personas are
  skill-local prompt assets under `references/personas/`
  (CE:`README.md:110`, CE:`CONCEPTS.md:11-17`). Each skill directory is
  self-contained; cross-skill sharing is done by audited byte-duplication with a
  parity test (CE:`AGENTS.md:203-238`).
- **Progressive disclosure as doctrine.** "Inline the Trigger, Not the Content"
  (CE:`AGENTS.md:134-149`); "load stubs" keep no improvisable detail inline so
  the reference load is structurally necessary (CE:`CONCEPTS.md:65-67`,
  concrete example CE:`skills/ce-plan/SKILL.md:762-766` — verified). `ce-plan`
  (806 lines) defers to 12 reference files; `ce-code-review` (835) defers 17
  personas plus schema/templates.
- **Deletion test for prose.** "Every line of skill prose must change agent
  behavior... if removing it would not change the output, it is a no-op —
  delete it" (CE:`AGENTS.md:122-132` — verified).
- **Run artifacts against summary-collapse.** Subagents write full output to
  `/tmp/compound-engineering/<skill>/<run-id>/` and return only the path;
  orchestrator reads the file back. Documented rationale: subagents
  intermittently return an executive summary instead of the full body
  (CE:`skills/ce-compound/SKILL.md:96-110` — verified;
  same pattern CE:`skills/ce-code-review/SKILL.md:470-481`).
- **Question-agnostic repo-profile cache** keyed by git SHAs at
  `/tmp/compound-engineering/repo-profile/<root-sha>/<head-sha>.json`, shared by
  7 skills; `docs/solutions/` is deliberately excluded so learnings are always
  re-read fresh (CE:`skills/ce-plan/references/repo-profile-cache.md:25-63`,
  CE:`skills/ce-code-review/SKILL.md:372`) **[relayed]**.
- **Learning loop closed at both ends.** Write side: `ce-compound` with a
  5-dimension overlap score to update-not-duplicate, plus `CONCEPTS.md`
  vocabulary capture (CE:`skills/ce-compound/SKILL.md:170-238,356-374`).
  Maintenance: `ce-compound-refresh` with Keep/Update/Consolidate/Replace/Delete
  outcomes (CE:`skills/ce-compound-refresh/SKILL.md:70-78`). Read side:
  `learnings-researcher` persona runs at **plan time**
  (CE:`skills/ce-plan/SKILL.md:302-321`) and as an **always-on review persona**
  (CE:`skills/ce-code-review/SKILL.md:114`) **[relayed]**.
- **Descriptions**: two clauses (capability + "Use when...") plus a
  near-universal **negative-disambiguation clause** naming the confusable
  sibling ("use ce-debug for bugs" — CE:`skills/ce-work/SKILL.md:3`,
  CE:`skills/ce-brainstorm/SKILL.md:3`) **[relayed, quoted verbatim by agent]**.
- **Pipeline composition** via a shared plan artifact
  (`docs/plans/<date>-...-plan.md` with `artifact_contract: ce-unified-plan/v1`,
  CE:`skills/ce-plan/SKILL.md:696-701`), `mode:` tokens (`mode:agent`,
  `mode:headless`) for non-interactive pipeline callers, and `lfg` as a fully
  automated 10-step chain with machine-checkable return envelopes
  (CE:`skills/lfg/SKILL.md:12-125`, CE:`skills/ce-work/SKILL.md:363-391`)
  **[relayed]**.
- **Multi-harness**: native manifests for Claude/Codex/Cursor/Kimi plus a
  TypeScript Converter/Writer CLI for OpenCode/Codex/Pi/Antigravity;
  `CLAUDE.md` is a one-line `@AGENTS.md` shim; skills never name instruction
  files on the read path for portability (CE:`AGENTS.md:93-108`) **[relayed]**.

### 2.2 turbo (77 Claude skills + 76 Codex mirrors, 238 files)

What it optimizes for: **small single-concern skills composed through standard
interfaces, with behavioral rules that keep the agent honest**.

- **Size discipline**: median skill 82 lines, max 218
  (turbo agent `wc -l`, spot-checked: `simplify-code` 78, `self-improve` 151).
  Frontmatter is exactly `name` + `description`
  (turbo:`claude/SKILL-CONVENTIONS.md:5` — verified).
- **Standard interfaces**: "Skills communicate through standard interfaces: git
  staging area, PR state, file conventions at `.turbo/`"
  (turbo:`claude/SKILL-CONVENTIONS.md:15`); review skills accept a standardized
  scope (diff command OR file list, `:17`); skills are context-agnostic —
  derive scope from git state when called standalone (`:16`, model:
  turbo:`claude/skills/simplify-code/SKILL.md:10-16` — verified).
- **Anti-skip / anti-stall enforcement** (turbo:`claude/ADDITIONS.md` — verified,
  installed into the user's CLAUDE.md):
  - never execute skill steps from memory instead of invoking the Skill tool (`:9`);
  - never skip a skill invocation/step/parallel branch to save tokens (`:11`);
  - never merge parallel branches — branch count is a floor (`:13`);
  - `<system-reminder>` auto-continue nudges do not override skill-defined
    AskUserQuestion gates (`:18`).
- **The "stop problem" mitigations**: workflow skills require a `## Task
  Tracking` section because each loaded child skill displaces the parent's
  continuation context (turbo:`claude/SKILL-CONVENTIONS.md:9`); every child
  skill ends its last step with the literal line "Then use the TaskList tool
  and proceed to any remaining task." (`:11`, verified at
  turbo:`claude/skills/self-improve/SKILL.md:139`); "caller"/"hand off"
  phrasing is banned as an end-of-turn signal (`:10`).
- **`.turbo/` artifact conventions**: `plans/`, `specs/`, `shells/` (with
  `depends_on` wiring), `improvements.md` backlog, `handoff/<date>-<slug>.md`
  session snapshots, report outputs — all gitignored, all resumable from a
  fresh session; `create-handoff` exists specifically for pre-compaction saves
  (turbo:`claude/skills/create-handoff/SKILL.md:3,8` — verified) **[.turbo
  taxonomy relayed; handoff verified]**.
- **`/self-improve` session-lesson routing** (verified, full read): scans the
  transcript in priority order (corrections first), filters
  (stable/non-obvious/actionable/undocumented/still-a-concern), then routes
  each lesson with a **hard skill-first rule** — a lesson that corrects a
  skill's behavior MUST go into that skill's file, never into memory or
  CLAUDE.md (turbo:`claude/skills/self-improve/SKILL.md:75,101`); AskUserQuestion
  gate before any write (`:123`).
- **Descriptions**: capability sentence + "Use when the user asks to" + 4–9
  **literal quoted trigger phrases**, sometimes plus a proactive-trigger clause
  (turbo:`claude/skills/create-handoff/SKILL.md:3` — verified;
  turbo:`claude/skills/note-improvement/SKILL.md:3` **[relayed]**).
- **Multi-harness**: two manually mirrored trees with a vocabulary translation
  table (turbo:`claude/SKILL-CONVENTIONS.md:52-65` — verified) and a
  cross-edition review step; "Drift between editions is the most common failure
  mode" (turbo:`claude/CLAUDE.md:9` **[relayed]**).

---

## 3. Gap Analysis

Scores are 1–5 relative to the better of the two references on each dimension.

| Dimension | Score | One-line verdict |
|---|:-:|---|
| Triggering reliability | 4/5 | Strong "Use when" coverage; missing turbo's literal trigger phrases and CE's negative disambiguation |
| Token efficiency / progressive disclosure | 2/5 | Weakest dimension: 6/39 skills offload; 12 commands >500 lines always fully loaded |
| Composability | 3.5/5 | Strong artifact pipeline; no standard scope interface or mode-token protocol |
| Maintainability | 3/5 | Best-in-class CI enforcement, but own authoring rules unenforced + doc drift |
| Duplication | 3/5 | One true near-duplicate (memory skills); 3 parallel memory systems; setup-command drift |
| Missing capabilities | — | Skill-reload/anti-skip rules, session-lesson→skill routing, handoff artifact, plan-time solutions retrieval, glossary |

### 3.1 Triggering reliability — 4/5

What's good (verified): 37/39 skill descriptions have an explicit "Use when"
clause (§1.2); no folded scalars; RULE 13 and the frontmatter lints in
`scripts/validate-agent-authoring.js` actively gate authoring regressions.

Gaps:

- 2 skills have no trigger clause at all:
  `plugins/yellow-core/skills/security-fencing/SKILL.md:3`,
  `plugins/yellow-research/skills/research-patterns/SKILL.md:4`.
- 3 use interchangeable boilerplate ("Use when commands or agents need X
  integration context") that gives the model no discriminating signal:
  `codex-patterns/SKILL.md:3`, `composio-patterns/SKILL.md:3`,
  `mempalace-conventions/SKILL.md:3`.
- Neither reference pattern is systematically applied here:
  - turbo's **quoted literal trigger phrases** ("Use when the user asks to
    \"create a handoff\", \"save session state\"...",
    turbo:`claude/skills/create-handoff/SKILL.md:3`). Some yellow agents do
    this (e.g. `plugins/yellow-linear/agents/research/linear-explorer.md`
    description quotes "search linear", "has anyone reported"), but it is not a
    convention for skills.
  - CE's **negative disambiguation** ("prefer ce-brainstorm for exploratory
    framing", CE:`skills/ce-plan/SKILL.md:3`). This repo has confusable pairs
    that would benefit: `optimize` vs `/workflows:review`, `debugging` vs
    `/codex:rescue`, `ideation` vs `brainstorming`, `session-history` vs
    ruvector recall. Only `ideation` does it today
    (`plugins/yellow-core/skills/ideation/SKILL.md:3` names
    `/workflows:brainstorm` as the boundary).

### 3.2 Token efficiency / progressive disclosure — 2/5

The repo's own standard prescribes CE-style disclosure — "Keep SKILL.md under
500 lines. Split detailed content into reference files"
(`plugins/yellow-core/skills/create-agent-skills/SKILL.md:131`) — but practice
diverges:

- Only 6/39 skills use documentation reference files (§1.2 table); 2 more ship
  scripts or data files. Among the 5 largest skills, 3 are fully inline:
  `optimize` (461 lines), `compound-lifecycle` (414), `council-patterns` (398)
  — no supporting files exist in their directories (verified by file scan).
- `create-agent-skills/SKILL.md` is 513 lines — over its own ceiling stated at
  its line 131 (verified by `wc -l`).
- Commands are the bigger cost: 24,777 lines across 105 commands, with 12 over
  500 lines and `review-pr.md` at 879 (§1.3). A command's full text loads on
  every invocation; none of the big commands use an on-demand reference-file
  split. CE's equivalent orchestrators (`ce-plan` 806, `ce-code-review` 835)
  are as long inline but defer 12–17 reference files *in addition*, keeping
  per-phase details out of the initial load (CE:`skills/ce-plan/SKILL.md:762-766`).
- CE's **evidence dossier / run-artifact** discipline exists here as prose —
  the Subagent Failure Convention prescribes per-run `$RUN_DIR` output files
  read back by orchestrators
  (`plugins/yellow-core/skills/create-agent-skills/SKILL.md:243-410`)
  **[relayed]** — and some pipelines implement it (yellow-debt scanners), but
  review/research agents largely return full findings inline through Task
  results (`plugins/yellow-review/commands/review/review-pr.md` aggregates
  inline reviewer output) **[unverified breadth — adoption per pipeline not
  exhaustively measured]**.
- No equivalent of CE's repo-profile cache: each planning/review run re-derives
  repo orientation. The only cross-session cache is context7 library docs
  (`plugins/yellow-research/hooks/lib/context7-cache.sh`).

### 3.3 Composability — 3.5/5

What's good (verified unless noted):

- A real artifact pipeline exists and is arguably richer than CE's:
  `/workflows:brainstorm` → `docs/brainstorms/…` → `/workflows:plan` →
  `plans/…` → `/workflows:work`, plus the large-project track
  `/workflows:spec` → `plans/specs/` → `/workflows:decompose` →
  `plans/shells/` (with `depends_on`) → `/workflows:pick-next-shell` →
  `/workflows:expand-shell` (paths cited from each command's header; see
  `plugins/yellow-core/commands/workflows/pick-next-shell.md:130-136`).
  This mirrors turbo's plans/specs/shells almost exactly — convergent design.
- Explicit halt-and-resume-from-file: "Context is likely full — run `/clear`,
  then `/workflows:work plans/<shell-slug>.md`"
  (`pick-next-shell.md:133-135`, verified) — same philosophy as turbo's
  fresh-session halts (turbo:`README.md:101-110`).
- Cross-plugin degradation contracts are documented per optional dependency
  (`plugins/yellow-core/CLAUDE.md` "Optional Plugin Dependencies").

Gaps:

- **No standard scope interface.** Each review/analysis surface re-invents
  scope handling; turbo declares one convention for all review skills
  (turbo:`claude/SKILL-CONVENTIONS.md:17`) and CE uses `mode:` tokens +
  structured return envelopes (CE:`skills/ce-work/SKILL.md:363-391`). Here,
  `/review:pr` has `--non-interactive`, `/workflows:compound` has `--in-pr`,
  debt scanners have their own JSON outputs — per-command inventions with no
  shared contract document.
- **Mid-plan progress writeback is stack-path only.** `/workflows:work` writes
  `## Stack Progress` checkboxes back to the plan file only when a
  `## Stack Decomposition` section exists
  (`plugins/yellow-core/commands/workflows/work.md:250-268`) **[relayed]**; the
  default single-branch path tracks progress in in-session TaskCreate state,
  which does not survive a fresh session.
- **No general session-handoff artifact** (turbo `create-handoff`). The halt
  pattern covers the shells track; ad-hoc interrupted work has no save-state
  convention.

### 3.4 Maintainability — 3/5

What's good: this repo mechanically enforces more than either reference —
schema validation, three-way version sync, RULE 13 (library-context drift),
RULE 14/14b (staging-promoter deny-list), W1.5/W1.5b (read-only review agents)
in `scripts/validate-agent-authoring.js` (verified by reading the rule
inventory), plus solutions-doc gating (`scripts/validate-solutions.js`) and
plan-lifecycle gating (`scripts/validate-plans.js`). CE and turbo have almost
no CI on their skill content (CE has release validation + one parity test;
turbo has none visible).

Gaps (all verified this session):

- **The authoring standard is partly aspirational.**
  `validate-agent-authoring.js` contains no check for the three standard
  headings (`## What It Does` / `## When to Use` / `## Usage`) or the 500-line
  ceiling (grep for both → 0 matches), even though root `CLAUDE.md` lists the
  headings rule among validator-enforced items. Only 4/9 `*-conventions`
  skills follow the heading template **[relayed]**;
  `create-agent-skills/SKILL.md` itself uses neither the template nor the
  ceiling (513 lines).
- **Doc drift in catalogs.** `plugins/yellow-core/CLAUDE.md` says "Skills (13)"
  and lists 13; 18 SKILL.md files exist on disk (missing: `mcp-health-probe`,
  `memory-recall-pattern`, `memory-remember-pattern`, `morph-discovery-pattern`,
  `multi-host-fleet`).
- **Stale integration claims.**
  `plugins/yellow-core/agents/research/learnings-researcher.md:294-299` claims
  it is invoked by `/workflows:plan` and `/workflows:brainstorm`; neither
  dispatches it (plan.md uses ruvector `hooks_recall` at
  `plugins/yellow-core/commands/workflows/plan.md:52-58`; brainstorm has zero
  references to learnings or docs/solutions).
- **Setup-command drift**: 17 plugins each hand-roll setup.md (278 vs 74 vs 95
  lines for the same nominal job across yellow-ci/linear/debt) with only a
  weak shared skeleton **[relayed]**.

### 3.5 Duplication — 3/5

- **True near-duplicate (verified):** the ruvector retrieval/dedup protocol is
  specified twice — `plugins/yellow-ruvector/skills/memory-query/SKILL.md:54-67`
  and `plugins/yellow-core/skills/memory-recall-pattern/SKILL.md:105-112` (+
  `memory-remember-pattern/SKILL.md` for the write path) carry the same
  top_k=5 / score<0.5 discard / top-3 / 800-char truncation / 0.82 dedup rules.
  Unlike CE's audited byte-duplication (parity test, CE:`AGENTS.md:223-238`),
  nothing here detects divergence between the two copies.
- **Three parallel memory systems** with partial integration:
  docs/solutions+MEMORY.md ↔ ruvector are cross-wired (staging-reviewer dedups
  against ruvector; compound writes into ruvector), but mempalace is fully
  standalone — zero cross-references either direction (grep verified by agent
  **[relayed]**). Cost: three "remember/recall" surfaces for a model to choose
  among, with overlapping trigger phrases
  (`yellow-ruvector:memory` "remember this" vs `yellow-mempalace:memory-archivist`
  "save a memory").
- **Not duplication (verified as deliberate):** the yellow-core vs yellow-review
  persona pairs are cross-referenced pipeline stages, and yellow-review
  dispatches yellow-core's security/performance personas rather than cloning
  them (`plugins/yellow-review/skills/pr-review-workflow/SKILL.md:90-93`
  **[relayed]**).

### 3.6 Missing capabilities (vs. both references)

1. **Anti-skip / skill-reload behavioral rules (turbo ADDITIONS.md).** Nothing
   in this repo re-anchors skill instructions mid-session or forbids executing
   skill steps from memory. Grep across all plugins for
   PreCompact hooks / "re-read the skill" / reload instructions → zero
   mechanisms (verified; the only context-loss mitigation is the
   halt-and-`/clear` pattern in `pick-next-shell.md:133-135`). Long sessions in
   this repo historically hit exactly the failure modes turbo's rules target
   (skipped steps, merged parallel branches).
2. **Session-lesson routing back into the tooling (turbo /self-improve).** The
   compound pipeline routes learnings to `docs/solutions/` + MEMORY.md +
   ruvector only. No path routes a correction *into the skill/command file that
   caused it* — turbo makes that the highest-priority hard rule
   (turbo:`claude/skills/self-improve/SKILL.md:75`). Given this repo IS the
   plugin source, that is the single highest-leverage missing loop: lessons
   about plugin behavior land in prose memory instead of fixing the plugin.
3. **Plan/brainstorm-time retrieval from docs/solutions/.** CE runs
   `learnings-researcher` at plan time (CE:`skills/ce-plan/SKILL.md:302-321`);
   here only `/review:pr`, `/review:review-all`, and `/docs:review` dispatch it
   (verified dispatch sites), while `/workflows:plan` consults only ruvector
   and `/workflows:brainstorm` consults nothing. The 99-doc solutions corpus is
   invisible to the two commands that shape new work.
4. **General session-handoff artifact (turbo create-handoff).** No equivalent;
   see §3.3.
5. **Repo-profile cache (CE).** Every planning/review run re-derives repo
   orientation; CE amortizes it across 7 skills keyed by git SHA **[relayed]**.
6. **Project glossary loop (CE CONCEPTS.md).** No vocabulary-capture step
   exists in the compound pipeline; CE seeds/refines a glossary on every
   compound run (CE:`skills/ce-compound/SKILL.md:356-374`).
7. **Cross-harness portability.** One-directional only: yellow-codex/council
   call out to Codex/Gemini/OpenCode as reviewers; nothing lets those harnesses
   run these plugins' workflows (verified absence). CE ships native manifests +
   converters; turbo maintains a mirrored Codex tree. (May be intentionally out
   of scope — this is a personal Claude Code system.)
8. **Line-level prose discipline (CE deletion test).** No counterpart to
   CE:`AGENTS.md:122-132`'s falsifiable-constraint test in this repo's
   authoring docs; at ~47.7k instruction lines, the leverage is large.

---

## 4. Candidate Improvement List

Grouped by provisional tier (final tiering, effort, risk, and acceptance checks
belong to Phase 2 `plan.md`). Sources: CE = compound-engineering pattern,
T = turbo pattern.

**Tier 1 candidates — low-risk, no structural change**

- C1. Rewrite the 5 weak skill descriptions (2 missing "Use when", 3 generic
  "integration context") with concrete trigger scenarios; adopt turbo-style
  quoted trigger phrases where user-invoked. (T; §3.1)
- C2. Add CE-style negative-disambiguation clauses to confusable siblings:
  optimize↔workflows:review, debugging↔codex:rescue, ideation↔brainstorming,
  session-history↔ruvector recall, memory systems. (CE; §3.1)
- C3. Fix verified doc drift: yellow-core CLAUDE.md "Skills (13)" → 18 with the
  5 missing entries; `learnings-researcher.md:294-299` stale Integration list.
  (§3.4)
- C4. Bring `create-agent-skills/SKILL.md` under its own 500-line rule by
  moving templates/archetype tables into `references/` (it already has the
  directory). (CE; §3.2)
- C5. Reconcile the root CLAUDE.md claim that the three-heading rule is
  validator-enforced with reality — either add the check (see C10) or soften
  the claim. (§3.4)

**Tier 2 candidates — structural**

- C6. Progressive-disclosure refactor of the 3 large fully-inline skills
  (optimize 461, compound-lifecycle 414, council-patterns 398) and the top
  command offenders (review-pr 879, work 796, setup:all 834 …) into SKILL.md/
  command + `references/` with CE-style load stubs. (CE; §3.2)
- C7. Consolidate the duplicated ruvector memory protocol: make
  yellow-core `memory-recall-pattern`/`memory-remember-pattern` the canonical
  spec and shrink yellow-ruvector `memory-query` to a pointer — or, if runtime
  constraints force duplication (cross-plugin skill limits, cf.
  docs/solutions cross-plugin-shared-skill-pattern), add a CE-style parity
  check to CI. (CE; §3.5)
- C8. Define one standard scope/mode interface document (diff-command | file
  list | PR number; `--non-interactive` semantics; structured return envelope)
  and align the review/debt/docs surfaces to it. (T `SKILL-CONVENTIONS.md:15-17`,
  CE mode tokens; §3.3)
- C9. Extend `## Stack Progress`-style plan-file checkbox writeback to the
  default (non-stack) `/workflows:work` path so execution state survives a
  fresh session. (T shells / CE U-ID pattern; §3.3)
- C10. Add validator rules for the currently-aspirational authoring standards:
  SKILL.md line ceiling (warning tier), three-heading template where claimed,
  and trigger-clause presence in `description:`. (repo's own standard; §3.4)
- C11. Unify or explicitly de-overlap the three memory systems' trigger
  surfaces (ruvector / mempalace / MEMORY.md) so "remember this" has one
  documented router. (§3.5)

**Tier 3 candidates — new capability**

- C12. **ADDITIONS.md-equivalent behavioral rules**: a small installable block
  (CLAUDE.md section or SessionStart hook output) with turbo's anti-skip,
  no-steps-from-memory, no-branch-merging, and task-list-continuation rules,
  adapted to this repo's orchestrator commands. (T `claude/ADDITIONS.md:7-18`)
- C13. **/self-improve-style lesson routing with a skill-first rule**: extend
  the compound pipeline (interactive command and/or staging-reviewer scoring
  taxonomy) so lessons that correct a plugin's own skill/command behavior are
  routed as *edits or issues against that file* (this repo is the source repo —
  gated by changeset/PR flow) instead of landing only in docs/solutions.
  (T `self-improve/SKILL.md:75-106`)
- C14. **Session-handoff skill**: `.claude/`-scratch or `plans/handoff/`
  artifact capturing task, state, in-flight changes, next action; complements
  the existing halt-and-`/clear` pattern for non-shell work.
  (T `create-handoff`)
- C15. **Learnings pre-pass for /workflows:plan and /workflows:brainstorm**:
  dispatch the existing `learnings-researcher` (Haiku, already built) the way
  `/review:pr` Step 3d does; also makes its Integration section true again.
  (CE plan-time retrieval; §3.6.3)
- C16. **Run-artifact convention rollout**: make the already-documented
  Subagent Failure Convention (per-run dir, path-not-content returns) the
  default for multi-agent orchestrators (review-pr aggregation, research
  conductor), citing CE's issue-#956 rationale. (CE `ce-compound/SKILL.md:96-110`)
- C17. **Repo-profile cache**: git-SHA-keyed orientation cache shared by
  plan/review/debt/docs commands, with docs/solutions explicitly excluded from
  caching. (CE `repo-profile-cache.md`)
- C18. **CONCEPTS.md vocabulary capture** step in knowledge-compounder.
  (CE `ce-compound/SKILL.md:356-374`)

---

*Phase 1 ends here. Phase 2 (`docs/optimization/plan.md`) will tier these with
per-item effort (S/M/L), risk, files affected, and binary acceptance checks,
after explicit approval.*
