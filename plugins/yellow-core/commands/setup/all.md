---
name: setup:all
description: "Run setup for all installed yellow-plugins. Checks prerequisites, environment variables, and plugin status, then offers interactive setup for plugins that need it. Use after fresh install or to verify configuration."
argument-hint: ''
allowed-tools:
  - Bash
  - Skill
  - AskUserQuestion
  - Read
---

# Set Up All Yellow Plugins

Run a unified dashboard check across all yellow-plugins, then offer to walk
through interactive setups for plugins that need attention. Produces a
before/after summary at the end.

**Goal: complete dashboard in 1 Bash call, then invoke Skill per plugin.**

## Workflow

### Step 1: Dashboard Check (ONE Bash call)

Run all prerequisite, environment variable, config file, and plugin status checks
in a single command:

```bash
printf '=== Prerequisites ===\n'
command -v node    >/dev/null 2>&1 && printf '%-14s OK (%s)\n' 'node:' "$(node --version 2>/dev/null)" || printf '%-14s NOT FOUND\n' 'node:'
command -v npm     >/dev/null 2>&1 && printf '%-14s OK (%s)\n' 'npm:' "$(npm --version 2>/dev/null)" || printf '%-14s NOT FOUND\n' 'npm:'
command -v npx     >/dev/null 2>&1 && printf '%-14s OK\n' 'npx:' || printf '%-14s NOT FOUND\n' 'npx:'
command -v curl    >/dev/null 2>&1 && printf '%-14s OK\n' 'curl:' || printf '%-14s NOT FOUND\n' 'curl:'
command -v jq      >/dev/null 2>&1 && printf '%-14s OK\n' 'jq:' || printf '%-14s NOT FOUND\n' 'jq:'
command -v rg      >/dev/null 2>&1 && printf '%-14s OK\n' 'rg:' || printf '%-14s NOT FOUND\n' 'rg:'
command -v gh      >/dev/null 2>&1 && printf '%-14s OK\n' 'gh:' || printf '%-14s NOT FOUND\n' 'gh:'
command -v ssh     >/dev/null 2>&1 && printf '%-14s OK\n' 'ssh:' || printf '%-14s NOT FOUND\n' 'ssh:'
command -v python3 >/dev/null 2>&1 && printf '%-14s OK (%s)\n' 'python3:' "$(python3 --version 2>/dev/null | awk '{print $2}')" || printf '%-14s NOT FOUND\n' 'python3:'
command -v semgrep >/dev/null 2>&1 && printf '%-14s OK\n' 'semgrep:' || printf '%-14s NOT FOUND\n' 'semgrep:'

printf '\n=== Environment Variables ===\n'
[ -n "${MORPH_API_KEY:-}" ]              && printf '%-30s set\n' 'MORPH_API_KEY:' || printf '%-30s NOT SET\n' 'MORPH_API_KEY:'
[ -n "${DEVIN_SERVICE_USER_TOKEN:-}" ]   && printf '%-30s set\n' 'DEVIN_SERVICE_USER_TOKEN:' || printf '%-30s NOT SET\n' 'DEVIN_SERVICE_USER_TOKEN:'
[ -n "${DEVIN_ORG_ID:-}" ]              && printf '%-30s set\n' 'DEVIN_ORG_ID:' || printf '%-30s NOT SET\n' 'DEVIN_ORG_ID:'
[ -n "${SEMGREP_APP_TOKEN:-}" ]         && printf '%-30s set\n' 'SEMGREP_APP_TOKEN:' || printf '%-30s NOT SET\n' 'SEMGREP_APP_TOKEN:'
[ -n "${EXA_API_KEY:-}" ]               && printf '%-30s set\n' 'EXA_API_KEY:' || printf '%-30s NOT SET\n' 'EXA_API_KEY:'
[ -n "${TAVILY_API_KEY:-}" ]            && printf '%-30s set\n' 'TAVILY_API_KEY:' || printf '%-30s NOT SET\n' 'TAVILY_API_KEY:'
[ -n "${PERPLEXITY_API_KEY:-}" ]        && printf '%-30s set\n' 'PERPLEXITY_API_KEY:' || printf '%-30s NOT SET\n' 'PERPLEXITY_API_KEY:'

printf '\n=== Config Files ===\n'
[ -d .ruvector ]                                     && printf '%-48s exists\n' '.ruvector/:' || printf '%-48s missing\n' '.ruvector/:'
[ -f .claude/yellow-chatprd.local.md ]               && printf '%-48s exists\n' '.claude/yellow-chatprd.local.md:' || printf '%-48s missing\n' '.claude/yellow-chatprd.local.md:'
[ -f .claude/yellow-ci.local.md ]                    && printf '%-48s exists\n' '.claude/yellow-ci.local.md:' || printf '%-48s missing\n' '.claude/yellow-ci.local.md:'
[ -f .claude/yellow-browser-test.local.md ]          && printf '%-48s exists\n' '.claude/yellow-browser-test.local.md:' || printf '%-48s missing\n' '.claude/yellow-browser-test.local.md:'
[ -f ~/.claude/yellow-statusline.py ]                && printf '%-48s exists\n' '~/.claude/yellow-statusline.py:' || printf '%-48s missing\n' '~/.claude/yellow-statusline.py:'

printf '\n=== GitHub CLI Auth ===\n'
if command -v gh >/dev/null 2>&1; then
  gh auth status >/dev/null 2>&1 && printf 'gh_auth: OK\n' || printf 'gh_auth: NOT AUTHENTICATED\n'
else
  printf 'gh_auth: SKIPPED (gh not found)\n'
fi
```

