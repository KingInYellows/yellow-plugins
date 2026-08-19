---
"yellow-core": minor
---

Harden the stacked-PR provider model: an explicit `CONFIG_INVALID` state
(distinguishing "no `.yellow-stack.yml`" from "present but unparseable"),
a canonical `stack-tooling-probe.js` readiness probe shared by both
providers, a fix for `planProviderSwitch()` disabling a broader-scope
install when only a project/local switch was requested, and a new
`stack-operation-registry.js` mapping every stacked-PR operation and
primitive to both providers. `/flow:work`, `/flow:review`, `/plan:complete`,
and the `debugging` skill now resolve the active provider once via
`stack-provider-router` instead of hardcoding `gt`.
