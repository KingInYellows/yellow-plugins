---
"yellow-core": patch
"yellow-codex": patch
"yellow-browser-test": patch
"yellow-ci": patch
"yellow-debt": patch
"yellow-research": patch
---

Guard shell blocks that parse `ls`, `ps`, `df` or `top` output against user aliases (`ls=eza`, `ps=procs`): plan listings now go through `command find … -exec ls -t {} +`, which also stops zsh's `nomatch` error on an empty `plans/`, and the other parsed calls use `command`. `/flow:work`, `/flow:review`, `/flow:decompose`, `/flow:pick-next-shell` and `/plan:status` no longer report "no plans" when `ls` is aliased.
