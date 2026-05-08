# Feature: Roll back `userConfigEntry.pattern` and document skill-budget workaround

## Problem Statement

`claude doctor` on a fresh install of the yellow-plugins marketplace surfaces
two issues:

1. **P0 install blocker** — `yellow-composio@1.2.1` is rejected with
   `Validation errors: userConfig.composio_mcp_url: Unrecognized key: "pattern"`.
   Per the official Claude Code docs (`code.claude.com/docs/en/plugins-reference`)
   the canonical `userConfig` entry shape is `{type, title, description,
   sensitive, required, default, multiple, min, max}` — `pattern` is NOT in
   the schema. PR #409 (2026-05-06) added `pattern` as a non-standard local
   extension; the schema description and solutions doc explicitly noted
   "remote-validator support is empirically untested." Empirically confirmed
   unsupported now: only `yellow-composio` uses it; no other plugin is
   affected.

2. **P2 skill-listing warning** — `/doctor` reports "157 descriptions dropped
   (4.9%/1% of context)". The Claude Code skill description budget is 1% of
   context (with an 8000-char fallback). Per the official skills reference,
   each skill's combined `description` + `when_to_use` is capped at 1,536
   characters in the listing. Yellow-plugins' longest description is 688 chars
   — well under the cap. **This is a user-side budget allocation issue, not
   an authoring problem.** No description trimming is warranted.

## Linear Issues

(none — no Linear issue tracker integration on this work)

## Current State

### `pattern` field surface (Issue 1)

| Layer | File | Lines |
|---|---|---|
| Plugin manifest (only consumer) | `plugins/yellow-composio/.claude-plugin/plugin.json` | `composio_mcp_url.pattern` block |
| Schema | `schemas/plugin.schema.json` | L31–34 (property def), L60–63 (type-gate `if/then`) |
| Validator | `scripts/validate-plugin.js` | L79–82 (PATTERN_ALLOWED_TYPES const), L919–1003 (RULE 10) |
| Tests A | `tests/integration/validate-plugin.test.ts` | L647–916 (PR-B describe, 14 it cases) |
| Tests B | `tests/integration/example-files-schema.test.ts` | L176–310 (PR-C describe, channels propagation + AJV pin) |
| Fixture | `examples/plugin-extended.example.json` | L59 (`"pattern": "^https://"`) |
| Solutions doc | `docs/solutions/build-errors/userconfig-pattern-field-schema-extension.md` | full file |
| Memory | `~/.claude/projects/.../memory/MEMORY.md` | L92 (Plugin Manifest Validation entry) |

### Security context

The `pattern` was added in PR #409 to enforce `^https://` on
`composio_mcp_url`, motivated by PR #396's reviewer concern: a non-TLS URL
would leak the `composio_api_key` (`sensitive: true`, keychain-backed) in
cleartext via the `X-API-Key` header. The schema-layer regex was a defense
at install/userConfig-prompt time. **Removing it reverts to the pre-PR409
baseline** — the same state in which yellow-composio shipped in PR #396 and
worked for ~2 days. We are not introducing a new risk; we are removing a
non-standard mitigation that the remote validator forbids us to ship.

The MCP server starts on plugin load, before any command runs; a runtime
prose check in `/composio:setup` would be post-hoc (advisory only). The
honest framing is: **format validation moves from schema-layer to
documentation-layer, with a SessionStart hook as a best-effort defense.**

### Skill-budget surface (Issue 2)

5 yellow-core SKILL.md descriptions are 500–688 chars (compound-lifecycle
688, ideation 666, optimize 615, debugging 520, session-history 518). All
are well under the 1,536-char official cap. The user-visible warning fires
because the marketplace ships 37 skills + adjacent plugins push aggregate
listing over the default 1%/8000-char budget. The fix is documenting the
user-side knobs (`skillListingBudgetFraction`, `SLASH_COMMAND_TOOL_CHAR_BUDGET`,
`/skills`-disable, `skillOverrides: name-only`) — not editing skill files.

## Proposed Solution

Four PRs, decoupled by risk:

### PR1 (P0 hotfix, ships today, unblocks install)

Smallest possible change to make `yellow-composio` installable:

- **Strip** `"pattern"` from `plugins/yellow-composio/.claude-plugin/plugin.json`
  `composio_mcp_url` block. Leave all other userConfig fields untouched.
