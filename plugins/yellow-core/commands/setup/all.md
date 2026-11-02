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
# yellow-morph needs Node >= 22.22.0; yellow-cursor and yellow-goal pin
# engines to >=22.22.0 <25.0.0.
if command -v node >/dev/null 2>&1 && node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 22) ? 0 : 1)' 2>/dev/null; then
  printf 'node2222_check:     ok\n'
else
  printf 'node2222_check:     too_old_or_missing\n'
fi
if command -v node >/dev/null 2>&1 && node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit((a > 22 || (a === 22 && b >= 22)) && a < 25 ? 0 : 1)' 2>/dev/null; then
  printf 'node2222_lt25_check: ok\n'
else
  printf 'node2222_lt25_check: out_of_range_or_missing\n'
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
command -v bash >/dev/null 2>&1 && printf 'bash:               OK\n' || printf 'bash:               NOT FOUND\n'
command -v timeout >/dev/null 2>&1 && printf 'timeout:            OK\n' || printf 'timeout:            NOT FOUND\n'
command -v od >/dev/null 2>&1 && printf 'od:                 OK\n' || printf 'od:                 NOT FOUND\n'
command -v sort >/dev/null 2>&1 && printf 'sort:               OK\n' || printf 'sort:               NOT FOUND\n'
# The rest of /council:setup's required set, plus its /dev/urandom check.
_cn_miss=""
for _cn_t in mktemp awk sed grep find; do command -v "$_cn_t" >/dev/null 2>&1 || _cn_miss="$_cn_miss $_cn_t"; done
case "$(od -An -N4 -tu4 /dev/urandom 2>/dev/null | tr -d ' \n')" in
  '' | *[!0-9]*) _cn_miss="$_cn_miss /dev/urandom" ;;
esac
[ -z "$_cn_miss" ] && printf 'council_extra_tools: ok\n' || printf 'council_extra_tools: missing%s\n' "$_cn_miss"
unset _cn_miss _cn_t
# yellow-council's blocks need bash 4.3+ or zsh (associative arrays).
if [ -n "${BASH_VERSION:-}" ]; then
  case "$BASH_VERSION" in
    [0-3].*|4.[0-2].*) printf 'shell_check:        too_old (bash %s)\n' "$BASH_VERSION" ;;
    *) printf 'shell_check:        ok (bash %s)\n' "$BASH_VERSION" ;;
  esac
elif [ -n "${ZSH_VERSION:-}" ]; then
  printf 'shell_check:        ok (zsh %s)\n' "$ZSH_VERSION"
else
  printf 'shell_check:        unsupported\n'
fi
# yellow-review's /review:resolve scripts need an awk (any implementation).
command -v awk >/dev/null 2>&1 && printf 'awk:                OK\n' || printf 'awk:                NOT FOUND\n'
command -v ast-grep >/dev/null 2>&1 && printf 'ast-grep:           OK\n' || printf 'ast-grep:           NOT FOUND\n'
command -v agent-browser >/dev/null 2>&1 && printf 'agent-browser:      OK\n' || printf 'agent-browser:      NOT FOUND\n'
[ -n "$_gt" ] && printf 'gt:                 OK (%s)\n' "$("$_gt" --version 2>/dev/null | head -n1)" || printf 'gt:                 NOT FOUND\n'
# gt-workflow's bundled Graphite MCP server (`gt mcp`) needs gt 1.6.7+.
if [ -n "$_gt" ]; then
  _gt_ver=$("$_gt" --version 2>/dev/null | head -n1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n1)
  if [ -z "$_gt_ver" ]; then
    printf 'gt_mcp_check:       unknown (could not parse gt --version)\n'
  elif printf '%s\n' "$_gt_ver" | awk -F. '{ exit !($1 > 1 || ($1 == 1 && ($2 > 6 || ($2 == 6 && $3 >= 7)))) }'; then
    printf 'gt_mcp_check:       ok\n'
  else
    printf 'gt_mcp_check:       too_old (%s < 1.6.7)\n' "$_gt_ver"
  fi
  unset _gt_ver
else
  printf 'gt_mcp_check:       SKIPPED (gt not found)\n'
