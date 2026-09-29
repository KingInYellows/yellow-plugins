# Driver for plugins/yellow-core/lib/repo-profile.sh (sourced by /flow:plan).
# Runs under bash and zsh; output must be identical. Env: REPO_ROOT, TMPD.
# Isolate from the contributor's git config (signing, hooks, templates).
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
cd "$TMPD" && git init -q repo && cd repo || exit 1
git -c user.email=t@example.com -c user.name=t commit -q --allow-empty -m init || exit 1
export CLAUDE_PLUGIN_DATA="$TMPD/data"
. "$REPO_ROOT/plugins/yellow-core/lib/repo-profile.sh"
out=$(rp_get)
printf 'get1=%s\n' "$(printf '%s\n' "$out" | sed -n 1p)"
entry=$(printf '%s\n' "$out" | sed -n 2p)
printf '{"profile_schema_version":1,"stack":"demo","dependency_surface":"","topology":"","root_doc_digests":{}}' >| "$TMPD/profile.json"
rp_put "$TMPD/profile.json" "$entry"
printf 'put_rc=%s\n' "$?"
out=$(rp_get)
printf 'get2=%s\n' "$(printf '%s\n' "$out" | sed -n 1p)"
printf '%s\n' "$out" | sed -n 2p | jq -c '{profile_schema_version, stack}'
rp_put "$TMPD/profile.json" "$TMPD/not-the-entry.json" 2>/dev/null
printf 'put_wrong_entry_rc=%s\n' "$?"
