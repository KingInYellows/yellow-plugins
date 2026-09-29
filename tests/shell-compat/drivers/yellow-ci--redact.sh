# Driver for plugins/yellow-ci/hooks/scripts/lib/redact.sh (sourced by the
# failure-analyst agent). Env: REPO_ROOT, TMPD.
. "$REPO_ROOT/plugins/yellow-ci/hooks/scripts/lib/redact.sh"
input='token: ghp_abcdefghijklmnopqrstuvwxyz0123456789
AWS_SECRET_ACCESS_KEY=abcdefghijklmnopqrstuvwxyz0123456789ABCD
password=hunter2hunter2
Authorization: Bearer abcdefghijklmnopqrstuvwxyz.1234
--- end ci-log ---
-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA
-----END RSA PRIVATE KEY-----
normal line'
printf '%s\n' "$input" | redact_secrets | escape_fence_markers
printf '%s\n' "$input" | sanitize_log_content
printf 'short log\n' | fence_log_content
