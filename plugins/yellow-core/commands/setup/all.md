---
name: setup:all
description: "Run setup for all installed marketplace plugins. Checks local prerequisites, MCP visibility, environment variables, and plugin status, then offers interactive setup for plugins that need it."
argument-hint: ''
allowed-tools:
  - Bash
  - Skill
  - AskUserQuestion
  - ToolSearch
---

# Set Up Marketplace Plugins

Run a unified readiness dashboard across every plugin in this marketplace, then
offer the relevant setup commands in a fixed order. The command does not
install plugins; it validates and configures the ones already installed.

## Workflow

### Step 1: Dashboard Check (ONE Bash call)

Run all local prerequisite, environment, config, and installation checks in one
Bash call:

```bash
# Snapshot tool paths upfront to avoid PATH drift in long scripts
_gt=$(command -v gt 2>/dev/null || true)
_gh=$(command -v gh 2>/dev/null || true)

printf '=== Runtime ===\n'
if command -v node >/dev/null 2>&1; then
  node_ver=$(node --version 2>/dev/null)
  node_major=$(printf '%s' "$node_ver" | sed 's/^v//' | cut -d. -f1)
  printf 'node:               OK (%s)\n' "$node_ver"
  [ "${node_major:-0}" -ge 18 ] && printf 'node18_check:       ok\n' || printf 'node18_check:       too_old\n'
else
  printf 'node:               NOT FOUND\n'
  printf 'node18_check:       missing\n'
fi
command -v npm >/dev/null 2>&1 && printf 'npm:                OK (%s)\n' "$(npm --version 2>/dev/null)" || printf 'npm:                NOT FOUND\n'
command -v npx >/dev/null 2>&1 && printf 'npx:                OK\n' || printf 'npx:                NOT FOUND\n'
command -v git >/dev/null 2>&1 && printf 'git:                OK\n' || printf 'git:                NOT FOUND\n'
command -v curl >/dev/null 2>&1 && printf 'curl:               OK\n' || printf 'curl:               NOT FOUND\n'
command -v jq >/dev/null 2>&1 && printf 'jq:                 OK\n' || printf 'jq:                 NOT FOUND\n'
command -v rg >/dev/null 2>&1 && printf 'rg:                 OK\n' || printf 'rg:                 NOT FOUND\n'
[ -n "$_gh" ] && printf 'gh:                 OK\n' || printf 'gh:                 NOT FOUND\n'
command -v ssh >/dev/null 2>&1 && printf 'ssh:                OK\n' || printf 'ssh:                NOT FOUND\n'
command -v semgrep >/dev/null 2>&1 && printf 'semgrep:            OK\n' || printf 'semgrep:            NOT FOUND\n'
command -v yq >/dev/null 2>&1 && printf 'yq:                 OK\n' || printf 'yq:                 NOT FOUND\n'
command -v realpath >/dev/null 2>&1 && printf 'realpath:           OK\n' || printf 'realpath:           NOT FOUND\n'
command -v flock >/dev/null 2>&1 && printf 'flock:              OK\n' || printf 'flock:              NOT FOUND\n'
if command -v ast-grep >/dev/null 2>&1; then
  printf 'ast-grep:           OK\n'
elif command -v sg >/dev/null 2>&1 && sg --version 2>&1 | grep -qi 'ast-grep'; then
  printf 'ast-grep:           OK (via sg)\n'
else
  printf 'ast-grep:           NOT FOUND\n'
fi
command -v uv >/dev/null 2>&1 && printf 'uv:                 OK\n' || printf 'uv:                 NOT FOUND\n'
command -v agent-browser >/dev/null 2>&1 && printf 'agent-browser:      OK\n' || printf 'agent-browser:      NOT FOUND\n'
[ -n "$_gt" ] && printf 'gt:                 OK (%s)\n' "$("$_gt" --version 2>/dev/null | head -n1)" || printf 'gt:                 NOT FOUND\n'
command -v ruvector >/dev/null 2>&1 && printf 'ruvector:           OK\n' || printf 'ruvector:           NOT FOUND\n'
command -v codex >/dev/null 2>&1 && printf 'codex:              OK (%s)\n' "$(codex --version 2>/dev/null | head -n1)" || printf 'codex:              NOT FOUND\n'

if command -v python3 >/dev/null 2>&1; then
  py_ver=$(python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>/dev/null)
  printf 'python3:            OK (%s)\n' "$py_ver"
  py37=$(python3 -c "import sys; print('ok' if sys.version_info >= (3, 7) else 'too_old')" 2>/dev/null)
  py313=$(python3 -c "import sys; print('ok' if sys.version_info >= (3, 13) else 'too_old')" 2>/dev/null)
  printf 'python37_check:     %s\n' "$py37"
  printf 'python313_check:    %s\n' "$py313"
else
  printf 'python3:            NOT FOUND\n'
  printf 'python37_check:     missing\n'
  printf 'python313_check:    missing\n'
fi

printf '\n=== Environment Variables ===\n'
if [ -n "${MORPH_API_KEY:-}" ]; then
  printf 'MORPH_API_KEY:             set (shell env)\n'
elif grep -qE '"morph_api_key"[[:space:]]*:' "${HOME}/.claude/.credentials.json" 2>/dev/null; then
  printf 'MORPH_API_KEY:             set (userConfig)\n'
else
  printf 'MORPH_API_KEY:             NOT SET (run /morph:setup if you configured via keychain)\n'
fi
[ -n "${DEVIN_SERVICE_USER_TOKEN:-}" ] && printf 'DEVIN_SERVICE_USER_TOKEN:  set\n' || printf 'DEVIN_SERVICE_USER_TOKEN:  NOT SET\n'
[ -n "${DEVIN_ORG_ID:-}" ] && printf 'DEVIN_ORG_ID:              set\n' || printf 'DEVIN_ORG_ID:              NOT SET\n'
[ -n "${SEMGREP_APP_TOKEN:-}" ] && printf 'SEMGREP_APP_TOKEN:         set\n' || printf 'SEMGREP_APP_TOKEN:         NOT SET\n'
[ -n "${OPENAI_API_KEY:-}" ] && printf 'OPENAI_API_KEY:            set\n' || printf 'OPENAI_API_KEY:            NOT SET\n'
[ -n "${EXA_API_KEY:-}" ] && printf 'EXA_API_KEY:               set\n' || printf 'EXA_API_KEY:               NOT SET\n'
[ -n "${TAVILY_API_KEY:-}" ] && printf 'TAVILY_API_KEY:            set\n' || printf 'TAVILY_API_KEY:            NOT SET\n'
[ -n "${PERPLEXITY_API_KEY:-}" ] && printf 'PERPLEXITY_API_KEY:        set\n' || printf 'PERPLEXITY_API_KEY:        NOT SET\n'
[ -n "${CERAMIC_API_KEY:-}" ] && printf 'CERAMIC_API_KEY:           set\n' || printf 'CERAMIC_API_KEY:           NOT SET\n'

printf '\n=== Repository State ===\n'
repo_top=$(git rev-parse --show-toplevel 2>/dev/null || true)
[ -n "$repo_top" ] && printf 'git_repo:           ok\n' || printf 'git_repo:           NOT A GIT REPOSITORY\n'
if [ -z "$repo_top" ]; then
  printf 'repo_root:          SKIPPED (not in git repo)\n'
elif [ -w "$repo_top" ]; then
  printf 'repo_root:          writable\n'
else
  printf 'repo_root:          NOT WRITABLE\n'
fi
graphite_repo_config=$(git rev-parse --git-path .graphite_repo_config 2>/dev/null || true)
[ -n "$graphite_repo_config" ] && [ -f "$graphite_repo_config" ] && printf 'graphite_repo:      present (%s)\n' "$graphite_repo_config" || printf 'graphite_repo:      missing\n'
auth_path=''
for path in "$HOME/.graphite_user_config" "${XDG_CONFIG_HOME:-$HOME/.config}/graphite/user_config" "$HOME/.config/graphite/user_config"; do
  if [ -f "$path" ]; then
    auth_path="$path"
    break
  fi
done
[ -n "$auth_path" ] && printf 'graphite_auth:      present (%s)\n' "$auth_path" || printf 'graphite_auth:      missing\n'
if [ -n "$_gt" ] && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  trunk=$("$_gt" trunk 2>/dev/null || true)
  [ -n "$trunk" ] && printf 'gt_trunk:           %s\n' "$trunk" || printf 'gt_trunk:           UNAVAILABLE\n'
else
  printf 'gt_trunk:           SKIPPED\n'
fi

printf '\n=== Config Files ===\n'
[ -n "$repo_top" ] && [ -d "$repo_top/.ruvector" ] && printf '.ruvector/:                         exists\n' || printf '.ruvector/:                         missing\n'
[ -n "$repo_top" ] && [ -f "$repo_top/.claude/yellow-chatprd.local.md" ] && printf '.claude/yellow-chatprd.local.md:    exists\n' || printf '.claude/yellow-chatprd.local.md:    missing\n'
[ -n "$repo_top" ] && [ -f "$repo_top/.claude/yellow-ci.local.md" ] && printf '.claude/yellow-ci.local.md:         exists\n' || printf '.claude/yellow-ci.local.md:         missing\n'
[ -n "$repo_top" ] && [ -f "$repo_top/.claude/yellow-browser-test.local.md" ] && printf '.claude/yellow-browser-test.local.md: exists\n' || printf '.claude/yellow-browser-test.local.md: missing\n'
[ -n "$repo_top" ] && [ -f "$repo_top/.graphite.yml" ] && printf '.graphite.yml:                      exists\n' || printf '.graphite.yml:                      missing\n'
[ -n "$repo_top" ] && [ -f "$repo_top/.github/pull_request_template.md" ] && printf '.github/pull_request_template.md:   exists\n' || printf '.github/pull_request_template.md:   missing\n'
[ -n "$repo_top" ] && [ -f "$repo_top/.claude/composio-usage.json" ] && printf '.claude/composio-usage.json:        exists\n' || printf '.claude/composio-usage.json:        missing\n'
[ -f ~/.codex/auth.json ] && printf '~/.codex/auth.json:                 exists\n' || printf '~/.codex/auth.json:                 missing\n'
[ -f ~/.claude/yellow-statusline.py ] && printf '~/.claude/yellow-statusline.py:     exists\n' || printf '~/.claude/yellow-statusline.py:     missing\n'

if [ -f ~/.claude/settings.json ] && command -v python3 >/dev/null 2>&1; then
  python3 -c '
import json, os
try:
    d = json.load(open(os.path.expanduser("~/.claude/settings.json")))
    sl = "present" if "statusLine" in d else "missing"
    dh = d.get("disableAllHooks", False)
    print(f"statusLine_key:      {sl}")
    print(f"disableAllHooks:     {dh}")
except Exception:
    print("statusLine_key:      parse_error")
    print("disableAllHooks:     unknown")
' 2>/dev/null || {
    printf 'statusLine_key:      parse_error\n'
    printf 'disableAllHooks:     unknown\n'
  }
else
  printf 'statusLine_key:      missing\n'
  printf 'disableAllHooks:     unknown\n'
fi

printf '\n=== Optional Working Paths ===\n'
[ -n "$repo_top" ] && [ -d "$repo_top/.debt" ] && printf '.debt/:                             exists\n' || printf '.debt/:                             missing\n'
[ -n "$repo_top" ] && [ -d "$repo_top/docs/audits" ] && printf 'docs/audits/:                       exists\n' || printf 'docs/audits/:                       missing\n'
[ -n "$repo_top" ] && [ -d "$repo_top/todos/debt" ] && printf 'todos/debt/:                        exists\n' || printf 'todos/debt/:                        missing\n'

printf '\n=== Installed Plugins ===\n'
plugin_cache="$HOME/.claude/plugins/cache"
if [ -d "$plugin_cache" ]; then
  installed_plugins=""
  if command -v python3 >/dev/null 2>&1; then
    installed_plugins=$(find "$plugin_cache" -type f -path '*/.claude-plugin/plugin.json' -print0 2>/dev/null \
      | xargs -0 python3 -c "
import json, sys
for p in sys.argv[1:]:
    try: print(json.load(open(p)).get('name',''))
    except Exception: pass
" 2>/dev/null | sed '/^$/d' | LC_ALL=C sort -u)
  elif command -v jq >/dev/null 2>&1; then
    installed_plugins=$(find "$plugin_cache" -type f -path '*/.claude-plugin/plugin.json' -print0 2>/dev/null \
      | xargs -0 -I{} jq -r '.name // empty' {} 2>/dev/null \
      | sed '/^$/d' | LC_ALL=C sort -u)
  fi
  if [ -n "$installed_plugins" ] || command -v python3 >/dev/null 2>&1 || command -v jq >/dev/null 2>&1; then
    # setup-all-dashboard-plugin-loop:start
    for p in gt-workflow yellow-ruvector yellow-morph yellow-devin yellow-semgrep yellow-research yellow-linear yellow-chatprd yellow-debt yellow-ci yellow-review yellow-browser-test yellow-docs yellow-composio yellow-codex yellow-core; do
      if printf '%s\n' "$installed_plugins" | grep -Fxq "$p"; then
        printf '%-22s installed\n' "$p:"
      else
        printf '%-22s NOT INSTALLED\n' "$p:"
      fi
    done
    # setup-all-dashboard-plugin-loop:end
  else
    printf 'plugin_cache_warning: unable to inspect plugin cache (need python3 or jq)\n'
  fi
else
  printf 'plugin_cache: NOT FOUND (cannot detect installed plugins)\n'
fi

printf '\n=== GitHub CLI Auth ===\n'
if [ -n "$_gh" ]; then
  "$_gh" auth status >/dev/null 2>&1 && printf 'gh_auth: OK\n' || printf 'gh_auth: NOT AUTHENTICATED\n'
else
  printf 'gh_auth: SKIPPED (gh not found)\n'
fi
```