fi
# yellow-ruvector installs ruvector into its own plugin data dir (not PATH):
# ~/.claude/plugins/data/<yellow-ruvector id>/, or the XDG fallback when the
# host does not set CLAUDE_PLUGIN_DATA. Count a dir only where the launcher
# accepts it (lib/install-ruvector.sh validate_paths): physically under HOME
# or /tmp, or under an absolute, non-system CLAUDE_CONFIG_DIR / XDG_DATA_HOME.
_rv_sys() { case "$1" in ''|/|/bin|/bin/*|/boot|/boot/*|/dev|/dev/*|/etc|/etc/*|/lib|/lib/*|/lib32|/lib32/*|/lib64|/lib64/*|/libx32|/libx32/*|/proc|/proc/*|/run|/run/*|/sbin|/sbin/*|/sys|/sys/*|/usr|/usr/*|/var|/var/*|/System|/System/*|/Library|/Library/*|/private/etc|/private/etc/*|/private/var|/private/var/*) return 0 ;; esac; return 1; }
_rv_base_ok() { case "$1" in /*) _rv_b=$(CDPATH= cd -P -- "$1" 2>/dev/null && pwd) && ! _rv_sys "$_rv_b" ;; *) return 1 ;; esac; }
_rv_home=$(CDPATH= cd -P -- "${HOME:-/nonexistent}" 2>/dev/null && pwd) || _rv_home="/__unset__"
# _rv_probe <cli.js> — `node <cli.js> --version`, bounded to 10s: GNU
# timeout or gtimeout when present, otherwise (stock macOS) a background run
# with a watchdog that kills it, so a hanging install never stalls /setup:all.
_rv_probe() {
  local t out p w rc
  # Only a timeout that supports --kill-after (GNU): a CLI that ignores
  # TERM is then KILLed 2s later. BusyBox-style ones use the watchdog below.
  for t in timeout gtimeout; do
    command -v "$t" >/dev/null 2>&1 && "$t" --kill-after=1 5 true >/dev/null 2>&1 \
      && { "$t" --kill-after=2 10 node "$1" --version 2>/dev/null; return; }
  done
  out=$(mktemp) || return 1
  node "$1" --version >|"$out" 2>/dev/null &
  p=$!
  ( sleep 10; kill -9 "$p" 2>/dev/null ) >/dev/null 2>&1 &
  w=$!
  wait "$p"; rc=$?
  kill "$w" 2>/dev/null
  cat "$out"; rm -f "$out"
  return "$rc"
}
_rv_cli=""; _rv_ver=""
# OK only when the entry actually runs (a missing or corrupt dependency
# makes --version fail). A broken candidate does not end the scan: a stale
# data dir from another plugin ID may sort before the live one. Only when no
# candidate runs is it NOT INSTALLED, so the classification offers
# /ruvector:setup, which repairs it.
# A relative XDG_DATA_HOME is invalid and ignored, as the launcher does:
# resolved against the cwd it would name a directory the project controls.
case "${XDG_DATA_HOME:-}" in /*) _rv_xdg=$XDG_DATA_HOME ;; *) _rv_xdg="$HOME/.local/share" ;; esac
for _rv_d in "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/plugins/data/yellow-ruvector*/ "${_rv_xdg}/yellow-ruvector/"; do
  [ -f "${_rv_d}current/node_modules/ruvector/bin/cli.js" ] || continue
  _rv_p=$(CDPATH= cd -P -- "$_rv_d" 2>/dev/null && pwd) || continue
  case "$_rv_p" in
    "$_rv_home"/*|/tmp/*|/private/tmp/*) ;;
    */plugins/data/*) [ -n "${CLAUDE_CONFIG_DIR:-}" ] && _rv_base_ok "$CLAUDE_CONFIG_DIR" && case "$_rv_p" in "$_rv_b"/plugins/data/?*) ;; *) false ;; esac || continue ;;
    *) [ "$_rv_xdg" = "${XDG_DATA_HOME:-}" ] && _rv_base_ok "$_rv_xdg" && [ "$_rv_p" = "$_rv_b/yellow-ruvector" ] || continue ;;
  esac
  # `current` must name a sibling install-* dir, and every component down to
  # cli.js must be a real directory or regular file inside it: a tampered
  # candidate never makes node run a file outside its data dir.
  _rv_t=$(readlink "${_rv_p}/current" 2>/dev/null) || continue
  case "$_rv_t" in */*|'') continue ;; install-?*) ;; *) continue ;; esac
  _rv_i="${_rv_p}/${_rv_t}"
  for _rv_c in "$_rv_i" "$_rv_i/node_modules" "$_rv_i/node_modules/ruvector" "$_rv_i/node_modules/ruvector/bin"; do
    [ -d "$_rv_c" ] && [ ! -L "$_rv_c" ] || continue 2
  done
  _rv_cli="$_rv_i/node_modules/ruvector/bin/cli.js"
  [ -f "$_rv_cli" ] && [ ! -L "$_rv_cli" ] || { _rv_cli=""; continue; }
  _rv_ver=$(_rv_probe "$_rv_cli") || _rv_ver=""
  # The output comes from files on disk (a stale or tampered install): keep
  # it only when its first line is a plain version string, else the install
  # counts as broken, so nothing else reaches the dashboard.
  _rv_ver=$(printf '%s\n' "$_rv_ver" | head -n1 | grep -E '^v?[0-9]+(\.[0-9]+){1,3}([-+][0-9A-Za-z.]{1,32})?$' || true)
  [ -n "$_rv_ver" ] && break
done
if [ -n "$_rv_ver" ]; then printf 'ruvector:           OK (plugin-managed %s)\n' "$_rv_ver"
elif [ -n "$_rv_cli" ]; then printf 'ruvector:           NOT INSTALLED (plugin-managed install broken; /ruvector:setup repairs it)\n'
else printf 'ruvector:           NOT INSTALLED (plugin-managed)\n'; fi
[ "${node_major:-0}" -ge 20 ] && printf 'node20_check:       ok\n' || printf 'node20_check:       too_old_or_missing\n'
unset _rv_cli _rv_xdg _rv_d _rv_p _rv_b _rv_home _rv_ver _rv_t _rv_i _rv_c
unset -f _rv_sys _rv_base_ok _rv_probe
command -v codex >/dev/null 2>&1 && printf 'codex:              OK (%s)\n' "$(codex --version 2>/dev/null | head -n1)" || printf 'codex:              NOT FOUND\n'
# Codex v0.118+ keeps auth in the OS keyring, not ~/.codex/auth.json. Never
# echo the status text: it can include API key fragments.
if command -v codex >/dev/null 2>&1; then
  # Bounded per yellow-codex's readiness contract (15s; keyring access can
  # block). Prints only a label: ok, not_logged_in, unverified, probe_error,
  # timeout. Plain shell, since the standalone Codex CLI needs no Node.
  if command -v timeout >/dev/null 2>&1; then
    _cx_out=$(timeout -s KILL 15 codex login status 2>&1)
    _cx_rc=$?
    if [ "$_cx_rc" -eq 137 ] || [ "$_cx_rc" -eq 124 ]; then _cx_login=timeout
    elif printf '%s\n' "$_cx_out" | grep -qi '^[[:space:]]*not logged in'; then _cx_login=not_logged_in
    elif [ "$_cx_rc" -eq 0 ]; then
      printf '%s\n' "$_cx_out" | grep -qi '^[[:space:]]*logged in' && _cx_login=ok || _cx_login=unverified
    else _cx_login=probe_error; fi
  else
    _cx_login='unverified (no timeout command to bound the probe)'
  fi
  printf 'codex_login:        %s\n' "$_cx_login"
  unset _cx_login _cx_out _cx_rc
else
  printf 'codex_login:        SKIPPED\n'
