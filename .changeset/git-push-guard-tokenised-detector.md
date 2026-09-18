---
'gt-workflow': patch
'github-workflow': patch
---

The PreToolUse `git push` backstop in both stacked-PR providers now tokenises
the Bash command instead of matching a substring regex. A new
`hooks/scripts/lib/git-push-detector.js` (byte-identical copy in each plugin,
enforced by `tests/integration/git-push-detector-parity.test.ts`) lexes the
command into shell words and simple-command segments — quotes including
`$'…'`, `$(…)`/backtick and `<(…)` substitution, redirections, heredocs and
here-strings, pipes (including into `{ }`/`if` groups), reserved words,
brace/glob expansion — so `/usr/bin/git push`, `git -C dir push`, `git -C
"$(pwd)" push`, `git 2>&1 push`, `g"i"t pu\sh`, `bash -c "git push"`,
`{ git push; }`, `echo 'git push' | bash`, `bash <(echo git push)`, `bash
<<EOF | tee`, `git $'push'`, `git {push,origin}`, `sudo`/`su -c`/`env
-S`/`timeout`/`flock`/`xargs` wrappers, `git -c core.pager='git push' log`,
`PAGER='git push' git log`, `/usr/lib/git-core/git-push` and `git -- push`
are all denied, while quoted literals (`echo "git push"`), heredoc bodies
fed to non-shell commands and comments are allowed. Shell nesting deeper
than three levels, more than sixteen wrapper layers, a runtime-computed
program name or subcommand (`$(which git) push`, `xargs -I{} git {}`), a
shell fed by an opaque pipe (`curl … | sh`, `echo -e … | sh`) and a
non-sh shell's `-c` string (`fish -c`) are denied outright, and any parser
error fails closed. github-workflow additionally denies a present-but-non-string
`tool_input.command` (mirroring gt-workflow) instead of coercing it to an
empty string; absent `tool_input` and unparseable envelopes still fail open
as documented. Both plugins' hook `timeout` values rise from 1 s to 5 s so
a cold Node start on a slow disk cannot time the backstop out (the parity
suite bounds the detector at < 500 ms per 64 KB adversarial input and
< 256 MB over the set).
