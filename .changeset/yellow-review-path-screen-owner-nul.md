---
"yellow-review": patch
"yellow-core": patch
---

The resolver `PATH` screen no longer trusts the setuid and setgid bits: an
executable it cannot read (so its `#!` line is hidden) now fails closed unless
root owns it and the user cannot write it, since any user can `chmod 4111` a script of their own. Root-owned
execute-only binaries, such as Fedora's `sudo` (4111) and `sudoreplay` (0111),
keep their directory on `PATH`. `harden_git_config` now splits
`git config --null` records in bash (`read -d ''`) instead of awk, so
`commit-resolve-fixes` and `run-verify-command` run on hosts whose only awk is
BWK (stock macOS `/usr/bin/awk`); `/review:setup` and `/setup:all` drop the
`awk_nul` check. The README documents the WSL2 `appendWindowsPath = false` fix
for the slow `PATH` screen.
