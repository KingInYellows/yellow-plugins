---
name: setup:all
description: "Run setup for all installed marketplace plugins. Checks local prerequisites, MCP visibility, environment variables, and plugin status, then offers interactive setup for plugins that need it."
argument-hint: ''
allowed-tools:
  - Bash
  - Read
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
command -v gemini >/dev/null 2>&1 && printf 'gemini:             OK (%s)\n' "$(gemini --version 2>&1 | head -n1)" || printf 'gemini:             NOT FOUND\n'
command -v opencode >/dev/null 2>&1 && printf 'opencode:           OK (%s)\n' "$(opencode --version 2>&1 | head -n1)" || printf 'opencode:           NOT FOUND\n'
if command -v mempalace >/dev/null 2>&1; then
  mp_version_raw=$(mempalace --version 2>/dev/null | head -n1)
  mp_version=$(printf '%s' "$mp_version_raw" | grep -Eo '[0-9]+(\.[0-9]+)+' | head -n1)
  printf 'mempalace:          OK (%s)\n' "${mp_version_raw:-unknown}"
  mp_major=${mp_version%%.*}
  if [ -n "$mp_major" ] && [ "$mp_major" -ge 3 ] 2>/dev/null; then
    printf 'mempalace_mcp_check: ok\n'
  else
    printf 'mempalace_mcp_check: too_old\n'
  fi
else
  printf 'mempalace:          NOT FOUND\n'
  printf 'mempalace_mcp_check: missing\n'
fi

if command -v python3 >/dev/null 2>&1; then
  py_ver=$(python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>/dev/null)
  printf 'python3:            OK (%s)\n' "$py_ver"
  py37=$(python3 -c "import sys; print('ok' if sys.version_info >= (3, 7) else 'too_old')" 2>/dev/null)
  py313=$(python3 -c "import sys; print('ok' if sys.version_info >= (3, 13) else 'too_old')" 2>/dev/null)
  py310=$(python3 -c "import sys; print('ok' if sys.version_info >= (3, 10) else 'too_old')" 2>/dev/null)
  printf 'python37_check:     %s\n' "$py37"
  printf 'python310_check:    %s\n' "$py310"
  printf 'python313_check:    %s\n' "$py313"
else
  printf 'python3:            NOT FOUND\n'
  printf 'python37_check:     missing\n'
  printf 'python310_check:    missing\n'
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
if [ -n "${DEVIN_SERVICE_USER_TOKEN:-}" ]; then
  printf 'DEVIN_SERVICE_USER_TOKEN:  set (shell env)\n'
elif grep -qE '"devin_service_user_token"[[:space:]]*:' "${HOME}/.claude/.credentials.json" 2>/dev/null; then
  printf 'DEVIN_SERVICE_USER_TOKEN:  set (userConfig)\n'
else
  printf 'DEVIN_SERVICE_USER_TOKEN:  NOT SET (run /devin:setup if you configured via keychain)\n'
fi
if [ -n "${DEVIN_ORG_ID:-}" ]; then
  printf 'DEVIN_ORG_ID:              set (shell env)\n'
elif grep -qE '"devin_org_id"[[:space:]]*:' "${HOME}/.claude/.credentials.json" 2>/dev/null; then
  printf 'DEVIN_ORG_ID:              set (userConfig)\n'
else
  printf 'DEVIN_ORG_ID:              NOT SET (run /devin:setup if you configured via keychain)\n'