fi
# yellow-council's Google slot is the Antigravity CLI; the legacy `gemini` CLI
# stopped serving consumer requests on 2026-06-18 and does not count.
command -v agy >/dev/null 2>&1 && printf 'agy:                OK (%s)\n' "$(agy --version 2>&1 | head -n1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n1)" || printf 'agy:                NOT FOUND\n'
# yellow-agy reads the agy row too; on Windows agy may live only in WSL.
command -v wsl.exe >/dev/null 2>&1 && printf 'wsl.exe:            OK\n' || printf 'wsl.exe:            NOT FOUND\n'
command -v opencode >/dev/null 2>&1 && printf 'opencode:           OK (%s)\n' "$(opencode --version 2>&1 | head -n1)" || printf 'opencode:           NOT FOUND\n'
command -v claude >/dev/null 2>&1 && printf 'claude:             OK (%s)\n' "$(claude --version 2>/dev/null | head -n1)" || printf 'claude:             NOT FOUND\n'
# yellow-goal pins goal-gen engineVersion 0.4.0 (/goal:setup is authoritative).
# Same binary and output contract as src/spawn.ts and src/runtime.ts: honor
# GOAL_GEN_BIN, require exit 0, empty stderr and exactly one JSON stdout line.
_gg_bin=${GOAL_GEN_BIN:-goal-gen}
if command -v "$_gg_bin" >/dev/null 2>&1; then
  _gg_ver=$(_GG_BIN="$_gg_bin" node -e '
const r = require("child_process").spawnSync(process.env._GG_BIN, ["version", "--json"], { encoding: "utf8", timeout: 15000, killSignal: "SIGKILL", shell: false });
if (r.status !== 0 || String(r.stderr || "").trim()) process.exit(1);
const lines = String(r.stdout || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
if (lines.length !== 1) process.exit(1);
try {
  const v = JSON.parse(lines[0]).engineVersion;
  if (typeof v === "string" && /^[0-9][0-9A-Za-z.+-]*$/.test(v)) process.stdout.write(v);
} catch {}
' 2>/dev/null)
  [ -n "$_gg_ver" ] && printf 'goal-gen:           OK (%s)\n' "$_gg_ver" || printf 'goal-gen:           UNPARSEABLE\n'
  unset _gg_ver
else
  printf 'goal-gen:           NOT FOUND\n'
fi
unset _gg_bin

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
elif grep -qE '"morph_api_key"[[:space:]]*:' "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/.credentials.json" 2>/dev/null; then
  printf 'MORPH_API_KEY:             set (userConfig)\n'
else
  printf 'MORPH_API_KEY:             NOT SET (run /morph:setup if you configured via keychain)\n'
fi
# yellow-cursor has no userConfig: the CLI reads CURSOR_API_KEY or the SDK's stored login.
[ -n "${CURSOR_API_KEY:-}" ] && printf 'CURSOR_API_KEY:            set (shell env)\n' || printf 'CURSOR_API_KEY:            NOT SET (export it, or use the Cursor stored login; /cursor:setup verifies)\n'
[ -f "$HOME/.cursor/sdk/auth.json" ] && printf 'cursor_stored_login:       present\n' || printf 'cursor_stored_login:       missing\n'
if [ -n "${DEVIN_SERVICE_USER_TOKEN:-}" ]; then
  printf 'DEVIN_SERVICE_USER_TOKEN:  set (shell env)\n'
elif grep -qE '"devin_service_user_token"[[:space:]]*:' "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/.credentials.json" 2>/dev/null; then
  printf 'DEVIN_SERVICE_USER_TOKEN:  set (userConfig)\n'
else
  printf 'DEVIN_SERVICE_USER_TOKEN:  NOT SET (run /devin:setup if you configured via keychain)\n'
fi
if [ -n "${DEVIN_ORG_ID:-}" ]; then
  printf 'DEVIN_ORG_ID:              set (shell env)\n'
elif grep -qE '"devin_org_id"[[:space:]]*:' "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/.credentials.json" 2>/dev/null; then
  printf 'DEVIN_ORG_ID:              set (userConfig)\n'
else
  printf 'DEVIN_ORG_ID:              NOT SET (run /devin:setup if you configured via keychain)\n'
fi
[ -n "${JULES_API_KEY:-}" ] && printf 'JULES_API_KEY:             set (shell env)\n' || printf 'JULES_API_KEY:             NOT SET (export it in your shell; see /jules:setup)\n'
[ -n "${SEMGREP_APP_TOKEN:-}" ] && printf 'SEMGREP_APP_TOKEN:         set\n' || printf 'SEMGREP_APP_TOKEN:         NOT SET\n'
[ -n "${OPENAI_API_KEY:-}" ] && printf 'OPENAI_API_KEY:            set\n' || printf 'OPENAI_API_KEY:            NOT SET\n'
[ -n "${EXA_API_KEY:-}" ] && printf 'EXA_API_KEY:               set\n' || printf 'EXA_API_KEY:               NOT SET\n'
[ -n "${TAVILY_API_KEY:-}" ] && printf 'TAVILY_API_KEY:            set\n' || printf 'TAVILY_API_KEY:            NOT SET\n'
[ -n "${PERPLEXITY_API_KEY:-}" ] && printf 'PERPLEXITY_API_KEY:        set\n' || printf 'PERPLEXITY_API_KEY:        NOT SET\n'


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
# `cfg`, not `path`: in zsh a loop over `path` rewrites $PATH.
for cfg in "$HOME/.graphite_user_config" "${XDG_CONFIG_HOME:-$HOME/.config}/graphite/user_config" "$HOME/.config/graphite/user_config"; do
  if [ -f "$cfg" ]; then
    auth_path="$cfg"
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
claude_config="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
[ -f "$claude_config/yellow-statusline.py" ] && printf '<config>/yellow-statusline.py:      exists\n' || printf '<config>/yellow-statusline.py:      missing\n'

if [ -f "$claude_config/settings.json" ] && command -v python3 >/dev/null 2>&1; then
  CLAUDE_SETTINGS_PATH="$claude_config/settings.json" python3 -c '
import json, os
try:
    d = json.load(open(os.environ["CLAUDE_SETTINGS_PATH"]))
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
# Mirrored in yellow-browser-test `commands/browser-test/setup.md` Step 2.5
# ("Check for Web Application") — update both when a signal changes.
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
   { grep -qE "^[[:space:]]*(\[[^]]*\.)?(axum|actix-web|rocket|warp)(\][[:space:]]*(#.*)?$|[[:space:]]*=)|^[^#]*package[[:space:]]*=[[:space:]]*\"(axum|actix-web|rocket|warp)\"" "$repo_top/Cargo.toml" 2>/dev/null || \
     awk '/^[ \t]*\[+[^]]*\]+[ \t]*(#.*)?$/ { t = $0; sub(/^[ \t]*\[+[ \t]*/, "", t); sub(/[ \t]*\]+.*$/, "", t); dep = (t ~ /^(workspace\.|target\..*\.)?(dev-|build-)?dependencies$/); next }
          dep && /^[ \t]*(axum|actix-web|rocket|warp)\.[A-Za-z_-]+[ \t]*=/ { found = 1; exit }
          END { exit !found }' "$repo_top/Cargo.toml" 2>/dev/null; }; then
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
docker_http_present=0
for f in compose.yaml compose.yml docker-compose.yaml docker-compose.yml; do
  if [ -n "$repo_top" ] && [ -f "$repo_top/$f" ] && \
     grep -qE '^[[:space:]]*-[[:space:]]*"?[0-9]+:(80|443|3000|3001|4000|5000|5173|8000|8080|8888)"?' "$repo_top/$f" 2>/dev/null; then
    docker_http_present=1
    break
  fi
done
if [ "$docker_http_present" -eq 1 ]; then
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
    for p in gt-workflow github-workflow yellow-ruvector yellow-morph yellow-cursor yellow-devin yellow-jules yellow-agy yellow-semgrep yellow-research yellow-linear yellow-debt yellow-ci yellow-review yellow-browser-test yellow-docs yellow-composio yellow-codex yellow-council yellow-goal yellow-claudemod yellow-core; do
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

printf '\n=== Stacked-PR Provider Tooling ===\n'
# Owner-scoped, not name-scoped: `gh extension search stack` returns three
# third-party extensions that also expose a `gh stack` command, and only
# github/gh-stack is first-party. Matching the bare name would report a
# lookalike as READY. A stack-named extension from any other owner is
# WRONG_OWNER (same rule as lib/stack-tooling-probe.js parseExtensionIdentity).
if [ -n "$_gh" ]; then
  # Capture the probe's own exit status rather than losing it to the pipe:
  # a failed `gh extension list` (network, or auth-required) must not be
  # reported as MISSING, which would tell the user to install an extension
  # whose state was never read.
  if _ext_list=$("$_gh" extension list 2>/dev/null); then
    if printf '%s\n' "$_ext_list" | grep -qE '(^|[[:space:]])github/gh-stack([[:space:]]|$)'; then
      printf 'gh_stack_ext: OK (github/gh-stack)\n'
    elif printf '%s\n' "$_ext_list" | awk '{ for (i = 1; i <= NF; i++) if (tolower($i) ~ /(^|\/)(gh-)?stack$/) f = 1 } END { exit !f }'; then
      printf 'gh_stack_ext: WRONG_OWNER (a stack-named extension that is not github/gh-stack)\n'
    else
      printf 'gh_stack_ext: MISSING\n'
    fi
  else
    printf 'gh_stack_ext: UNAVAILABLE (could not query extensions)\n'
  fi
else
  printf 'gh_stack_ext: SKIPPED (gh not found)\n'
fi

printf '\n=== Remote-Agent Provider Tooling ===\n'
# setup-all-remote-agent-tooling:start
# Coarse "is the plugin CLI resolvable" proxy for yellow-cursor and
# yellow-jules: checks that `dist/cli.js` exists at the plugin's installPath
# (from `claude plugin list --json`, NEVER a `${CLAUDE_PLUGIN_ROOT}/../<plugin>`
# relative guess — the real plugin cache is version-suffixed). This is a
# coarse signal — file presence, not a live SDK resolution or auth check —
# the authoritative live checks are `/cursor:setup` and `/jules:setup`.
# yellow-devin ships no CLI to resolve: its tooling is the DEVIN_* credential
# rows under "Environment Variables" above.
_cursor_root=""
_jules_root=""
_enabled_install_path() {
  printf '%s' "$_plugin_list_json" | PLUGIN_ID="$1" PROJECT_PATH="$repo_top" node -e '
    const fs = require("fs");
    let rows;
    try { rows = JSON.parse(fs.readFileSync(0, "utf8")); } catch { rows = []; }
    if (!Array.isArray(rows)) rows = [];
    // Same rule as summarizeProviders (remote-agent-provider-state.js): project
    // and local rows count only when they belong to the current repository
    // (PROJECT_PATH is the git toplevel; empty outside a repo, so none count).
    const projectPath = process.env.PROJECT_PATH || "";
    const scopeRank = { local: 0, project: 1, user: 2, managed: 3 };
    const candidates = rows
      .filter((row) =>
        row && typeof row === "object" &&
        row.id === process.env.PLUGIN_ID &&
        row.enabled === true &&
        typeof row.installPath === "string" && row.installPath.length > 0 &&
        ((row.scope !== "project" && row.scope !== "local") ||
          (projectPath.length > 0 && row.projectPath === projectPath))
      )
      .sort((a, b) => (scopeRank[a.scope] ?? 9) - (scopeRank[b.scope] ?? 9));
    process.stdout.write(candidates.length > 0 ? candidates[0].installPath : "");
  ' 2>/dev/null
}
if _plugin_list_json=$(claude plugin list --json 2>/dev/null); then
  _cursor_root=$(_enabled_install_path 'yellow-cursor@yellow-plugins')
  _jules_root=$(_enabled_install_path 'yellow-jules@yellow-plugins')
fi
if [ -n "$_cursor_root" ] && [ -f "$_cursor_root/dist/cli.js" ]; then
  printf 'cursor_cli_resolved: OK (%s)\n' "$_cursor_root"
else
  printf 'cursor_cli_resolved: NOT FOUND\n'
fi
# Every cursor command needs @cursor/sdk: the plugin's own node_modules first,
# then the data-dir runtime /cursor:setup installs (src/config.ts resolveDataDir).
if [ -n "${YELLOW_CURSOR_DATA_DIR:-}" ]; then _cursor_data=$YELLOW_CURSOR_DATA_DIR
elif [ -n "${XDG_DATA_HOME:-}" ]; then _cursor_data="$XDG_DATA_HOME/yellow-cursor"
else
  case "$(uname -s 2>/dev/null)" in
    Darwin) _cursor_data="$HOME/Library/Application Support/yellow-cursor" ;;
    MINGW*|MSYS*|CYGWIN*) _cursor_data="${APPDATA:-$HOME/AppData/Roaming}/yellow-cursor" ;;
    *) _cursor_data="$HOME/.local/share/yellow-cursor" ;;
  esac
