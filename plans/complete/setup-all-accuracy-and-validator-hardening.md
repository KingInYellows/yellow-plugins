# Feature: setup:all Accuracy Audit + Validator Hardening

## Overview

`/setup:all` (`plugins/yellow-core/commands/setup/all.md`, 718 lines) is the
orchestrator every marketplace plugin's setup flows through. A two-agent
research pass confirmed four live drift bugs plus one pre-existing cascade
bug — all invisible to CI because `scripts/validate-setup-all.js` only checks
plugin-name set-membership and order across four marker-delimited sections.
This plan fixes the confirmed drift, adds a cache-cascade guard, and hardens
the validator so this drift class cannot silently recur.

Scope decisions made during planning (user-confirmed):

- **yellow-devin fix = PARTIAL tier only.** userConfig-only credentials get
  an accurate PARTIAL (not READY): 8 of 9 devin commands read shell env vars
  directly via curl, so userConfig-only setups genuinely fail at runtime.
  Full userConfig support across the 8 commands is a documented follow-up.
- **Validator hardening = recommended tier.** Markers + checks for the
  Step 1.5 probe list, the Step 1.6 credential-status plugin list, and the
  illustrative dashboard example; derive `COMMAND_PLUGIN_MAP` from the
  markdown; register error codes; add path overrides + integration tests.
  Full classification-prose parsing is explicitly YAGNI.
- **Plugin-cache cascade bug = fix in this PR.**

## Problem Statement

### Confirmed drift (passes CI today)

1. **Orphaned ToolSearch probe** — `all.md:292-311` (Step 1.5) says "four
   ToolSearch probes" but lists five query bullets; `list_user_organizations`
   is a leftover from the yellow-chatprd removal (PR #580 deleted the
   recorded-tool line and classification block but not the query bullet).
