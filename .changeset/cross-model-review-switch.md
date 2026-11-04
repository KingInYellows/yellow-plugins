---
"yellow-review": minor
"yellow-council": minor
"yellow-codex": patch
"yellow-core": patch
---

Add a `cross_model_review: auto | off` switch to `yellow-plugins.local.md`.
With `off`, `/review:pr` never selects `codex-reviewer` and says so in
Coverage, and `/council` runs only the Claude reviewer unless the user's
message for that run names the external reviewers. `off` in either the repo
or the user-level file wins, so a PR head cannot lift a user's `off`; an
unrecognized value counts as `off`. New `cross-model-mode` script in
yellow-review (CLAUDE-217).