fi
# Load the module like src/sdk-resolver.ts does; a leftover directory from a
# failed install does not count.
_cursor_sdk=no
if node -e 'for (const p of process.argv.slice(1)) { if (!p) continue; try { require(p); process.exit(0); } catch {} } process.exit(1);' \
    "${_cursor_root:+$_cursor_root/node_modules/@cursor/sdk}" "$_cursor_data/runtime/node_modules/@cursor/sdk" >/dev/null 2>&1; then
  _cursor_sdk=yes
  printf 'cursor_sdk_resolved: OK\n'
else
  printf 'cursor_sdk_resolved: MISSING\n'
fi
if [ -n "$_jules_root" ] && [ -f "$_jules_root/dist/cli.js" ]; then
  printf 'jules_cli_resolved: OK (%s)\n' "$_jules_root"
else
  printf 'jules_cli_resolved: NOT FOUND\n'
fi
# Remote-agent group state for Step 2.5, from the classifier /linear:delegate
# uses. Tooling flags come from the probes above; devin counts only when both
# credential env vars are exported, because its commands call curl directly.
_core_root=""
[ -n "${_plugin_list_json:-}" ] && _core_root=$(_enabled_install_path 'yellow-core@yellow-plugins')
if [ -n "$_core_root" ] && [ -f "$_core_root/lib/remote-agent-provider-state.js" ]; then
  _t_cursor=no; [ -n "$_cursor_root" ] && [ -f "$_cursor_root/dist/cli.js" ] && [ "$_cursor_sdk" = yes ] && _t_cursor=yes
  _t_devin=no; [ -n "${DEVIN_SERVICE_USER_TOKEN:-}" ] && [ -n "${DEVIN_ORG_ID:-}" ] && _t_devin=yes
  _t_jules=no; [ -n "$_jules_root" ] && [ -f "$_jules_root/dist/cli.js" ] && _t_jules=yes
  # Without a repo, project/local rows from other checkouts must not count, so
  # drop them here; the classifier only filters them when given a path.
  printf '%s' "$_plugin_list_json" | _RA_LIB="$_core_root/lib/remote-agent-provider-state.js" \
    _RA_PROJECT="${repo_top:-}" _RA_CURSOR="$_t_cursor" _RA_DEVIN="$_t_devin" _RA_JULES="$_t_jules" \
    node -e '
