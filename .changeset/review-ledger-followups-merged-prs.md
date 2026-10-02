---
'yellow-council': patch
'yellow-research': patch
'yellow-browser-test': patch
'yellow-core': patch
---

fix: follow-ups from the review ledger of the merged council synthesis staging
and setup-command PRs.

- `yellow-council`: `/council` step 5a reports a stale state file it reclaims,
  checks the removal and tells lock contention apart from a state file it
  cannot write or hard-link. A failed 5d resume or 5e run now routes through the
  Cancel block instead of paying for a whole fan-out that 5a would then refuse.
  Steps 7 to 9 and `council_synth_abort` remove the state file even when the
  staging directory cannot be removed, and a symlink at that path is unlinked
  without following it. `synthesis.bats` records the staging directories each 5a
  run creates instead of diffing a directory listing.
- `yellow-research`: `/research:setup` 401 messages name the userConfig and
  keychain key, Step 3.5 checks Perplexity visibility through ToolSearch only,
  and the shell-env wording says Claude Code must have been launched with the
  key exported.
- `yellow-browser-test` and `yellow-core`: web-app detection recognizes dotted
  Cargo dependency keys such as `axum.workspace = true`, the outside-git
  fallback is the working directory, and a discoverer that finds no web app
  falls through to manual configuration. `web-app-signals.bats` covers the
  mirrored block.
