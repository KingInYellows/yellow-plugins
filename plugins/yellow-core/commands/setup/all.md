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
if command -v python3 >/dev/null 2>&1; then
  py_ver=$(python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>/dev/null)
  py_ok=$(python3 -c "import sys; print('ok' if sys.version_info >= (3, 7) else 'too_old')" 2>/dev/null)
  [ "$py_ok" = "ok" ] && printf '%-14s OK (%s)\n' 'python3:' "$py_ver" || printf '%-14s TOO OLD (%s, need 3.7+)\n' 'python3:' "$py_ver"
else
  printf '%-14s NOT FOUND\n' 'python3:'
fi
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

printf '\n=== Installed Plugins ===\n'
plugin_cache="$HOME/.claude/plugins/cache"
if [ -d "$plugin_cache" ]; then
  for p in yellow-ruvector yellow-morph yellow-devin yellow-semgrep yellow-research yellow-chatprd yellow-ci yellow-browser-test yellow-core; do
    found=0
    for d in "$plugin_cache"/*/; do
      if [ -f "${d}.claude-plugin/plugin.json" ]; then
        if command -v python3 >/dev/null 2>&1; then
          name=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('name',''))" "${d}.claude-plugin/plugin.json" 2>/dev/null)
        elif command -v jq >/dev/null 2>&1; then
          name=$(jq -r '.name // ""' "${d}.claude-plugin/plugin.json" 2>/dev/null)
        else
          name=""
        fi
        if [ "$name" = "$p" ]; then found=1; break; fi
      fi
    done
    [ "$found" = "1" ] && printf '%-24s installed\n' "$p:" || printf '%-24s NOT INSTALLED\n' "$p:"
  done
  if ! command -v python3 >/dev/null 2>&1 && ! command -v jq >/dev/null 2>&1; then
    printf 'WARNING: neither python3 nor jq found — plugin detection may be inaccurate\n'
  fi
else
  printf 'plugin_cache: NOT FOUND (cannot detect installed plugins)\n'
fi

printf '\n=== GitHub CLI Auth ===\n'
if command -v gh >/dev/null 2>&1; then
  gh auth status >/dev/null 2>&1 && printf 'gh_auth: OK\n' || printf 'gh_auth: NOT AUTHENTICATED\n'
else
  printf 'gh_auth: SKIPPED (gh not found)\n'
fi
```

### Step 2: Classify Plugin Status

Parse the Bash output from Step 1 and classify each plugin. Use this decision
tree to assign a status of **NOT INSTALLED**, **READY**, **PARTIAL**, or
**NEEDS SETUP** to each plugin.

If a plugin shows `NOT INSTALLED` in the Installed Plugins section, classify it
as **NOT INSTALLED** and skip all other checks for that plugin. Only classify
READY/PARTIAL/NEEDS SETUP for installed plugins:

**yellow-ruvector:**

- READY: `.ruvector/` exists AND `node` OK AND `npx` OK
- NEEDS SETUP: any READY condition not met

**yellow-morph:**

- READY: `rg` OK AND `node` OK AND `npx` OK AND `MORPH_API_KEY` set
- NEEDS SETUP: `MORPH_API_KEY` NOT SET OR any required tool missing (`rg`, `node`, or `npx`)

**yellow-devin:**

- READY: `curl` OK AND `jq` OK AND `DEVIN_SERVICE_USER_TOKEN` set AND `DEVIN_ORG_ID` set
- NEEDS SETUP: any READY condition not met (`curl` or `jq` missing, or either env var not set)

**yellow-semgrep:**

- READY: `curl` OK AND `jq` OK AND `SEMGREP_APP_TOKEN` set AND `semgrep` OK
- PARTIAL: `SEMGREP_APP_TOKEN` set but `semgrep` NOT FOUND (and `curl`/`jq` OK)
- NEEDS SETUP: `SEMGREP_APP_TOKEN` NOT SET OR `curl` NOT FOUND OR `jq` NOT FOUND

**yellow-research:**

- READY: all 3 API keys set (`EXA_API_KEY`, `TAVILY_API_KEY`, `PERPLEXITY_API_KEY`)
- PARTIAL: 1-2 of 3 API keys set
- NEEDS SETUP: 0 of 3 API keys set

**yellow-chatprd:**

- READY: `.claude/yellow-chatprd.local.md` exists
- NEEDS SETUP: config file missing

**yellow-ci:**

- READY: `gh` OK AND `jq` OK AND `ssh` OK AND `gh_auth` OK AND `.claude/yellow-ci.local.md` exists
- PARTIAL: `gh` OK AND `jq` OK AND `.claude/yellow-ci.local.md` exists AND (`gh_auth` NOT AUTHENTICATED OR `ssh` NOT FOUND)
- NEEDS SETUP: `gh` NOT FOUND OR `jq` NOT FOUND OR `.claude/yellow-ci.local.md` missing

**yellow-browser-test:**

- READY: `.claude/yellow-browser-test.local.md` exists AND `node` OK AND `npm` OK
- NEEDS SETUP: config file missing OR `node` NOT FOUND OR `npm` NOT FOUND

**yellow-core (statusline):**

- READY: `~/.claude/yellow-statusline.py` exists AND `python3` OK (>= 3.7)
- NEEDS SETUP: statusline not installed OR `python3` NOT FOUND OR python version < 3.7

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

**If 0 plugins are installed (all are NOT INSTALLED):**

Display: "No yellow-plugins are installed. Install plugins first, then run
setup:all." Stop.

**If all installed plugins are READY (regardless of NOT INSTALLED count):**

Display: "All installed plugins are configured."
If any plugins are NOT INSTALLED, also display: "X plugin(s) not installed:
[list]."
Use AskUserQuestion with options: "Run statusline refresh" and "Done". If user
picks "Run statusline refresh", invoke `Skill` with `statusline:setup`. Stop.

**If 1+ installed plugins are NEEDS SETUP or PARTIAL:**

Count the installed plugins that are not READY (exclude NOT INSTALLED from the
count and from all selection lists). Use AskUserQuestion:

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

Use AskUserQuestion: "What would you like to do next?" with options:
- "Re-run setup:all" — restart from Step 1
- "Done"
If user picks "Re-run setup:all", restart from Step 1.

## Error Handling

| Error | Message | Action |
|---|---|---|
| Bash check fails to execute | "Dashboard check failed. Verify shell environment." | Stop |
| Plugin not installed | Show as NOT INSTALLED in dashboard | Skip — do not offer interactive setup for uninstalled plugins |
| Plugin cache not found | Dashboard prints "plugin_cache: NOT FOUND" | Continue — classify plugins based on prerequisite/env/config checks only; Skill invocation will detect missing plugins |
| Skill invocation fails (skill not found) | "yellow-<plugin> setup: FAILED (skill not found — plugin may not be installed)" | Record, continue to next plugin |
| Skill invocation fails (MCP error) | "yellow-<plugin> setup: FAILED (<error>)" | Record, continue to next plugin |
| User cancels during interactive phase | Show partial before/after for completed setups | Show summary, stop |
| All plugins already READY | "All installed plugins are configured." | Use AskUserQuestion: "Run statusline refresh" or "Done"; invoke `statusline:setup` if selected |