let d = "";
process.stdin.on("data", (c) => { d += c; }).on("end", () => {
  const e = process.env;
  let state = "UNKNOWN", detail = "";
  try {
    let plugins = JSON.parse(d);
    if (!e._RA_PROJECT && Array.isArray(plugins)) plugins = plugins.filter((r) => !(r && (r.scope === "project" || r.scope === "local")));
    const r = require(e._RA_LIB).classifyRemoteAgentState({
      plugins,
      projectPath: e._RA_PROJECT || null,
      tooling: { cursor: e._RA_CURSOR === "yes", devin: e._RA_DEVIN === "yes", jules: e._RA_JULES === "yes" },
    });
    state = String(r.state || "UNKNOWN");
    detail = String(r.detail || "");
  } catch {}
  const clean = (v) => v.replace(/[\r\n]+/g, " ");
  process.stdout.write("remote_agent_state: " + clean(state) + "\n");
  if (detail) process.stdout.write("remote_agent_detail: " + clean(detail) + "\n");
});' 2>/dev/null || printf 'remote_agent_state: UNKNOWN\n'
  unset _t_cursor _t_devin _t_jules
else
  printf 'remote_agent_state: UNKNOWN (yellow-core classifier not resolved)\n'
fi
unset _cursor_data _cursor_sdk _core_root
# setup-all-remote-agent-tooling:end
```

### Step 1.5: Session MCP Visibility (ToolSearch probes)

<!-- setup-all-toolsearch-probes:start -->
Run four ToolSearch probes to capture current-session MCP visibility:

- `list_teams`
- `parallel__createDeepResearch`
- `ceramic_search`
- `COMPOSIO_SEARCH_TOOLS`

Record whether these exact tools are present in the results:

- `mcp__plugin_yellow-linear_linear__list_teams`
- `mcp__plugin_yellow-research_parallel__createDeepResearch`
- `mcp__plugin_yellow-research_ceramic__ceramic_search`
- `mcp__plugin_yellow-composio_composio-server__COMPOSIO_SEARCH_TOOLS`
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

`/gt-setup` stops when the repo is not initialised (`graphite_repo` missing
OR `gt_trunk` unavailable), so both checks are required. `gt_trunk:
SKIPPED` (no `gt`, or not in a git repo) is a failure, not a pass.

- READY: `git_repo` ok AND `gt` OK AND `jq` OK AND `graphite_auth` present
  AND `graphite_repo` present AND `gt_trunk` names a branch (not
  `UNAVAILABLE`, not `SKIPPED`) AND `.graphite.yml` present
- PARTIAL: every READY condition except `.graphite.yml`, which is missing
- NEEDS SETUP: any of `git_repo`, `gt`, `jq`, `graphite_auth`,
  `graphite_repo` or `gt_trunk` fails

Whatever the status, if `gt_mcp_check` is `too_old`, add to the Detail
column: "gt is below 1.6.7 (show the version from that row), so the bundled
Graphite MCP server is unavailable; upgrade gt". The CLI workflow still
works, so this does not change the status.

**github-workflow:**

Alternative provider of the `stacked-pr` capability group (see the
Alternative Provider Groups section below). It is classified like any other
plugin, but its setup is only ever offered when it is the **enabled**
provider — a user running Graphite must never be asked to configure GitHub
stacks as well.

- READY: `gh` OK AND `gh_auth` OK AND `gh_stack_ext` OK
- PARTIAL: `gh` OK AND `gh_auth` OK AND `gh_stack_ext` is `MISSING` — the
  provider plugin is installed but the official `github/gh-stack` extension
  is not; detail: "install with `gh extension install github/gh-stack`"
- PARTIAL: `gh` OK AND `gh_auth` OK AND `gh_stack_ext` is `WRONG_OWNER` —
  a third-party extension holds the `gh stack` name, so the official one
  cannot be installed beside it; detail: "a `stack`-named gh extension is
  installed that is not `github/gh-stack`; remove it with
  `gh extension remove stack`, then `gh extension install github/gh-stack`"
- UNKNOWN: `gh` OK AND `gh_auth` OK AND `gh_stack_ext` is `UNAVAILABLE` —
  `gh extension list` itself failed, so the extension's state was never
  read. Report it as undetermined; do NOT offer the install and do NOT
  report READY. Suggest re-running after checking `gh auth status`.
- NEEDS SETUP: `gh` missing OR `gh_auth` NOT AUTHENTICATED

**yellow-ruvector:**

- READY: `node20_check` ok AND `npm` OK AND `jq` OK AND `ruvector` OK
  (plugin-managed install) AND `.ruvector/` exists
- PARTIAL: `node20_check` ok AND `npm` OK AND `jq` OK AND `.ruvector/` exists
  AND `ruvector` NOT INSTALLED — the plugin installs it on the next session
  start (prewarm hook) or via `/ruvector:setup`; detail: "plugin-managed
  ruvector not installed yet"
- NEEDS SETUP: `node20_check` not ok, `npm` or `jq` missing (the install runs
  `npm ci` and the hooks need `jq`), or `.ruvector/` missing

**yellow-morph:**

The Morph API key can be supplied via either the plugin's `userConfig`
prompt (stored in the system keychain, preferred) or a shell
`MORPH_API_KEY` export (power-user fallback). Neither is visible to
shell checks directly, so treat READY as "key is configured via *some*
path" and rely on `/morph:status` for authoritative OFFLINE detection.

- READY: `node2222_check` ok AND `npm` OK AND `rg` OK AND either of:
  (a) shell `MORPH_API_KEY` set, OR
  (b) `pluginConfigs.yellow-morph.options.morph_api_key` present in
      `~/.claude/.credentials.json` (userConfig was answered). Detection:
      classification derives from the `MORPH_API_KEY` row already produced
      by Step 1 — if it shows `set (shell env)` or `set (userConfig)`,
      condition (b) is satisfied. Do NOT re-run a grep here; the Step 1
      row is the source. It is a key-name match in
      `${CLAUDE_CONFIG_DIR:-~/.claude}/.credentials.json`, not a path-scoped
      lookup, and `/morph:status` remains authoritative.
- PARTIAL: local prerequisites are satisfied but neither the shell env
  var nor the userConfig option is detectable — the plugin will install
  but the MCP server will not start. Recommend running `/morph:setup`
  or answering the userConfig prompt at next plugin-enable.
- NEEDS SETUP: any local prerequisite missing (`node2222_check` — `/morph:setup`
  requires Node 22.22.0 or later — `npm`, or `rg`).

**yellow-cursor:**

Alternative provider of the `remote-agent` capability group (see the
Alternative Provider Groups section below) and the **preferred** member —
`yellow-devin` below is the legacy path. `credential-status.json` is not
emitted for this plugin in v1 (it has no MCP server and no SessionStart
hook writing that file), so classification reads Step 1's `CURSOR_API_KEY`
row plus the `cursor_stored_login`, `cursor_cli_resolved` and
`cursor_sdk_resolved` probes directly. The plugin has no `userConfig`: the
CLI reads `CURSOR_API_KEY` or the Cursor SDK's stored login. Every command
fails with `CURSOR_SDK_MISSING` until `/cursor:setup` installs `@cursor/sdk`.

- READY: `cursor_cli_resolved` is `OK` AND `cursor_sdk_resolved` is `OK` AND
  `jq` OK AND `node2222_lt25_check` ok AND (`CURSOR_API_KEY` shows
  `set (shell env)` OR `cursor_stored_login` is `present`)
- PARTIAL: plugin enabled but any READY condition fails while at least one
  of the CLI or a credential source resolved — detail names the gap, e.g.
  "@cursor/sdk not installed — run `/cursor:setup`"
- NEEDS SETUP: neither the CLI nor any credential source resolved

**yellow-devin:**

Legacy remote-agent provider — `yellow-cursor` above is preferred; this
plugin remains supported for existing Devin workflows and security fixes
only. Credentials may come from shell env vars or the plugin's `userConfig`
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

**yellow-jules:**

Experimental remote-agent provider — `yellow-cursor` above is preferred. The
CLI reads `JULES_API_KEY` from the shell environment only (no `userConfig`),
so classification reads Step 1's `JULES_API_KEY` row and the
`jules_cli_resolved` probe. Whether the pinned Jules SDK is installed is not
visible here; `/jules:setup` is the authoritative check and installs it only
with consent.

- READY: `jules_cli_resolved` is `OK` AND `JULES_API_KEY` shows
  `set (shell env)` — detail notes that `/jules:setup` verifies the SDK
- PARTIAL: plugin enabled but `jules_cli_resolved` is `NOT FOUND`, OR the CLI
  resolved but `JULES_API_KEY` is `NOT SET` — detail: "export
  `JULES_API_KEY`, then run `/jules:setup` to verify or install the SDK"
- NEEDS SETUP: neither the CLI nor the credential resolved

**yellow-agy:**

Scaffold successor to yellow-jules (setup checks only). Classify from Step 1's
`agy:` row, the same row yellow-council reads. On Windows agy may live only
inside WSL, which this dashboard does not probe; `/agy:setup` is authoritative
and also checks auth variables and overages.

Never READY: the version row alone cannot confirm subscription-only auth,
overages off, or the permission settings, so `/agy:setup` must run.

- PARTIAL: `agy` OK with any version, OR `agy` NOT FOUND on a host where Step
  1's `wsl.exe` row is OK — detail: "run `/agy:setup` to check auth, overages,
  permissions and the WSL bridge"
- NEEDS SETUP: `agy` NOT FOUND and the `wsl.exe` row is NOT FOUND

**yellow-semgrep:**

Prefer the credential-status file from Step 1.6 over shell-env-only probes;
a file reported `malformed` counts as absent.
The wrapper script honors both userConfig and shell env as of v4.1.0.

- READY: `curl` OK AND `jq` OK AND `semgrep` OK AND (status file shows
  `semgrep_app_token` present, OR status file absent AND `SEMGREP_APP_TOKEN`
  set in shell env)
- PARTIAL: token resolved (per status file or shell env) but `semgrep` CLI
  is missing
- NEEDS SETUP: token absent (status file shows `0/1 present` OR file
  absent AND shell env unset) OR `curl` missing OR `jq` missing

**yellow-research:**

Prefer the credential-status file from Step 1.6 over shell-env-only probes;
a file reported `malformed` counts as absent.
The 3-element fallback wrapper means keys may be resolved from the keychain
(invisible to the dashboard's Bash subprocess) — the status file is the
only accurate signal.

Compute bundled source availability out of 5:

1. `exa_api_key` present per status file, OR `EXA_API_KEY` set in shell env
   (legacy path when status file absent)
2. `tavily_api_key` present per status file, OR `TAVILY_API_KEY` set
3. `perplexity_api_key` present per status file, OR `PERPLEXITY_API_KEY` set
4. Parallel Task tool visible via ToolSearch
5. Ceramic counts when `ceramic_search` is visible via ToolSearch (OAuth;
   no API key).

- READY: all 5 bundled sources available
- PARTIAL: 1-4 bundled sources available
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
  `yq` OK AND `realpath` OK AND `yellow-core` installed AND `yellow-linear`
  installed. `gt` is not required: `/debt:fix` submits through the enabled
  stacked-PR provider, whose own row reports its tooling.
- PARTIAL: all required local checks pass AND `yellow-core` installed, but
  `yellow-linear` is NOT INSTALLED (optional — only `/debt:sync` needs it)
- NEEDS SETUP: any required local check fails OR `yellow-core` is NOT
  INSTALLED (non-optional dependency: debt commands source
  `validate_file_path()` from yellow-core/lib/validate-fs.sh and fail
  without it)

**yellow-ci:**

- READY: `gh` OK AND `jq` OK AND `ssh` OK AND `gh_auth` OK AND
  `.claude/yellow-ci.local.md` exists AND `yellow-linear` installed
- PARTIAL: `gh` OK AND `jq` OK AND `gh_auth` OK AND config exists, but `ssh`
  is missing (only self-hosted runner diagnosis needs it) — OR all other
  READY conditions hold but `yellow-linear` is NOT INSTALLED (optional —
  only `/ci:report-linear` needs it)
- NEEDS SETUP: `gh` missing OR `jq` missing OR `gh_auth` NOT AUTHENTICATED
  (the `ci-setup` skill stops on it) OR config missing

**yellow-review:**

- READY: `gh` OK AND `jq` OK AND `gh_auth` OK AND `awk` OK AND
  `yellow-core` installed. `gt` is not required: review pushes route through
  the enabled stacked-PR provider, whose own row reports its tooling.
- PARTIAL: required local review checks pass, but `yellow-core` is NOT INSTALLED
- NEEDS SETUP: any required local review check fails (`awk` NOT FOUND
  means `/review:resolve`'s commit and verify scripts cannot run)

**yellow-browser-test:**

Run a project-type heuristic before classifying. Read `web_signal_count`
from Step 1's "Web App Signals" section (the bash dashboard probes
`package.json` for framework deps, `Gemfile` for Rails, `requirements.txt`/
`pyproject.toml` for Django/Flask/FastAPI, `go.mod` for Gin/Echo/Fiber/Chi/
Gorilla, `Cargo.toml` for Axum/Actix/Rocket/Warp, PaaS configs
`fly.toml`/`render.yaml`/`vercel.json`/`netlify.toml`, and
Compose files (`compose.y*ml`, `docker-compose.y*ml`) for HTTP port
mappings).

If `web_signal_count` is `0` AND `.claude/yellow-browser-test.local.md` is
absent, OMIT this plugin from the dashboard entirely — a non-web-app repo
(dotfiles, CLI tool, library) has nothing for browser-test to target.

Classification when `web_signal_count >= 1` OR config file present:

- READY: `.claude/yellow-browser-test.local.md` exists AND `agent-browser` OK
- RECOMMENDED: `web_signal_count >= 1` but `.claude/yellow-browser-test.local.md`
  is missing — emit "Web app detected; run `/browser-test:setup` to enable
  testing." This is informational, not a NEEDS SETUP error.
- NEEDS SETUP: config file exists but `agent-browser` missing — detail notes
  that installing it needs `npm` and Node 22.22.0 or later

If `web_signal_count` is `0` AND no config file: omit from dashboard.

**yellow-docs:**

- READY: `git_repo` ok AND `git` OK
- NEEDS SETUP: `git` missing OR not in a git repository

**yellow-composio:**

The bundled MCP is native HTTP at `https://connect.composio.dev/mcp`.
Claude Code authenticates it with browser OAuth. There is no API key and
no credential-status file.

