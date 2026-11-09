#!/usr/bin/env bash
# yellow-core: list the rule-pack roots /flow:plan hands to
# learnings-researcher.
#
# Execute with bash; never source this file.
#
#   rule-pack-roots.sh
#
# Prints one folder per line, each laid out like `rule-packs/` (holding
# `<id>/` pack folders): `rule-packs` (relative to the repository root) when
# the working tree has one, then every machine-local folder from a
# `rule_pack_dirs:` block list in yellow-plugins.local.md. Prints nothing when
# there are none. Exit 0 always, except 2 for usage.
#
# Machine-local folders are read from the user-level
# ${CLAUDE_CONFIG_DIR:-$HOME/.claude}/yellow-plugins.local.md, and from the
# repository root's copy only when git does not track it, so a checked-out
# branch cannot point a session at arbitrary folders. Entries must be absolute
# (or ~/...) folders without . or .. segments and must not be symlinks.
# yellow-review's skills/pr-review-workflow/scripts/rule-pack-context applies
# the same rules; change both together. Format: docs/rule-packs.md.

set -uo pipefail

[ $# -eq 0 ] || { printf 'Usage: rule-pack-roots.sh\n' >&2; exit 2; }

warn() { printf '[rule-packs] Warning: %s\n' "$1" >&2; }

TOP=$(git rev-parse --show-toplevel 2>/dev/null) || TOP=""

local_dirs() {
    [ -f "$1" ] && [ ! -L "$1" ] || return 0
    awk '
        NR == 1 { if ($0 != "---") exit; next }
        $0 == "---" { exit }
        /^rule_pack_dirs:[ \t]*(#.*)?$/ { on = 1; next }
        on && /^[ \t]+-[ \t]+/ {
            v = $0; sub(/^[ \t]+-[ \t]+/, "", v); sub(/[ \t]+#.*$/, "", v); sub(/[ \t]+$/, "", v)
            if (v ~ /^".*"$/ || v ~ /^\047.*\047$/) v = substr(v, 2, length(v) - 2)
            print v; next
        }
        on && /^[ \t]*(#.*)?$/ { next }
        { on = 0 }
    ' "$1"
}

if [ -n "$TOP" ] && [ -d "$TOP/rule-packs" ] && [ ! -L "$TOP/rule-packs" ]; then
    printf 'rule-packs\n'
fi

CONFIGS=("${CLAUDE_CONFIG_DIR:-${HOME:-/nonexistent}/.claude}/yellow-plugins.local.md")
if [ -n "$TOP" ] && [ -e "$TOP/yellow-plugins.local.md" ]; then
    rc=0
    git -C "$TOP" ls-files --error-unmatch -- yellow-plugins.local.md >/dev/null 2>&1 || rc=$?
    if [ "$rc" -eq 1 ]; then
        CONFIGS+=("$TOP/yellow-plugins.local.md")
    elif local_dirs "$TOP/yellow-plugins.local.md" | grep -q .; then
        warn 'rule_pack_dirs in a tracked yellow-plugins.local.md is ignored'
    fi
fi

for cfg in "${CONFIGS[@]}"; do
    while IFS= read -r dir; do
        case "$dir" in "~/"*) dir="${HOME:-/nonexistent}/${dir#\~/}" ;; esac
        case "$dir" in
            /*) ;;
            *) warn 'rule_pack_dirs entry is not an absolute path; skipped'; continue ;;
        esac
        case "/$dir/" in
            */../* | */./*) warn 'rule_pack_dirs entry contains . or .. segments; skipped'; continue ;;
        esac
        if [ ! -d "$dir" ] || [ -L "$dir" ]; then
            warn 'rule_pack_dirs entry is not a folder (or is a symlink); skipped'
            continue
        fi
        printf '%s\n' "$dir"
    done < <(local_dirs "$cfg")
done
exit 0
