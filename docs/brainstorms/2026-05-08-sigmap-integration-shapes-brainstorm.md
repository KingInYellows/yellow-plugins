# Sigmap Integration Shapes — Brainstorm

**Date:** 2026-05-08
**Pain:** Context-length problems on large-codebase tasks — Claude opens too many files or prompt gets truncated. Observed in two specific scenarios: (B) targeted-fix tasks where Claude reads too many adjacent files, and (D) cold-start on unfamiliar codebases before ruvector has session history.
**Stack context:** yellow-ruvector active with hooks running; ruvector handles "what did we learn before?" but not "make command output smaller right now."
**Research inputs:** `docs/research/sigmap-evaluation-for-yellow-plugins.md`, `docs/research/rtk-vs-sigmap-context-management-comparison.md`

---

## What We're Building

A two-layer strategy to address token-budget pressure in large-codebase sessions. The question started as "where does sigmap fit?" but comparative research surfaced RTK (Rust Token Killer) as a more direct answer to the stated pain, operating on a completely different layer. The honest answer is: build RTK first as a yellow-rtk plugin, measure whether targeted-fix over-reading remains painful after 14 days, and only then decide which sigmap integration shape is warranted.

The two tools are orthogonal, not competing:

- **RTK** compresses the OUTPUT of shell commands (git status, cat, ls, test runners) before it enters the context window. It fires automatically via a PreToolUse hook. It reduces token cost per command by 60-99%.
- **sigmap** ranks and summarizes which SOURCE FILES are relevant to a given query. It requires explicit MCP tool invocation or a workflow command pre-pass. It reduces the wrong-file-loading problem, not the command-output-bloat problem.