Define `composio_tools_visible` from Step 1.5: the recorded tool
`mcp__plugin_yellow-composio_composio-server__COMPOSIO_SEARCH_TOOLS` is
present, OR ToolSearch also returned
`mcp__claude_ai_composio__COMPOSIO_SEARCH_TOOLS` or
`mcp__composio-server__COMPOSIO_SEARCH_TOOLS`. The last two are legacy
prefixes and are not in the recorded probe list.

- READY: `composio_tools_visible` AND `.claude/composio-usage.json` exists.
  `jq` missing is degraded usage tracking, not a setup failure. Tool
  visibility proves registration, not authentication (a rejected OAuth
  session can still leave a stale usage file behind) — set the Detail
  column to "tools visible; auth not verified — run `/composio:status` or
  `/composio:setup` to probe" rather than implying a live health check
  happened.
- PARTIAL: `composio_tools_visible` AND the usage counter
  (`.claude/composio-usage.json`) is missing → run `/composio:setup`.
- NEEDS SETUP: not `composio_tools_visible`. Open `/mcp`, select
  `composio-server`, and choose Authenticate. Complete the browser login,
  then restart Claude Code if the tools are still missing. On WSL or
  headless hosts, run `claude mcp login plugin:yellow-composio:composio-server
  --no-browser` in a separate terminal; `/composio:setup` has the rest.

