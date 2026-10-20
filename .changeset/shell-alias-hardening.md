---
"yellow-core": patch
"yellow-codex": patch
"yellow-browser-test": patch
"yellow-ci": patch
"yellow-debt": patch
"yellow-research": patch
---

Guard shell blocks that parse `ls`, `ps`, `df` or `top` output against user aliases (`ls=eza`, `ps=procs`). Plan listings in `/flow:work`, `/flow:review` and `/flow:decompose` now go through `command find -H … -exec ls -t {} +`, so an aliased `ls` no longer makes them report "no plans" and zsh's `nomatch` error no longer leaks on an empty `plans/`. `/plan:status` and `/flow:pick-next-shell` get the same `find` existence check. The codex status listing, the browser-test process check, the yellow-debt scanner and yellow-research code-researcher cache-directory permission checks, and the yellow-ci remote probes use `command`.