### Step 2: Classify Plugin Status

Parse the Bash output from Step 1 and classify each plugin. Use this decision
tree to assign a status of **READY**, **PARTIAL**, or **NEEDS SETUP** to each
plugin:

**yellow-ruvector:**
- READY: `.ruvector/` exists AND `node` OK
- NEEDS SETUP: `.ruvector/` missing OR `node` NOT FOUND

**yellow-morph:**
- READY: `rg` OK AND `node` OK AND `npx` OK AND `MORPH_API_KEY` set
- NEEDS SETUP: `MORPH_API_KEY` NOT SET OR `rg` NOT FOUND

**yellow-devin:**
- READY: `curl` OK AND `jq` OK AND `DEVIN_SERVICE_USER_TOKEN` set AND `DEVIN_ORG_ID` set
- NEEDS SETUP: either env var NOT SET

**yellow-semgrep:**
- READY: `SEMGREP_APP_TOKEN` set AND `semgrep` OK
- PARTIAL: `SEMGREP_APP_TOKEN` set but `semgrep` NOT FOUND
- NEEDS SETUP: `SEMGREP_APP_TOKEN` NOT SET

**yellow-research:**
- READY: all 3 API keys set (`EXA_API_KEY`, `TAVILY_API_KEY`, `PERPLEXITY_API_KEY`)
- PARTIAL: 1-2 of 3 API keys set
- NEEDS SETUP: 0 of 3 API keys set

**yellow-chatprd:**
- READY: `.claude/yellow-chatprd.local.md` exists
- NEEDS SETUP: config file missing

**yellow-ci:**
- READY: `gh` OK AND `jq` OK AND `ssh` OK AND `gh_auth` OK
- PARTIAL: tools OK but `gh_auth` NOT AUTHENTICATED
- NEEDS SETUP: `gh` NOT FOUND OR `jq` NOT FOUND

**yellow-browser-test:**
- READY: `.claude/yellow-browser-test.local.md` exists
- NEEDS SETUP: config file missing

**yellow-core (statusline):**
- READY: `~/.claude/yellow-statusline.py` exists
- NEEDS SETUP: statusline not installed

Display the status table:

```text
yellow-plugins Setup Dashboard
===============================

  Plugin               Status          Detail
  -------------------  -----------     --------------------------------
  yellow-ruvector      READY           .ruvector/ initialized
  yellow-morph         READY           API key set, tools available
  yellow-devin         NEEDS SETUP     DEVIN_SERVICE_USER_TOKEN not set
  yellow-semgrep       PARTIAL         Token set, semgrep CLI missing
  yellow-research      PARTIAL         2/3 API keys set (Perplexity missing)
  yellow-chatprd       NEEDS SETUP     Config file missing
  yellow-ci            READY           gh authenticated, tools available
  yellow-browser-test  NEEDS SETUP     Config file missing
  yellow-core          NEEDS SETUP     Statusline not installed

  Summary: X ready, Y partial, Z need setup
```

