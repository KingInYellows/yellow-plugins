# Shared SessionStart-hook scenario setup for the yellow-ci parity harness.
#
# The bash hook (session-start.sh, now ported to Node) and the Node port both
# read NO meaningful stdin — they derive their output from the environment:
# the presence of .github/workflows in the cwd, the routing-summary cache under
# $HOME/.cache/yellow-ci/, whether `gh` is available/authenticated, a 60s
# md5(PWD) result cache, and what `gh run list` returns. So a "fixture" is a
# named environment scenario, not a stdin payload.
#
# `hook_scenario_setup <case> <sandbox>` configures HOME, PATH, MOCK_GH_* and a
# working directory IN THE CALLING SHELL and sets $HOOK_SCENARIO_WORKDIR to the
# directory to cd into. It MUST be called directly (not in a `$(...)` command
# substitution — that runs in a subshell and the exports would be lost). Used
# identically by the golden capture (capture-hook-goldens.sh) and the parity
# bats (hook-parity.bats) so the Node port is measured against the exact
# conditions the bash goldens were captured under.

HOOK_SCENARIO_MOCKS_DEFAULT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../mocks" && pwd)"
HOOK_SCENARIO_ROUTING_TEXT='[yellow-ci] Runner routing: prefer pool:ares for heavy CI; pool:atlas for lightweight checks.'
HOOK_SCENARIO_CACHED_TEXT='[yellow-ci] CACHED: 1 recent failure(s) on branch(es): cached-branch. Use /ci:diagnose to investigate.'

# Build a PATH dir containing only the coreutils the hook needs, deliberately
# excluding `gh`, so `command -v gh` fails even though the real gh is installed.
_hook_scenario_bin_without_gh() {
  local dir="$1/nogh-bin"
  mkdir -p "$dir"
  local tool p
  for tool in sh bash env node jq dirname pwd mkdir md5sum md5 cut stat date cat mv rm head tr tail timeout grep printf awk; do
    if p=$(command -v "$tool" 2>/dev/null); then
      ln -sf "$p" "$dir/$tool"
    fi
  done
  printf '%s' "$dir"
}

hook_scenario_setup() {
  local case="$1" sandbox="$2"
  local mocks="${HOOK_SCENARIO_MOCKS:-$HOOK_SCENARIO_MOCKS_DEFAULT}"
  local home="$sandbox/home" work="$sandbox/work"
  mkdir -p "$home/.cache/yellow-ci" "$work"
  export HOME="$home"
  # Keep the R38 new-cache path sandbox-scoped and EMPTY by default, so the
  # legacy-read fallback is exercised. Individual cases may pre-seed either the
  # legacy ($HOME/.cache/yellow-ci) or new ($XDG_DATA_HOME/yellow-ci) location.
  export XDG_DATA_HOME="$home/.local/share"
  unset CLAUDE_PLUGIN_DATA
  export MOCK_GH_AUTH=ok MOCK_GH_RUNLIST=empty
  export PATH="$mocks:$PATH"

  # .github/workflows presence
  case "$case" in
    no-workflows) : ;;
    *) mkdir -p "$work/.github/workflows"; printf 'name: ci\n' >"$work/.github/workflows/ci.yml" ;;
  esac

  # routing-summary cache presence
  case "$case" in
    routing-summary-absent|no-workflows) : ;;
    *) printf '%s' "$HOOK_SCENARIO_ROUTING_TEXT" >"$home/.cache/yellow-ci/routing-summary.txt" ;;
  esac

  # gh availability / auth / run-list behavior
  case "$case" in
    gh-missing) export PATH="$(_hook_scenario_bin_without_gh "$sandbox")" ;;
    gh-unauthed) export MOCK_GH_AUTH=unauthed ;;
    cache-miss-failures) export MOCK_GH_RUNLIST=failures ;;
    malformed-gh-json) export MOCK_GH_RUNLIST=malformed ;;
    rate-limited-gh) export MOCK_GH_RUNLIST=ratelimit ;;
  esac

  # cache-hit: pre-seed a fresh (age ~0, <60s TTL) result cache so gh is never
  # consulted; the hook must echo the cached message verbatim.
  if [ "$case" = "cache-hit" ]; then
    local key
    if command -v md5sum >/dev/null 2>&1; then
      key=$(printf '%s' "$work" | md5sum | cut -c1-32)
    else
      key=$(printf '%s' "$work" | md5 -q | cut -c1-32)
    fi
    printf '%s' "$HOOK_SCENARIO_CACHED_TEXT" >"$home/.cache/yellow-ci/last-check-$key"
  fi

  # Set (not echo) the workdir so callers can invoke this directly and keep the
  # env exports; a `$(...)` capture would run it in a subshell and drop them.
  HOOK_SCENARIO_WORKDIR="$work"
}