fi
[ -n "${SEMGREP_APP_TOKEN:-}" ] && printf 'SEMGREP_APP_TOKEN:         set\n' || printf 'SEMGREP_APP_TOKEN:         NOT SET\n'
[ -n "${OPENAI_API_KEY:-}" ] && printf 'OPENAI_API_KEY:            set\n' || printf 'OPENAI_API_KEY:            NOT SET\n'
[ -n "${EXA_API_KEY:-}" ] && printf 'EXA_API_KEY:               set\n' || printf 'EXA_API_KEY:               NOT SET\n'
[ -n "${TAVILY_API_KEY:-}" ] && printf 'TAVILY_API_KEY:            set\n' || printf 'TAVILY_API_KEY:            NOT SET\n'
[ -n "${PERPLEXITY_API_KEY:-}" ] && printf 'PERPLEXITY_API_KEY:        set\n' || printf 'PERPLEXITY_API_KEY:        NOT SET\n'
[ -n "${CERAMIC_API_KEY:-}" ] && printf 'CERAMIC_API_KEY:           set\n' || printf 'CERAMIC_API_KEY:           NOT SET\n'
[ -n "${COMPOSIO_MCP_URL:-}" ] && printf 'COMPOSIO_MCP_URL:          set\n' || printf 'COMPOSIO_MCP_URL:          NOT SET\n'
[ -n "${COMPOSIO_API_KEY:-}" ] && printf 'COMPOSIO_API_KEY:          set\n' || printf 'COMPOSIO_API_KEY:          NOT SET\n'

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
[ -n "$repo_top" ] && [ -f "$repo_top/.claude/yellow-ci.local.md" ] && printf '.claude/yellow-ci.local.md:         exists\n' || printf '.claude/yellow-ci.local.md:         missing\n'
[ -n "$repo_top" ] && [ -f "$repo_top/.claude/yellow-browser-test.local.md" ] && printf '.claude/yellow-browser-test.local.md: exists\n' || printf '.claude/yellow-browser-test.local.md: missing\n'
[ -n "$repo_top" ] && [ -f "$repo_top/.graphite.yml" ] && printf '.graphite.yml:                      exists\n' || printf '.graphite.yml:                      missing\n'
[ -n "$repo_top" ] && [ -f "$repo_top/.github/pull_request_template.md" ] && printf '.github/pull_request_template.md:   exists\n' || printf '.github/pull_request_template.md:   missing\n'
[ -n "$repo_top" ] && [ -f "$repo_top/.claude/composio-usage.json" ] && printf '.claude/composio-usage.json:        exists\n' || printf '.claude/composio-usage.json:        missing\n'
[ -f ~/.codex/auth.json ] && printf '~/.codex/auth.json:                 exists\n' || printf '~/.codex/auth.json:                 missing\n'
[ -d "$HOME/.mempalace" ] && printf '~/.mempalace/:                      exists\n' || printf '~/.mempalace/:                      missing\n'
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

printf '\n=== Web App Signals (yellow-browser-test) ===\n'
# Probe for web-app signals so the classifier can decide whether to OMIT
# yellow-browser-test on non-web repos. Any single match flips
# web_signal_count > 0; the classifier uses the count, not individual flags.
web_signal_count=0
if [ -n "$repo_top" ] && [ -f "$repo_top/package.json" ] && \
   grep -qE '"(next|react|vue|svelte|astro|nuxt|remix|express|fastify|koa|hono|gatsby|vite|webpack-dev-server|@angular/core|lit|solid-js|preact|alpinejs)"' "$repo_top/package.json" 2>/dev/null; then
  printf 'web_signal_node:               present\n'
  web_signal_count=$((web_signal_count + 1))
else
  printf 'web_signal_node:               absent\n'
fi
if [ -n "$repo_top" ] && [ -f "$repo_top/Gemfile" ] && \
   grep -qE "^[[:space:]]*gem[[:space:]]+['\"]rails['\"]" "$repo_top/Gemfile" 2>/dev/null; then
  printf 'web_signal_rails:              present\n'
  web_signal_count=$((web_signal_count + 1))
else
  printf 'web_signal_rails:              absent\n'
fi
python_web_present=0
for f in "$repo_top/requirements.txt" "$repo_top/pyproject.toml"; do
  if [ -n "$repo_top" ] && [ -f "$f" ] && \
     grep -qiE "(django|flask|fastapi|starlette|sanic)" "$f" 2>/dev/null; then
    python_web_present=1
    break
  fi
done
if [ "$python_web_present" -eq 1 ]; then
  printf 'web_signal_python:             present\n'
  web_signal_count=$((web_signal_count + 1))
else
  printf 'web_signal_python:             absent\n'
fi
if [ -n "$repo_top" ] && [ -f "$repo_top/go.mod" ] && \
   grep -qE "(gin-gonic|labstack/echo|gofiber/fiber|go-chi/chi|gorilla/mux)" "$repo_top/go.mod" 2>/dev/null; then
  printf 'web_signal_go:                 present\n'
  web_signal_count=$((web_signal_count + 1))
else
  printf 'web_signal_go:                 absent\n'