Neither tool overlaps with ruvector. **Both RTK and ruvector register PreToolUse hooks** (verified in `plugins/yellow-ruvector/.claude-plugin/plugin.json` — ruvector's matcher is `Edit|Write|MultiEdit|Bash`), but they perform different operations on different data: RTK rewrites the command's `stdout` after execution to compress output, ruvector injects context before execution. The "no collision" conclusion holds operationally — different operations, different data — but it is **not** because of different hook types. sigmap and ruvector partially overlap on "file relevance ranking" but answer different questions (TF-IDF structural ranking vs. semantic embedding recall).

---

## Why This Approach

The layered recommendation — RTK first, sigmap second-phase — follows from three observations:

1. The stack currently has zero coverage for command-output compression. Every `git log`, `cat`, `ls`, and test run in a Claude Code session is currently full-size. RTK changes this immediately and automatically, with zero changes to existing workflows.

2. For Pain D (cold-start), RTK activates from session prompt one regardless of ruvector history. sigmap requires either a standing `CLAUDE.md` context section or an explicit MCP tool call — neither is guaranteed to activate automatically on cold-start without a command wrapper.

3. For Pain B (targeted-fix over-reading), RTK reduces the token cost of each file read that Claude makes, even if it still reads too many. sigmap reduces the number of files loaded, but only if invoked at the right moment. After RTK is deployed, if the over-reading problem persists, sigmap addresses a different layer of it.

Shipping RTK first also gives a measurable baseline: `rtk gain` shows actual per-session savings from a local SQLite DB. After 14 days, you have real data to answer "is file-selection still the bottleneck?" rather than guessing.

---

## Key Decisions

### Reframing: two orthogonal layers

The original question was "where does sigmap fit in the plugins?" The better question turned out to be "which layer of the token-budget problem should we address first?" RTK addresses output compression (happening now, every session). sigmap addresses file-selection discipline (relevant but partially covered by ruvector). Both have a place; they should be treated as phase 1 and phase 2, not as competing options.

---

### Approach A: sigmap MCP shim in yellow-ruvector (second-phase, lowest cost)

Add a single `mcpServers` entry alongside the existing `ruvector` server in yellow-ruvector's `plugin.json`, pointing to the standalone sigmap binary in MCP mode. No hooks, no commands, no agents — just the server entry. sigmap's 9 tools become available as `mcp__plugin_yellow-ruvector_sigmap__query_context`, `mcp__plugin_yellow-ruvector_sigmap__search_signatures`, etc.

```json
"sigmap": {
  "command": "/usr/local/bin/sigmap",
  "args": ["--mcp"]
}
```

**Pros:**
- One JSON block, reversible in 30 seconds
- Zero interaction with ruvector's hook pipeline — the two MCP servers are completely independent
- Zero cold-start penalty unless a sigmap tool is actually called
- Opt-in by design: sigmap tools only run when explicitly invoked

**Cons:**
- No scaffolding around when to call which tool — requires remembering sigmap exists and knowing which of its 9 tools apply
- No documentation in the plugin about sigmap tools or trigger conditions
- MCP namespace lives under yellow-ruvector, which is a confusing home for a file-ranking tool
- Does not solve Pain D automatically — cold-start still requires explicit tool invocation

**Best when:** You want to validate that sigmap's `query_context` or `get_map` actually reduces file sprawl on the specific repos before building anything more. This is a 14-day pilot with a one-line rollback. Run this only after RTK is deployed and measured.

**Do not ship sigmap this way before RTK.** Without RTK baseline data, you cannot distinguish "sigmap helped" from "the session was just smaller."

---

### Approach B: sigmap pre-pass wired into workflow commands (second-phase, deliberate)

Update specific workflow command files to include an explicit sigmap pre-pass step. Before generating any output, those commands call `mcp__plugin_yellow-ruvector_sigmap__query_context` with the task description and use the ranked file list as a grounding signal before proceeding.

**Which commands would benefit and when:**

| Command | Pre-pass tool | Trigger condition | Fallback |
|---|---|---|---|
| `/workflows:plan` | `query_context` with task description | Repo has >200 files OR task description mentions "refactor", "migration", "cross-cutting" | Skip pre-pass; proceed directly |
| `/workflows:work` | `search_signatures` with subtask description | Subtask targets an unfamiliar module (no ruvector history for this path) | Fall through to ruvector recall alone |
| `/research:code` | `get_map` for codebase overview | Research question is structural ("how does X work", "where is Y implemented") | Skip; use grep/search directly |
| `/workflows:brainstorm` on a code topic | `query_context` | Topic mentions a specific component or file area | Skip |

**Trigger condition rationale — what NOT to trigger on:**
- Small repos (<200 files): sigmap's ranking adds latency without meaningful payoff
- Tasks already scoped to known files: if the plan already lists target files, pre-pass is noise
- Sessions where ruvector's session-start hook returned high-confidence memories: ruvector already handled orientation for this area
- Single-file edits: the overhead of a pre-pass exceeds the value

**Interaction with ruvector's hooks:**
- `UserPromptSubmit` hook fires on every prompt and injects relevant ruvector memories. If ruvector's injection already surfaces the right files, the sigmap pre-pass returns redundant signal — watch for this in practice.
- The two systems use different ranking algorithms (embeddings vs. TF-IDF). On cold-start where ruvector has no history, sigmap pre-pass provides value ruvector cannot. After ruvector accumulates session history, the marginal gain narrows.
- No technical collision — ruvector injects into system context, sigmap pre-pass results are surfaced inline in the command flow.

**Fallback if sigmap returns poor results:**
- If `query_context` returns fewer than 3 files or all results are test files, skip the pre-pass output and proceed without it. Treat sigmap signal as advisory, not mandatory.
- If the sigmap MCP server is not available (binary missing, cold-start failure), the command should degrade gracefully rather than fail.

**Pros:**
- Makes sigmap automatic at the right trigger points
- Solves both B and D for the commands that wrap it
- Complements ruvector: structural TF-IDF ranking (sigmap) + semantic embedding recall (ruvector) answer different questions

**Cons:**
- Requires updating command files — more surface area, validators flag tool list changes
- Every invocation of the wrapped command now has sigmap cold-start latency even when the repo is small
- If the pre-pass misses (wrong files ranked), the command proceeds with bad grounding signal
- Creates coupling: command failures if sigmap MCP server is misconfigured

**Best when:** Approach A pilot has confirmed sigmap reduces file sprawl on the repos where pain is occurring, and you want that behavior to be automatic for plan/work commands specifically. Build Approach B only after Approach A is validated.

---

### Approach C: dedicated yellow-sigmap plugin (second-phase, full investment)

A new plugin in `plugins/yellow-sigmap/` with its own `plugin.json`, a skill explaining when to use each of the 9 MCP tools, a `/sigmap:orient` command for deliberate cold-start orientation, and a cross-plugin dependency on yellow-ruvector declared via the X-01 pattern.

**Full plugin shape:**

`plugin.json` would include:
- `mcpServers.sigmap` pointing to the standalone binary
- `commands` listing `/sigmap:orient`, `/sigmap:map`, `/sigmap:impact`
- `dependencies` with `yellow-ruvector` as optional (orient command uses ruvector's session context to detect cold-start)
- `userConfig` with `sigmap_binary_path` (type: `file`, title: "Path to sigmap binary") and `sigmap_min_repo_size` (type: `number`, title: "Minimum file count to trigger pre-pass")
- No hooks — sigmap has no hook integration point

**Commands:**
- `/sigmap:orient $ARGUMENTS` — runs `query_context` with the task description, then `search_signatures` for the top-ranked files, and outputs a compact "relevant files" list with function/class signatures. Designed as the first step of any cold-start session on an unfamiliar area.
- `/sigmap:map` — runs `get_map` for a codebase overview and outputs module boundaries, major entry points, and dependency surface. Use at start of planning sessions.
- `/sigmap:impact $ARGUMENTS` — runs `get_impact` with a file path or function name. Shows what changing that surface would affect. Use before any refactor that might have broad cascade effects.

**`/sigmap:orient` step-by-step:**
1. Check `command -v sigmap` — fail clearly if not installed, with install instructions
2. Check ruvector session context: if ruvector's recall returned relevant memories for this area, note this and proceed more conservatively (less pre-pass weight needed)
3. Call `mcp__plugin_yellow-sigmap_sigmap__query_context` with the task description from `$ARGUMENTS`
4. Call `mcp__plugin_yellow-sigmap_sigmap__search_signatures` on the top 5 ranked files
5. Output: ranked file list, key signatures, "files you likely need" summary — no more than 30 lines
6. Do NOT write to `CLAUDE.md` or any file — output inline only. The CLAUDE.md write path is explicitly disabled.

**Cross-plugin dependency (X-01 pattern):**
```json
"dependencies": [
  {
    "name": "yellow-ruvector",
    "version": "*",
    "optional": true,
    "reason": "sigmap:orient reads ruvector session context to detect cold-start conditions"
  }
]
```

**Marketplace entry:**
```json
{
  "name": "yellow-sigmap",
  "description": "Pre-task file ranking and codebase orientation via sigmap signature indexing",
  "category": "development"
}
```

**What requires updating beyond the plugin itself:**
- `.claude-plugin/marketplace.json` — add the plugin entry
- `plugins/yellow-core/commands/setup/all.md` — add to the setup dashboard (validate-setup-all.js will fail without this)
- `pnpm changeset` — required for any marketplace change

**Pros:**
- Clean ownership — sigmap has its own namespace, CLAUDE.md, README, and doesn't pollute ruvector
- `/sigmap:orient` gives a named, intentional invocation point that works well for cold-start
- Easier to evolve independently — can add agents, new commands, hook integration without touching ruvector
- Cleanest for marketplace users: installable independently, uninstallable without side effects

**Cons:**
- Full plugin overhead for what is fundamentally one MCP server entry + 3 commands
- Requires sigmap to prove its value first — a full plugin at 181 stars and single-maintainer bus-factor is a significant bet
- Cross-plugin dependency adds manifest complexity
- `/sigmap:orient` requires the user to remember to run it — does not fire automatically

**Best when:** sigmap has proven measurable value over a 30-60 day pilot (Approach A or B), the community count has grown past the research doc's 500-star threshold, and you have a clear repeating use pattern that justifies dedicated documentation and commands.

---

### Approach D (NEW): yellow-rtk plugin — build this first

A new plugin in `plugins/yellow-rtk/` that wraps the RTK CLI. No MCP server. No agents. Three commands plus a SessionStart hook that warns if `rtk` is not on PATH.

**This brainstorm intentionally does NOT duplicate the Approach D design.** The full plugin design — `plugin.json` shape, command behavior, SessionStart hook script, CLAUDE.md collision mitigation, telemetry policy, version pinning, marketplace integration, edge cases, security considerations — lives in the implementation plan and is the authoritative source:

- → **`plans/yellow-rtk-plugin.md`**

**Why this Approach D, in one paragraph:** RTK is a CLI binary that compresses Claude Code's shell-tool output via a PreToolUse hook installed in `~/.claude/settings.json`. It has zero overlap with ruvector (different hook surface, different data), activates automatically from session prompt one, gives a falsifiable ROI signal via `rtk gain`'s SQLite dashboard within 7 days, and has materially lower bus-factor than sigmap (3+ contributors per README, Homebrew formula). The plugin owns three commands (`/rtk:setup`, `/rtk:gain`, `/rtk:discover`) plus a thin SessionStart probe — RTK itself owns the PreToolUse hook in user space.

**Pros:** Solves a problem the stack has zero current coverage for; automatic; measurable ROI in 7–14 days; zero collision with ruvector; single Rust binary, Homebrew install.

**Cons:** Adds a Rust binary prerequisite (Homebrew makes trivial); RTK's compression is opaque to Claude — filter bugs cause silent data loss; orphan PreToolUse hook persists in `settings.json` after `/plugin marketplace remove` (manual cleanup documented in the plan).

**Best when:** Observable context-length pain on large-codebase sessions and you want an immediate, automatic, measurable improvement. Build this before any sigmap integration shape.

---

## Open Questions

1. **Hook cleanup on uninstall:** yellow-rtk's plugin.json doesn't own the PreToolUse hook entry in `settings.json` — RTK installs that directly. If yellow-rtk is uninstalled, the hook remains. Should `/rtk:setup` add a note about manual cleanup, or should the plugin track the hook and offer a `/rtk:teardown` command?

2. **Approach A pilot criteria:** After yellow-rtk is deployed and `rtk gain` is running, what metric should trigger moving to the Approach A sigmap pilot? A rough candidate: if after 14 days of RTK, the average number of files-opened-per-targeted-fix on repos with 200+ files is still greater than 8-10, sigmap pre-pass is worth piloting. This needs to be measured empirically — the right threshold is not known in advance.

3. **sigmap CLAUDE.md collision in practice:** Approach A uses sigmap in MCP-query-only mode (no file writes). Approaches B and C also explicitly disable file writes. But sigmap's MCP tools do have side effects (index updates, cache writes). The collision risk is mitigated but not zero — worth documenting the `.gitignore` entries before any pilot begins.

4. **RTK filter gaps on this stack's specific commands:** RTK supports 100+ commands, but the yellow-plugins workflow has some unusual patterns (e.g., `pnpm validate:schemas`, `gt stack submit`, `bats tests/`). The `/rtk:discover` command will surface which of these are being compressed vs. passed through. The first `/rtk:discover` run after deployment is the first real data point.

5. **yellow-rtk vs. embedding RTK setup into yellow-ruvector:** Since RTK is orthogonal to ruvector but both address "context quality," there's an argument for adding `/rtk:setup` and `/rtk:gain` as commands in yellow-ruvector rather than a separate plugin. Counter-argument: clean separation of concerns, independent install/uninstall, yellow-ruvector is already a dense plugin. Separate plugin is the cleaner choice unless yellow-ruvector's CLAUDE.md grows to include RTK guidance anyway.

---

## Layered Recommendation

**Phase 1 — Build yellow-rtk, ship, measure (target: next 2 weeks)**

Build the yellow-rtk plugin as specified in Approach D. It is the minimum change with the maximum automatic impact on both target pains. After 7-14 days of deployment, run `/rtk:gain` and verify measurable savings on the repos where context pressure was observed. RTK should show 60-80%+ savings on `git log`, `cat`, `ls`, and test runner outputs.

**Phase 2 — Evaluate residual pain (2-4 weeks after Phase 1)**

After RTK is deployed and measured, assess whether targeted-fix over-reading remains painful. Ask: "Is Claude still opening too many files on targeted-fix tasks, or did RTK's per-command compression make the over-reading tolerable?" If the answer is "still painful," move to Approach A.

**Phase 3 — sigmap Approach A pilot (if Phase 2 confirms residual pain)**

Add the sigmap MCP shim to yellow-ruvector's `plugin.json`. For 2 weeks, manually call `mcp__plugin_yellow-ruvector_sigmap__query_context` before targeted-fix tasks and observe whether the ranked file list matches what Claude eventually opens. Track the delta.

**Phase 4 — Approach B or C (if Approach A pilot succeeds)**

If the Approach A pilot shows sigmap's file ranking is consistently better than ruvector's injection for targeted-fix cold-start, and if the invocation friction of manually calling the MCP tool is noticeable, move to Approach B (wire into `/workflows:plan`) or Approach C (dedicated yellow-sigmap plugin). Approach B is the right next step if the value is proven but the invocation is too manual. Approach C is warranted only if the use cases diversify beyond plan and targeted-fix.

---

## Decision Criteria for Phase 2 (sigmap trigger)

After 14 days of RTK deployment, run `/rtk:gain` and also manually review 5-10 representative sessions from the repos where context pressure is observed. Move to sigmap Approach A if:

- Average files-opened-per-targeted-fix on repos with 200+ files is still > 8 after RTK is active
- There are 3+ sessions where ruvector's session-start hook logged no relevant memories (cold-start confirmed) AND Claude issued 10+ file reads in the first 5 minutes of the session
- `rtk gain` shows RTK is delivering savings (confirming the tool is working and the remaining pain is in file selection, not command output bloat)

Do not move to sigmap if:
- RTK deployment shows the sessions are now under the context limit with command compression alone
- ruvector's memories have accumulated enough history that cold-start is no longer blank-slate for these repos
- The repos where pain was observed are under 10K LOC (sigmap adds latency without meaningful payoff)

---

## Source Research

- `docs/research/sigmap-evaluation-for-yellow-plugins.md` — sigmap mechanism, maturity, overlap with ruvector, integration cost
- `docs/research/rtk-vs-sigmap-context-management-comparison.md` — head-to-head comparison, RTK mechanism, integration shapes, risk analysis
- `plugins/yellow-ruvector/.claude-plugin/plugin.json` — plugin.json structure used to ground Approaches A/D
- `plugins/yellow-ci/.claude-plugin/plugin.json` — minimal plugin shape with SessionStart hook, used to ground Approach D
- `.claude-plugin/marketplace.json` — category field and plugin entry format
