# Changelog

## 1.1.4

### Patch Changes

- [#534](https://github.com/KingInYellows/yellow-plugins/pull/534)
  [`70a5148`](https://github.com/KingInYellows/yellow-plugins/commit/70a5148a24e5213ed4a69fb21e3ba2ac8af36782)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - refactor:
  de-duplicate install-script helpers via a build-time generator

  The `version_gte()` semver comparator and the color-output helpers
  (`error`/`warning`/`success` + the `RED/GREEN/YELLOW/NC` constants) were
  copy-pasted byte-identically across the plugin install scripts (debt findings
  014/015/036/037).
  - `scripts/snippets/install-helpers.sh` +
    `scripts/snippets/install-version-gte.sh` — canonical sources, single point
    of truth.
  - `scripts/sync-shell-snippets.js` — generator that injects each canonical
    snippet into the consuming install scripts between
    `# >>> generated: <name> >>>` / `# <<< generated: <name> <<<` sentinel
    markers. `pnpm generate:snippets` regenerates; `pnpm validate:snippets` (and
    now `pnpm validate:schemas`, run in CI) fails on drift.
  - `install-codex.sh` and `install-semgrep.sh` embed both snippets;
    `install.sh` (yellow-ruvector) and `install-ast-grep.sh` (yellow-research)
    embed `install-helpers` only. yellow-ruvector keeps its own `version_lt` (a
    distinct comparator); yellow-research does not need version comparison.

  No behavior change — the embedded blocks are byte-identical to the prior
  inline copies. Gates: `generate:snippets` + `validate:snippets` (drift caught
  on tamper, clean on sync), `validate:plugins`, shellcheck, bash -n.

- [#529](https://github.com/KingInYellows/yellow-plugins/pull/529)
  [`8a004b7`](https://github.com/KingInYellows/yellow-plugins/commit/8a004b7f30dcd0b9858f027b7cb5f57d120d398c)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - refactor:
  extract validate_file_path to shared yellow-core/lib/validate-fs.sh

  `validate_file_path()` (and `canonicalize_project_dir()`) were copy-pasted
  across `yellow-ci`, `yellow-ruvector`, and `yellow-debt` with divergent
  implementations — a security fix to one copy was easily missed in the others
  (debt audit findings 002/003/004).
  - `plugins/yellow-core/lib/validate-fs.sh` — new canonical home for both
    functions, sourced via `${CLAUDE_PLUGIN_ROOT}/../yellow-core/lib/` per the
    `credential-status.sh` precedent. Canonical impl = yellow-ruvector's
    (separate `canonicalize_project_dir`, `tr -d` newline detection, explicit
    symlink-escape block) plus two deliberate enhancements: optional `$2`
    project root with git-toplevel fallback (yellow-debt callers rely on it),
    and internal root canonicalization for reliable containment checks.
  - The three plugins' local `lib/validate.sh` files now source the shared
    helper with a `[ -f ]` guard and keep only their plugin-specific validators.
  - `plugins/yellow-core/tests/validate-fs.bats` — canonical test suite; each
    plugin's `validate.bats` sources the shared lib directly.

  Review pass follow-ups in this PR:
  - Idempotency guard (`_VALIDATE_FS_LOADED`) added to validate-fs.sh so
    double-sourcing (test setup + runtime hook chain) is safe.
  - yellow-debt declares yellow-core as a required `dependencies` entry; the
    consuming `lib/validate.sh` now warns to stderr when the helper is absent
    rather than letting callers fail silently at exit 127.
  - AGENTS.md and `plugins/yellow-{core,debt,ruvector}` docs updated to point to
    the new shared lib (parallel to the credential-status.sh precedent).
  - `ruvector-conventions` SKILL.md updated to describe the actual `cd+pwd -P` /
    `realpath` validation (no longer `realpath -m`).

## 1.1.3

### Patch Changes

- [`c3cdfdb`](https://github.com/KingInYellows/yellow-plugins/commit/c3cdfdb5a2c0d260e32096a524c4712fe277d019)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add `$schema`
  pointer to all remaining plugin manifests:
  `https://json.schemastore.org/claude-code-plugin-manifest.json`

  Per https://code.claude.com/docs/en/plugins-reference, Claude Code's plugin
  loader ignores this field at load time, but editors and IDEs use it for
  autocomplete and inline validation against the official remote validator
  schema. yellow-core received the pointer earlier in the stack as a
  single-plugin probe; this PR extends it to the other 17.

  Also documents local vs remote validator divergence in CONTRIBUTING.md with a
  recipe for empirical install testing (`claude plugin validate`,
  `claude --plugin-url`, fresh-install probe). The `claude plugin validate` CI
  integration is deferred to a follow-up PR pending CI runtime evaluation.

All notable changes to this plugin are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.1.2] - 2026-03-10

### Patch Changes

- [`91908d9`](https://github.com/KingInYellows/yellow-plugins/commit/91908d935feb46fbb447a67eae997e5f491e3c05)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add MCP warmup
  and retry-once patterns to all consuming commands for ruvector integration
  consistency. Harden install.sh and setup.md to require global binary in PATH.

---

## [1.1.1] - 2026-03-06

### Patch Changes

- [`c6b5a9b`](https://github.com/KingInYellows/yellow-plugins/commit/c6b5a9b473cb95df73e3c867d9b6c649b98b28ab)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Fix hooks.json
  sync with plugin.json: add missing PreToolUse hook entry, update PostToolUse
  matcher to include MultiEdit. Replace broken `npx ruvector hooks verify` in
  setup.md with direct script checks.

---

## [1.1.0] - 2026-02-25

### Fixed

- Remove unsupported `changelog` key from plugin.json that blocked installation
  via Claude Code's remote validator.

---

## [1.0.0] - 2026-02-18

### Added

- Initial release — persistent vector memory and semantic code search for Claude
  Code agents via ruvector MCP server.

---

**Maintained by**: [KingInYellows](https://github.com/KingInYellows)
