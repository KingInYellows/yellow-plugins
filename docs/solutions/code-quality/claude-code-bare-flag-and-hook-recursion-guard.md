---
name: claude-code-bare-flag-and-hook-recursion-guard
description: Use `--bare` on every `claude -p` invocation spawned from a hook to prevent the child session from loading hooks/plugins and triggering recursion; the env-var sentinel pattern is defense-in-depth, not the primary guard.
date: 2026-05-19
category: code-quality
track: knowledge
problem: A `claude -p` session spawned from within a Stop or SessionStart hook will, by default, auto-discover and fire its own hooks/plugins — including the same hook that spawned it — creating an unbounded recursion cascade.
tags:
  - claude-code
  - hooks
  - bare-mode
  - recursion-guard
  - background-agents
components:
  - plugins/yellow-core/hooks/scripts/session-start.sh
  - plugins/yellow-core/hooks/scripts/stop.sh
  - plugins/yellow-core/commands/compound/review-staged.md
source: pr-review-research
---

# Claude Code `--bare` flag is the primary hook-recursion guard, not env-var sentinels

## Context

The compound-staging pipeline (PRs #540-544) spawns `claude -p` from inside
SessionStart and Stop hooks. Without the `--bare` flag, the child session:

1. Loads `.claude/settings.json` and picks up the same hooks.
2. Fires its own SessionStart hook, which evaluates thresholds again and
   may spawn another `claude -p`.
3. Triggers a Stop hook on completion, which writes another pending entry.

This creates a recursion cascade that the existing `COMPOUND_DRAIN_IN_PROGRESS`
env-var sentinel only partially defends against (the env var must
propagate cleanly through every `claude -p` invocation, and Claude Code's
hook-subprocess environment inheritance is not documented as guaranteed).

## Resolution

Per the official Claude Code CLI docs (`code.claude.com/docs/en/headless`):

> `--bare` **skips auto-discovery of hooks, skills, plugins, MCP servers,
> auto memory, CLAUDE.md.** Sets `CLAUDE_CODE_SIMPLE`. `--bare` is the
> recommended mode for scripted calls and "will become the default for
> `-p` in a future release."

**Pattern:** every `claude -p` invocation from inside a hook MUST include
`--bare` as the primary recursion guard. The env-var sentinel
(`COMPOUND_DRAIN_IN_PROGRESS=1`) remains as defense-in-depth for edge
cases where `--bare` is accidentally omitted or where hooks load via
explicit `--mcp-config`.

```bash
# Hook-spawned drain (correct):
COMPOUND_DRAIN_IN_PROGRESS=1 claude -p \
  --bare \
  --permission-mode bypassPermissions \
  --max-turns 50 \
  --output-format json \
  "$DRAIN_PROMPT" >> "$DRAIN_LOG" 2>&1
```

## Other key findings from this research

1. **SessionStart cannot block** — exit code 2 shows stderr to the user
   but does NOT block session startup. Stop hook CAN block via exit 2 or
   `decision: "block"`.

2. **`disallowedTools: [AskUserQuestion]` is runtime-enforced** (removes
   the tool from the model's context list entirely), not advisory. This
   is the load-bearing scheduler-level deny for non-interactive drain
   agents.

3. **`background: true` frontmatter requires `run_in_background: true`
   on the Task call** — without both, the orchestrator still serializes.

4. **Plugin-scoped agents have `permissionMode` silently dropped.** The
   `--permission-mode bypassPermissions` flag must be on the `claude -p`
   CLI call, not in the agent frontmatter. (Agent frontmatter
   `permissionMode` works for non-plugin agents but is a no-op for
   plugin-shipped agents.)

5. **`bypassPermissions` requires prior interactive acceptance.** A user
   must run `claude --permission-mode bypassPermissions` once
   interactively before the hook-spawned `claude -p` can use it. This is
   a first-run setup requirement that must be documented in the plugin's
   setup instructions.

6. **Env vars available to all hook subprocesses:** `CLAUDE_PROJECT_DIR`,
   `CLAUDE_PLUGIN_ROOT`, `CLAUDE_PLUGIN_DATA`, `CLAUDE_ENV_FILE` (for
   SessionStart/Setup/CwdChanged/FileChanged hooks), `CLAUDE_EFFORT`,
   `CLAUDE_CODE_REMOTE`.

7. **The `async` and `asyncRewake` fields exist on command hooks only**,
   not on SessionStart or Stop event hooks. Non-blocking behavior for
   event hooks comes from disowned-subshell patterns, not a manifest flag.

## Sources

- `https://code.claude.com/docs/en/hooks` — official, verified 2026-05-19
- `https://code.claude.com/docs/en/cli-reference` — official
- `https://code.claude.com/docs/en/headless` — official, `--bare` mode spec
- `https://code.claude.com/docs/en/permission-modes` — official
- `https://code.claude.com/docs/en/tools-reference` — official
- `docs/solutions/code-quality/subagent-frontmatter-field-catalog.md` —
  local team-curated, verified 2026-05-04

## Apply when

- Authoring a Claude Code plugin that spawns `claude -p` from a hook.
- Reviewing hooks that do not already include `--bare`.
- Debugging unbounded recursion symptoms in hook-based pipelines.

---

## Update — 2026-05-20

### Exception: `--bare` is incompatible with drain prompts that invoke plugin agents via Task

**Context:** The compound-staging drain (PR #542) spawns `claude -p` from the
Stop hook to process queued compound entries. The drain prompt instructs the
child session to invoke `yellow-core:workflow:staging-reviewer` via Task — a
plugin agent registered in `plugin.json`.

**The conflict:** `--bare` skips plugin auto-discovery entirely. A child session
launched with `--bare` has no plugins registered, so
`yellow-core:workflow:staging-reviewer` does not exist in its Task registry.
The subagent invocation fails — the Task tool reports the agent is not found.

**Consequence for the existing guidance:** When a hook-spawned `claude -p` must
itself invoke plugin agents via Task, `--bare` cannot be the recursion guard.
The env-var sentinel (`COMPOUND_DRAIN_IN_PROGRESS=1`) becomes the **only**
load-bearing guard. Both mechanisms work together only when the child session's
prompt is self-contained and does not need plugin auto-discovery.

**Decision tree:**

```
Does the drain prompt invoke any plugin agent (via Task subagent_type)?
├── No  → use --bare (primary) + COMPOUND_DRAIN_IN_PROGRESS (defense-in-depth)
└── Yes → MUST drop --bare
           Use COMPOUND_DRAIN_IN_PROGRESS=1 as the sole recursion guard
           Verify EVERY hook in the plugin checks this sentinel at the TOP
           of the script (before any other work) and calls json_exit early
```

**Pattern for plugin-invoking drains (no `--bare`):**

```bash
# Stop hook — drain that calls plugin agents
COMPOUND_DRAIN_IN_PROGRESS=1 claude -p \
  --permission-mode bypassPermissions \
  --max-turns 50 \
  --output-format json \
  "$DRAIN_PROMPT" >> "$DRAIN_LOG" 2>&1 &
disown
```

```bash
# session-start.sh / stop.sh — sentinel guard (must be the FIRST check)
if [ "${COMPOUND_DRAIN_IN_PROGRESS:-}" = "1" ]; then
  json_exit  # child drain session — skip all hook logic
fi
```

Every hook in the plugin must carry this guard. Env-var inheritance through
`claude -p` subprocess environments is reliable — Claude Code passes the
spawning shell's environment to hook subprocesses. If any hook in the plugin
fires in the child session without the sentinel check, it re-enters the drain
dispatch logic and can recurse.

**Source:** PR #542 review round 2, compound-staging stack.
