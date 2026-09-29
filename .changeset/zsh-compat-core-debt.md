---
'yellow-core': patch
'yellow-debt': patch
---

Make shell blocks work when Claude Code's Bash tool runs them under zsh:

- yellow-debt: every command and agent block that sources `lib/validate.sh`
  now runs it in a bash child (`bash /dev/fd/3 3<<'TAG'`). Under zsh the
  library's state-transition lock ran a command named `200` and its RETURN
  trap was undefined, so `/debt:triage`, `/debt:fix` and the remediation
  agent left todos untransitioned with a stale `.lock`.
- yellow-core: `lib/compound-staging.sh` no longer declares `local path`
  (tied to `$PATH` in zsh) and is now tested under both shells;
  `/setup:all` no longer loops over `path`; `/worktree:cleanup` parses
  `--dry-run` correctly under zsh (its 0-based index loop missed it);
  `/flow:review` and the staging-reviewer dedup pass no longer rely on
  bash-only array key expansion; overwriting redirects use `>|` where
  zsh's `noclobber` would refuse them.
