# Brainstorm: setup:all Command

Date: 2026-03-04

## What We're Building

A single `setup:all` orchestrator command in **yellow-core** that configures every
yellow-plugin on a fresh machine. The command works in hybrid mode:

1. **Dashboard phase** -- Run non-interactive checks across all 9 plugins in a
   fixed order. Check CLI prerequisites, environment variables, config files, and
   MCP connectivity. Render a unified status table showing READY / NEEDS SETUP /
   MISSING for each plugin.

2. **Interactive phase** -- After the dashboard, prompt: "N plugins need
   interactive setup -- run them now?" If yes, walk through only the plugins that
   need attention by invoking their existing `/X:setup` commands via the Skill
   tool, sequentially, in the same fixed order.

3. **Final summary** -- After all interactive setups complete (or are skipped),
   produce a consolidated before/after dashboard showing what changed.

The command assumes all plugins are installed. It does not install plugins -- it
configures them.

### Fixed Plugin Order

The order is hard-coded and chosen to respect implicit dependencies (e.g.,
ruvector and morph should be set up before research checks their MCP health):

| Order | Plugin             | Setup Type        | What Gets Checked                                    |
|-------|--------------------|-------------------|------------------------------------------------------|
| 1     | yellow-ruvector    | Install + init    | node, npm, ruvector CLI, `.ruvector/` dir, .gitignore |
| 2     | yellow-morph       | Env check         | rg, node, npx, `MORPH_API_KEY`                       |
| 3     | yellow-devin       | Env check         | curl, jq, `DEVIN_SERVICE_USER_TOKEN`, `DEVIN_ORG_ID` |
| 4     | yellow-semgrep     | Env check         | curl, jq, semgrep CLI, `SEMGREP_APP_TOKEN`           |
| 5     | yellow-research    | Env check + MCP   | `EXA_API_KEY`, `TAVILY_API_KEY`, `PERPLEXITY_API_KEY`, MCP sources |
| 6     | yellow-chatprd     | Interactive wizard | MCP connectivity, org/project config file             |
| 7     | yellow-ci          | Interactive wizard | gh, jq, ssh, GitHub auth, runner SSH config           |
| 8     | yellow-browser-test| Interactive wizard | node, npm, agent-browser, app discovery config        |
| 9     | yellow-core        | Detect + generate  | python3, statusline script, `~/.claude/settings.json` |

Rationale: Infrastructure tools first (ruvector, morph), then API-key plugins
(devin, semgrep, research), then interactive wizards (chatprd, ci, browser-test),
and finally statusline last because it detects all other installed plugins.

### Dashboard Output Format

The dashboard phase produces a table like:

```
yellow-plugins Setup Dashboard
===============================

  Prerequisites
    node v22.x          OK
    npm 10.x            OK
    curl                OK
    jq                  OK
    rg (ripgrep)        OK
    gh (GitHub CLI)      OK
    ssh                 OK
    python3 3.11        OK
    semgrep             NOT FOUND

  Environment Variables
    MORPH_API_KEY              set
    DEVIN_SERVICE_USER_TOKEN   set
    DEVIN_ORG_ID               set
    SEMGREP_APP_TOKEN          NOT SET
    EXA_API_KEY                set
    TAVILY_API_KEY             set
    PERPLEXITY_API_KEY         NOT SET

  Plugin Status
    Plugin               Status          Detail
    -------------------  -----------     --------------------------------
    yellow-ruvector      READY           .ruvector/ initialized, doctor passing
    yellow-morph         READY           API key set, MCP package found
    yellow-devin         READY           Token valid, org ID set
    yellow-semgrep       NEEDS SETUP     SEMGREP_APP_TOKEN not set, semgrep CLI missing
    yellow-research      PARTIAL         2/3 API keys set (Perplexity missing), 3/4 MCP sources
    yellow-chatprd       NEEDS SETUP     No config file at .claude/yellow-chatprd.local.md
    yellow-ci            READY           gh authenticated, runner config exists
    yellow-browser-test  NEEDS SETUP     No config file at .claude/yellow-browser-test.local.md
    yellow-core          NEEDS SETUP     Statusline not installed

  Summary: 4 ready, 1 partial, 4 need setup
```

### Status Classification

Each plugin gets one of three statuses based on its dashboard checks:

- **READY** -- All prerequisites met, env vars set, config files present. No
  interactive setup needed.
- **PARTIAL** -- Functional but degraded. Some optional env vars missing (e.g.,
  research with 2/3 API keys). Interactive setup is optional.
- **NEEDS SETUP** -- Missing required prerequisites, env vars, or config files.
  Interactive setup recommended.

### Interactive Phase Flow

After the dashboard:

- If 0 plugins need setup: "All plugins are configured. Nothing to do."
- If 1+ plugins need setup: prompt with the list and options:
  - "Run all N setups now" -- walk through each sequentially
  - "Pick which to run" -- let the user choose from a checklist
  - "Skip for now" -- exit with the dashboard as-is