fi
if [ -n "$repo_top" ] && [ -f "$repo_top/Cargo.toml" ] && \
   grep -qE "^(axum|actix-web|rocket|warp)[[:space:]]*=" "$repo_top/Cargo.toml" 2>/dev/null; then
  printf 'web_signal_rust:               present\n'
  web_signal_count=$((web_signal_count + 1))
else
  printf 'web_signal_rust:               absent\n'
fi
paas_match=""
for f in fly.toml render.yaml vercel.json netlify.toml; do
  if [ -n "$repo_top" ] && [ -f "$repo_top/$f" ]; then
    paas_match="$f"
    break
  fi
done
if [ -n "$paas_match" ]; then
  printf 'web_signal_paas:               present (%s)\n' "$paas_match"
  web_signal_count=$((web_signal_count + 1))
else
  printf 'web_signal_paas:               absent\n'
fi
if [ -n "$repo_top" ] && [ -f "$repo_top/docker-compose.yml" ] && \
   grep -qE '^[[:space:]]*-[[:space:]]*"?[0-9]+:(80|443|3000|3001|4000|5000|5173|8000|8080|8888)"?' "$repo_top/docker-compose.yml" 2>/dev/null; then
  printf 'web_signal_docker_http:        present\n'
  web_signal_count=$((web_signal_count + 1))
else
  printf 'web_signal_docker_http:        absent\n'
fi
printf 'web_signal_count:              %s\n' "$web_signal_count"

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
    for p in gt-workflow yellow-ruvector yellow-morph yellow-devin yellow-semgrep yellow-research yellow-linear yellow-debt yellow-ci yellow-review yellow-browser-test yellow-docs yellow-composio yellow-codex yellow-council yellow-mempalace yellow-core; do
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

<!-- setup-all-toolsearch-probes:start -->
Run four ToolSearch probes to capture current-session MCP visibility:

- `list_teams`
- `parallel__createDeepResearch`
- `ast-grep__find_code`
- `ceramic_search`

Record whether these exact tools are present in the results:

- `mcp__plugin_yellow-linear_linear__list_teams`
- `mcp__plugin_yellow-research_parallel__createDeepResearch`
- `mcp__plugin_yellow-research_ast-grep__find_code`
- `mcp__plugin_yellow-research_ceramic__ceramic_search`
<!-- setup-all-toolsearch-probes:end -->

ToolSearch reflects current-session visibility only. If a plugin was installed
after the session started, the tool may remain invisible until Claude Code is
restarted.

### Steps 1.6 + 1.7: Credential Status Files and Plugin Version Drift

Read
`${CLAUDE_PLUGIN_ROOT}/references/setup-all/credential-status-and-version-drift.md`
and run the two probe blocks exactly as written there: Step 1.6 reads
each credential-bearing plugin's `credential-status.json` (the
AUTHORITATIVE classification source when present), and Step 1.7 runs the
24h-cached `claude plugin list --json --available` version-drift check.
Do not re-derive either bash block from memory — the jq field
extraction, the cache TTL handling, and the `sort -V` outdated
comparison are load-bearing, and an improvised probe misclassifies
plugins in the Step 2 dashboard. If the Read fails (file missing, path
unresolved), stop and report the exact path that could not be loaded —
do not reconstruct the probes from memory or silently skip them.

### Step 2: Classify Plugin Status

Classify each installed plugin as **READY**, **PARTIAL**, or **NEEDS SETUP**.

If Step 1 printed `plugin_cache: NOT FOUND` OR `plugin_cache_warning: unable
to inspect plugin cache`, STOP before classifying: in both branches no
installed-status lines were emitted, so installed state is unknown for every
plugin — do NOT read the absence of a plugin's line as `NOT INSTALLED`.
Report the matching cause — "Plugin cache directory not found at
~/.claude/plugins/cache — cannot determine installed plugins. Fix the cache
path (or reinstall plugins) and re-run /setup:all." or "Plugin cache exists
but cannot be inspected (need python3 or jq) — install one and re-run
/setup:all." — and stop.

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
      classification derives from the `MORPH_API_KEY` row already produced
      by Step 1 — if it shows `set (shell env)` or `set (userConfig)`,
      condition (b) is satisfied. Do NOT re-run a bare grep here; the
      Step 1 output is the authoritative source and uses path-scoped
      detection (`pluginConfigs.<plugin>.options.<key>`) rather than an
      unscoped string match.
