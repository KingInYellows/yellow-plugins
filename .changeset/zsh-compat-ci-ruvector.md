---
'yellow-ci': patch
'yellow-ruvector': patch
---

Make shell blocks work when Claude Code's Bash tool runs them under zsh:

- yellow-ruvector: `/ruvector:setup` and `/ruvector:status` blocks that
  source `lib/install-ruvector.sh` or `hooks/scripts/lib/resolve.sh` now run
  in a bash child (`bash -c "$(cat <<'TAG' … )"`); both libraries use
  bash-only constructs (`BASHPID`, `${!…}`, `BASH_SOURCE`).
- yellow-ci: the runner-targets merge block runs in a bash child, and the
  `/ci:setup` and `/ci:setup-runner-targets` validation instructions call
  the bash-only `validate.sh` through `bash -c`. `ci-runner-health` no
  longer declares `local status` (read-only in zsh). `redact.sh` is now
  tested under both shells.
- yellow-ci: `fence_log_content` printed no begin fence under bash — bash's
  `printf` read the `---` format as an option — leaving CI logs wrapped in
  an unbalanced injection fence. It now prints both fence lines.
