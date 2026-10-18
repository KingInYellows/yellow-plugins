# shell-compat: library
# Shared by review-ledger.sh and resolve-paths.sh (bash; sourced).
# shellcheck shell=bash

# sp_active_version <cache-dir> <plugin>: print the version directory name
# that installed_plugins.json (${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plugins/)
# records as <plugin>'s active install. <cache-dir> is
# <marketplace>/<plugin>; the entry key is <plugin>@<marketplace>. A
# project-scoped entry applies only when $PWD is inside its projectPath and
# beats a user-scoped one (the deepest projectPath wins); an installPath
# outside <cache-dir> is ignored. Exits 1 when jq, the file, or a usable
# entry is missing. run-github-stack-runtime.js and yellow-core's
# worktree-restack.sh apply the same rule.
sp_active_version() {
    local cache="$1" plugin="$2" file real mkt ver
    file="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plugins/installed_plugins.json"
    [ -f "$file" ] && command -v jq >/dev/null 2>&1 || return 1
    real=$(cd -P -- "$cache" 2>/dev/null && pwd -P) || return 1
    mkt="${real%/*}"; mkt="${mkt##*/}"
    ver=$(jq -r --arg key "$plugin@$mkt" --arg cwd "$PWD" '
        [ (.plugins[$key] // empty) | if type == "array" then .[] else . end
          | select(type == "object" and (.installPath | type) == "string")
          | (.projectPath // "") as $pp
          | if $pp == "" then [0, .installPath]
            elif $cwd == $pp or ($cwd | startswith($pp + "/")) then [1 + ($pp | length), .installPath]
            else empty end ]
        | sort_by(-.[0]) | .[] | .[1]' "$file" 2>/dev/null |
        while IFS= read -r dir; do
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