### Step 1.5: Session MCP Visibility (ToolSearch probes)

Run five ToolSearch probes to capture current-session MCP visibility:

- `list_user_organizations`
- `list_teams`
- `parallel__createDeepResearch`
- `ast-grep__find_code`
- `ceramic_search`

Record whether these exact tools are present in the results:

- `mcp__plugin_yellow-chatprd_chatprd__list_user_organizations`
- `mcp__plugin_yellow-linear_linear__list_teams`
- `mcp__plugin_yellow-research_parallel__createDeepResearch`
- `mcp__plugin_yellow-research_ast-grep__find_code`
- `mcp__plugin_yellow-research_ceramic__ceramic_search`

ToolSearch reflects current-session visibility only. If a plugin was installed
after the session started, the tool may remain invisible until Claude Code is
restarted.

### Step 2: Classify Plugin Status

Classify each installed plugin as **READY**, **PARTIAL**, or **NEEDS SETUP**.
If a plugin shows `NOT INSTALLED` in the Installed Plugins section, classify it
as **NOT INSTALLED** and skip all other checks for that plugin.

<!-- setup-all-classification:start -->
**gt-workflow:**

- READY: `gt` OK AND `jq` OK AND `graphite_auth` present AND (`graphite_repo`
  present OR `gt_trunk` not `UNAVAILABLE`) AND `.graphite.yml` present
