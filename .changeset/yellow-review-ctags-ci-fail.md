---
"yellow-review": patch
---

Fail the two universal-ctags ledger tests when CI is set, so a runner without universal-ctags cannot skip them inside the required yellow-review bats job. Scope verification now runs on Universal Ctags 5.9 (the Ubuntu package), which rejects the `--` end-of-options marker the ledger passed, so every code scope fell back to unscoped. A ctags failure, timeout or tag-parse error now prints a one-line `[review-ledger]` warning instead of silently falling back, and `/review:setup` reports a ledger library that fails to load instead of blaming ctags.
