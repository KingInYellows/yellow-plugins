# Changelog

## 1.1.7

### Patch Changes

- [#609](https://github.com/KingInYellows/yellow-plugins/pull/609)
  [`00f60b5`](https://github.com/KingInYellows/yellow-plugins/commit/00f60b54e761770665cb8683a4754ecc984521f1)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Memory-router
  decision (Tier 2 C11, maintainer-decided): yellow-ruvector is the standard
  memory system; yellow-mempalace is deprecated pending removal. Generic trigger
  phrases ("remember this", "record a decision", "add a fact", generic recall)
  no longer auto-route to mempalace — `memory-archivist`, `/mempalace:search`,
  `/mempalace:navigate`, `/mempalace:kg`, and `palace-navigator` descriptions
  are narrowed to explicit `/mempalace:*` / palace / KG invocation, and
  `/ruvector:learn`'s description reciprocally claims "record a decision" /
  "save a memory" / "add a fact" so those phrases route somewhere. The full
  routing table and rationale are recorded in `docs/memory-routing-protocol.md`;
  mempalace's CLAUDE.md and README carry deprecation banners. Actual plugin
  removal and palace-data migration are a follow-up plan; explicit mempalace
  commands keep working until then.

- [#606](https://github.com/KingInYellows/yellow-plugins/pull/606)
  [`3c54894`](https://github.com/KingInYellows/yellow-plugins/commit/3c54894cc7aa8495cd7743e6109ce600b91811ee)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Memory-protocol
  drift control (Tier 2 C7): declare yellow-ruvector's `memory-query` skill the
  canonical home of the ruvector protocol constants and put the duplicated
  copies under a CI drift lint.
  - `memory-query/SKILL.md` gains a Canonical Source header; yellow-core's
    `memory-recall-pattern`, `memory-remember-pattern`, and
    `mcp-integration-patterns` are marked replicas (their old self-canonical
    "Design reference" blockquotes rewritten)
  - A single ASCII sentinel line carrying the constants (recall top_k=5 / score
    < 0.5 / top-3 / 800-char truncation / dedup top_k=1 / 0.82) is
    byte-identical in all four files
  - New RULE 16 in `scripts/validate-agent-authoring.js` fails CI when the
    sentinel line diverges in any copy, a declared file lacks the sentinel or is
    missing entirely, or an undeclared plugins/ file carries one (containment);
    the surrounding prose restatements of the constants remain a manual sweep
  - The ~10 consuming command files are documented as out of CI scope
    (context-adapted paraphrases), with two divergences recorded:
    `ruvector/search.md` top_k=10 (intentional) and `ruvector/learn.md` missing
    dedup (open maintainer question, not silently fixed)

## 1.1.6

### Patch Changes

- [#601](https://github.com/KingInYellows/yellow-plugins/pull/601)
  [`128149b`](https://github.com/KingInYellows/yellow-plugins/commit/128149b5188fbd0367f8045c799aa3c59e03c727)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! -
  docs(optimization): Tier 1 quick wins C1-C4 — self-description layer fixes.

  C1: rewrite 5 weak `user-invokable: false` skill descriptions
  (security-fencing, research-patterns, codex-patterns, composio-patterns,
  mempalace-conventions) with concrete "Use when" triggers, removing topic
  enumeration and "integration context" boilerplate.

  C2: add one negative-disambiguation clause each to 5 confusable surfaces:
  optimize vs /workflows:review, debugging vs /codex:rescue, session-history vs
  ruvector recall, and /ruvector:memory <-> /mempalace:search pointing at each
  other. Additive only — no existing trigger removed.

  C3: fix stale yellow-core catalogs — CLAUDE.md Skills (13)→(18), README.md
  Skills table 9→18 rows, learnings-researcher.md Integration section corrected
  to the real dispatch sites (/review:pr, /review:review-all, /docs:review).

  C4: split the 168-line Subagent Failure Convention section out of
  create-agent-skills/SKILL.md (513 lines, over its own 500-line ceiling) into
  references/subagent-failure-convention.md behind a load stub that preserves
  the section heading. SKILL.md is now 365 lines.

  Review follow-up: review-pr.md's Step 5 citation now points at the new
  references/subagent-failure-convention.md for the "When the convention
  applies" subsection (the C4 move relocated it out of SKILL.md).

  Doc-only; no scripts, hooks, schemas, or CI behavior change. Root CLAUDE.md
  (C5) and root README recounts ship in the same PR without a changeset (outside
  plugins/).

## 1.1.5

### Patch Changes

- [#576](https://github.com/KingInYellows/yellow-plugins/pull/576)
  [`d0273a3`](https://github.com/KingInYellows/yellow-plugins/commit/d0273a369835a7d689fd37d3b0616afbb9e138e6)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - fix: collapse
  the /ruvector:setup description from a wrapped multi-line single-quoted scalar
  to a single line — Claude Code's frontmatter parser silently truncates
  multi-line description values, which can blank the command's marketplace
  listing

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