- PARTIAL: `gt` OK AND `jq` OK AND `graphite_auth` present AND (`graphite_repo`
  present OR `gt_trunk` not `UNAVAILABLE`) AND `.graphite.yml` missing
- NEEDS SETUP: any core condition not met (`gt`, `jq`, `graphite_auth`,
  `graphite_repo`/`gt_trunk`)

**yellow-ruvector:**

- READY: `node18_check` ok AND `npx` OK AND `.ruvector/` exists AND global
  `ruvector` binary OK
- NEEDS SETUP: any READY condition not met

**yellow-morph:**

The Morph API key can be supplied via either the plugin's `userConfig`
prompt (stored in the system keychain, preferred) or a shell
`MORPH_API_KEY` export (power-user fallback). Neither is visible to
shell checks directly, so treat READY as "key is configured via *some*
path" and rely on `/morph:status` for authoritative OFFLINE detection.

- READY: `node18_check` ok AND `npm` OK AND `rg` OK AND either of:
  (a) shell `MORPH_API_KEY` set, OR
  (b) `pluginConfigs.yellow-morph.options.morph_api_key` present in
      `~/.claude/.credentials.json` (userConfig was answered). Detection:
      `grep -qE '"morph_api_key"[[:space:]]*:' ~/.claude/.credentials.json 2>/dev/null`.
