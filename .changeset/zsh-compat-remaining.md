---
'github-workflow': patch
'gt-workflow': patch
'yellow-browser-test': patch
'yellow-codex': patch
'yellow-devin': patch
'yellow-linear': patch
'yellow-research': patch
'yellow-review': patch
'yellow-semgrep': patch
---

Make shell blocks work when Claude Code's Bash tool runs them under zsh:

- yellow-codex, yellow-semgrep: the setup version check used `read -a` into
  0-based arrays; under zsh it errored and always reported the installed
  version as new enough. It now compares with awk (same results in both
  shells).
- gt-workflow: `gt-cleanup` parses flags by shifting positional parameters
  (its 0-based index loop missed `--dry-run` and `--stale-days` under zsh);
  `gt-setup` no longer loops over `path` (tied to `$PATH` in zsh).
- github-workflow, yellow-devin: NUL-/newline-delimited read loops replace
  bash-only `mapfile`.
- yellow-linear: `/linear:delegate` no longer assigns `path`, which clobbered
  `$PATH` under zsh before the idempotency-key hashing ran.
- yellow-devin: the session-status example no longer assigns the read-only
  zsh parameter `status`.
- yellow-browser-test, yellow-research, yellow-review, yellow-semgrep, and
  gt-workflow: redirects that overwrite a file created by `mktemp` use `>|`,
  which zsh's `noclobber` would otherwise refuse.
