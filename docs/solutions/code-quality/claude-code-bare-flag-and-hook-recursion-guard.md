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