- PARTIAL: local prerequisites are satisfied but neither the shell env
  var nor the userConfig option is detectable — the plugin will install
  but the MCP server will not start. Recommend running `/morph:setup`
  or answering the userConfig prompt at next plugin-enable.
- NEEDS SETUP: any local prerequisite missing (`node18_check`, `npm`, or
  `rg`).

**yellow-devin:**

- READY: `curl` OK AND `jq` OK AND `DEVIN_SERVICE_USER_TOKEN` set AND
  `DEVIN_ORG_ID` set
- NEEDS SETUP: any READY condition not met

**yellow-semgrep:**

- READY: `curl` OK AND `jq` OK AND `SEMGREP_APP_TOKEN` set AND `semgrep` OK
- PARTIAL: `SEMGREP_APP_TOKEN` set but `semgrep` CLI is missing
- NEEDS SETUP: token missing OR `curl` missing OR `jq` missing

**yellow-research:**

Compute bundled source availability out of 6:

1. `EXA_API_KEY` set
2. `TAVILY_API_KEY` set
3. `PERPLEXITY_API_KEY` set
4. Parallel Task tool visible via ToolSearch
5. ast-grep counts only when the exact ToolSearch match is present **and**
   `ast-grep` OK **and** `uv` OK (uv manages Python 3.13 transparently via
   `--python 3.13` in plugin.json — no system Python check needed)
