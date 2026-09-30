---
'yellow-council': patch
---

Keep `/council`'s synthesis staging capability out of model-relayed text: Step
5a now records the staging directory and its token in a shell-owned 0600
`.git/council-synth.state` file, and Steps 5b, 5d and 5e reload them from there
(failing closed on a missing, symlinked, foreign or garbled file) instead of
trusting literals the orchestrator substitutes. `docs/security.md` documents
the staging directory's contents, handoff, cleanup and prompt-injection
boundary.
