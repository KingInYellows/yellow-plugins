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
  The Cancel block, Steps 7 to 9 and `council_synth_abort` unlink the state file
  only when this run claimed it (`SYNTH_STATE_CLAIMED`), so a symlink or foreign
  entry that 5a refused is left alone, and they remove it even when the staging
  directory cannot be removed; 5e and `council_synth_abort` release the state
  claim before they remove the staging directory, so a directory that cannot be
  removed no longer blocks later runs. A non-writable staging directory is repaired with
  `chmod -R u+rwx` and retried once, otherwise the warning names the manual
  command. The 24-hour figure is documented as the sweep's eligibility threshold,
  and the stale-state reclaim race is recorded as a known residual.
  `synthesis.bats` records the staging directories each 5a run creates instead of
  diffing a directory listing.
- `yellow-research`: `/research:setup` 401 messages name the userConfig and
  keychain key. A rejected shell key reports `UNVERIFIED` rather than `INVALID`
  when a keychain or userConfig key may take precedence and cannot be inspected.
  Step 3.5 checks Perplexity visibility through ToolSearch only and does not
  promote on visibility alone, because a changed key needs a Claude Code
  restart. The shell-env wording says Claude Code must have been launched with
  the key exported.
- `yellow-browser-test` and `yellow-core`: web-app detection recognizes dotted
  Cargo dependency keys such as `axum.workspace = true` and a trailing TOML
  comment after a dependency-table header, the outside-git fallback is the
  working directory, and a discoverer that finds no web app falls through to
  manual configuration. `web-app-signals.bats` covers the mirrored block.