6. Ceramic MCP tool (`ceramic_search`) visible via ToolSearch.
   `CERAMIC_API_KEY` is *not* required — the Ceramic MCP authenticates via
   OAuth 2.1 (browser flow on first use). The env var only powers the REST
   live-probe in `/research:setup`; ToolSearch visibility alone counts this
   source as available.

- READY: all 6 bundled sources available
- PARTIAL: 1-5 bundled sources available
- NEEDS SETUP: 0 bundled sources available

**yellow-linear:**

- READY: `gt` OK AND `mcp__plugin_yellow-linear_linear__list_teams` is visible
- PARTIAL: Linear MCP is visible but `gt` is missing
- NEEDS SETUP: Linear MCP tool is not visible in the current session

**yellow-chatprd:**

- READY: `.claude/yellow-chatprd.local.md` exists AND
  `mcp__plugin_yellow-chatprd_chatprd__list_user_organizations` is visible
- PARTIAL: exactly one of config file or MCP visibility is missing
- NEEDS SETUP: both config file and MCP visibility are missing

**yellow-debt:**

- READY: `git_repo` ok AND `repo_root` writable AND `git` OK AND `jq` OK AND
  `yq` OK AND `realpath` OK AND `flock` OK AND `gt` OK AND `yellow-linear`
  installed
- PARTIAL: all required local checks pass, but `yellow-linear` is NOT INSTALLED
- NEEDS SETUP: any required local check fails

**yellow-ci:**

- READY: `gh` OK AND `jq` OK AND `ssh` OK AND `gh_auth` OK AND
  `.claude/yellow-ci.local.md` exists
- PARTIAL: `gh` OK AND `jq` OK AND config exists, but `ssh` is missing or
  `gh_auth` is not authenticated
