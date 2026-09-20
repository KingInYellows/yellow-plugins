---
title: 'Substring-regex command denylist is evadable by shell construct variation'
date: 2026-07-22
category: 'security-issues'
track: knowledge
problem: 'A regex denylist matching raw command text (git push blocker) is bypassable via ${IFS}, quote-splitting, eval, or path-qualified invocation'
tags:
  - command-injection
  - denylist
  - regex-evasion
  - shell-parsing
components:
  - plugins/gt-workflow/hooks/scripts/lib/policy-check-git-push.js
---

# Substring-regex command denylist is evadable by shell construct variation

## Problem

`policy-check-git-push.js` blocks raw `git push` via a regex against the
raw command string (mirrored from the original bash `check-git-push.sh`):
`/(^|[;&()|$\`]|\s)git\s+push/m`. A regex denylist matching literal token
boundaries is evadable by any shell construct that changes the string's
surface form without changing what the shell executes: `${IFS}`
substitution for the space (`git${IFS}push`), quote or backslash splitting
(`g"i"t push`, `git pu\sh`), intervening flags (`git -c foo push`),
path-qualified invocation (`/usr/bin/git push`), or `eval`-based indirection
that constructs the string at runtime after the hook's static check. This is
empirically verified against the current regex — pre-existing behavior
carried into the Node port, not introduced by the port itself.

Companion finding: the fixture set testing this regex covers 3
metacharacter shapes (space, semicolon, pipe) — passing those creates false
confidence, since none of the actual evasion techniques above are
represented.

## Detection

Any hook blocking a command family (not a specific literal string) via
regex against raw command text, rather than tokenizing and checking parsed
argv, is presumptively evadable. Check whether the fixture/test suite
includes `${IFS}`, quote-splitting, `eval`, and path-prefix cases, not just
whitespace/metacharacter variants of the already-blocked shape.

## Fix or Guidance

Prefer tokenizing the command (shell-lexer semantics) and checking the
parsed argv's first token(s) against the denylist, rather than regexing the
raw string. Where tokenizing isn't practical, invert to an allowlist of
safe commands/subcommands — an allowlist fails closed on anything
unrecognized, a denylist fails open on anything unanticipated. If a
denylist regex is kept as defense-in-depth (not the sole control), document
that explicitly so reviewers don't treat it as sufficient alone.

## Update — 2026-09-17: the backstop now tokenises

