---
'yellow-composio': patch
'yellow-council': patch
---

Make shell blocks work when Claude Code's Bash tool runs them under zsh:

- yellow-composio: the usage-counter lock no longer fails to parse in zsh
  (fd 9 instead of a multi-digit fd, appended rather than truncated) and the
  temp write uses `>|` so a stale `.tmp` cannot block it under `noclobber`.
- yellow-council: `/council` and `/council:setup` no longer refuse to run
  under zsh (the bash 4.3 check now applies only to bash), the report no
  longer uses bash-only `${!arr[@]}` and `${var^}` expansions, overwriting
  redirects onto existing temp and state files use `>|`, and the
  `build_target_path` helper no longer shadows zsh's `path`/`PATH`.
