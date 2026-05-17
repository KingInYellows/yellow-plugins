---
'yellow-core': patch
'yellow-ci': patch
'yellow-ruvector': patch
'yellow-debt': patch
---

refactor: extract validate_file_path to shared yellow-core/lib/validate-fs.sh

`validate_file_path()` (and `canonicalize_project_dir()`) were copy-pasted
across `yellow-ci`, `yellow-ruvector`, and `yellow-debt` with divergent
implementations — a security fix to one copy was easily missed in the
others (debt audit findings 002/003/004).

- `plugins/yellow-core/lib/validate-fs.sh` — new canonical home for both
  functions, sourced via `${CLAUDE_PLUGIN_ROOT}/../yellow-core/lib/` per the
  `credential-status.sh` precedent. Canonical impl = yellow-ruvector's
  (separate `canonicalize_project_dir`, `tr -d` newline detection, explicit
  symlink-escape block) plus two deliberate enhancements: optional `$2`
  project root with git-toplevel fallback (yellow-debt callers rely on it),
  and internal root canonicalization for reliable containment checks.
- The three plugins' local `lib/validate.sh` files now source the shared
  helper with a `[ -f ]` guard and keep only their plugin-specific
  validators.
- `plugins/yellow-core/tests/validate-fs.bats` — canonical test suite;
  each plugin's `validate.bats` sources the shared lib directly.

Review pass follow-ups in this PR:

- Idempotency guard (`_VALIDATE_FS_LOADED`) added to validate-fs.sh so
  double-sourcing (test setup + runtime hook chain) is safe.
- yellow-debt declares yellow-core as a required `dependencies` entry; the
  consuming `lib/validate.sh` now warns to stderr when the helper is absent
  rather than letting callers fail silently at exit 127.
- AGENTS.md and `plugins/yellow-{core,debt,ruvector}` docs updated to point
  to the new shared lib (parallel to the credential-status.sh precedent).
- `ruvector-conventions` SKILL.md updated to describe the actual
  `cd+pwd -P` / `realpath` validation (no longer `realpath -m`).
