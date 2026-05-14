---
'yellow-codex': patch
'yellow-semgrep': patch
'yellow-ruvector': patch
---

refactor: de-duplicate install-script helpers via a build-time generator

The `version_gte()` semver comparator and the color-output helpers
(`error`/`warning`/`success` + the `RED/GREEN/YELLOW/NC` constants) were
copy-pasted byte-identically across the plugin install scripts (debt
findings 014/015/036/037).

- `scripts/snippets/install-helpers.sh` + `scripts/snippets/install-version-gte.sh`
  — canonical sources, single point of truth.
- `scripts/sync-shell-snippets.js` — generator that injects each canonical
  snippet into the consuming install scripts between
  `# >>> generated: <name> >>>` / `# <<< generated: <name> <<<` sentinel
  markers. `pnpm generate:snippets` regenerates; `pnpm validate:snippets`
  (and now `pnpm validate:schemas`, run in CI) fails on drift.
- `install-codex.sh` and `install-semgrep.sh` embed both snippets;
  `install.sh` (yellow-ruvector) embeds `install-helpers` only — it keeps
  its own `version_lt` (a distinct comparator).

No behavior change — the embedded blocks are byte-identical to the prior
inline copies. Gates: `generate:snippets` + `validate:snippets` (drift
caught on tamper, clean on sync), `validate:plugins`, shellcheck, bash -n.
