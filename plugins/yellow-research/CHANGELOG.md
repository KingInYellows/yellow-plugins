# Changelog

## 3.4.1

### Patch Changes

- [#636](https://github.com/KingInYellows/yellow-plugins/pull/636)
  [`95b182c`](https://github.com/KingInYellows/yellow-plugins/commit/95b182c18575a5dc5277058da7dc172b970323fe)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - docs: document
  the bundled-Tavily/EXA vs claude.ai native-connector overlap — new
  `docs/research-connector-overlap.md` records the three-tier prefix priority
  order (bundled preferred), and the plugin README cross-links it.

## 3.4.0

### Minor Changes

- [#615](https://github.com/KingInYellows/yellow-plugins/pull/615)
  [`e6b1ac7`](https://github.com/KingInYellows/yellow-plugins/commit/e6b1ac77ea71da5e93831abcd3d603faa51d70ca)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Adopt the
  run-artifact convention at the `/research:deep` ⇄ `research-conductor`
  boundary: the command creates a per-run directory via `mktemp`, the conductor
  writes the full synthesis to `<run_dir>/synthesis.md` and returns a compact
  confirmation + path (inline return only when the artifact write fails), and
  the command reads the artifact back before writing `docs/research/<slug>.md`.
  yellow-core: the Subagent Failure Convention reference gains an
  adopter/exemption list and corrects its stale claim that `CLAUDE_PLUGIN_DATA`
  is undocumented (it is documented — as the persistent data dir, which is why
  RUN_DIR still must not use it).

## 3.3.1

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

## 3.3.0

### Minor Changes

- [#598](https://github.com/KingInYellows/yellow-plugins/pull/598)
  [`c547322`](https://github.com/KingInYellows/yellow-plugins/commit/c54732264cd05cac5eb37ddd31b2a4dc904dce58)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! -
  feat(library-context): close the context7 cache loop — tier2 doc-content
  cache + runtime writeback

  Two ends of the cache loop noted as out-of-scope in PR #538 are now wired:
  `hooks/lib/context7-cache.sh` gains `_lc_lookup_docs` (tier2 reader),
  `_lc_write_tier1`, and `_lc_write_tier2` (atomic-merge writers with LRU
  eviction at 50 entries), exposed via two new wrappers —
  `bin/lc-cache-lookup-docs` and `bin/lc-cache-write <tier> <args...>`.

  SKILL.md's Step 1 (library-id resolution) and Step 2 (document lookup) now
  instruct writeback after a successful live MCP call, so the cache warms with
  use instead of only filling via the SessionStart pre-warm.
  `best-practices-researcher.md`'s inlined safe-chain block gains the same
  symmetric tier1/tier2 writeback (renumbered 1.1-1.5), preserving the RULE 13
  drift sentinel unchanged.

  Writebacks are advisory — a failed write is logged to stderr and swallowed,
  never blocking the agent whose MCP call already succeeded. `reference.md`'s
  Cache section is rewritten to describe the shipped tier2 lookup/write API and
  the runtime writeback contract in place of the earlier "reserved for a future
  round" framing.

## 3.2.3

### Patch Changes

- [#597](https://github.com/KingInYellows/yellow-plugins/pull/597)
  [`b9f96da`](https://github.com/KingInYellows/yellow-plugins/commit/b9f96dafa86aaa210cd4fbe6b85f97f8569c0626)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add RULE 13 to
  `validate-agent-authoring.js`: agents listing a context7 tool
  (`mcp__context7__resolve-library-id`/`query-docs`/`get-library-docs`) must
  either preload `skills: [library-context]` or carry the inline drift sentinel
  `context7 unavailable — falling back to` (em dash U+2014). Catches a
  corrupted/missing fallback chain at CI instead of code-review time. Also
  de-scopes the deferred-lint promise and the speculative opt-in-adoption
  backlog from the skill's `reference.md`.

## 3.2.2

### Patch Changes

- [#566](https://github.com/KingInYellows/yellow-plugins/pull/566)
  [`70813bb`](https://github.com/KingInYellows/yellow-plugins/commit/70813bbb4da3c6d41ccecca1fac8a37c9d374972)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Make hook
  scripts executable and correct stale yellow-composio setup docs.
  - chmod +x the SessionStart/Stop hook scripts in yellow-core
    (`hooks/scripts/stop.sh`, `hooks/scripts/session-start.sh`), yellow-composio
    (`hooks/check-mcp-url.sh`), and yellow-research
    (`hooks/write-credential-status.sh`). This clears the
    `claude plugin validate` "not executable" warnings and aligns these four
    with every other hook script in the repo (all already executable). The hooks
    are registered as `bash ${CLAUDE_PLUGIN_ROOT}/...sh`, so they already ran
    regardless — this is a warning/consistency cleanup, not a behavior change.
  - yellow-composio: fix `commands/composio/setup.md`, which still claimed the
    `userConfig` fields were `required: true`. They are not (the flag was
    removed per claude-code#39827, which does not block install/enable). The
    `bin/start-composio.sh` wrapper's non-zero exit on empty values is the
    actual safeguard. The troubleshooting prose now matches the plugin manifest
    and CLAUDE.md.

## 3.2.1

### Patch Changes

- [#564](https://github.com/KingInYellows/yellow-plugins/pull/564)
  [`0494696`](https://github.com/KingInYellows/yellow-plugins/commit/04946963ccaaf93f8b1818a6232fe1a39ffab9c1)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Make the
  morphmcp tool-name note in `/research:setup` version-agnostic ("In current
  morphmcp the tool is named `codebase_search`") so it no longer pins a specific
  morphmcp version that drifts on every bump. No behavior change.

## 3.2.0

### Minor Changes

- [#537](https://github.com/KingInYellows/yellow-plugins/pull/537)
  [`dbe1d70`](https://github.com/KingInYellows/yellow-plugins/commit/dbe1d70a4839049b44d9a57344eb69ba3c0d9bbc)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! -
  feat(yellow-research): SessionStart context7 cache pre-warm hook

  Adds an asynchronous SessionStart pre-warm of the context7 library docs cache
  so common library queries don't burn the anonymous global pool. Merged into
  the existing `hooks/write-credential-status.sh` (background subshell,
  fire-and-forget) so SessionStart cost stays under the ~3s UX budget —
  yellow-morph `prewarm-morph.sh` precedent.

  **Cache shape** at
  `${CLAUDE_PLUGIN_DATA}/context7-cache-<md5_of_project_dir>.json`:
  - `tier1` — `library-name → {library_id, fetched_at}` (24h TTL, capped at top
    5 libs from project lockfiles)
  - `tier2` — `library-id|topic → {docs, fetched_at}` (4h TTL, max 50; reserved
    for future lazy population on cache miss)
  - `lockfile_fingerprint` — mtimes of all detected lockfiles for invalidation
    tracking
  - `schema: "1"` for forward-compatibility

  **Lockfile support:** package-lock.json, pnpm-lock.yaml, yarn.lock,
  Cargo.lock, go.sum, requirements.txt (+ package.json fallback).

  **Auth:** uses `CONTEXT7_API_KEY` as `Authorization: Bearer` when set;
  anonymous otherwise. Anonymous quota is 200 req/hr global pool (per live
  `ratelimit-limit` header on context7's HTTP API, 2026-05-17).

  **HTTP API** verified live:
  `GET https://context7.com/api/v1/search?query=<name>` returns
  `{results: [{id: "/owner/repo", ...}]}`. The MCP server (used by agents at
  runtime) is unaffected — the hook hits the HTTP API directly since shell hooks
  can't invoke MCP tools.

  **Safety:** atomic-rename writes (yellow-ci precedent), idempotent re-source
  guard, no `set -e`, fire-and-forget background subshell so hook errors never
  block session start. Skips cleanly when curl/jq missing, CLAUDE_PLUGIN_DATA
  unset, no lockfile, or cache fresh (< 24h).

  14 bats tests cover: no-lockfile skip, CLAUDE_PLUGIN_DATA-unset skip,
  anonymous warm, authenticated warm, fresh-cache skip, corrupted-cache rewrite,
  lockfile scanning for package.json + Cargo.lock, pre-warm cap, atomic write,
  idempotent re-source.

- [#536](https://github.com/KingInYellows/yellow-plugins/pull/536)
  [`ac8db1f`](https://github.com/KingInYellows/yellow-plugins/commit/ac8db1fc146b63f12634968ecd574a333cfa82b0)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! -
  feat(yellow-research): add `library-context` skill + refactor
  `code-researcher` to preload it

  New canonical SKILL.md at `plugins/yellow-research/skills/library-context/`
  defines the context7 → EXA → WebSearch fallback chain for library
  documentation lookup: ToolSearch availability detection, two-step invocation
  (`resolve-library-id` → `query-docs`), disambiguation rules, rate-limit
  handling (anonymous 60 req/hr global pool), citation format, and the
  drift-detection sentinel phrase `context7 unavailable — falling back to`
  (Unicode em dash U+2014).

  Sibling `reference.md` holds distribution rationale, the deferred RULE 13
  drift lint grep, the consumer enumeration, and the deferred cache-hook
  contract. Loaded on demand, not auto-injected by `skills:` preload.

  `code-researcher.md` now preloads via `skills: [library-context]` and
  delegates library-doc routing to the skill (inline context7/fallback prose
  removed from the "Source Routing" section; table row points to the skill).

  Cross-plugin consumers (initial: yellow-core `best-practices-researcher`)
  inline the safe-chain block verbatim since `anthropics/claude-code#15944`
  (cross-plugin `skills:` resolution) is closed not planned.

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

- [#532](https://github.com/KingInYellows/yellow-plugins/pull/532)
  [`be06a57`](https://github.com/KingInYellows/yellow-plugins/commit/be06a571a9e8817870eec61b5844aec3c5182163)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - fix: remediate
  7 security-debt patterns across 6 plugins and root scripts

  Targeted fixes for the security-debt findings (006, 009, 017, 022, 023,
  032, 033) from the 2026-05-13 audit.
  - **006** `yellow-research/scripts/install-ast-grep.sh`: replace `curl … | sh`
    with download-to-temp over `--proto =https`, shebang sanity-check, then
    execute the local copy. The uv installer URL is version-pinned for
    reproducibility.
  - **009** `scripts/export-ci-metrics.sh`: allowlist-validate `STAGE` /
    `STATUS` and validate `ADDITIONAL_LABELS` key/value pairs before they are
    embedded in Prometheus label output — prevents label injection.
  - **017** `yellow-devin/commands/devin/delegate.md`: validate the git remote
    URL format and wrap the gathered Repository/Branch context in
    `--- begin/end repository context (reference only) ---` fencing before it
    enters the Devin task prompt.
  - **022** `yellow-composio/hooks/check-mcp-url.sh`: drop the brittle hardcoded
    cache-path fallback for `CLAUDE_PLUGIN_ROOT` — skip the credential-status
    write when it is unset rather than guessing a path.
  - **023** `yellow-ci/hooks/scripts/session-start.sh`: hash the `$PWD`-derived
    cache key (md5, 32 chars) so deeply-nested paths cannot exceed the 255-byte
    filename limit and break the cache path.
  - **032** `gt-workflow/hooks/check-commit-message.sh`: extend the `-m` grep to
    also match single-quoted arguments — `-m 'feat: x'` previously bypassed
    conventional-commit enforcement entirely.
  - **033** `yellow-morph/lib/install-morphmcp.sh`: validate `owner_pid` is
    numeric before `kill -0`, treating an empty/corrupt pid file as a stale lock
    instead of passing garbage to `kill`.

  Gates: `pnpm validate:plugins`, yellow-ci Bats (147), shellcheck, bash -n —
  all green.

- [#538](https://github.com/KingInYellows/yellow-plugins/pull/538)
  [`253e453`](https://github.com/KingInYellows/yellow-plugins/commit/253e453e4329754d21d2f647dc4180645bd070fb)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! -
  feat(library-context): wire cache reader into Step 1 (closes PR #537's
  chatgpt-codex consumer gap)

  PR #537 (`yellow-research` SessionStart context7 cache pre-warm hook) shipped
  the cache-write side + the `bin/lc-cache-lookup` reader infrastructure, but
  the SKILL.md and best-practices-researcher inlined block — both shipped on PR
  #536 — still instructed agents to call `mcp__context7__resolve-library-id`
  directly. So the pre-warm consumed context7 quota and wrote a cache nothing
  read; net effect was making the anonymous-pool pressure worse, not better.

  This commit closes the loop:
  - `plugins/yellow-research/skills/library-context/SKILL.md` Step 1 rewritten
    as "cache-first" — instructs agents to call
    `bash ${CLAUDE_PLUGIN_ROOT}/bin/lc-cache-lookup <name>` first and skip the
    MCP resolve when output is non-empty. The wrapper exits 0 on every path
    (cache miss, expired, helper absent, jq missing), so empty output is the
    safe fallback signal — never an error.
  - `plugins/yellow-core/agents/research/best-practices-researcher.md`: inlined
    block adds an optional 1.1 pre-step that calls the helper at
    `${CLAUDE_PLUGIN_ROOT}/../yellow-research/bin/lc-cache-lookup` (the
    established cross-plugin path pattern documented in `AGENTS.md` and
    `plugins/yellow-core/CLAUDE.md`). The call is suffixed with
    `2>/dev/null || true` so bash exit 127 (yellow-research not installed) is
    absorbed into the same empty-output branch as a real cache miss. `Bash` is
    added to the agent's `tools:` list since the body now invokes the Bash tool.
    Other safe-chain steps renumber to 1.2-1.4; HTML annotation enumerates the
    five intentional deltas vs the canonical SKILL.md block.
  - `reference.md`: "Cache-compatibility (deferred)" → "Cache (consumer wiring
    landed in this PR; hook in PR #537)" with the full cache schema documented.

  Sentinel preserved (2 occurrences in BPR). With this PR + #537 merged, the
  cache loop is closed: SessionStart pre-warms via HTTP → SKILL.md Step 1 reads
  via `lc-cache-lookup` → runtime context7 quota drops on cache hits.

- [#533](https://github.com/KingInYellows/yellow-plugins/pull/533)
  [`c42f470`](https://github.com/KingInYellows/yellow-plugins/commit/c42f470babb5c71ac0c8fe5d1fba98edc7f9ca12)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - refactor: dedup
  yellow-research MCP wrappers and credential-status hook scaffold

  Consolidates two families of copy-pasted shell (debt findings 011/012/013 and
  024/025).
  - **011/012/013** — the three
    `yellow-research/bin/start-{exa,perplexity, tavily}.sh` MCP wrappers carried
    a byte-identical userConfig→env resolution block. Extracted to
    `bin/lib/resolve-mcp-key.sh` (`resolve_mcp_key VAR`); each wrapper is now ~4
    lines plus its distinct `npx` invocation. New `tests/resolve-mcp-key.bats`
    (5 tests).
  - **024/025** — `yellow-research` and `yellow-semgrep`'s
    `hooks/write-credential-status.sh` shared a ~40-line scaffold (version read,
    field classification, status write, `{"continue": true}` exit). Extracted to
    `credential_hook_scaffold` in `yellow-core/lib/credential-status.sh`; both
    hooks are now down to a source-guard plus the plugin-specific field-spec
    list. New `credential_hook_scaffold` tests in `credential-status.bats` (4
    tests).

  Both hooks still emit `{"continue": true}` on every path. Gates:
  `validate:plugins`, Bats (resolver 5, credential-status 16), shellcheck — all
  green.

## 3.1.3

### Patch Changes

- [#513](https://github.com/KingInYellows/yellow-plugins/pull/513)
  [`af12995`](https://github.com/KingInYellows/yellow-plugins/commit/af129959f2615a348eede582a34e8c27c33bf84e)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! -
  feat(yellow-research): emit credential-status.json from SessionStart

  Adds `hooks/write-credential-status.sh` (wired via plugin.json SessionStart)
  that emits `${CLAUDE_PLUGIN_DATA}/credential-status.json` describing which of
  the three `userConfig` API key fields (perplexity, tavily, exa) are resolved
  from `userConfig` vs shell env vs absent. Ceramic and parallel are
  OAuth-managed (no `userConfig` field) and are intentionally omitted.

  This lets `/setup:all` (in a subsequent PR) classify yellow-research as READY
  when keys are in the keychain (which it couldn't see before — it only probed
  shell env vars). No behavioral change to MCP servers; the 3-element fallback
  wrapper from v3.1.0 already worked correctly at runtime.

## 3.1.2

### Patch Changes

- [`b52d058`](https://github.com/KingInYellows/yellow-plugins/commit/b52d0583f1afd9cc11259b8e4eac62a124596623)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add explicit
  `model:` and `effort:` frontmatter to 8 phase-1 agents to escape the
  inheritance trap on narrow-role agents and add chain-of-thought depth to
  synthesizers/orchestrators.
  - `product-lens-reviewer` (yellow-docs): `model: sonnet` (matches sibling
    reviewers' explicit tiering)
  - `gemini-reviewer`, `opencode-reviewer` (yellow-council): `model: haiku` +
    `effort: low` — CLI relay agents that do no reasoning
  - `learnings-researcher` (yellow-core): `model: haiku` + `effort: low` — BM25
    retrieval, no synthesis; called on every `/review:pr` and `/workflows:plan`
  - `runner-assignment` (yellow-ci): `model: haiku` + `effort: low` —
    deterministic label-matching against fixed runner taxonomy
  - `audit-synthesizer` (yellow-debt): `effort: high` (model already `opus`) —
    cross-scanner deduplication and confidence gating benefit from extended CoT
  - `research-conductor` (yellow-research): `effort: high` (model already
    `opus`) — multi-source fan-out routing involves ambiguous decomposition
  - `brainstorm-orchestrator` (yellow-core): `model: sonnet` + `effort: high` —
    iterative dialogue with research integration; Sonnet is the structured-
    orchestration ceiling

## 3.1.1

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

## 3.1.0

### Minor Changes

- [`f5cac97`](https://github.com/KingInYellows/yellow-plugins/commit/f5cac9791e6f4563f9ed0a8f5e83371f2ba6531d)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! -
  feat(yellow-research): MCP API keys now fall back to shell env when userConfig
  is unset

  Each of the perplexity, tavily, and exa MCP servers now launches via a thin
  wrapper script (`bin/start-<server>.sh`) that resolves its API key with the
  following precedence:
  1. `userConfig` value (preferred — keychain-encrypted via Claude Code)
  2. Shell env fallback: `PERPLEXITY_API_KEY`, `TAVILY_API_KEY`, `EXA_API_KEY`

  Power users who already export these keys in their shell rc no longer have to
  re-enter them through the plugin config UI. If both sources are set,
  `userConfig` wins. If neither is set, the wrapper unsets the empty value so
  the MCP package sees "absent" rather than "explicitly empty"; behavior on the
  no-key path is unchanged.

  The wrapper pattern matches the existing
  `plugins/yellow-morph/bin/start-morph.sh` precedent. `--` separator added
  before forwarded args defends against future flag-injection if Claude Code
  ever passes args to MCP servers.

## 3.0.3

### Patch Changes

- [`a529c54`](https://github.com/KingInYellows/yellow-plugins/commit/a529c54481520876d301a5eec889371601b1b8a7)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - # Fix
  `/research:setup` Perplexity diagnostic + correct stale shell-env docs

  Two related fixes that address user confusion after the v2.0.0 migration to
  userConfig-backed credentials.

  ## Setup-time diagnostic

  Append a v2.0.0 migration hint to the Perplexity / Tavily / EXA "INVALID (HTTP
  401)" decision branch in `/research:setup` Step 3. When a user has a key set
  only in shell env (not userConfig), the curl probe runs and may return HTTP
  401 — but that 401 is structurally ambiguous. Two distinct causes:
  - (a) The key is genuinely expired or revoked.
  - (b) The key in shell env is valid, but `plugin.json` now reads
    `${user_config.<name>}` rather than the shell env, so the MCP never sees the
    key and fails at startup (Perplexity) or runtime (EXA / Tavily) regardless.

  The new message names both causes and tells the user how to act on each:
  regenerate at the provider dashboard for (a),
  `/plugin disable yellow-research && /plugin enable yellow-research` to answer
  the userConfig prompt for (b). Ceramic's branch is unaffected — it has no
  userConfig entry; its REST probe and MCP authentication are independent.

  Implementation detail: the 401/403 diagnostic is inlined into each of the
  three userConfig-capable provider probe blocks (EXA, Tavily, Perplexity),
  inside the curl-ran branch right after `$http_status` is set, so the
  diagnostic evaluates in the same subprocess where the probe ran. Ceramic's
  block runs its own inline decision tree without the v2.0.0 diagnostic. The
  pre-existing standalone post-probe decision-tree block was removed: each
  ` ```bash``` ` block in a command file is a fresh subprocess, so variables set
  in the per-provider blocks (`$curl_exit`, `$http_status`, `$provider_status`,
  `$provider_detail`, `$SKIP_CURL_PROBE`) were never visible to a separate
  decision-tree block. See
  `docs/solutions/code-quality/bash-block-subshell-isolation-in-command-files.md`.

  ## Doc corrections

  The README and `research-patterns` SKILL.md still instructed users to
  `export *_API_KEY` in `~/.zshrc` and "restart Claude Code." That guidance
  became stale on PR #259 / v2.0.0 (May 5, 2026) — `plugin.json` reads
  `${user_config.<key>}` exclusively. Following the old instructions silently
  traps every new user: shell env appears configured but the MCPs never see the
  key. The instructions are replaced with the
  `/plugin disable && /plugin enable` userConfig prompt path, with the
  shell-env-only fallback documented for power users who want a wrapper script.

  `CERAMIC_API_KEY` is still documented as a shell-env var because it gates the
  REST live-probe in `/research:setup`, not the MCP server (which uses OAuth) —
  that part is correct and unchanged.

  ## Out of scope
  - Restoring shell-env-as-MCP-input. PR #259 deliberately moved auth to the OS
    keychain as a hardening pass; that decision stands.
  - Investigating whether the user's specific Perplexity key is itself expired.
    The diagnostic distinguishes the two failure modes so the user can act on
    the right one.

## 3.0.2

### Patch Changes

- [#386](https://github.com/KingInYellows/yellow-plugins/pull/386)
  [`8496a31`](https://github.com/KingInYellows/yellow-plugins/commit/8496a313eec4e9c0953357f6365dee760dfdc3c2)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - # Fix
  `userConfig` manifest validator drift — add required `type` and `title`

  Add `"type": "string"` and `"title": "<sentence-case label>"` to every
  `userConfig` entry in the four plugins that declared user-supplied
  credentials. The Claude Code remote validator (surfaced via `claude doctor`)
  rejects any `userConfig` entry missing either field; local CI was passing
  because `schemas/plugin.schema.json` made `type` optional and used `label`
  instead of `title`.

  Affected entries (7 total):
  - `yellow-devin`: `devin_service_user_token`, `devin_org_id`
  - `yellow-research`: `perplexity_api_key`, `tavily_api_key`, `exa_api_key`
  - `yellow-morph`: `morph_api_key`
  - `yellow-semgrep`: `semgrep_app_token`

  Companion changes outside the plugins (no changeset needed — repo root):
  - `schemas/plugin.schema.json` — `userConfigEntry` tightened: `type` and
    `title` now required, `type` enum extended with `directory` and `file`
    (parity with remote validator), unused `label` property removed, dead
    `allOf` branch (the `if not required type` fall-through) removed,
    `directory`/`file` default-type-string constraint branches added.
  - `scripts/validate-plugin.js` — RULE 9 added: hand-rolled `userConfig`
    enforcement (per-entry `type` enum check + `title` non-empty string check).
    The repo's local CI does not currently AJV-load `plugin.schema.json`, so
    script-level enforcement is what actually catches this drift before
    `claude doctor`.
  - `docs/solutions/build-errors/userconfig-type-title-remote-validator-drift.md`
    — new solutions doc cross-referencing the prior `changelog`/`repository`
    drift incidents.

  **Behavior change for users:** `sensitive: true` (or `false` for
  `devin_org_id`) is preserved verbatim — keychain storage and credential
  masking are unchanged. The new `title` field is a UI label only; it never
  carries the credential value. Plugin install behavior is unchanged for
  existing users; the change unblocks fresh installs that hit the strict remote
  validator.

## 3.0.1

### Patch Changes

- [`01cc4c0`](https://github.com/KingInYellows/yellow-plugins/commit/01cc4c0246115a5bd3a60d26b956eed90626456b)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add deliberate
  model routing and per-repo plugin lint script

  **Model routing** — set explicit models on 5 agents/commands where the default
  `inherit` is wasteful or insufficient:
  - `model: haiku` on pure display/status commands (`debt:status`,
    `semgrep:status`) — matches precedent in `ci:status`. Low reasoning needs
    don't require Sonnet-level inference.
  - `model: opus` on heavy-reasoning agents: `architecture-strategist` (SOLID /
    coupling analysis), `research-conductor` (multi-source synthesis),
    `audit-synthesizer` (cross-scanner merging with severity scoring).

  Caveats documented in the plan:
  - GitHub Issue #14863 — verify Haiku + `tool_reference` block support in
    current Claude Code version; affected agents only use Bash/Skill/
    AskUserQuestion so low risk.
  - GitHub Issue #29768 — model inheritance bug; setting `model:` explicitly
    (not relying on inherit) avoids this.

  **Plugin lint script** — introduces `scripts/lint-plugins.sh`, a shell-only
  lint that validates agent frontmatter (name/description/tools), flags the
  `memory: true` mistake (correct form is a scope string), and verifies skill
  references resolve to an existing SKILL.md. Wired into CI via
  `.github/workflows/lint-plugins.yml`.

  The lint currently reports 0 errors and 0 warnings — all `memory: true`
  occurrences were migrated to valid scope strings in prior stack PRs (#253 and
  #255), so this lint lands clean on day one.

## 3.0.0

### Major Changes

- [#259](https://github.com/KingInYellows/yellow-plugins/pull/259)
  [`160f021`](https://github.com/KingInYellows/yellow-plugins/commit/160f02182e5e37d66658fcd1d567893bf3026e0e)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Roll out
  userConfig-based credential storage across five plugins, replacing or
  augmenting shell environment variable lookups with Claude Code userConfig.
  - **yellow-semgrep** (BREAKING): `SEMGREP_APP_TOKEN` is now read from
    `userConfig.semgrep_app_token` instead of the shell environment variable.
    Users who supplied the token only via `SEMGREP_APP_TOKEN` in their shell
    profile must re-enter it via the userConfig prompt (run `/semgrep:setup`);
    the shell env path no longer feeds the MCP server at startup.
  - **yellow-research** (BREAKING): All three API keys (`PERPLEXITY_API_KEY`,
    `TAVILY_API_KEY`, `EXA_API_KEY`) are migrated to userConfig. Existing users
    who relied solely on shell env vars must answer the userConfig prompt to
    continue using the plugin; run `/research:setup` to re-enter credentials.
  - **yellow-devin** (additive): HTTP-MCP userConfig declaration added for
    `devin_service_user_token` and `devin_org_id`. The shell env fallback
    (`DEVIN_SERVICE_USER_TOKEN`, `DEVIN_ORG_ID`) continues to work; no action
    required for current users.
  - **yellow-core** (additive): New `mcp-health-probe` skill defining a
    canonical three-state MCP health classification (OFFLINE / DEGRADED /
    HEALTHY) for `/<plugin>:status` commands. The existing
    `mcp-integration-patterns` skill is split into three focused sub-skills for
    narrower auto-invocation: `memory-recall-pattern`,
    `memory-remember-pattern`, and `morph-discovery-pattern`. The umbrella
    `mcp-integration-patterns` skill is retained until consumers migrate. The
    `/setup:all` env-variable dashboard gains a `check_key()` helper that
    reports shell env vs userConfig state per credential.

All notable changes to this plugin are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [2.0.0] - 2026-04-17

### Major Changes

- **Breaking:** all three API keys (`PERPLEXITY_API_KEY`, `TAVILY_API_KEY`,
  `EXA_API_KEY`) migrated to `userConfig`. The perplexity, tavily, and exa MCP
  servers now read their API keys from Claude Code's `userConfig` (sensitive,
  keychain-backed) instead of shell env vars. The three keys are declared
  **optional** — the plugin degrades gracefully when any are missing, so
  skipping the prompts is valid for users who only want a subset of research
  sources.

  Empirically verified behavior (MCP stdio probe, 2026-04-17): perplexity
  hard-fails at startup without `PERPLEXITY_API_KEY` (so its tools disappear
  entirely); tavily and exa start without their keys but return runtime errors
  on tool invocation. Either way, `/research:deep` and `/research:code` continue
  to operate with whichever sources are available.

### Migration (existing users)

- Run `claude plugin update yellow-research@yellow-plugins`. Claude Code prompts
  for each key at plugin-enable time; dismiss any you don't want stored.
  Answering preserves the keychain-backed experience; skipping leaves the old
  shell-env path broken for that MCP (since plugin.json now references
  `${user_config.*}`, not `${*_API_KEY}` shell vars).
- Power users who prefer shell env vars can add a thin wrapper script per MCP
  (see yellow-morph's `bin/start-morph.sh` for a pattern), but for most users
  answering the userConfig prompt is the recommended path.

---

## 1.4.2

### Patch Changes

- [#255](https://github.com/KingInYellows/yellow-plugins/pull/255)
  [`3b4025e`](https://github.com/KingInYellows/yellow-plugins/commit/3b4025e8c1af062223ea8db4bf6b067f439156c6)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Set memory
  scope on workflow orchestrators; sharpen overlap descriptions

  Add `memory: project` to 4 workflow orchestrators (brainstorm-orchestrator,
  knowledge-compounder, spec-flow-analyzer in yellow-core; devin-orchestrator in
  yellow-devin) so they accrue cross-session learning per project. The correct
  frontmatter form is a scope string (`user`/`project`/`local`), not the boolean
  `memory: true` used elsewhere in the codebase.

  Also correct invalid `memory: true` to `memory: project` on the remaining 12
  agents that were not covered by the parent PR's review-agent sweep:
  yellow-core (repo-research-analyst, git-history-analyzer, security-reviewer,
  performance-reviewer, security-lens, session-historian), yellow-research
  (code-researcher, research-conductor), yellow-docs (doc-auditor,
  doc-generator, diagram-architect), and yellow-review
  (project-compliance-reviewer). After this PR, no agent in the repository
  declares the invalid `memory: true`.

  Note on tool surface: per Claude Code docs, `memory: <scope>` automatically
  enables Read/Write/Edit so agents can persist learnings to
  `.claude/agent-memory/<name>/`. For yellow-review's review agents — which the
  plugin's CLAUDE.md documents as "report findings, do NOT edit project files
  directly" — the prompt-level read-only contract remains the source of truth;
  the orchestrating `/review:pr` command applies all fixes. The implicit
  Write/Edit grant is required for memory persistence and does not reflect a
  change in agent responsibility.

  Sharpen the `description:` trigger clauses for two overlap pairs:
  - security-sentinel (active vulnerabilities) vs security-debt-scanner (debt
    patterns that could become vulnerabilities)

  The code-simplicity-reviewer vs code-simplifier pair already had clear
  pre-fix/post-fix trigger clauses — no change needed there.

---

## 1.4.0

### Minor Changes

- [`b441164`](https://github.com/KingInYellows/yellow-plugins/commit/b441164550b346b20b73bf466bcbc3e33e823b74)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Fix ast-grep
  MCP Python 3.13 gate with uv-managed Python

  Add `--python 3.13` to uvx args so uv auto-downloads Python 3.13 without
  touching the system Python. Auto-install uv and pre-warm Python 3.13 in the
  install script. Remove Python 3.13 system requirement from setup commands. Fix
  sg/ast-grep binary check inconsistency in setup:all dashboard.

- [#265](https://github.com/KingInYellows/yellow-plugins/pull/265)
  [`635f58d`](https://github.com/KingInYellows/yellow-plugins/commit/635f58d254b22a733f57f72fa15681c56d3f6e86)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add Ceramic.ai
  as the default first-hop research backend across yellow-research and
  yellow-core.
  - yellow-research: bundle a 6th MCP server entry pointing at
    `https://mcp.ceramic.ai/mcp` (OAuth 2.1; same shape as the existing Parallel
    Task block). The `code-researcher` and `research-conductor` agents prefer
    `ceramic_search` for general-web and Simple/Moderate triage tiers, with
    explicit fall-through to the existing Perplexity/Tavily/EXA stack when
    Ceramic is unavailable or returns no useful results. Both agents are
    instructed to rewrite topics into concise keyword form before calling
    Ceramic, since it is a lexical (not semantic) search engine.
    `/research:setup` gains a `CERAMIC_API_KEY` format check, REST live-probe,
    and dashboard row; `CERAMIC_API_KEY` powers the REST probe only — the MCP
    authenticates via OAuth.
  - yellow-core: bundle the same Ceramic MCP entry as a second `mcpServers`
    alongside `context7`. The `best-practices-researcher` agent leads its Phase
    2 web-search step with `ceramic_search`, falling back to built-in
    `WebSearch`. `WebFetch` stays primary for single-URL content fetches
    (Ceramic has no fetch endpoint).

  Pricing: $0.05 per 1,000 queries (vs. tens of $/month per provider in the
  prior stack). Rate limits: 20 QPS pay-as-you-go; 50 QPS Pro.

  No prior backend is removed. Roll back by deleting the `mcpServers.ceramic`
  block from either plugin's `plugin.json`.

- [#290](https://github.com/KingInYellows/yellow-plugins/pull/290)
  [`65e2938`](https://github.com/KingInYellows/yellow-plugins/commit/65e29382c2df760ef62efca337c1fc6160193245)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Fix
  `subagent_type` 2-segment → 3-segment format across the `review:pr` keystone
  and other command files. Claude Code's Task registry resolves agents by the
  literal `plugin:directory:agent-name` triple from frontmatter — the 2-segment
  `plugin:agent-name` form silently mismatches and causes the
  graceful-degradation guard to skip every cross-plugin persona spawn.

  Also updates `scripts/validate-agent-authoring.js` to register both 2-segment
  and 3-segment forms (transitional — the 2-segment form remains accepted by the
  validator so non-keystone callers fail loudly only on the runtime mismatch,
  not on CI). New code should always emit the 3-segment form.

  `yellow-review` (MINOR — keystone behavior fix, no API change):
  - `commands/review/review-pr.md` — Step 3d `learnings-researcher` dispatch
    (`yellow-core:research:learnings-researcher`), the entire always-on /
    conditional / supplementary persona dispatch table (17 entries: 4 always-on
    plus 12 conditional plus 1 supplementary — `yellow-review:review:*` for the
    10 in-plugin personas, `yellow-core:review:*` for the 6 security / perf /
    architecture / pattern / simplicity / polyglot personas,
    `yellow-codex:review:codex-reviewer` for the optional supplementary), Step 8
    `yellow-review:review:code-simplifier`, and Step 9a
    `yellow-core:workflow:knowledge-compounder` all corrected to the
    three-segment registry form.
  - `commands/review/review-all.md` — `learnings-researcher` Task example in the
    inlined per-PR pipeline corrected to
    `yellow-core:research:learnings-researcher`.
  - `skills/pr-review-workflow/SKILL.md` — Cross-Plugin Agent References
    examples corrected to `yellow-core:review:security-sentinel` and
    `yellow-codex:review:codex-reviewer`; pattern hint expanded from
    `yellow-core:<agent-name>` to `yellow-core:<dir>:<agent-name>` so future
    authors copy the right form.
  - `agents/review/code-reviewer.md` — Deprecation stub frontmatter and body
    migration prose updated to spell out the three-segment form
    (`yellow-review:review:code-reviewer` →
    `yellow-review:review:project-compliance-reviewer`); the stub's
    residual_risks JSON also corrected so any caller still landing on the stub
    gets a copy-pasteable replacement string.
  - `CLAUDE.md` Cross-Plugin Agent References — Both intro paragraphs updated to
    specify the three-segment form with a concrete example.

  `yellow-core` (MINOR — self-reference fix on Wave 2 keystone agent and core
  workflow commands):
  - `agents/research/learnings-researcher.md` Integration section — Standalone
    invocation example corrected to `yellow-core:research:learnings-researcher`.
  - `commands/workflows/compound.md` — `knowledge-compounder` dispatch corrected
    to `yellow-core:workflow:knowledge-compounder`.
  - `commands/workflows/work.md` — Codex rescue dispatch corrected to
    `yellow-codex:workflow:codex-executor`.

  `yellow-docs` (MINOR — every cross-agent dispatch was 2-segment):
  - `commands/docs/audit.md` — `doc-auditor` →
    `yellow-docs:analysis:doc-auditor`.
  - `commands/docs/diagram.md` — `diagram-architect` →
    `yellow-docs:generation:diagram-architect`.
  - `commands/docs/generate.md` — `doc-generator` →
    `yellow-docs:generation:doc-generator`.
  - `commands/docs/refresh.md` — both `doc-auditor` and `doc-generator`
    references updated as above.

  `yellow-research` (MINOR — deepen-plan dispatch was 2-segment):
  - `commands/workflows/deepen-plan.md` — `repo-research-analyst` →
    `yellow-core:research:repo-research-analyst`; `research-conductor` →
    `yellow-research:research:research-conductor`.

  Triggers a marketplace release so consumers' plugin caches refresh; the
  keystone is otherwise dispatch-blocked end-to-end.

### Patch Changes

- [`e00b53e`](https://github.com/KingInYellows/yellow-plugins/commit/e00b53e874fe3d053c9f683b2eb86d1e6fe99dff)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Unbundle
  context7 MCP from yellow-core; repoint yellow-research callers to user-level

  Remove the bundled `mcpServers.context7` entry from
  `plugins/yellow-core/.claude-plugin/plugin.json` to avoid the
  dual-OAuth-pop-up issue when users have context7 installed both at user level
  and bundled inside yellow-core (the namespace collision pattern documented in
  `docs/solutions/integration-issues/duplicate-mcp-url-double-oauth.md`). Per CE
  PR #486 (compound-engineering v2.62.0, 2026-04-03) parity.
  - **yellow-core:** `mcpServers` block removed from `plugin.json`;
    `best-practices-researcher` agent's tool list updated to user-level
    `mcp__context7__*` names; CLAUDE.md/README.md updated to recommend
    user-level install; statusline/setup.md no longer lists yellow-core as
    having an MCP.
  - **yellow-research:** `code-researcher` agent, `/research:code` command,
    `/research:setup` command, `research-patterns` skill, CLAUDE.md, and
    README.md all repointed from `mcp__plugin_yellow-core_context7__*` to
    user-level `mcp__context7__*`. ToolSearch availability check + EXA fallback
    preserved (existing prose).

  **User action:** install context7 at user level via
  `/plugin install context7@upstash` (or via Claude Code MCP settings UI). The
  user-level context7 server registers tools as
  `mcp__context7__resolve-library-id` and `mcp__context7__query-docs`.
  yellow-research's `code-researcher` falls back to EXA `get_code_context_exa`
  if user-level context7 is not detected by ToolSearch — no behavior change for
  users without context7.

  Roll back by re-adding the `mcpServers.context7` block to
  `plugins/yellow-core/.claude-plugin/plugin.json` and reverting the tool-name

---

## [1.3.0] - 2026-03-10

### Minor Changes

- [`1c183f3`](https://github.com/KingInYellows/yellow-plugins/commit/1c183f3529250822df87180b5c9e69dadc2830a0)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add
  auto-install with confirmation for semgrep CLI and ast-grep binary in setup
  commands

### Patch Changes

- [`69d84c8`](https://github.com/KingInYellows/yellow-plugins/commit/69d84c8f17a23da89979765c434d4e2c0c683935)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Expand
  marketplace setup coverage with dedicated setup commands, repository-root
  aware setup checks, and stricter setup validation guardrails.

---

## [1.2.0] - 2026-03-06

### Minor Changes

- [`eb5c43c`](https://github.com/KingInYellows/yellow-plugins/commit/eb5c43c88c810c1452d3d6a034e6bf2e8ea18ee1)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add ast-grep
  MCP server for AST-based structural code search. Bundles 4 new tools
  (find_code, find_code_by_rule, dump_syntax_tree, test_match_code_rule) via
  uvx. Adds health checks for ast-grep and Parallel Task MCP to /research:setup.

---

## [1.1.0] - 2026-02-25

### Fixed

- Remove unsupported `changelog` key from plugin.json that blocked installation
  via Claude Code's remote validator.

---

## [1.0.0] - 2026-02-23

### Added

- Initial release — bundled research MCP servers: Perplexity, Tavily, EXA, and
  Parallel Task for multi-source deep research.

---

**Maintained by**: [KingInYellows](https://github.com/KingInYellows)