Each interactive setup is invoked via the Skill tool (e.g.,
`Skill("semgrep:setup")`). This reuses the existing setup commands unchanged.
Between each setup, show a brief transition: "Next: yellow-chatprd (3 of 4)..."

### Final Summary

After interactive setups complete, re-run the dashboard checks and show a
before/after comparison:

```
Setup Complete -- Before/After
===============================

  Plugin               Before          After
  -------------------  -----------     -----------
  yellow-semgrep       NEEDS SETUP     READY
  yellow-chatprd       NEEDS SETUP     READY
  yellow-browser-test  NEEDS SETUP     READY
  yellow-core          NEEDS SETUP     READY

  Overall: 8 ready, 1 partial (yellow-research -- Perplexity key optional)
```

## Why This Approach

**Single orchestrator command (Approach A)** was chosen over a two-layer
script+command system or a plugin registry with auto-discovery because:

1. **Simplest to build.** One markdown command file in yellow-core. No new Bash
   scripts, no schema changes to plugin.json, no dynamic discovery logic. The
   orchestrator owns the dashboard checks; individual setup commands own their
   interactive wizards.

2. **Reuses everything that exists.** All 9 setup commands work unchanged. The
   Skill tool already supports cross-plugin command invocation. The dashboard
   checks are lightweight (env var presence, CLI tool existence, config file
   existence) and intentionally do not duplicate the full validation each setup
   command performs -- that is the setup command's job.

3. **YAGNI.** The plugin list changes rarely (a few times per quarter). A
   hard-coded list is trivial to update. Dynamic auto-discovery and plugin.json
   schema extensions would be over-engineered for 9 plugins maintained by the
   same team. If the ecosystem grows to 20+ plugins with independent authors,
   Approach C (registry) can be revisited.

4. **Hybrid mode gets the best of both worlds.** Users who just want to see what
   is missing get a fast dashboard without sitting through 9 sequential wizards.
   Users on a fresh machine can run the interactive setups for only the plugins
   that actually need them.

## Key Decisions

1. **Hybrid mode over pure non-interactive or pure interactive.** Dashboard
   first for visibility, then interactive setups only for plugins that need it.
   This respects the user's time -- a machine with 7/9 plugins already configured
   should not walk through 9 wizards.

2. **Lives in yellow-core.** Core is the shared foundation and already houses
   statusline:setup and workflow commands. The setup:all command is an ecosystem
   concern, not a per-plugin concern.

3. **Fixed order, not dynamic dependency resolution.** The order is hard-coded:
   infrastructure first (ruvector, morph), API-key plugins next (devin, semgrep,
   research), interactive wizards after (chatprd, ci, browser-test), statusline
   last. This is simpler than a dependency graph and the order rarely changes.

4. **Dashboard checks are shallow.** The dashboard checks env var presence and
   CLI tool existence. It does not validate API key formats, test live API
   connectivity, or probe permissions -- those are the individual setup commands'
   responsibilities. This keeps the orchestrator lightweight and avoids
   duplicating logic.

5. **Invoke existing setup commands via Skill tool.** No refactoring of existing
   setup commands. The orchestrator calls `Skill("ruvector:setup")` etc. This
   means the interactive phase benefits from any improvements made to individual
   setup commands automatically.

6. **Before/after final summary.** Re-run the same dashboard checks after
   interactive setups complete. Show only plugins whose status changed. This
   gives the user confidence that the setups actually worked.

7. **Command name: `setup:all`.** Follows the existing `namespace:action`
   pattern (statusline:setup, research:setup). The `setup` namespace is
   appropriate since this is a cross-cutting setup concern owned by core.

## Open Questions

1. **Should PARTIAL plugins be included in the interactive phase prompt?**
   Currently, PARTIAL means functional-but-degraded (e.g., research with 2/3 API
   keys). Should the prompt offer to run their setup, or only offer NEEDS SETUP
   plugins? Leaning toward including PARTIAL with a note that setup is optional.

2. **What happens if an interactive setup fails mid-way?** If chatprd:setup
   fails (e.g., MCP unavailable), should setup:all continue to the next plugin
   or stop? Leaning toward continue-and-record-failure, since each setup is
   independent.

3. **Should setup:all check for plugin installation first?** The current design
   assumes all plugins are installed. If a plugin is not installed, its setup
   command will not exist and the Skill call will fail. Should the dashboard
   detect uninstalled plugins and show them as MISSING (not NEEDS SETUP)?

4. **Should the dashboard check be extractable for re-use?** The dashboard
   logic (check env vars, check CLI tools, check config files) could be useful
   as a standalone `/setup:status` command that just shows the dashboard without
   offering interactive setup. Worth considering as a follow-up.

5. **allowed-tools list.** The setup:all command will need a broad allowed-tools
   list since it invokes Skill for each plugin. Need to verify whether Skill
   calls inherit the invoked command's allowed-tools or if the caller must
   declare them all. If the latter, the list will be large.