Adapt the "Detail" column to reflect the actual state detected. Be specific
about what is missing (e.g., which env var, which CLI tool, which config file).

### Step 3: Decision — Interactive Setup

Based on the dashboard classification:

**If all 9 plugins are READY:**

Display: "All plugins are configured. Nothing to do."

Use AskUserQuestion: "What would you like to do next?" with options:
- "Refresh statusline" — invoke `statusline:setup` to re-detect plugins
- "Done"

**If 1+ plugins are NEEDS SETUP or PARTIAL:**

Count the plugins that are not READY. Use AskUserQuestion:

"N plugins need attention. How would you like to proceed?" with options:
- "Run all N setups" — walk through each sequentially
- "Pick which to run" — choose from a list
- "Skip for now" — exit with dashboard as-is

If user picks **"Pick which to run"**, use AskUserQuestion with `multiSelect:
true` to present the non-READY plugins as options. Only show plugins that are
NEEDS SETUP or PARTIAL. Label each option with the plugin name and its status
detail.

If user picks **"Skip for now"**, display the dashboard summary and stop. Do not
proceed to Step 4 or Step 5.

### Step 4: Sequential Interactive Setups

For each plugin the user selected (or all non-READY plugins if "Run all"),
invoke the corresponding setup command via the Skill tool in this fixed order:

1. `ruvector:setup`
2. `morph:setup`
3. `devin:setup`
4. `semgrep:setup`
5. `research:setup`
6. `chatprd:setup`
7. `ci:setup`
8. `browser-test:setup`
9. `statusline:setup` (always last when included)

Only invoke setups for plugins the user selected. Skip plugins they did not
select even if they appear earlier in the fixed order.

Before each setup, display a transition message:

```text
--- Setup N of M: yellow-<plugin> ---
```

Invoke the Skill tool:

```
Invoke the Skill tool with skill: "<namespace>:setup".
```

**Graceful degradation:** If a Skill invocation fails (skill not found, plugin
not installed, MCP unavailable, or any error), record the failure:

```text
yellow-<plugin> setup: FAILED (<error reason>)
```

Continue to the next plugin. Do not stop the orchestrator.

After each setup completes (or fails), continue to the next selected plugin.

### Step 5: Final Summary

After all selected setups have been run, re-run the same Bash check from Step 1
to get the updated state. Classify each plugin again using the same rules from
Step 2.

Display a before/after comparison table showing only plugins whose status
changed:

```text
Setup Complete — Before/After
===============================

  Plugin               Before          After
  -------------------  -----------     -----------
  yellow-devin         NEEDS SETUP     READY
  yellow-chatprd       NEEDS SETUP     READY
  yellow-browser-test  NEEDS SETUP     READY
  yellow-core          NEEDS SETUP     READY

  Overall: X ready, Y partial, Z need setup
```

If any plugins still need setup (status did not change or changed to PARTIAL),
note them:

```text
Still need attention:
  yellow-semgrep — PARTIAL (semgrep CLI not installed)
  yellow-research — PARTIAL (Perplexity API key not set)
```

If all plugins are now READY:

```text
All plugins are fully configured.
```

### Step 6: Next Steps

Use AskUserQuestion: "What would you like to do next?" with options:
- "Re-run setup:all" — start from Step 1 again
- "Done"

## Error Handling

| Error | Message | Action |
|---|---|---|
| Bash check fails to execute | "Dashboard check failed. Verify shell environment." | Stop |
| No plugins installed in cache | "yellow-plugins detected via setup commands (cache check skipped)." | Continue — rely on Skill invocation to detect missing plugins |
| Skill invocation fails (skill not found) | "yellow-<plugin> setup: FAILED (skill not found — plugin may not be installed)" | Record, continue to next plugin |
| Skill invocation fails (MCP error) | "yellow-<plugin> setup: FAILED (<error>)" | Record, continue to next plugin |
| User cancels during interactive phase | Show partial before/after for completed setups | Show summary, stop |
| All plugins already READY | "All plugins are configured. Nothing to do." | Offer statusline refresh or done |
