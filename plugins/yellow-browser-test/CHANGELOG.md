# Changelog

## 1.1.4

### Patch Changes

- [#573](https://github.com/KingInYellows/yellow-plugins/pull/573)
  [`95277f7`](https://github.com/KingInYellows/yellow-plugins/commit/95277f7e1b73cfebcff9409972f4d34ab3f441d0)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - fix: add the
  canonical report template to test-conventions (test-reporter and the skill
  previously pointed at each other with no template existing anywhere); inline
  the dev-server check/start/poll block in /browser-test:explore (previously a
  dangling "same logic as /browser-test:test" reference); guard test-runner's
  server-alive check against unset SERVER_PID with a PID-file/curl fallback

## 1.1.3

### Patch Changes

- [#514](https://github.com/KingInYellows/yellow-plugins/pull/514)
  [`956cf82`](https://github.com/KingInYellows/yellow-plugins/commit/956cf82fdfa32b78a396b7f687be35b9b99f789f)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! -
  feat(yellow-core): credential-status-aware /setup:all classification

  Closes the dashboard's three biggest false-positive paths reported by users
  running plugins on multiple hosts:
  1. **yellow-research PARTIAL despite working MCPs.** The dashboard previously
     only probed shell env vars (`EXA_API_KEY` etc) and missed keys stored in
     the system keychain via userConfig. Now reads `credential-status.json`
     (emitted by the SessionStart hook from the yellow-research PR earlier in
     this stack) as the authoritative source.
  2. **yellow-composio NEEDS SETUP cascade.** Updated classification reflects
     the v1.3.0 stdio architecture: the bundled MCP only registers when the
     wrapper's credential resolution succeeds, so an empty URL no longer breaks
     `claude doctor` for other MCPs. Dashboard now distinguishes "credentials
     absent" from "credentials present but MCP not yet visible" (Claude Code
     restart needed).
  3. **yellow-browser-test NEEDS SETUP on every non-web-app repo.** Adds a
     project-type heuristic: if NO web-app signals are present (no React/
     Vue/Next/Django/Rails/Axum framework deps, no Vercel/Fly/Render config, no
     docker-compose HTTP port mapping) AND no
     `.claude/yellow-browser-test.local.md`, omit the plugin from the dashboard
     entirely. When web-app signals ARE present but the config file is missing,
     emit a RECOMMENDED hint instead of a NEEDS SETUP error.

  Also extends `app-discoverer` agent (yellow-browser-test) with non-Node
  language detection (Gemfile/Rails, requirements.txt/Django/Flask/FastAPI,
  go.mod/Gin/Echo, Cargo.toml/Axum/Actix) and PaaS config detection (fly.toml,
  render.yaml, vercel.json, netlify.toml).

  New Step 1.6 reads each credential-bearing plugin's status file. Falls back to
  legacy shell-env-only probes when status files are absent (e.g., on first
  install before any SessionStart has fired).

## 1.1.2

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

## 1.1.1

### Patch Changes

- [`31da4b1`](https://github.com/KingInYellows/yellow-plugins/commit/31da4b14740f8eea7fc45501b94a2151c5a36009)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Fix shell
  portability and reliability in setup scripts. Replace bash-only version_gte()
  with POSIX-compatible implementation in install-codex.sh and
  install-semgrep.sh. Add fnm/nvm activation before Node version check and guard
  against fnm multishell ephemeral npm prefix in install-codex.sh. Fix dashboard
  reliability in setup:all by replacing Python heredoc with python3 -c,
  snapshotting tool paths to prevent PATH drift, and using find|xargs instead of
  find|while for plugin cache detection. Add web-app pre-flight check to
  browser-test:setup.

All notable changes to this plugin are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.1.0] - 2026-02-25

### Fixed

- Remove unsupported `changelog` key from plugin.json that blocked installation
  via Claude Code's remote validator.

---

## [1.0.0] - 2026-02-18

### Added

- Initial release — autonomous web app testing with agent-browser:
  auto-discovery, structured flows, and bug reporting.

---

**Maintained by**: [KingInYellows](https://github.com/KingInYellows)