- NEEDS SETUP: `gh` missing OR `jq` missing OR config missing

**yellow-review:**

- READY: `gh` OK AND `jq` OK AND `gt` OK AND `gh_auth` OK AND `yellow-core`
  installed
- PARTIAL: required local review checks pass, but `yellow-core` is NOT INSTALLED
- NEEDS SETUP: any required local review check fails

**yellow-browser-test:**

- READY: `.claude/yellow-browser-test.local.md` exists AND `node18_check` ok
  AND `npm` OK AND `agent-browser` OK
- NEEDS SETUP: any READY condition not met

**yellow-docs:**

- READY: `git_repo` ok AND `git` OK
- NEEDS SETUP: `git` missing OR not in a git repository

**yellow-composio:**

- READY: `jq` OK AND Composio MCP tools visible via ToolSearch AND
  `.claude/composio-usage.json` exists with valid `version` field
- PARTIAL: Composio MCP tools visible but `jq` missing or usage counter missing
- NEEDS SETUP: Composio MCP tools not visible in the current session

**yellow-codex:**

- READY: `codex` binary found in PATH AND version >= 0.118.0 AND
  (`OPENAI_API_KEY` set OR `~/.codex/auth.json` exists)
- PARTIAL: `codex` binary found AND version >= 0.118.0, but auth not configured
- NEEDS SETUP: `codex` binary not found OR version < 0.118.0

**yellow-core:**

- READY: `python37_check` ok AND `~/.claude/yellow-statusline.py` exists AND
  `statusLine_key` is `present` AND `disableAllHooks` is not `True`
- PARTIAL: script exists AND `statusLine_key` is present AND `python37_check`
  is ok, but `disableAllHooks` is `True`
- NEEDS SETUP: any other READY condition not met
<!-- setup-all-classification:end -->

Display the dashboard in this order:

```text
Marketplace Setup Dashboard
===========================

  Plugin               Status          Detail
  -------------------  -----------     ------------------------------------------
  gt-workflow          READY           Graphite auth detected, repo initialized
  yellow-ruvector      NEEDS SETUP     Global ruvector binary missing from PATH
  yellow-morph         PARTIAL         Local tools ready, Morph API key not configured
  yellow-devin         NEEDS SETUP     DEVIN_SERVICE_USER_TOKEN not set
  yellow-semgrep       PARTIAL         Token set, semgrep CLI missing
  yellow-research      PARTIAL         2/6 bundled sources available
  yellow-linear        READY           Linear MCP visible, Graphite available
  yellow-chatprd       PARTIAL         Config exists, MCP not visible this session
  yellow-debt          PARTIAL         Required tools ready, yellow-linear missing
  yellow-ci            READY           gh authenticated, runner config present
  yellow-review        PARTIAL         Review prerequisites ready, yellow-core missing
  yellow-browser-test  NEEDS SETUP     agent-browser missing
  yellow-docs          READY           git available, repo is a git repository
  yellow-composio      PARTIAL         MCP visible, usage counter missing
  yellow-codex         PARTIAL         codex v0.118.0 found, OPENAI_API_KEY not set
  yellow-core          PARTIAL         statusLine installed, disableAllHooks=true

  Summary: X ready, Y partial, Z need setup
```

Be specific in the Detail column. Name the missing tool, env var, config file,
or bundled research source count rather than using generic labels.

### Step 3: Decision — Interactive Setup

Based on the dashboard classification:

**If 0 marketplace plugins are installed (all are NOT INSTALLED):**

Display: "No marketplace plugins are installed. Install plugins first, then run
`/setup:all` again." Stop.

**If all installed plugins are READY:**

Display: "All installed plugins are configured."
If any plugins are NOT INSTALLED, also display: "X plugin(s) not installed:
[list]."

If `yellow-core` is installed, use AskUserQuestion with options:

- "Run statusline refresh"
- "Done"

If the user chooses "Run statusline refresh", invoke `Skill` with
`skill: "statusline:setup"`. Stop.

