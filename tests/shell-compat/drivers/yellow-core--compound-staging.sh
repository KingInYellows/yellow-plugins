# Driver for plugins/yellow-core/lib/compound-staging.sh (sourced by
# /compound:review-staged). Env: REPO_ROOT, TMPD.
export HOME="$TMPD/home"
mkdir -p "$HOME"
. "$REPO_ROOT/plugins/yellow-core/lib/compound-staging.sh"
slug=$(cs_derive_project_slug "/home/x/my repo")
printf 'slug=%s\n' "$slug"
printf 'staging=%s\n' "$(cs_staging_dir_for_slug "$slug" | sed "s#$HOME#<home>#")"
printf 'epoch=%s\n' "$(cs_iso_to_epoch 2026-09-28T12:00:00Z)"
cs_atomic_jsonl_write "$TMPD/a/b.jsonl" '{"x":1}' && cs_atomic_jsonl_write "$TMPD/a/b.jsonl" '{"x":2}'
printf 'write_rc=%s content=%s\n' "$?" "$(cat "$TMPD/a/b.jsonl")"
printf 'token=abcdefghijklmnop Bearer abcdefghijklmnopqrstuvwxyz\n' | cs_redact_secrets
printf 'budget0=%s\n' "$(cs_read_drain_budget "$TMPD")"
cs_update_drain_budget "$TMPD" oauth >/dev/null 2>&1
cs_read_drain_budget "$TMPD" | jq -c '{drains_in_window, auth_route}'
printf 'path_intact=%s\n' "$(command -v date >/dev/null && printf yes || printf no)"
