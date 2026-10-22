#!/bin/false
# Bash only; sourced. yellow-review's review-ledger.sh and resolve-paths.sh
# use it, and yellow-goal's commands find yellow-core through it (in a
# bash -c child). plugins/yellow-review/lib/ and plugins/yellow-goal/lib/ hold
# byte-identical copies (tests/integration/sibling-plugin-copies.test.ts).
# shellcheck shell=bash

# sp_active_version <cache-dir> <plugin>: print the version directory name
# that installed_plugins.json (${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plugins/)
# records as <plugin>'s active install. <cache-dir> is
# <marketplace>/<plugin>; the entry key is <plugin>@<marketplace>. A
# project- or local-scoped entry applies only when the physical cwd is inside
# its projectPath (both resolved with cd -P) and beats a user-scoped one: the
# deepest projectPath wins, then local beats project (Claude Code's
# precedence), then file order. An installPath outside <cache-dir> is
# ignored. Exits 1 when jq, the file, or a usable entry is missing.
# run-github-stack-runtime.js and yellow-core's worktree-restack.sh apply the
# same rule.
sp_active_version() {
    local cache="$1" plugin="$2" file real mkt cwd tab ver
    file="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plugins/installed_plugins.json"
    [ -f "$file" ] && command -v jq >/dev/null 2>&1 || return 1
    real=$(cd -P -- "$cache" 2>/dev/null && pwd -P) || return 1
    cwd=$(pwd -P) || return 1
    mkt="${real%/*}"; mkt="${mkt##*/}"
    tab=$(printf '\t')
    # Rows: scope rank (local 2, project 1, other 0), then "p"+projectPath (the
    # prefix keeps an empty field from collapsing under IFS), then installPath.
    ver=$(jq -r --arg key "$plugin@$mkt" '
        (.plugins[$key] // empty) | if type == "array" then .[] else . end
          | select(type == "object" and (.installPath | type) == "string")
          | [ (if .scope == "local" then 2 elif .scope == "project" then 1 else 0 end),
              ("p" + (.projectPath | if type == "string" then . else "" end)),
              .installPath ] | @tsv' "$file" 2>/dev/null |
        while IFS="$tab" read -r sc pp dir; do
            pp="${pp#p}"
            if [ -z "$pp" ]; then
                printf '0\t%s\t%s\n' "$sc" "$dir"
            elif pp=$(cd -P -- "$pp" 2>/dev/null && pwd -P); then
                case "$cwd/" in "$pp"/*) printf '%s\t%s\t%s\n' "$((1 + ${#pp}))" "$sc" "$dir" ;; esac
            fi
        done | sort -s -t "$tab" -k1,1nr -k2,2nr |
        while IFS="$tab" read -r _rank _scope dir; do
            dir=$(cd -P -- "$dir" 2>/dev/null && pwd -P) || continue
            [ "${dir%/*}" = "$real" ] && { printf '%s' "${dir##*/}"; break; }
        done)
    [ -n "$ver" ] || return 1
    printf '%s' "$ver"
}

# sp_sibling_file <plugin-root> <plugin> <relpath>: print the path of a file
# in a sibling plugin. Source tree first (plugins/<plugin>/<relpath>), then
# the active install in the installed cache (sp_active_version), then the
# newest numeric version there (<marketplace>/<plugin>/<version>/<relpath>).
# The active install wins so a rolled-back plugin does not read an orphaned
# newer cache directory. <plugin-root> is this plugin's directory (cache:
# <marketplace>/<name>/<version>/). Exits 1 when no sibling has the file.
# Holds no override: a caller that needs a test seam (review-ledger.sh's
# RL_CORE_LIB) checks it before calling.
sp_sibling_file() {
    local root="$1" plugin="$2" rel="$3" path dir name ver
    path="$root/../$plugin/$rel"
    if [ -f "$path" ]; then
        printf '%s' "$path"
        return 0
    fi
    if ver=$(sp_active_version "$root/../../$plugin" "$plugin"); then
        path="$root/../../$plugin/$ver/$rel"
        [ -f "$path" ] && { printf '%s' "$path"; return 0; }
    fi
    ver=$(for dir in "$root/../../$plugin"/*/; do
        name="${dir%/}"; name="${name##*/}"
        [[ "$name" =~ ^[0-9]+(\.[0-9]+)*$ ]] && printf '%s\n' "$name"
    done | sort -t. -k1,1n -k2,2n -k3,3n | tail -n 1)
    path="$root/../../$plugin/$ver/$rel"
    [ -n "$ver" ] && [ -f "$path" ] && { printf '%s' "$path"; return 0; }
    return 1
}