**yellow-codex:**

- READY: `codex` binary found in PATH AND version >= 0.140.0 AND
  (`OPENAI_API_KEY` set OR `codex_login` ok OR `~/.codex/auth.json` exists).
  Current CLIs keep ChatGPT login in the OS keyring, so `codex_login` is the
  normal signal; `auth.json` only covers pre-0.118 installs. `timeout`,
  `probe_error` and `unverified` mean auth is unknown, not absent: report it
  as such and point at `/codex:setup`.
- PARTIAL: `codex` binary found AND version >= 0.140.0, but auth not configured
- NEEDS SETUP: `codex` binary not found OR version < 0.140.0

**yellow-council:**

Required system tools: `bash` on PATH (the council scripts run under
`bash`, even from a zsh session), `shell_check` ok (bash 4.3+ or zsh),
`timeout`, `jq`, `od`, `sort` and `council_extra_tools` ok (`mktemp`, `awk`,
`sed`, `grep`, `find`, readable `/dev/urandom`), plus `yellow-core` installed (Claude
Code disables the council without it). Reviewer CLIs: `agy` >= 1.0 (Gemini slot; a legacy
`gemini` binary does not count), `opencode` >= 1.14, and yellow-codex
installed. OpenRouter auth for OpenCode is not probed here; `/council:setup`
checks it.

- READY: required system tools present AND all 3 reviewer CLIs installed
- PARTIAL: required system tools present AND 1 or 2 of 3 reviewer CLIs
  installed — council runs with reduced coverage
- NEEDS SETUP: any required system tool missing, `yellow-core` NOT
  INSTALLED, OR 0 of 3 reviewer CLIs installed

**yellow-goal:**

Classify from Step 1's `goal-gen` row (`$GOAL_GEN_BIN` or `goal-gen`,
`version --json`); the pin is `0.4.0` (`plugins/yellow-goal/src/pin.ts`) and `/goal:setup` is
authoritative.

- READY: `goal-gen` OK with version `0.4.0` AND `yellow-core` installed AND
  `node2222_lt25_check` ok (engines pin `>=22.22.0 <25.0.0`)
- PARTIAL: never — missing binary or version mismatch is fail-closed
- NEEDS SETUP: `goal-gen` NOT FOUND (`GOAL_ENGINE_MISSING`), a version other
  than `0.4.0` (`GOAL_ENGINE_VERSION_MISMATCH`), `UNPARSEABLE`
  (`GOAL_ENGINE_UNPARSEABLE`), `yellow-core` NOT INSTALLED (required
  dependency), or `node2222_lt25_check` not ok

**yellow-claudemod:**

- READY: Step 1's `claude:` row is OK with a version of 2.1.301 or later
  (the hooks module needs `agent.spawn` for Agent-tool subagents)
- PARTIAL: never — the downshift is off by default by design, and the
  ledger needs no setup
- NEEDS SETUP: the `claude:` row is NOT FOUND OR its version is older than
  2.1.301 or unparseable

**yellow-core:**

