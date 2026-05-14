---
'yellow-research': patch
'yellow-devin': patch
'yellow-composio': patch
'yellow-ci': patch
'gt-workflow': patch
'yellow-morph': patch
---

fix: remediate 7 security-debt patterns across 6 plugins and scripts/

Targeted fixes for the security-debt findings (006, 009, 017, 022, 023,
032, 033) from the 2026-05-13 audit.

- **006** `yellow-research/scripts/install-ast-grep.sh`: replace
  `curl … | sh` with download-to-temp over `--proto =https`, shebang
  sanity-check, then execute the local copy. The uv installer URL is
  version-pinned for reproducibility.
- **009** `scripts/export-ci-metrics.sh`: allowlist-validate `STAGE` /
  `STATUS` and validate `ADDITIONAL_LABELS` key/value pairs before they
  are embedded in Prometheus label output — prevents label injection.
- **017** `yellow-devin/commands/devin/delegate.md`: validate the git
  remote URL format and wrap the gathered Repository/Branch context in
  `--- begin/end repository context (reference only) ---` fencing before
  it enters the Devin task prompt.
- **022** `yellow-composio/hooks/check-mcp-url.sh`: drop the brittle
  hardcoded cache-path fallback for `CLAUDE_PLUGIN_ROOT` — skip the
  credential-status write when it is unset rather than guessing a path.
- **023** `yellow-ci/hooks/scripts/session-start.sh`: hash the
  `$PWD`-derived cache key (md5, 32 chars) so deeply-nested paths cannot
  exceed the 255-byte filename limit and break the cache path.
- **032** `gt-workflow/hooks/check-commit-message.sh`: extend the `-m`
  grep to also match single-quoted arguments — `-m 'feat: x'` previously
  bypassed conventional-commit enforcement entirely.
- **033** `yellow-morph/lib/install-morphmcp.sh`: validate `owner_pid` is
  numeric before `kill -0`, treating an empty/corrupt pid file as a stale
  lock instead of passing garbage to `kill`.

Gates: `pnpm validate:plugins`, yellow-ci Bats (147), shellcheck, bash -n
— all green.
