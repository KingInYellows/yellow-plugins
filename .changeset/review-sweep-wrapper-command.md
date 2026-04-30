---
"yellow-review": minor
---

Add `/review:sweep` wrapper command

Run `/review:pr` followed by `/review:resolve` on the same PR in one
invocation — adaptive multi-agent code review with autonomous fixes,
then parallel resolution of all open bot and human reviewer comment
threads.

Because the `Skill` tool surfaces no machine-readable exit status from
invoked commands, the wrapper uses an `AskUserQuestion` between the two
steps as the failure-boundary signal: if the user confirms `/review:pr`
completed cleanly, the resolve step runs; otherwise it is skipped.

Pure orchestration — no logic added to `/review:pr` or `/review:resolve`,
both of which remain invokable directly when only one half of the
sequence is needed.
