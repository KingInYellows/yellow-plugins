---
'yellow-goal': patch
---

`/goal:run-stub` hygiene: the test-only `GOAL_GEN_SCRATCH` override is stripped
from the production CLI environment (scratch trees are always removed, and
cleanup failures never mask the run outcome), the request-path allowlist counts
bytes so a newline cannot slip past command substitution, the released-artifact
smoke asserts every `git` exit status, and the security doc states the trusted
local-executable boundary explicitly.
