# shell-compat: library
# Shared by review-ledger.sh and resolve-paths.sh (bash; sourced).
# shellcheck shell=bash

# sp_sibling_file <plugin-root> <plugin> <relpath>: print the path of a file
# in a sibling plugin. Source tree first (plugins/<plugin>/<relpath>), then
# the newest numeric version in the installed cache
# (<marketplace>/<plugin>/<version>/<relpath>). <plugin-root> is this
# plugin's directory (cache: <marketplace>/<name>/<version>/). Exits 1 when no
# sibling has the file. Holds no override: a caller that needs a test seam
# (review-ledger.sh's RL_CORE_LIB) checks it before calling.
sp_sibling_file() {
    local root="$1" plugin="$2" rel="$3" path dir name ver
    path="$root/../$plugin/$rel"
    if [ -f "$path" ]; then
        printf '%s' "$path"
        return 0
    fi
    ver=$(for dir in "$root/../../$plugin"/*/; do
        name="${dir%/}"; name="${name##*/}"
        [[ "$name" =~ ^[0-9]+(\.[0-9]+)*$ ]] && printf '%s\n' "$name"
    done | sort -t. -k1,1n -k2,2n -k3,3n | tail -n 1)
    path="$root/../../$plugin/$ver/$rel"
    [ -n "$ver" ] && [ -f "$path" ] && { printf '%s' "$path"; return 0; }
    return 1
}
