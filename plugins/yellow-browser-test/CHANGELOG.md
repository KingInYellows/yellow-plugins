# Changelog

## 1.1.10

### Patch Changes

- [`9809c4d`](https://github.com/KingInYellows/yellow-plugins/commit/9809c4d24202af368482ccc3c7429d00da0c497c)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - fix: follow-ups
  from the review ledger of the merged council synthesis staging and
  setup-command PRs.
  - `yellow-council`: `/council` step 5a reports a stale state file it reclaims,
    checks the removal and tells lock contention apart from a state file it
    cannot write or hard-link. A failed 5d resume or 5e run now routes through
    the Cancel block instead of paying for a whole fan-out that 5a would then
    refuse. The Cancel block, Steps 7 to 9 and `council_synth_abort` unlink the
    state file only when this run claimed it (`SYNTH_STATE_CLAIMED`), so a
    symlink or foreign entry that 5a refused is left alone, and they remove it
    even when the staging directory cannot be removed; 5e and
    `council_synth_abort` release the state claim before they remove the staging
    directory, so a directory that cannot be removed no longer blocks later
    runs. A non-writable staging directory is repaired with `chmod -R u+rwx` and
    retried once, otherwise the warning names the manual command. The 24-hour
    figure is documented as the sweep's eligibility threshold, and the
    stale-state reclaim race is recorded as a known residual. `synthesis.bats`
    records the staging directories each 5a run creates instead of diffing a
    directory listing.
  - `yellow-research`: `/research:setup` 401 messages name the userConfig and
    keychain key. A rejected shell key reports `UNVERIFIED` rather than
    `INVALID` when a keychain or userConfig key may take precedence and cannot
    be inspected. Step 3.5 checks Perplexity visibility through ToolSearch only
    and does not promote on visibility alone, because a changed key needs a
    Claude Code restart. The shell-env wording says Claude Code must have been
    launched with the key exported. A Perplexity `UNVERIFIED` status with a
    passed shell key stays pending until Step 3.5 sees the MCP tools; Step 4
    then promotes it to
    `PRESENT (validated via MCP startup — effective credential source unconfirmed; …)`
    and counts it as active only if the key was not changed this session. A
    rejected shell key is never promoted on visibility alone and stays
    `UNVERIFIED` with a restart-and-rerun instruction.
  - `yellow-research`, `yellow-devin` and `yellow-semgrep`: the jq-less fallback
    in `has_userconfig` matches only a non-empty string value for the option
    inside the same plugin object, like the jq path, so a leftover empty
    `"exa_api_key": ""` entry no longer downgrades a passing shell key to
    `UNVERIFIED`. `has-userconfig.bats` covers the empty, whitespace,
    other-provider and jq-absent cases.
  - `yellow-browser-test` and `yellow-core`: web-app detection recognizes dotted
    Cargo dependency keys such as `axum.workspace = true` and a trailing TOML
    comment after a dependency-table header, the outside-git fallback is the
    working directory, and a discoverer that finds no web app falls through to
    manual configuration. `web-app-signals.bats` covers the mirrored block.

## 1.1.9

### Patch Changes

- [`fac0932`](https://github.com/KingInYellows/yellow-plugins/commit/fac0932fd4ea079e9771af337b10d36d660aaed1)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! -
  fix(yellow-browser-test): `/browser-test:setup` now detects web apps beyond
  `package.json`, using the same signals as `/setup:all` (Rails, Python
  Django/Flask/FastAPI/Starlette/Sanic, Go, Rust, PaaS config, docker-compose
  HTTP ports). Django, FastAPI, Rails, Go and Rust projects no longer see the
  "no web framework detected" prompt, which also stops claiming those apps are
  undetectable. The `app-discoverer` agent now inspects all four Compose
  filenames (`compose.yaml`, `compose.yml`, `docker-compose.yaml`,
  `docker-compose.yml`) to match.

## 1.1.8

### Patch Changes

- [`81189d7`](https://github.com/KingInYellows/yellow-plugins/commit/81189d79e855529134be73946702f3350148c736)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Make shell
  blocks work when Claude Code's Bash tool runs them under zsh:
  - yellow-codex, yellow-semgrep: the setup version check used `read -a` into
    0-based arrays; under zsh it errored and always reported the installed
    version as new enough. It now compares with awk (same results in both
    shells).
  - gt-workflow: `gt-cleanup` parses flags by shifting positional parameters
    (its 0-based index loop missed `--dry-run` and `--stale-days` under zsh);
    `gt-setup` no longer loops over `path` (tied to `$PATH` in zsh).
  - github-workflow, yellow-devin: NUL-/newline-delimited read loops replace
    bash-only `mapfile`.
  - yellow-linear: `/linear:delegate` no longer assigns `path`, which clobbered
    `$PATH` under zsh before the idempotency-key hashing ran.
  - yellow-devin: the session-status example no longer assigns the read-only zsh
    parameter `status`.
  - yellow-browser-test, yellow-research, yellow-review, yellow-semgrep, and
    gt-workflow: redirects that overwrite a file created by `mktemp` use `>|`,
    which zsh's `noclobber` would otherwise refuse.

## 1.1.7

### Patch Changes

- [`ac9831f`](https://github.com/KingInYellows/yellow-plugins/commit/ac9831f647b322c83d16db8489e028b5d3ffba6b)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! -
  docs(CLAUDE.md): currency sweep across all plugin CLAUDE.md files — fix stale
  counts and archived-plan paths, replace hardcoded Graphite conventions with
  the `/stack:status` provider rule, correct MCP tool namespaces and dependency
  tables, and add per-plugin Testing sections.

## 1.1.6

### Patch Changes

- [`e239b34`](https://github.com/KingInYellows/yellow-plugins/commit/e239b3462d7c65e866d87dc27197b0167dc0e0d7)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Rename the
  skill frontmatter key `user-invokable` to `user-invocable` in every SKILL.md.
  Claude Code (verified against 2.1.259) parses only `user-invocable`; the `k`
  spelling this repo standardised on was silently ignored, so every internal
  skill declared `user-invokable: false` still appeared in the `/` menu. The
  validator gains RULE 20 (error tier) rejecting the old key so it cannot creep
  back through stale templates.

- [`2f39283`](https://github.com/KingInYellows/yellow-plugins/commit/2f39283d69689e9d03c00db8094c058765df1621)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Modernise the
  authoring surface for current Claude Code and the Claude 5 generation. The
  agent-authoring validator now accepts the `fable` model alias and full
  `claude-*` model IDs (V2), understands the post-2.1.63 `Agent` tool name in
  `Agent(bareword):` shorthand checks, and adds RULE 21 — a warning-tier line
  ceiling for commands (500) and agents (300) so the next progressive-disclosure
  pass has a scoreboard. The `tools:` / `allowed-tools:` lists, the `Task(` call
  sites and the tool name in prose are renamed from the legacy `Task` to `Agent`
  (the alias still works), and the pseudo-YAML `Task:` dispatch labels are swept
  as well. The `debt-conventions` scanner template now matches the shipped
  scanners (`model: sonnet`, `effort: low`).

## 1.1.5

### Patch Changes

- [#631](https://github.com/KingInYellows/yellow-plugins/pull/631)
  [`f7fc2d8`](https://github.com/KingInYellows/yellow-plugins/commit/f7fc2d87f26a30bc2e6ffbcc301254d240895871)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - fix: README
  prerequisite link pointed at ArcadeLabsInc/agent-browser (404); now points at
  vercel-labs/agent-browser (verified live).

- [#633](https://github.com/KingInYellows/yellow-plugins/pull/633)
  [`99dd605`](https://github.com/KingInYellows/yellow-plugins/commit/99dd605cbf72e9ec138627c56bd51224ac985017)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - fix: all six
  `Task(bareword):` dispatch sites (app-discoverer, test-runner, test-reporter
  across setup/test/explore/report commands) now use the canonical
  `Task(subagent_type="yellow-browser-test:testing:<name>")` form the Task
  runtime actually resolves.

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
