---
'yellow-core': patch
---

Pin `effort: medium` on the `knowledge-compounder` agent. Since Claude Code
2.1.317 a subagent on a different model from the session uses that model's
saved effort setting, or its default when none is saved, so from an Opus
session the Sonnet compounder no longer inherited the session's effort level.