- **Add SessionStart hook** at `plugins/yellow-composio/hooks/check-mcp-url.sh`
  that reads `CLAUDE_PLUGIN_OPTION_COMPOSIO_MCP_URL` env var and emits a
  `systemMessage` warning if non-HTTPS (cannot block MCP load — that is
  Claude Code's responsibility — but surfaces the risk to the user before
  any command runs). Wire via `plugin.json` `hooks.SessionStart`. Follow
  CLAUDE.md hook conventions: `set -uo pipefail` (drop `-e`), `json_exit`
  helper, `{"continue": true}` on all paths, jq fallback fail-closed,
  CRLF-strip after Write.
- **Update** `plugins/yellow-composio/skills/composio-patterns/SKILL.md`
  Security section: explicitly state the URL format constraint is advisory
  (no schema enforcement); recommend `https://mcp.composio.dev/*` only.
- **Update** `plugins/yellow-composio/.claude-plugin/plugin.json`
  `composio_api_key.description`: append "format validation is not enforced;
  invalid keys produce a 401 at runtime" (prevents future `pattern`
  re-introduction PRs for the API key).
- **Changeset** patch-bump for yellow-composio.
- **Manual install probe before merge** — `gh pr checkout` on a clean WSL
  session, run `claude doctor` to confirm `yellow-composio` no longer
  produces the "Unrecognized key" error.

### PR2 (Close ecosystem drift, sibling — no plugin files)

Removes the schema/validator/test surface so future plugins cannot
re-introduce the rejected key:

- **Schema** `schemas/plugin.schema.json`: remove L31–34 (`pattern` property
  def) and L60–63 (`if/then` type-gate). The same definition is referenced
  by both top-level `userConfig` and `channels[].userConfig` (`$ref`); a
  single removal cascades to both.
- **Validator** `scripts/validate-plugin.js`: remove L79–82
  (`PATTERN_ALLOWED_TYPES` const) + L919–1003 (RULE 10 enforcement).
- **Tests A** delete `tests/integration/validate-plugin.test.ts` L647–916
  (PR-B describe block).
- **Tests B** delete `tests/integration/example-files-schema.test.ts`
  L176–310 (PR-C describe block — channels propagation + AJV pin).
  *This file was missed in the original research; SpecFlow caught it.*
- **Fixture** `examples/plugin-extended.example.json` L59: remove
  `"pattern": "^https://"`.
- **Solutions doc** `docs/solutions/build-errors/userconfig-pattern-field-schema-extension.md`:
  add `status: reverted` to frontmatter and prepend a `## Outcome` section
  at the top: "Empirically rejected by Claude Code's remote validator
  (`/doctor` 'Unrecognized key' on install). Field reverted in
  yellow-composio@<bump>; schema/validator/tests removed in PR #<n>. The
  remote validator's official `userConfig` schema does not include
  `pattern`. Do not re-attempt." Keep the file in place (do NOT archive) —
  the "we tried this and it failed" narrative is the highest-signal part.
- **MEMORY.md** L92: replace with a one-liner pointing to the solutions
  doc's `## Outcome` section + the date the rollback shipped.
- **No changeset required** (no `plugins/**` files touched). Verify the CI
  changeset gate is satisfied; explicitly note the absence in PR description.

### PR3 (CI hardening, P1, sibling — single-plugin probe first)

Reduces probability of repeating this drift:

- **Phase 3a (probe):** Add `"$schema": "https://json.schemastore.org/claude-code-plugin-manifest.json"`
  to ONE plugin's `plugin.json` — pick `yellow-core` (most-watched). Patch-bump,
  ship as a changeset PR. Manually `claude doctor`-probe on fresh install. If
  remote validator silently ignores it (per docs: "Claude Code ignores this
  field at load time"), proceed to 3b.
- **Phase 3b (rollout):** Add `$schema` to the remaining 17 plugin.json files.
  Single bulk PR with 17 patch bumps. Bypass-skip if 3a probe fails — record
  outcome in MEMORY.md.
- **Phase 3c (CI gate):** Add `claude plugin validate` step to
  `.github/workflows/validate-schemas.yml`. Requires Claude Code CLI in CI —
  evaluate install cost; likely a `claude-code-cli` action or
  `npm i -g @anthropic-ai/claude-code` step (~10–30s). If too heavy, scope to
  PR-only path (skip on main).
- **Phase 3d (docs):** Update `CONTRIBUTING.md` with:
  - Local-vs-remote validator divergence callout (link to userconfig-pattern doc)
  - `claude --plugin-url <artifact>` recipe for staging tests
  - "Test on fresh install before publishing breaking schema changes" remains
    the only authoritative gate.

### PR4 (Issue 2 docs, P2, no rush)

Documents the user-side workaround for the skill-budget warning:

- **README.md**: add a "Skill listing budget" section under
  `## Troubleshooting` (create if absent) explaining the 1%/8000-char default,
  the three knobs (`skillListingBudgetFraction` setting,
  `SLASH_COMMAND_TOOL_CHAR_BUDGET` env, `/skills` disable,
  `skillOverrides: name-only`), and when to use each.
- **CONTRIBUTING.md**: link to the README section from any "your skill
  isn't appearing" troubleshooting note.
- **NO** SKILL.md description trimming. All current descriptions are well
  under the 1,536-char official cap.

## Implementation Plan

### Phase 1: PR1 hotfix (ship today)

- [ ] 1.1: `gt branch create fix/yellow-composio-strip-userconfig-pattern`
- [ ] 1.2: Edit `plugins/yellow-composio/.claude-plugin/plugin.json` — remove
  `pattern` line; append api_key description note
- [ ] 1.3: Create `plugins/yellow-composio/hooks/check-mcp-url.sh`
  (SessionStart hook, advisory warning on non-HTTPS); wire in `plugin.json`
  `hooks.SessionStart`. CRLF-strip via `sed -i 's/\r$//'`.
- [ ] 1.4: Edit `plugins/yellow-composio/skills/composio-patterns/SKILL.md`
  Security section
- [ ] 1.5: `pnpm validate:schemas && pnpm validate:plugins` — confirm green
- [ ] 1.6: `pnpm changeset` — patch bump yellow-composio with summary
- [ ] 1.7: `gt commit create -m "fix(yellow-composio): strip non-standard
  userConfig.pattern; remote validator rejects it"`
- [ ] 1.8: `gt stack submit`
- [ ] 1.9: Manual install probe — `claude doctor` on fresh install confirms
  `yellow-composio` loads cleanly. Record outcome in PR description.

### Phase 2: PR2 ecosystem drift removal (sibling on main)

- [ ] 2.1: `gt branch create chore/remove-userconfig-pattern-schema`
- [ ] 2.2: Edit `schemas/plugin.schema.json` — remove L31–34 + L60–63
- [ ] 2.3: Edit `scripts/validate-plugin.js` — remove L79–82 + L919–1003
- [ ] 2.4: Delete `tests/integration/validate-plugin.test.ts` L647–916
- [ ] 2.5: Delete `tests/integration/example-files-schema.test.ts` L176–310
- [ ] 2.6: Edit `examples/plugin-extended.example.json` — remove L59
- [ ] 2.7: Edit `docs/solutions/build-errors/userconfig-pattern-field-schema-extension.md`
  — frontmatter `status: reverted` + prepend `## Outcome` section
- [ ] 2.8: Update MEMORY.md L92 entry → one-line pointer
- [ ] 2.9: `pnpm validate:schemas && pnpm test:unit && pnpm test:integration
  && pnpm lint && pnpm typecheck` all green
- [ ] 2.10: Confirm no `.changeset/*.md` required; note absence in PR body
- [ ] 2.11: `gt commit create -m "chore: remove userConfig.pattern schema +
  validator + tests (remote validator rejects)"`
- [ ] 2.12: `gt stack submit`

### Phase 3: PR3 CI hardening (sibling, P1)

- [ ] 3a.1: `gt branch create feat/plugin-json-schema-pointer-probe`
- [ ] 3a.2: Add `$schema` to `plugins/yellow-core/.claude-plugin/plugin.json`
- [ ] 3a.3: Changeset patch-bump yellow-core, commit, submit
- [ ] 3a.4: Manual install probe on merge — `claude doctor` clean?
- [ ] 3a.5: GATE — proceed to 3b only on probe success
- [ ] 3b.1: `gt branch create feat/plugin-json-schema-pointer-rollout`
- [ ] 3b.2: Add `$schema` to remaining 17 plugin.json files
- [ ] 3b.3: Bulk changeset (17 patches), commit, submit
- [ ] 3c.1: `gt branch create feat/ci-claude-plugin-validate`
- [ ] 3c.2: Add `claude plugin validate` job to validate-schemas.yml
- [ ] 3c.3: Time the CI run delta; gate on PR-only if >60s
- [ ] 3d.1: Update CONTRIBUTING.md with local/remote divergence + probe recipe

### Phase 4: PR4 skill-budget docs (P2, no urgency)

- [ ] 4.1: `gt branch create docs/skill-listing-budget-troubleshooting`
- [ ] 4.2: Add `## Troubleshooting > Skill listing budget` to README.md
- [ ] 4.3: Cross-link from CONTRIBUTING.md
- [ ] 4.4: NO skill description changes; verify with `git status`
- [ ] 4.5: No changeset required (no `plugins/**` touched)
- [ ] 4.6: Commit + submit

## Technical Specifications

### Files to Modify

- `plugins/yellow-composio/.claude-plugin/plugin.json` — strip `pattern`,
  amend api_key description, add SessionStart hook
- `plugins/yellow-composio/skills/composio-patterns/SKILL.md` — Security
  section advisory note
- `schemas/plugin.schema.json` — remove `pattern` def + type-gate
- `scripts/validate-plugin.js` — remove RULE 10 + constant
- `tests/integration/validate-plugin.test.ts` — remove PR-B describe
- `tests/integration/example-files-schema.test.ts` — remove PR-C describe
- `examples/plugin-extended.example.json` — remove pattern line
- `docs/solutions/build-errors/userconfig-pattern-field-schema-extension.md`
  — outcome section + status frontmatter
- All 18 `plugins/*/.claude-plugin/plugin.json` — `$schema` pointer (PR3)
- `.github/workflows/validate-schemas.yml` — `claude plugin validate` step
- `README.md` — skill budget troubleshooting section
- `CONTRIBUTING.md` — local/remote divergence + probe recipe
- `MEMORY.md` — L92 entry update

### Files to Create

- `plugins/yellow-composio/hooks/check-mcp-url.sh` — SessionStart advisory hook

### Dependencies

None. `claude` CLI in CI is the only new tooling concern (PR3c).

## Acceptance Criteria

1. `claude doctor` on a fresh install of `KingInYellows/yellow-plugins`
   marketplace shows zero plugin errors. Verify with `gh pr checkout` on
   PR1 + manual install.
2. `pnpm validate:schemas && pnpm test:unit && pnpm test:integration &&
   pnpm lint && pnpm typecheck` stay green at every PR boundary.
3. No file under `plugins/yellow-composio/` references the schema-level
   `pattern` mechanism after PR1; SessionStart hook produces a visible
   warning when `CLAUDE_PLUGIN_OPTION_COMPOSIO_MCP_URL` is non-HTTPS.
4. Solutions doc reads top-down as: "We tried `pattern`. Remote validator
   rejected it. Reverted on `<date>`. Do not re-attempt."
5. README "Skill listing budget" section gives a copy-pasteable
   `~/.claude/settings.json` snippet for raising the budget.
6. `$schema` pointer survives `claude doctor` on yellow-core probe; if it
   does not, PR3b/3c are aborted and the outcome is recorded in
   MEMORY.md.

## Edge Cases & Error Handling

- **MCP starts before SessionStart hook fires** — confirmed risk. SessionStart
  hook is a *warning surface*, not a *block*. Document this honestly in
  PR1's PR description and SKILL.md security section.
- **Channels-level userConfig** — `$ref` in schema means removing top-level
  `pattern` cascades. Verify with `pnpm test:integration` after PR2.
- **`$schema` rejected by remote validator** — gate PR3b/3c on PR3a probe
  outcome. If the remote validator treats `$schema` like it treated
  `pattern`, PR3a creates 1 plugin with the same install error; the
  changeset must be reverted before merging.
- **Backwards compatibility for already-installed users** — Claude Code has
  `/plugin marketplace update` as the manual refresh path (per CLAUDE.md
  known issue + GH #26744). PR1's PR description should include a
  "Existing installs: run `/plugin marketplace update`" callout.
- **Stale memory file** — if other memory files under
  `~/.claude/projects/.../memory/` reference `pattern`, grep and update
  in PR2 step 2.8. Single source of truth: MEMORY.md L92.

## Testing Strategy

- **Unit/integration:** PR2 validates that removing the schema property
  does not break any other test (`pnpm test:integration` must pass after
  the deletions). The deletion is symmetric — schema removal + test
  removal land together.
- **Manual install probe:** PR1 cannot ship without a fresh-install
  `claude doctor` run. Record the doctor output in the PR description as
  evidence.
- **CI smoke (PR3c):** Once `claude plugin validate` is in CI, every
  future PR touching `plugin.json` runs through the official local
  validator before merge — closes the gap that allowed PR409 to ship.

## Performance Considerations

CI runtime impact: PR3c adds `claude plugin validate` (estimated 5–15s
per plugin, 18 plugins → ~2–4 min sequential, ~30s parallelized).
Acceptable for PR-trigger; gate to PR-only if push-to-main becomes slow.

## Security Considerations

The original threat model (PR #396 → PR #409) was: user pastes non-HTTPS
URL → Composio MCP server uses URL → `X-API-Key` header sent in cleartext.
Mitigations after PR1:

- **Defense 1 (advisory):** SessionStart hook warns user on non-HTTPS at
  every session start. User-visible, not preventive.
- **Defense 2 (documentation):** SKILL.md and `composio_mcp_url.description`
  prose explicitly state HTTPS-only requirement.
- **Defense 3 (Composio dashboard):** Composio's own API endpoint discovery
  documentation only ever produces `https://mcp.composio.dev/*` URLs. A
  user pasting `http://` is doing so against documented guidance.

This is the same defensive posture as pre-PR409 (PR #396 baseline). No
regression is being introduced; a non-standard schema-level mitigation is
being removed because the remote validator rejects it.

## Migration & Rollback

PR1 is itself a rollback. If PR1 breaks something else, revert the commit;
yellow-composio remains at the broken-install version, but no other plugin
is affected. PR2 is independently revertible (schema + test deletion is
reversible from git history). PR3a/b is gated on probe; PR3c is independent
of PR3a/b.

## References

- Original schema extension plan: `plans/userconfig-pattern-enforcement.md`
- Solutions doc to update: `docs/solutions/build-errors/userconfig-pattern-field-schema-extension.md`
- Pre-existing two-validator drift doc: `docs/solutions/build-errors/userconfig-type-title-remote-validator-drift.md`
- Pre-existing changelog drift doc: `docs/solutions/build-errors/plugin-json-changelog-key-schema-drift-remote-validator.md`
- Official plugins reference: `https://code.claude.com/docs/en/plugins-reference`
- Official skills reference: `https://code.claude.com/docs/en/skills`
- JSON Schema for plugin.json: `https://json.schemastore.org/claude-code-plugin-manifest.json`
- PR that introduced pattern: PR #409 (`d49ce331`)
- PR that motivated pattern: PR #396 (`cd2aa523`)

<!-- stack-topology: linear -->
<!-- stack-trunk: main -->

## Stack Decomposition

### 1. agent/fix/yellow-composio-strip-userconfig-pattern
- **Type:** fix
- **Description:** strip non-standard userConfig.pattern from yellow-composio (remote validator rejects)
- **Scope:** plugins/yellow-composio/.claude-plugin/plugin.json, plugins/yellow-composio/hooks/check-mcp-url.sh, plugins/yellow-composio/skills/composio-patterns/SKILL.md, .changeset/
- **Tasks:** 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9
- **Depends on:** (none)
- **Linear:** (none)

### 2. agent/chore/remove-userconfig-pattern-schema
- **Type:** chore
- **Description:** remove userConfig.pattern schema, RULE 10, both PR-B/PR-C test blocks, fixture, and update solutions doc + MEMORY.md
- **Scope:** schemas/plugin.schema.json, scripts/validate-plugin.js, tests/integration/validate-plugin.test.ts, tests/integration/example-files-schema.test.ts, examples/plugin-extended.example.json, docs/solutions/build-errors/userconfig-pattern-field-schema-extension.md, MEMORY.md
- **Tasks:** 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 2.12
- **Depends on:** #1
- **Linear:** (none)

### 3. agent/docs/skill-listing-budget-troubleshooting
- **Type:** docs
- **Description:** document skill-listing budget knobs (skillListingBudgetFraction, SLASH_COMMAND_TOOL_CHAR_BUDGET, /skills disable, skillOverrides name-only) — no description trimming
- **Scope:** README.md, CONTRIBUTING.md
- **Tasks:** 4.1, 4.2, 4.3, 4.4, 4.5, 4.6
- **Depends on:** #2
- **Linear:** (none)

### 4. agent/feat/plugin-json-schema-pointer-probe
- **Type:** feat
- **Description:** add $schema pointer to yellow-core plugin.json (single-plugin probe) — gates rollout in #5
- **Scope:** plugins/yellow-core/.claude-plugin/plugin.json, .changeset/
- **Tasks:** 3a.1, 3a.2, 3a.3, 3a.4, 3a.5
- **Depends on:** #3
- **Linear:** (none)

### 5. agent/feat/plugin-json-schema-rollout-and-ci
- **Type:** feat
- **Description:** add $schema pointer to remaining 17 plugins, wire `claude plugin validate` into CI, document local/remote validator divergence in CONTRIBUTING
- **Scope:** plugins/*/.claude-plugin/plugin.json (17 files), .github/workflows/validate-schemas.yml, CONTRIBUTING.md, .changeset/
- **Tasks:** 3b.1, 3b.2, 3b.3, 3c.1, 3c.2, 3c.3, 3d.1
- **Depends on:** #4
- **Linear:** (none)