- PARTIAL: local prerequisites are satisfied but neither the shell env
  var nor the userConfig option is detectable — the plugin will install
  but the MCP server will not start. Recommend running `/morph:setup`
  or answering the userConfig prompt at next plugin-enable.
- NEEDS SETUP: any local prerequisite missing (`node18_check`, `npm`, or
  `rg`).

**yellow-devin:**

Credentials may come from shell env vars or the plugin's `userConfig`
prompt, but 8 of 9 devin commands read `$DEVIN_SERVICE_USER_TOKEN` /
`$DEVIN_ORG_ID` directly via curl — only shell env is fully functional.
Classification derives from the two Step 1 rows (`set (shell env)` /
`set (userConfig)` / `NOT SET`). On macOS, userConfig values live in the
system keychain and are invisible to Step 1's file grep — a keychain-only
credential shows `NOT SET`; `/devin:setup` is the authoritative check.

- READY: `curl` OK AND `jq` OK AND both rows show `set (shell env)`
- PARTIAL: `curl` OK AND `jq` OK AND both rows resolved, but at least one
  only as `set (userConfig)` — detail: "userConfig is set but the shell env
  var is unset; /devin:* commands call curl directly and will return 401.
  Export the vars (or see /devin:setup)."
- NEEDS SETUP: `curl` missing OR `jq` missing OR either row `NOT SET`

**yellow-semgrep:**

Prefer the credential-status file from Step 1.6 over shell-env-only probes.
The wrapper script honors both userConfig and shell env as of v4.1.0.

- READY: `curl` OK AND `jq` OK AND `semgrep` OK AND (status file shows
  `semgrep_app_token` present, OR status file absent AND `SEMGREP_APP_TOKEN`
  set in shell env)
- PARTIAL: token resolved (per status file or shell env) but `semgrep` CLI
  is missing
- NEEDS SETUP: token absent (status file shows `source: absent` OR file
  absent AND shell env unset) OR `curl` missing OR `jq` missing

**yellow-research:**

Prefer the credential-status file from Step 1.6 over shell-env-only probes.
The 3-element fallback wrapper means keys may be resolved from the keychain
(invisible to the dashboard's Bash subprocess) — the status file is the
only accurate signal.

Compute bundled source availability out of 6:

1. `exa_api_key` present per status file, OR `EXA_API_KEY` set in shell env
   (legacy path when status file absent)
2. `tavily_api_key` present per status file, OR `TAVILY_API_KEY` set
3. `perplexity_api_key` present per status file, OR `PERPLEXITY_API_KEY` set
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

If the status file is absent AND no shell env vars are set, surface a hint:
"yellow-research credentials not detected — restart Claude Code to populate
the status file, or run `/plugin disable yellow-research && /plugin enable
yellow-research` to re-trigger the userConfig prompts."

**yellow-linear:**

- READY: `gt` OK AND `mcp__plugin_yellow-linear_linear__list_teams` is visible
- PARTIAL: Linear MCP is visible but `gt` is missing
- NEEDS SETUP: Linear MCP tool is not visible in the current session

**yellow-debt:**

- READY: `git_repo` ok AND `repo_root` writable AND `git` OK AND `jq` OK AND
  `yq` OK AND `realpath` OK AND `flock` OK AND `gt` OK AND `yellow-core`
  installed AND `yellow-linear` installed
- PARTIAL: all required local checks pass AND `yellow-core` installed, but
  `yellow-linear` is NOT INSTALLED (optional — only `/debt:sync` needs it)
- NEEDS SETUP: any required local check fails OR `yellow-core` is NOT
  INSTALLED (non-optional dependency: debt commands source
  `validate_file_path()` from yellow-core/lib/validate-fs.sh and fail
  without it)

**yellow-ci:**

- READY: `gh` OK AND `jq` OK AND `ssh` OK AND `gh_auth` OK AND
  `.claude/yellow-ci.local.md` exists AND `yellow-linear` installed
- PARTIAL: `gh` OK AND `jq` OK AND config exists, but `ssh` is missing or
  `gh_auth` is not authenticated — OR all other READY conditions hold but
  `yellow-linear` is NOT INSTALLED (optional — only `/ci:report-linear`
  needs it)
- NEEDS SETUP: `gh` missing OR `jq` missing OR config missing

**yellow-review:**

- READY: `gh` OK AND `jq` OK AND `gt` OK AND `gh_auth` OK AND `yellow-core`
  installed
- PARTIAL: required local review checks pass, but `yellow-core` is NOT INSTALLED
- NEEDS SETUP: any required local review check fails

**yellow-browser-test:**

Run a project-type heuristic before classifying. Read `web_signal_count`
from Step 1's "Web App Signals" section (the bash dashboard probes
`package.json` for framework deps, `Gemfile` for Rails, `requirements.txt`/
`pyproject.toml` for Django/Flask/FastAPI, `go.mod` for Gin/Echo/Fiber/Chi/
Gorilla, `Cargo.toml` for Axum/Actix/Rocket/Warp, PaaS configs
`fly.toml`/`render.yaml`/`vercel.json`/`netlify.toml`, and
`docker-compose.yml` for HTTP port mappings).

