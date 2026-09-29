---
'gt-workflow': patch
'yellow-composio': patch
'yellow-core': patch
'yellow-ci': patch
'yellow-debt': patch
'yellow-ruvector': patch
---

Follow-up zsh fixes from review:

- Bash-only blocks now run as `bash /dev/fd/3 3<<'TAG'`, which the
  stacked-PR providers' git-push hook can inspect (the earlier
  `bash -c "$(cat <<'TAG' …)"` form was refused as unverifiable) and which
  keeps the caller's stdin.
- gt-workflow: `gt-setup`'s version check split the version into a 0-based
  array and passed every version under zsh; it now compares with awk.
- yellow-core: `/flow:compound --in-pr` no longer loses `gh pr view` to
  zsh's `noclobber` (`2>|` onto its mktemp file).
- yellow-composio: the usage counter writes through a fresh `mktemp` name
  rather than a fixed `.tmp` a repo could ship as a symlink.
- yellow-ci: validation one-liners single-quote the value.