If `yellow-core` is not installed, stop after the summary.

**If 1+ installed plugins are NEEDS SETUP or PARTIAL:**

Count only installed plugins that are not READY. Exclude NOT INSTALLED plugins
from the count and from selection lists. Use AskUserQuestion:

"N plugins need attention. How would you like to proceed?"

- "Run all N setups"
- "Pick which to run"
- "Skip for now"

If the user picks **"Pick which to run"**, present only the installed plugins
that are PARTIAL or NEEDS SETUP. Label each option with the plugin name plus
its detail.

If the user picks **"Skip for now"**, display the dashboard summary and stop.

### Step 4: Sequential Interactive Setups

For each selected plugin, invoke the corresponding setup command via the Skill
tool in this fixed order:

<!-- setup-all-delegated-commands:start -->
1. `gt-setup`
2. `ruvector:setup`
3. `morph:setup`
4. `devin:setup`
5. `semgrep:setup`
6. `research:setup`
7. `linear:setup`
8. `chatprd:setup`
9. `debt:setup`
10. `ci:setup`
11. `review:setup`
12. `browser-test:setup`
13. `docs:setup`
14. `composio:setup`
15. `codex:setup`
16. `statusline:setup`
<!-- setup-all-delegated-commands:end -->

Only invoke setups for plugins the user selected. Use this mapping:

<!-- setup-all-plugin-command-map:start -->
- `gt-workflow` → `gt-setup`
- `yellow-ruvector` → `ruvector:setup`
- `yellow-morph` → `morph:setup`
- `yellow-devin` → `devin:setup`
- `yellow-semgrep` → `semgrep:setup`
- `yellow-research` → `research:setup`
- `yellow-linear` → `linear:setup`
- `yellow-chatprd` → `chatprd:setup`
- `yellow-debt` → `debt:setup`
- `yellow-ci` → `ci:setup`
- `yellow-review` → `review:setup`
- `yellow-browser-test` → `browser-test:setup`
- `yellow-docs` → `docs:setup`
- `yellow-composio` → `composio:setup`
- `yellow-codex` → `codex:setup`
- `yellow-core` → `statusline:setup`
<!-- setup-all-plugin-command-map:end -->

Before each setup, display:

```text
--- Setup N of M: <plugin-name> ---
```

If a Skill invocation fails, record it and continue:

```text
<plugin-name> setup: FAILED (<error reason>)
```

### Step 5: Final Summary

After all selected setups have run, re-run the same Bash dashboard from Step 1
and the same ToolSearch probes from Step 1.5. Re-classify every plugin using
the same rules and show only status changes:

```text
Setup Complete — Before/After
=============================

  Plugin               Before          After
  -------------------  -----------     -----------
  gt-workflow          NEEDS SETUP     READY
  yellow-research      NEEDS SETUP     PARTIAL
  yellow-linear        NEEDS SETUP     READY
  yellow-core          PARTIAL         READY

  Overall: X ready, Y partial, Z need setup
```

If any plugins still need attention, list them with their final detail:

```text
Still need attention:
  yellow-morph — PARTIAL (Morph API key not configured)
  yellow-review — PARTIAL (yellow-core not installed)
```

If all installed plugins are READY, display:

```text
All installed marketplace plugins are fully configured.
```

## Error Handling

| Error | Message | Action |
|---|---|---|
| Dashboard Bash call fails | "Dashboard check failed. Verify shell environment." | Stop |
| ToolSearch probe missing expected tool | Record plugin as PARTIAL or NEEDS SETUP based on the rules above | Continue |
| Plugin cache not found | "plugin_cache: NOT FOUND" | Continue with local checks only; installed status may be inaccurate |
| Skill invocation fails | "`<plugin>` setup: FAILED (<error>)`" | Record and continue |
| User cancels during interactive setup | Show partial before/after for completed setups | Stop after summary |
| All installed plugins already READY | "All installed plugins are configured." | Offer statusline refresh only when yellow-core is installed |