2. **Stale illustrative dashboard** — `all.md:546-566` lists 16 plugins;
   `yellow-council` (added PR #328) was never added to the example table.
3. **yellow-devin false NEEDS SETUP** — classification (`all.md:375-379`)
   requires shell env vars `DEVIN_SERVICE_USER_TOKEN`/`DEVIN_ORG_ID`, but
   plugin.json declares userConfig fields as the recommended storage. A
   userConfig-only user is told NEEDS SETUP even though `/devin:setup`
   reports configured. (Correct end state is PARTIAL, not READY — see
   Overview.)
4. **yellow-debt hard dependency invisible** — `all.md:432-438` never checks
   `yellow-core installed`, despite `plugins/yellow-debt/.claude-plugin/plugin.json`
   declaring a NON-optional dependency ("debt commands fail without it").
   Inverse inconsistency: yellow-review checks yellow-core with no declared
   manifest dependency; yellow-ci never surfaces its optional yellow-linear
   dependency while yellow-debt does.

<!-- deepen-plan: codebase -->
> **Codebase:** Two adjacent findings for the PR description (verified, out of
> scope to fix here): (a) `plugins/yellow-review/.claude-plugin/plugin.json`
> has NO `dependencies` field at all, yet `all.md:450-453` checks
> `yellow-core installed` — the inverse of the yellow-debt gap; consider a
> follow-up to declare the manifest dependency. (b)
> `schemas/plugin.schema.json:308-311` documents `optional`-dependency
> validator behavior ("the validator does not warn...") that NO script in
> `scripts/*.js` implements — dependency-drift tooling is a systemic gap,
> not a `/setup:all`-local one.
<!-- /deepen-plan -->

### Adjacent bugs found during analysis

5. **Plugin-cache cascade** — `all.md:280-282` + `all.md:330-332`: when the
   plugin cache dir probe fails, `installed_plugins` is empty, every plugin
   classifies NOT INSTALLED, and all checks are skipped — a broken cache path
   is reported as "nothing installed".
6. **Step 5 staleness** — `all.md:677-679` re-runs Step 1 and Step 1.5 for
   the before/after summary but never re-runs Steps 1.6/1.7
   (credential-status + version drift). The yellow-research /
   yellow-semgrep / yellow-composio classifications "prefer the
   credential-status file from Step 1.6", so the plugins most likely to have
   changed during Step 4 can show a stale "no change".

### Why CI stays green

`scripts/validate-setup-all.js` (326 lines) does not parse: the Step 1
env-var probe list, the Step 1.5 ToolSearch list (no markers), classification
block contents, the illustrative examples, or the Step 1.6 reference-file
plugin list. Its `COMMAND_PLUGIN_MAP` is hand-duplicated and cross-checked
against itself. It has no error codes, no test file, and hardcoded input
paths (no fixture override, unlike `VALIDATE_PLUGINS_DIR` / `SOLUTIONS_DIR`
precedents).

## Implementation Plan

### Phase 1: Spike — empirically verify userConfig storage (BLOCKING)

Two contradictory detection patterns coexist for `sensitive: true` userConfig
fields, and the right one cannot be determined from the codebase:

- `all.md:99-105` (MORPH_API_KEY probe) greps `~/.claude/.credentials.json`
- `has_userconfig()` (copied verbatim in `devin/setup.md:40-60`,
  `research/setup.md`, `semgrep/setup.md`) greps
  `~/.claude/settings.json` → `.pluginConfigs[$plugin].options[$option]`

<!-- deepen-plan: codebase -->
> **Codebase:** There is a THIRD mechanism the two-pattern framing misses:
> `CLAUDE_PLUGIN_OPTION_<KEY>` env vars injected into plugin subprocesses —
> documented in `docs/plugin-credential-status-protocol.md` and used live in
> `plugins/yellow-semgrep/hooks/write-credential-status.sh:22-23`
> (`semgrep_app_token:CLAUDE_PLUGIN_OPTION_SEMGREP_APP_TOKEN:SEMGREP_APP_TOKEN`).
> This is the only repo-documented authoritative read path, but it applies to
> hook subprocesses; the spike question is whether command-context Bash sees it.
<!-- /deepen-plan -->

- [x] 1.1: On a machine with yellow-devin enabled and credentials entered
      ONLY via the userConfig prompt (no shell exports), inspect both
      `~/.claude/.credentials.json` and `~/.claude/settings.json` to
      determine where sensitive userConfig values (or placeholders) actually
      land. Record the finding in this plan file under a `## Spike Results`
      section.
- [x] 1.2: Choose the detection pattern for the devin fix based on 1.1. If
      both files are populated for different purposes, prefer the
      `has_userconfig()` pattern (matches `/devin:setup`'s own detection, so
      dashboard and delegated setup agree). If `has_userconfig()` provably
      cannot see sensitive fields, use the `.credentials.json` grep AND file
      a follow-up: `/devin:setup`, `/research:setup`, `/semgrep:setup` all
      share the broken pattern.

<!-- deepen-plan: external -->
> **Research:** External evidence largely resolves this spike (decompiled
> `pluginOptionsStorage.ts` + official docs, HIGH certainty): sensitive
> userConfig values are stored in the OS keychain (macOS) or
> `~/.claude/.credentials.json` (Linux/no-keychain), and `savePluginOptions`
> **actively scrubs sensitive keys out of `settings.json`** — no key, no
> placeholder, no presence marker ever exists in `pluginConfigs[...].options`
> for a `sensitive: true` field. Therefore `has_userconfig()`'s settings.json
> grep CANNOT detect sensitive fields (it can only ever see non-sensitive
> ones). `CLAUDE_PLUGIN_OPTION_*` is documented/implemented only for plugin
> subprocesses (hooks, MCP/LSP servers, monitors) — slash-command Bash is
> absent from every enumerated injection surface (moderate certainty, by
> consistent absence). No documented presence-only check exists. Caveat: live
> bug anthropics/claude-code#62442 — on macOS v2.1.150 sensitive userConfig
> values are not persisted AT ALL (in-memory only). The spike reduces to a
> quick local confirmation on this machine (WSL2 → `.credentials.json` path):
> verify the file exists and contains `pluginSecrets` entries after a
> userConfig save, then adopt the `.credentials.json` grep (morph pattern) as
> the detection mechanism for task 2.3.
> Sources: https://code.claude.com/docs/en/plugins-reference ;
> https://github.com/antonoly/claude-code-anymodel/blob/main/utils/plugins/pluginOptionsStorage.ts ;
> https://github.com/anthropics/claude-code/issues/62442
<!-- /deepen-plan -->

## Spike Results (Phase 1 — completed 2026-07-08)

Local inspection (WSL2, key names only, no values read): `~/.claude/.credentials.json`
exists (mode 0600) containing only `claudeAiOauth` and `mcpOAuth` — **no
`pluginSecrets` key**. `~/.claude/settings.json` has **no `pluginConfigs` key**.
This machine has never stored plugin userConfig values; all plugin credentials
here are shell-env-only. Conclusions:

- Absence case verified locally: neither detection file can produce a false
  positive on a machine with no saved userConfig.
- Presence-case location rests on external evidence (HIGH certainty,
  decompiled `pluginOptionsStorage.ts` + official docs): on Linux/no-keychain,
  sensitive values land in `.credentials.json` under
  `pluginSecrets.<name>@<marketplace>`; sensitive keys are actively scrubbed
  from `settings.json` and never appear in `pluginConfigs[...].options`.
- **Decision (1.2):** task 2.3 uses the `.credentials.json` grep (the
  MORPH_API_KEY pattern), extended to also match the `pluginSecrets` structure;
  document the macOS-keychain limitation (file grep cannot see keychain-stored
  values — `/devin:setup` remains authoritative there). `has_userconfig()` is
  NOT used: it greps `settings.json`, which provably never contains sensitive
  fields. Follow-up to file at PR time: `devin/setup.md`, `research/setup.md`,
  `semgrep/setup.md` all use `has_userconfig()` against `sensitive: true`
  fields — the shared helper is blind to exactly the fields it targets.

### Phase 2: Fix drift in `plugins/yellow-core/commands/setup/all.md`

All edits observe: each ```bash block is a fresh subprocess (no shared state
across blocks — `docs/solutions/code-quality/bash-block-subshell-isolation-in-command-files.md`);
the Step 1.5 / Step 2 three-point atomic-update rule
(`docs/solutions/code-quality/setup-classification-probe-coupling.md`):
keyword list + resolved-name list + probe count change together.

- [x] 2.1: Remove the orphaned `list_user_organizations` query bullet from
      Step 1.5 (`all.md:296`). Verify text reads "four ToolSearch probes",
      four query bullets, four recorded fully-qualified names.
- [x] 2.2: Add the missing `yellow-council` row to the illustrative
      dashboard example (`all.md:546-566`) with a plausible status/detail
      consistent with its classification block (gemini/opencode/codex CLI
      availability). Also verify the Step 5 before/after example
      (`all.md:681-693`) needs no equivalent fix.
- [x] 2.3: yellow-devin classification (`all.md:375-379`) — three tiers:
      - READY: curl OK AND jq OK AND both shell env vars set
      - PARTIAL: shell env unset but userConfig present (detection pattern
        from Phase 1) — warning text mirrors `devin/setup.md:83-96`:
        "userConfig is set but shell env is unset; /devin:* commands use
        curl directly and will return 401. Export the vars or restart
        Claude Code."
      - NEEDS SETUP: neither source present
      Update Step 1's env-var rows for the two devin vars to also report
      userConfig presence (same display style as the MORPH_API_KEY row) so
      the classification block has its input in the dashboard output.

<!-- deepen-plan: external -->
> **Research:** Detection implication for this task: use the
> `.credentials.json` grep (the existing MORPH_API_KEY pattern at
> `all.md:99-105`), NOT `has_userconfig()` — sensitive fields never appear in
> `settings.json` (see Phase 1 annotation). Limitation to document in the
> PARTIAL tier text: on macOS the value lives in the system keychain and is
> not detectable by any file grep — a keychain-stored credential will show as
> "not set" at dashboard level; direct the user to `/devin:setup` for the
> authoritative check. Follow-up to file at PR time: `has_userconfig()` in
> `devin/setup.md`, `research/setup.md`, `semgrep/setup.md` greps
> settings.json for `sensitive: true` fields that are never stored there —
> the shared helper is blind to exactly the fields it is used for.
<!-- /deepen-plan -->
- [x] 2.4: yellow-debt classification (`all.md:432-438`) — add
      `yellow-core installed` to the NEEDS SETUP condition (non-optional
      manifest dependency), reusing the existing `installed_plugins` loop
      output (`all.md:269-276`); do not invent a new probe.

<!-- deepen-plan: codebase -->
> **Codebase:** Confirmed reusable exactly as described — the loop at
> `all.md:268-276` prints per-plugin `installed`/`NOT INSTALLED` lines for
> all 17 names regardless of install subset, and two classification blocks
> already reference it by name (yellow-debt→yellow-linear at 432-438,
> yellow-review→yellow-core at 450-453). Tasks 2.4/2.5 follow that exact
> prose pattern; no new probe mechanics needed.
<!-- /deepen-plan -->
- [x] 2.5: yellow-ci classification (`all.md:440-446`) — surface the
      optional yellow-linear dependency as a PARTIAL note, matching
      yellow-debt's existing pattern (normalizes bug #5 toward surfacing).
- [x] 2.6: Step 5 (`all.md:677-679`) — explicitly re-run Steps 1.6 and 1.7
      alongside Step 1 and Step 1.5 in the before/after re-classification.
      The 1.6/1.7 logic lives in
      `plugins/yellow-core/references/setup-all/credential-status-and-version-drift.md` —
      reference it, do not re-derive the bash inline (the command file
      forbids reconstructing those blocks from memory).
- [x] 2.7: Cache-cascade guard — in Step 2's classification preamble
      (`all.md:330-332`), when Step 1 reported `plugin_cache: NOT FOUND`,
      halt classification with an explicit error ("plugin cache directory
      not found at <path> — cannot determine installed plugins; fix the
      cache path before rerunning") instead of letting every plugin cascade
      to NOT INSTALLED.

<!-- deepen-plan: codebase -->
> **Codebase:** Framing correction: when `plugin_cache: NOT FOUND`, the
> per-plugin for-loop (nested inside the directory-exists check) never runs,
> so NO installed-status lines are emitted at all — the "cascade to NOT
> INSTALLED" is the LLM's inference from the absent section, not hard-coded
> bash output. The halt guard is still the right fix; word it as "no
> installed-status lines are emitted". Also confirmed: the probed path
> `$HOME/.claude/plugins/cache` + `*/.claude-plugin/plugin.json` glob is the
> established convention in 4 other files (`statusline/setup.md:60-62`,
> `debt/setup.md:44-54`, `review/setup.md:34-44`, `council/setup.md:133,164`)
> — none of which guard the missing-directory case either, so scoping the
> fix to `/setup:all` only is consistent.
<!-- /deepen-plan -->

### Phase 3: Harden `scripts/validate-setup-all.js`

Markers and the checks that require them land in the SAME PR (a hard-fail
validator landing before the markdown markers would break any in-flight
stacked branch that rebases onto it).

- [x] 3.1: Testability first — add env-var path overrides
      (`VALIDATE_SETUP_ALL_MARKETPLACE_PATH`, `VALIDATE_SETUP_ALL_COMMAND_PATH`,
      plus overrides for the references file and plugins dir), following the
      `VALIDATE_PLUGINS_DIR` / `SOLUTIONS_DIR` precedent exactly.

<!-- deepen-plan: codebase -->
> **Codebase:** Citation precision: `VALIDATE_PLUGINS_DIR` lives in
> `scripts/validate-agent-authoring.js` (consumed by
> `tests/integration/helpers/validator-harness.ts:16-23`), not
> validate-plugin.js; `SOLUTIONS_DIR` is in `scripts/validate-solutions.js`.
> The pattern to copy is `process.env.X || <real path>` with the env var
> named after the validator.
<!-- /deepen-plan -->
- [x] 3.2: Error codes — add a `SETUP_COVERAGE` category and
      `ERROR-SETUP-001..N` to `packages/domain/src/validation/errorCatalog.ts`
      (+ `types.ts`), one code per check family (missing markers, coverage
      drift, probe-list drift, credential-status-list drift, example drift,
      map drift). In the CJS script, assemble codes via concatenation
      (`'ERROR-' + 'SETUP' + '-001'`) — `scripts/lint-error-codes.js` fails
      CI on literal `ERROR-X-N` strings in `scripts/`. Add the paired-edit
      comment both sides, per the SOL/PLAN precedent.

<!-- deepen-plan: codebase -->
> **Codebase:** Extension points verified: the `PLAN_LIFECYCLE`/
> `ERROR-PLAN-001` precedent block sits at
> `packages/domain/src/validation/errorCatalog.ts:91-105` with the exact
> ESM/CJS-bridge and paired-edit comments to mirror; `types.ts:19-28` holds
> the `ErrorCategory` enum (add `SETUP_COVERAGE`) and the category-mapping
> array pattern is at `types.ts:319-321`. `scripts/lint-error-codes.js`
> scans ALL `scripts/*.js` with `/ERROR-[A-Z]+-\d+/g` — the
> assemble-via-concatenation requirement is exact, not optional.
<!-- /deepen-plan -->
- [x] 3.3: Derive `COMMAND_PLUGIN_MAP` from the markdown's own
      `setup-all-plugin-command-map` section instead of the hardcoded copy
      (`validate-setup-all.js:20-38`). Strengthen: resolve each delegated
      command's real plugin from the file path where its `name:` frontmatter
      is found under `plugins/**/commands/`, and require it to equal the
      markdown map's plugin — validates the map against reality, not
      against a second hand-written copy.

<!-- deepen-plan: codebase -->
> **Codebase:** Confirmed genuinely new capability: `loadCommandNames()`
> (`validate-setup-all.js:216-231`) builds a FLAT Set of command names with
> no per-command plugin association, and `validateDelegation()` (262-291)
> cross-checks the markdown map only against the hardcoded
> `COMMAND_PLUGIN_MAP` copy (lines 20-38, byte-for-byte duplicate of the
> markdown). `extractMarkedSection()` (69-75) is generic indexOf-based and
> reusable as-is for the new marker pairs in 3.4-3.6.
<!-- /deepen-plan -->
- [x] 3.4: New marker pair `<!-- setup-all-toolsearch-probes:start/end -->`
      around Step 1.5's query list + recorded-name list. Validator checks:
      (a) query-bullet count == recorded fully-qualified-name count == the
      stated "N ToolSearch probes" number; (b) every recorded name matches
      `mcp__plugin_{plugin}_{server}__{tool}` with `{plugin}` in the
      marketplace set. Catches the chatprd-removal class directly.
- [x] 3.5: New marker pair around the credential-status plugin list in
      `references/setup-all/credential-status-and-version-drift.md`
      (currently `yellow-research yellow-composio yellow-semgrep`).
      Validator derives the expected set by scanning `plugins/*/hooks/*.sh`
      for credential-status emission (writes or sources
      `credential-status`) and diffs it against the marked list. NOTE: do
      NOT derive from `userConfig.*.sensitive === true` — yellow-devin and
      yellow-morph have sensitive userConfig but intentionally no
      credential-status hook; the hook-scan is the accurate signal.

<!-- deepen-plan: codebase -->
> **Codebase:** Derivation heuristic verified empirically:
> `grep -rl "credential-status\|write_credential_status" plugins/*/hooks/*.sh`
> returns exactly three files (`yellow-composio/hooks/check-mcp-url.sh`,
> `yellow-research/hooks/write-credential-status.sh`,
> `yellow-semgrep/hooks/write-credential-status.sh`) — an exact match to the
> reference file's current list at
> `references/setup-all/credential-status-and-version-drift.md:22`.
<!-- /deepen-plan -->
- [x] 3.6: New marker pair around the illustrative dashboard example
      (`all.md:546-566`). Validator extracts plugin names from the fenced
      block and requires exact set-equality with the marketplace. Catches
      the yellow-council class directly.

### Phase 4: Tests, housekeeping, quality gates

- [x] 4.1: `tests/integration/validate-setup-all.test.ts` — spawnSync
      pattern with `mkdtempSync` fixtures (model:
      `tests/integration/validate-solutions.test.ts`). Write a small
      dedicated helper (do NOT generalize
      `tests/integration/helpers/validator-harness.ts`, which is hardcoded
      to validate-agent-authoring.js). Fixture cases: green baseline;
      each of the four drift bugs reintroduced (orphaned probe bullet,
      missing example row, map mismatch, credential-status list drift);
      missing-marker hard fail; each case asserts the specific
      ERROR-SETUP-* code on stderr.
- [x] 4.2: Delete the stale `plans/plugin-setup-commands-research-and-ci.md`
      (untracked; describes creating /research:setup and /ci:setup, both long
      shipped — per `docs/solutions/code-quality/stale-plan-docs-committed-after-implementation.md`).
- [x] 4.3: Changeset — `pnpm changeset`, **patch** for yellow-core
      (behavior corrections to an existing command; no new command/agent).
- [x] 4.4: Quality gates — `pnpm validate:schemas` (includes
      validate-setup-all + lint-error-codes), `pnpm test:integration`,
      `pnpm test:unit`, `pnpm lint`, `pnpm typecheck`.
- [x] 4.5: Docs sync — `plugins/yellow-core/CLAUDE.md` / `README.md` only if
      user-visible behavior descriptions change (command count is
      unchanged); verify the one-line /setup:all descriptions still hold.
- [x] 4.6: Submit via Graphite (`gt branch create`, `gt commit create`,
      `gt stack submit`) — single PR, markers + validator together.

## Technical Details

Files to modify:
- `plugins/yellow-core/commands/setup/all.md` — all Phase 2 edits
- `plugins/yellow-core/references/setup-all/credential-status-and-version-drift.md` —
  marker pair (3.5) + Step 5 re-run touchpoint (2.6)
- `scripts/validate-setup-all.js` — Phase 3
- `packages/domain/src/validation/errorCatalog.ts`, `types.ts` — 3.2

Files to create:
- `tests/integration/validate-setup-all.test.ts` (+ small local helper)
- `.changeset/*.md`

Files to delete:
- `plans/plugin-setup-commands-research-and-ci.md`

## Acceptance Criteria

1. `pnpm validate:setup-all` passes on the fixed files; reintroducing any of
   the four drift bugs in a test fixture fails with its specific
   `ERROR-SETUP-*` code (verified by 4.1's test cases).
2. Step 1.5 lists exactly four query bullets, four recorded names, and says
   "four" — verified by the new 3.4 check running in CI.
3. Illustrative dashboard example contains all 17 marketplace plugins —
   verified by the new 3.6 check.
4. yellow-devin classification has three tiers; the userConfig-only tier is
   PARTIAL (not READY) and its warning names the 401/shell-env cause.
5. yellow-debt NEEDS SETUP when yellow-core is not installed; yellow-ci
   PARTIAL note when yellow-linear is not installed.
6. `plugin_cache: NOT FOUND` halts classification with an explicit error —
   no plugin is reported NOT INSTALLED from a missing cache.
7. Step 5 explicitly re-runs Steps 1.6/1.7.
8. Spike result (userConfig storage location) recorded in this plan.
9. CI baseline green: `pnpm validate:schemas && pnpm test:unit && pnpm lint
   && pnpm typecheck`, plus `pnpm test:integration`.

## Edge Cases

- `jq` absent on the target machine: any userConfig detection added to
  Step 1 must keep the `grep -qF` fallback and treat `jq` exit >= 2 as a
  parse warning, matching the canonical `has_userconfig()` semantics.
- Dual-source drift (userConfig set AND shell env set to different values):
  shell env wins for command invocations; classification stays READY, no
  warning needed at dashboard level (delegated `/devin:setup` handles it).
- Validator hard-fails on missing markers: acceptable because markers and
  checks land atomically; in-flight branches that touch all.md will need a
  rebase + marker adoption, called out in the PR description.
- WSL2 CRLF: any new `.sh` content and edited files normalized with
  `sed -i 's/\r$//'` before commit; all files LF.

<!-- deepen-plan: external -->
> **Research:** Platform edge cases for the userConfig detection (task 2.3):
> on macOS, sensitive values live in the system keychain — undetectable by
> any file grep, so a keychain-stored credential will read "not set" at
> dashboard level (document this limitation; `/devin:setup` remains the
> authoritative check). On macOS v2.1.150 there is also a live persistence
> bug (anthropics/claude-code#62442) where sensitive userConfig is not saved
> at all — do not build logic assuming durable storage. Keychain storage
> shares an ~2 KB total limit with OAuth tokens per the official docs.
<!-- /deepen-plan -->

## Out of Scope (explicit)

- Full userConfig support in the 8 yellow-devin commands, and/or a
  yellow-devin SessionStart hook + credential-status.json — follow-up issue
  to file at PR time (option (b)/(c) from planning; deferred by decision).
- Semantic parsing of classification-block prose or a classification DSL —
  YAGNI; the blocks are LLM-executed instructions, intentionally free-form.
- Dependency-name substring checks in classification blocks ("maximal"
  validator tier) — declined during planning.
- `validate-doc-counts.js` per-plugin count coverage — unrelated gap.

## References

- `plugins/yellow-core/commands/setup/all.md` (all line refs above)
- `scripts/validate-setup-all.js`
- `plugins/yellow-core/references/setup-all/credential-status-and-version-drift.md`
- `plugins/yellow-devin/commands/devin/setup.md:40-96` (has_userconfig +
  dual-source warning text)
- `docs/solutions/code-quality/setup-classification-probe-coupling.md`
- `docs/solutions/code-quality/bash-block-subshell-isolation-in-command-files.md`
- `docs/solutions/integration-issues/mcp-bundled-server-tool-naming-and-plugin-authoring-patterns.md`
- `docs/solutions/code-quality/stale-plan-docs-committed-after-implementation.md`
- `tests/integration/validate-solutions.test.ts` (test template)
- `docs/brainstorms/2026-03-04-setup-all-command-brainstorm.md`,
  `docs/brainstorms/2026-05-06-ceramic-setup-all-coverage-audit-brainstorm.md`
- Git archaeology: PR #580 (chatprd removal, source of bug 1), PR #328
  (council addition, source of bug 2), PR #514 (credential-status
  classification), PR #605 (progressive-disclosure split of Steps 1.6/1.7)

<!-- deepen-plan: external -->
> **Research:** External sources for the userConfig storage model (Phase 1):
> official plugins reference https://code.claude.com/docs/en/plugins-reference
> (storage split, `sensitive` semantics, `CLAUDE_PLUGIN_OPTION_<KEY>` export
> surface); decompiled `utils/plugins/pluginOptionsStorage.ts` at
> https://github.com/antonoly/claude-code-anymodel/blob/main/utils/plugins/pluginOptionsStorage.ts
> (mirror: https://github.com/leaf-kit/claude-analysis/blob/main/src/utils/plugins/pluginOptionsStorage.ts)
> — `savePluginOptions` scrubs sensitive keys from settings.json; storage key
> is `"<name>@<marketplace>"`; keychain read via
> `security find-generic-password` (memoized, ~50-100ms). Live bugs:
> anthropics/claude-code#62442 (sensitive userConfig not persisted, macOS
> v2.1.150), #39455 (prompt not shown on enable), #65959 (`--plugin-dir`
> Configure-options regression), #47955 (Linux libsecret declined — Linux
> stays file-based `.credentials.json`).
<!-- /deepen-plan -->