If `web_signal_count` is `0` AND `.claude/yellow-browser-test.local.md` is
absent, OMIT this plugin from the dashboard entirely — a non-web-app repo
(dotfiles, CLI tool, library) has nothing for browser-test to target.

Classification when `web_signal_count >= 1` OR config file present:

- READY: `.claude/yellow-browser-test.local.md` exists AND `node18_check` ok
  AND `npm` OK AND `agent-browser` OK
- RECOMMENDED: `web_signal_count >= 1` but `.claude/yellow-browser-test.local.md`
  is missing — emit "Web app detected; run `/browser-test:setup` to enable
  testing." This is informational, not a NEEDS SETUP error.
- NEEDS SETUP: config file exists but tooling missing (`node18_check`/`npm`/
  `agent-browser`)

If `web_signal_count` is `0` AND no config file: omit from dashboard.

**yellow-docs:**

- READY: `git_repo` ok AND `git` OK
- NEEDS SETUP: `git` missing OR not in a git repository

**yellow-composio:**

The bundled MCP is now `command`-type stdio with a wrapper resolving
userConfig OR shell env (v1.3.0+). Prefer the credential-status file for
classification; when it is absent, fall back to the `COMPOSIO_MCP_URL` /
`COMPOSIO_API_KEY` shell env vars (per Step 1.6's documented fallback rule)
so a fresh install that has not yet written the status file is not
mis-classified.

Define `composio_creds_present` as: status file shows BOTH `composio_mcp_url`
and `composio_api_key` `present == true`, OR (status file absent AND both
`COMPOSIO_MCP_URL` and `COMPOSIO_API_KEY` are set in shell env).

- READY: `jq` OK AND Composio MCP tools visible via ToolSearch AND
  `composio_creds_present` AND `.claude/composio-usage.json` exists.
  (No `node` gate here: visible tools already imply either the bundled
  server started — so node was adequate — or a legacy prefix is serving
  them, for which node is irrelevant.)
- PARTIAL: `composio_creds_present` AND one of:
  - MCP tools not visible yet AND `node18_check` not `ok` (missing, OR
    present but older than v18), AND you intend to use the bundled prefix →
    install or upgrade to Node.js 18+ (the bundled wrapper runs
    `node bin/composio-proxy.mjs`, whose proxy calls the global `fetch()`
    API that needs Node 18+; a restart or disable/enable cannot fix a
    missing or too-old binary). Not needed if using the Claude.ai-native or
    manual `claude mcp add` prefix.
  - MCP tools not visible yet → Claude Code restart needed to pick up the
    newly-configured credentials
  - usage counter (`.claude/composio-usage.json`) missing → run
    `/composio:setup`
- NEEDS SETUP: status file shows either credential as `source: absent`, OR
  status file missing AND at least one of `COMPOSIO_MCP_URL` /
  `COMPOSIO_API_KEY` is unset. In either case the wrapper will exit
  non-zero and the bundled MCP won't start — no cascade failure to other
  MCPs. Remediation: run `/plugin disable yellow-composio && /plugin
  enable yellow-composio` (or export both env vars for fleet installs).

**yellow-codex:**

- READY: `codex` binary found in PATH AND version >= 0.118.0 AND
  (`OPENAI_API_KEY` set OR `~/.codex/auth.json` exists)
- PARTIAL: `codex` binary found AND version >= 0.118.0, but auth not configured
- NEEDS SETUP: `codex` binary not found OR version < 0.118.0

**yellow-council:**

- READY: `bash` >= 4.3 AND `timeout` AND `jq` AND
  (`gemini` >= 0.40 OR `opencode` >= 1.14 OR yellow-codex installed)
- PARTIAL: required system tools present AND at least 1 of 3 reviewer CLIs
  installed (Gemini, OpenCode, Codex via yellow-codex) — council can run with
  reduced coverage
- NEEDS SETUP: required system tools missing (`bash`, `timeout`, `jq`) OR
  system tools present but 0 of 3 reviewer CLIs installed

**yellow-mempalace:**

- READY: `python310_check` ok AND `mempalace_mcp_check` ok AND
  `~/.mempalace/` directory exists
- PARTIAL: `python310_check` ok AND `mempalace_mcp_check` ok AND `~/.mempalace/` not initialized
- NEEDS SETUP: `mempalace_mcp_check` not ok (binary missing or version `< 3.0.0`) OR `python310_check` not ok

**yellow-core:**

- READY: `python37_check` ok AND `~/.claude/yellow-statusline.py` exists AND
  `statusLine_key` is `present` AND `disableAllHooks` is not `True`
- PARTIAL: script exists AND `statusLine_key` is present AND `python37_check`
  is ok, but `disableAllHooks` is `True`
- NEEDS SETUP: any other READY condition not met
<!-- setup-all-classification:end -->

Display the dashboard in this order:

<!-- setup-all-dashboard-example:start -->
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
  yellow-debt          PARTIAL         Required tools ready, yellow-linear missing
  yellow-ci            READY           gh authenticated, runner config present
  yellow-review        PARTIAL         Review prerequisites ready, yellow-core missing
  yellow-browser-test  NEEDS SETUP     agent-browser missing
  yellow-docs          READY           git available, repo is a git repository
  yellow-composio      PARTIAL         MCP visible, usage counter missing
  yellow-codex         PARTIAL         codex v0.118.0 found, OPENAI_API_KEY not set
  yellow-council       PARTIAL         1 of 3 reviewer CLIs installed (codex only)
  yellow-mempalace     NEEDS SETUP     mempalace binary missing from PATH
  yellow-core          PARTIAL         statusLine installed, disableAllHooks=true

  Summary: X ready, Y partial, Z need setup
```
<!-- setup-all-dashboard-example:end -->

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
8. `debt:setup`
9. `ci:setup`
10. `review:setup`
11. `browser-test:setup`
12. `docs:setup`
13. `composio:setup`
14. `codex:setup`
15. `council:setup`
16. `mempalace:setup`
17. `statusline:setup`
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
- `yellow-debt` → `debt:setup`
- `yellow-ci` → `ci:setup`
- `yellow-review` → `review:setup`
- `yellow-browser-test` → `browser-test:setup`
- `yellow-docs` → `docs:setup`
- `yellow-composio` → `composio:setup`
- `yellow-codex` → `codex:setup`
- `yellow-council` → `council:setup`
- `yellow-mempalace` → `mempalace:setup`
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

After all selected setups have run, re-run the same Bash dashboard from Step 1,
the same ToolSearch probes from Step 1.5, AND the Step 1.6/1.7 probes from
`${CLAUDE_PLUGIN_ROOT}/references/setup-all/credential-status-and-version-drift.md`
— a setup run can re-trigger userConfig prompts or restart MCP servers, so
credential-status files may have changed mid-command; skipping 1.6/1.7 here
would show stale before/after rows for exactly the plugins most likely to have
changed (yellow-research, yellow-semgrep, yellow-composio). Re-classify every
plugin using the same rules and show only status changes:

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
| Plugin cache not found or uninspectable (no python3/jq) | "Plugin cache directory not found at ~/.claude/plugins/cache — cannot determine installed plugins." / "Plugin cache exists but cannot be inspected (need python3 or jq)." | Stop before Step 2 classification |
| Skill invocation fails | "`<plugin>` setup: FAILED (<error>)`" | Record and continue |
| User cancels during interactive setup | Show partial before/after for completed setups | Stop after summary |
| All installed plugins already READY | "All installed plugins are configured." | Offer statusline refresh only when yellow-core is installed |