- READY: `python37_check` ok AND `<config>/yellow-statusline.py` exists AND
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
  github-workflow      PARTIAL         gh authenticated, github/gh-stack not installed
  yellow-ruvector      PARTIAL         Plugin-managed ruvector not installed yet
  yellow-morph         PARTIAL         Local tools ready, Morph API key not configured
  yellow-cursor        READY           CLI resolved, credentials configured (alternative provider — not enabled)
  yellow-devin         NEEDS SETUP     DEVIN_SERVICE_USER_TOKEN not set
  yellow-jules         NEEDS SETUP     JULES_API_KEY not set (experimental provider — not enabled)
  yellow-agy           PARTIAL         agy not on PATH; run /agy:setup to check the WSL bridge
  yellow-semgrep       PARTIAL         Token set, semgrep CLI missing
  yellow-research      PARTIAL         2/5 bundled sources available
  yellow-linear        READY           Linear MCP visible, Graphite available
  yellow-debt          PARTIAL         Required tools ready, yellow-linear missing
  yellow-ci            READY           gh authenticated, runner config present
  yellow-review        PARTIAL         Review prerequisites ready, yellow-core missing
  yellow-browser-test  NEEDS SETUP     agent-browser missing
  yellow-docs          READY           git available, repo is a git repository
  yellow-composio      PARTIAL         MCP visible, usage counter missing
  yellow-codex         PARTIAL         codex v0.140.0 found, OPENAI_API_KEY not set
  yellow-council       PARTIAL         1 of 3 reviewer CLIs installed (Codex only)
  yellow-goal          NEEDS SETUP     goal-gen missing from PATH
  yellow-claudemod     READY           Claude Code 2.1.302 (downshift off)
  yellow-core          PARTIAL         statusLine installed, disableAllHooks=true

  Summary: X ready, Y partial, Z need setup
```
<!-- setup-all-dashboard-example:end -->

Be specific in the Detail column. Name the missing tool, env var, config file,
or bundled research source count rather than using generic labels.

### Step 2.5: Alternative Provider Groups

Some marketplace plugins are **alternative providers** of the same
capability: interchangeable implementations, of which exactly one may be
enabled at a time. Several may be installed — that is normal and supported —
but enabling more than one is a conflict, not a redundancy.

<!-- setup-all-provider-groups:start -->
- `stacked-pr` (mutually exclusive: exactly one enabled)
  - `gt-workflow` → `graphite`
  - `github-workflow` → `github`
- `remote-agent` (mutually exclusive: exactly one enabled)
  - `yellow-cursor` → `cursor`
  - `yellow-devin` → `devin`
  - `yellow-jules` → `jules`
<!-- setup-all-provider-groups:end -->

`scripts/validate-provider-groups.js` gates this list against the
`capabilityProvider` declarations in `catalog/plugins/*.json`, so it cannot
drift from the marketplace silently.

**Never ask the user to configure more than one member of a group.** Every
member appears in the dashboard, because all can be installed and their
readiness is worth reporting. Only the **enabled** one is offered for setup:

1. Determine the group's enabled member. For `stacked-pr`, use
   `/stack:status` (or the `stack-provider-router` skill). For
   `remote-agent`, read Step 1's `remote_agent_state` row: the dashboard
   already ran `lib/remote-agent-provider-state.js classify` (the classifier
   `/linear:delegate` uses) with the cursor, devin and jules tooling probes,
   so `PARTIAL_TOOLING` is reachable; its `detail` is on the
   `remote_agent_detail` row. `UNKNOWN` means the classifier could not run; treat it like a missing yellow-core (item 5). Do not infer
   either group's active member from which CLI happens to be on PATH.
2. Offer setup for that member only. Show every other member's row with its
   status and the annotation `(alternative provider — not enabled)`.
<!-- setup-all-remote-agent-states:start -->
3. If the group's state is not one of its READY states or
   `PARTIAL_TOOLING` — `stacked-pr`: not `READY_GRAPHITE`, `READY_GITHUB`,
   or `PARTIAL_TOOLING` (no provider enabled, both enabled, an intent
   mismatch, an unparseable `.yellow-stack.yml` i.e. `CONFIG_INVALID`, or a
   managed-scope conflict); `remote-agent`: not `READY_CURSOR`,
   `READY_DEVIN`, `READY_JULES`, or `PARTIAL_TOOLING` (`UNSELECTED`,
   `CONFLICT`, or `CONFIG_INVALID`) — do **not** pick one. Report the state and its
   `detail` (fenced as untrusted, same as `/stack:status` and
   `/linear:delegate` do), and point at `/stack:select` for `stacked-pr`
   (or, for `CONFIG_INVALID`, at fixing/removing `.yellow-stack.yml` by
   hand first) — `remote-agent` has no switch command in v1, so for that
   group just report which provider(s) need to be enabled/disabled by
   hand. There is no fallback between providers in either group.
<!-- setup-all-remote-agent-states:end -->
4. If the state is `PARTIAL_TOOLING`, the enabled provider is not ambiguous
   — only its tooling is missing. Offer that provider's own setup command
   rather than a provider-switch command (which only changes plugin
   enablement and cannot install missing tooling): `/gt-setup` for
   `gt-workflow`, `/github-stack:setup` for `github-workflow`,
   `/cursor:setup` for `yellow-cursor`, `/devin:setup` for `yellow-devin`,
   `/jules:setup` for `yellow-jules`.
5. If `yellow-core` is not installed, neither group's status can be
   determined (both classifiers live in `plugins/yellow-core/lib/`): report
   every member's readiness, annotate that the active provider could not be
   determined for either group, and offer neither.

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
from the count and from selection lists. Also exclude the non-enabled member
of any alternative provider group (Step 2.5) — it is reported, never offered,
and must not inflate the "N plugins need attention" count. Use
AskUserQuestion:

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
2. `github-stack:setup`
3. `ruvector:setup`
4. `morph:setup`
5. `cursor:setup`
6. `devin:setup`
7. `jules:setup`
8. `agy:setup`
9. `semgrep:setup`
10. `research:setup`
11. `linear:setup`
12. `debt:setup`
13. `ci:setup`
14. `review:setup`
15. `browser-test:setup`
16. `docs:setup`
17. `composio:setup`
18. `codex:setup`
19. `council:setup`
20. `goal:setup`
21. `claudemod:setup`
22. `statusline:setup`
<!-- setup-all-delegated-commands:end -->

This list is the fixed **order**, not a to-do list. Only invoke setups for
plugins the user selected, and never invoke both members of an alternative
provider group in one run (see the section below). Use this mapping:

<!-- setup-all-plugin-command-map:start -->
- `gt-workflow` → `gt-setup`
- `github-workflow` → `github-stack:setup`
- `yellow-ruvector` → `ruvector:setup`
- `yellow-morph` → `morph:setup`
- `yellow-cursor` → `cursor:setup`
- `yellow-devin` → `devin:setup`
- `yellow-jules` → `jules:setup`
- `yellow-agy` → `agy:setup`
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
- `yellow-goal` → `goal:setup`
- `yellow-claudemod` → `claudemod:setup`
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
changed (yellow-research, yellow-semgrep). Re-classify every
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