Both stacked-PR providers' `policy-check-git-push.js` now delegate to
`hooks/scripts/lib/git-push-detector.js` (one copy per plugin, byte-identity
enforced by `tests/integration/git-push-detector-parity.test.ts`). It lexes
the command into shell words and simple-command segments — quotes
(including `$'…'`/`$"…"`), backslashes, comments, `$(…)`/backtick
substitution (the outer command stays one segment with a placeholder; the
body becomes its own), `<(…)`/`>(…)` process substitution (a stdin source
of the consuming command), redirections (dropped from argv; `2>&1` is not a
control operator), heredocs and here-strings (bound to the declaring
segment), pipes (a pipe into `{ … }`/`( … )`/`if …` feeds every command in
the group), and the `;` `&&` `||` `|` `&` `(` `)` `{` `}` newline
separators — and denies a segment whose argv[0] basename is `git` (or the
`git-push`/`git-send-pack` plumbing binaries) after peeling leading
reserved words (`if`, `!`, `while`, `do`, `{`…), `K=V`/`K+=V`/`K[i]=V`
assignments and the transparent wrappers in its `WRAPPERS` table
(`command`, `builtin`, `exec`, `env`, `nohup`, `time`, `timeout`, `nice`,
`ionice`, `sudo`, `doas`, `pkexec`, `su`, `runuser`, `sg`, `script`,
`xargs`, `setsid`, `stdbuf`, `flock`, `chrt`, `taskset`, `setarch`,
`linux32`/`linux64`, `prlimit`, `setpriv`, `runcon`, `chroot`, `unshare`,
`nsenter`, `strace`, `ltrace`, `systemd-run`, `caffeinate`, `busybox`, the
`ld-linux*.so` loader), whose first non-option token after git's global
options is `push` or `send-pack` (`git -- push` counts: git treats `--` as
end of options and runs push). Unquoted brace and pathname expansion
(`{git,push}`, `gi[t]`, `pu*`) mark a word as decided at runtime, as do
`$(…)` and an xargs replacement token. Values git itself executes are
re-scanned (`-c core.pager=…`, `-c alias.p=push`, `PAGER=…`,
`GIT_SSH_COMMAND=…`, `-c credential.helper='!…'`), as are the commands
git subcommands run on the caller's behalf (`rebase --exec`/`-x`,
`submodule foreach`, `bisect run`, `difftool -x`/`--extcmd`, the
`filter-branch --*-filter` options, `for-each-repo … push`); `git subtree
push` is a push. `bash|sh|zsh|dash|ksh|rbash|posh… -c <string>` (options
after `-c` are skipped first), `eval`, `su -c`, `sudo -s`/`-i`, `runuser
-c`, `script -c`, `flock -c`, `env -S`, and a shell (or `source`/`.`) fed a
heredoc, here-string, process substitution or a pipe from
`echo`/`printf`/`cat <<EOF` are re-scanned recursively, and a re-scanned
script inherits the outer command's stdin through every level (`echo 'git
push' | sh -c sh`, `… | bash -c 'bash -c sh'`). The `$(…)`/backtick bodies
of an unquoted-delimiter heredoc are lexed as top-level commands whatever
reads the body (`cat <<EOF` / `gh pr create --body "$(cat <<EOF …`);
`<<'EOF'` and `<<\EOF` bodies stay literal. Denied unconditionally,
because the backstop cannot read them: nesting deeper than three shells,
more than sixteen wrapper layers, a runtime-computed program name or
subcommand (`$(which git) push`, `git $(x) push`, `xargs -I{} git {}`), a
shell or xargs fed by an opaque pipe (`curl … | sh`, `cat file | bash`,
`{ echo a; echo b; } | sh`, `echo -e …`, a `%` printf format, xargs input
carrying quotes), and a non-sh shell's `-c` string (`fish -c`, `pwsh
-Command`). Any parser exception fails closed.

Remaining out of scope — the guard is still a backstop behind the
provider's own submit path, not the sole control: `${IFS}` substitution,
variable indirection (`$GIT push`), shell aliases and `hash -p` bindings,
`export`ed command variables (`export GIT_EDITOR='git push'; git commit`)
and the `GIT_CONFIG_PARAMETERS` / `GIT_CONFIG_KEY_n` environment forms of
`-c`, stdin re-plumbed by a bare `exec <<< …; bash`, old-style nested
backticks (`` `echo \`git push\`` ``), script files and copies of the
binary written earlier in the same command (`echo 'git push' > s; bash s`,
`ln -s /usr/bin/git g; ./g push`), interpreter one-liners (`python3 -c
"os.system('git push')"`) and `find -exec`. Successive review passes on
the tokeniser found the substitution, redirection, heredoc-binding, pipe,
reserved-word, `$'…'`, process substitution, expansion,
producer-semantics, `-c`-ordering, xargs-token, expanding-heredoc,
git-exec-subcommand, multi-level-stdin, group-pipe, group-trailing-stdin
(`{ sh; } <<EOF`), subshell-inside-`$(…)`, stdin trailing-backslash,
bare-`$SHELL` wrapper (`sudo -s <<EOF`), cluster-tail value (`sudo -Eu
root`), `git config` write and remote-helper classes; the parity corpus
(`DENY`/`ALLOW` arrays plus a 64 KB linear-time bound per input and a
256 MB memory bound over the set, covering one producer read by
thousands of shells, deeply nested `<(` and expanding heredocs, many
trailing sources on one group, and `ld-…` loader names) now pins each.

## Related Documentation

- [bash-to-node-port-drops-fail-closed-and-bounds.md](./bash-to-node-port-drops-fail-closed-and-bounds.md) —
  same file's other pre-existing/dropped safety gaps
