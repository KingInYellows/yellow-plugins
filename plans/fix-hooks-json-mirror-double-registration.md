# Fix: remove `hooks/hooks.json` mirrors that Claude Code now auto-loads

## Problem Statement

On startup, Claude Code 2.1.272 prints one warning per enabled plugin:

```
● yellow-ruvector: hooks.json: unknown key "_comment" ignored
● yellow-ci: hooks.json: unknown key "_comment" ignored
● yellow-morph: hooks.json: unknown key "_comment" ignored
● yellow-debt: hooks.json: unknown key "_comment" ignored
● gt-workflow: hooks.json: unknown key "_comment" ignored
```

(`github-workflow` carries the same file; it only stays quiet because exactly
one stack provider is enabled at a time.)

The warning is the visible symptom. The real defect is that every hook in
these six plugins is registered twice: Claude Code auto-discovers
`plugins/<name>/hooks/hooks.json` **and** loads the inline `hooks` object in
`.claude-plugin/plugin.json`, with no dedup between the two sources. Observed
in this session: `yellow-ruvector`'s SessionStart banner printed twice;
`yellow-core`'s (inline-only, no mirror) printed once. That means
PreToolUse/PostToolUse guards in gt-workflow and github-workflow, and
ruvector's UserPromptSubmit/Stop/PostToolUse hooks, all run twice per event.

Beneficiaries: every marketplace user (cleaner startup, half the hook
overhead) and maintainers (one source of truth for hook config).

## Current State

- Six plugins ship a hand-maintained `hooks/hooks.json` whose `_comment` says
  "REFERENCE ONLY — not loaded by Claude Code". That claim was true in
  Feb 2026 (`docs/solutions/build-errors/claude-code-plugin-manifest-validation-errors.md:138`)
  and is false now: `code.claude.com/docs/en/plugins-reference` documents
  `hooks/hooks.json` as auto-discovered, and the loader warns-and-ignores any
  top-level key other than `hooks` / `description` (behaviour reported from
  ~2.1.267).
- The authoritative hook config is `source.hooks` in
  `catalog/plugins/<name>.json`, emitted into `plugin.json` by
  `pnpm generate:manifests`. The mirrors are **not** generated (hand-edited;
  see `git log -- plugins/*/hooks/hooks.json`).
- `github-workflow`'s mirror has already drifted from its `plugin.json`
  (unquoted vs quoted `${CLAUDE_PLUGIN_ROOT}` in both commands) — the
  maintenance hazard the mirror creates.
- Four plugins already follow the target pattern (inline only, no mirror):
  `yellow-core`, `yellow-composio`, `yellow-research`, `yellow-semgrep`.
- `AGENTS.md:226` already warns against this pattern in prose. Prose did not
  prevent six violations, so this plan also adds an enforced check.
- Nothing consumes the mirrors at runtime except Claude Code's auto-discovery:
  - RULE 7 (`ruleHooksJson`, `scripts/lib/plugin-rules.js:296`) returns early
    when the file is absent.
  - `scripts/lib/generate/emit-codex.js` produces `hooks/codex-hooks.json`
    from `source.hooks` and never reads the mirror. `yellow-ci` and
    `gt-workflow` `.codex-plugin/plugin.json` point at `./hooks/codex-hooks.json`
    — **that file stays**.
  - `validate-generated`, `contract-drift`, `security-audit`,
    `plugin-shell-tests` do not enumerate the mirrors. Vitest tests and the
    characterization snapshot use synthetic fixtures. No packaging list
    (`.npmignore`, `package.json#files`, Cursor/Codex targets) names them.
  - No plugin README/CLAUDE.md mentions `hooks/hooks.json`; the yellow-ruvector
    bats comments mention "the hooks.json watchdog" only as a timeout concept.

## Proposed Solution

1. Delete the six mirrors. Inline `plugin.json` hooks (generated from
   `catalog/`) become the only Claude-side hook source, matching the four
   inline-only plugins.
2. Extend RULE 7 so `pnpm validate:plugins` errors when a plugin has inline
   hooks in `plugin.json` **and** a `hooks/hooks.json` on disk — the
   coexistence itself is now the defect, regardless of drift. Precedent:
   `plans/complete/validate-plugin-js-hooks-file-shape-hardening.md` promoted a
   soft RULE 7 warning to `addError` in the same function.
3. Correct the docs that still call the mirror "reference only / not loaded".

Alternatives rejected:
- Strip `_comment` only — silences the warning, keeps double-firing.
- Replace `_comment` with the documented `description` key — same.
- Make `hooks/hooks.json` authoritative and drop inline hooks from the catalog
  — inverts the generator model (`emit-claude.js` / `emit-codex.js` both read
  `source.hooks`) for no benefit.

## Implementation Plan

### Phase 1: Remove the mirrors

- [x] 1.1 `git rm` the six files:
      `plugins/{yellow-ruvector,yellow-ci,yellow-morph,yellow-debt,gt-workflow,github-workflow}/hooks/hooks.json`.
      Do not touch `plugins/{yellow-ci,gt-workflow}/hooks/codex-hooks.json`.
- [x] 1.2 Confirm nothing dangles:
      `rg -n 'hooks/hooks\.json' plugins/ scripts/ tests/ .github/ schemas/ --glob '!node_modules'`
      should return only the string-pointer anti-pattern references
      (`scripts/lib/plugin-rules.js:213-217`, `tests/integration/validate-plugin*.test.ts`
      fixtures, `schemas/plugin.schema.json:64` example) and `emit-codex.js`
      comments.
- [x] 1.3 Add one changeset, all six plugins at `patch` (precedent:
      `.changeset/remove-yellow-mempalace.md` bumps two packages in one file):
      ```yaml
      ---
      'yellow-ruvector': patch
      'yellow-ci': patch
      'yellow-morph': patch
      'yellow-debt': patch
      'gt-workflow': patch
      'github-workflow': patch
      ---
      fix: remove hooks/hooks.json reference mirrors — Claude Code auto-discovers
      the file, which registered every hook twice and emitted
      `unknown key "_comment" ignored` on startup. Inline plugin.json hooks are
      the only Claude-side source.
      ```
      The patch bump is what invalidates users' `~/.claude/plugins/cache`
      copies; without it existing installs keep the old mirror.

### Phase 2: Enforce the invariant (RULE 7 coexistence guard)

- [x] 2.1 In `scripts/lib/plugin-rules.js` `ruleHooksJson`, after the
      `fs.existsSync` check and before parsing: when `hasInlineHooks` is true,
      `addError(errors, 'hooks/hooks.json: coexists with inline hooks in plugin.json — …')`.
      Keep the parse/shape/per-event checks (they run for hooks-only plugins
      with no inline block and must stay unconditional). Remove the drift
      comparison and its `compareHookInternals` / `compareHookEntries`
      helpers — they were only reachable when inline hooks and the file
      coexisted, which is now the error itself (review finding).
- [x] 2.2 Update the RULE 7 header comment (`plugin-rules.js:292-295`) to say
      coexistence is an error, drift is a warning kept for the
      hooks-only → inline migration case.
- [x] 2.3 Add a test in `tests/integration/validate-plugin.test.ts` next to the
      RULE 7 block (~line 465): valid `hooks/hooks.json` + inline `hooks` in
      the manifest → non-zero status and the coexistence message in stderr.
      Add a sibling asserting a hooks-only plugin (no inline `hooks`) with a
      valid `hooks/hooks.json` still passes.
- [x] 2.4 Existing tests that pair a malformed `hooks/hooks.json` with inline
      hooks (`validate-plugin.test.ts:576`, characterization `:166`) already
      expect failure; check their stderr assertions still match and refresh
      `tests/integration/__snapshots__/validate-plugin-characterization.test.ts.snap`
      with `pnpm vitest run tests/integration/validate-plugin-characterization.test.ts -u`
      only if the error array for that fixture legitimately gains the new line.
- [x] 2.5 Document the rule: add a bullet under the hooks guidance in
      `AGENTS.md:224-227` ("Never ship `hooks/hooks.json` alongside inline
      hooks — RULE 7 errors on it") and mention the new error in
      `docs/plugin-validation-guide.md` RULE 7 description (~line 226).

### Phase 3: Docs and verification

- [x] 3.1 `docs/security.md:213` — "Check `hooks.json` for hook configuration"
      → "Check the `hooks` block in `.claude-plugin/plugin.json` (generated
      from `catalog/`)".
- [x] 3.2 Append a dated `## Update — 2026-09-15` section to
      `docs/solutions/build-errors/claude-code-plugin-manifest-validation-errors.md`
      (repo convention: append, don't rewrite) stating the "can remain for
      reference, not loaded" guidance is superseded — Claude Code auto-loads
      `hooks/hooks.json`, mirrors were deleted, RULE 7 now blocks coexistence.
      Link the July update in `ci-schema-drift-hooks-inline-vs-string.md`.
- [x] 3.3 Optional, one line each: `AUDIT_REPORT.md:142` (H-04 resolved) and
      `docs/optimization/analysis.md:158` (citation now historical). Skip if
      those snapshot docs are treated as frozen.
- [x] 3.4 Run the targeted gates: `pnpm validate:plugins`,
      `pnpm validate:schemas`, `pnpm test:integration`, `pnpm lint`,
      `pnpm typecheck`. `validate:generated` is unaffected (mirrors are not
      catalog-sourced) — confirm it still passes.
- [ ] 3.5 Live verification on the enabled stack provider only (gt-workflow
      or github-workflow — never both): reinstall the marketplace, then
      `claude plugin validate plugins/<name>` for the six plugins, start a
      session and confirm (a) zero `unknown key` warnings, (b) the
      `🧠 RuVector Intelligence Layer Active` banner appears once, (c) one
      PreToolUse-gated `git push` attempt runs the gt-workflow/github-workflow
      guard once (add a temporary `echo >> /tmp/guard.log` or watch `set -x`
      output rather than eyeballing).

## Technical Details

Files to delete:
- `plugins/yellow-ruvector/hooks/hooks.json`
- `plugins/yellow-ci/hooks/hooks.json`
- `plugins/yellow-morph/hooks/hooks.json`
- `plugins/yellow-debt/hooks/hooks.json`
- `plugins/gt-workflow/hooks/hooks.json`
- `plugins/github-workflow/hooks/hooks.json`

Files to modify:
- `scripts/lib/plugin-rules.js` — RULE 7 coexistence `addError`
- `tests/integration/validate-plugin.test.ts` — two new RULE 7 cases
- `tests/integration/__snapshots__/validate-plugin-characterization.test.ts.snap` — only if the fixture error array changes
- `AGENTS.md`, `docs/plugin-validation-guide.md`, `docs/security.md`
- `docs/solutions/build-errors/claude-code-plugin-manifest-validation-errors.md` — appended update
- `.changeset/<slug>.md` — new

Files to leave alone:
- `plugins/{yellow-ci,gt-workflow}/hooks/codex-hooks.json` and `.codex-plugin/plugin.json` (Codex contract, generated)
- `catalog/plugins/*.json`, `.claude-plugin/plugin.json` (already correct; no regeneration needed)
- `scripts/lib/plugin-rules.js:213-217` string-pointer warning (different anti-pattern, still valid)

No new dependencies. No schema change. Cursor distribution unaffected (none of
the six plugins is Cursor-enabled; Cursor packaging does not copy `hooks/`).

## Acceptance Criteria

1. Startup on Claude Code ≥ 2.1.267 with all marketplace plugins installed prints
   no `hooks.json: unknown key` warning. (Verify: fresh install, new session.)
2. `yellow-ruvector`'s SessionStart banner appears exactly once per session;
   the enabled stack provider's PreToolUse guard runs once per gated command.
3. `pnpm validate:plugins` fails with the coexistence error when any plugin
   directory contains both inline `hooks` and `hooks/hooks.json`; passes for
   the current tree; passes for a hooks-only fixture.
4. `pnpm validate:schemas && pnpm test:integration && pnpm lint && pnpm typecheck`
   pass; `validate:generated` reports no drift.
5. One changeset bumps all six plugins at `patch`; after `pnpm apply:changesets`
   `pnpm validate:versions` passes (three-way sync incl. `.codex-plugin` for
   yellow-ci / gt-workflow).
6. `rg 'not loaded by Claude Code' docs/ AGENTS.md` returns only the historical
   Feb 2026 text, now followed by the dated update.

## Edge Cases

- **Stale user caches.** Users keep the old mirror until the patch release
  lands and Claude Code refetches; the warning persists for them until then.
  Expected; the changeset is the fix.
- **Hooks-only plugin (no inline block).** Still valid upstream; RULE 7 must
  keep accepting it. The guard keys on `hasInlineHooks`, not on file presence;
  the parse/shape/per-event checks still run for it.
- **`hooks` as a string path in plugin.json.** Already warned at
  `plugin-rules.js:213`; `collectInlineHooks` yields no inline hooks for it, so
  the new guard does not fire — correct, since only one source exists.
- **Prior double-fired side effects.** ruvector's Stop/UserPromptSubmit/PostToolUse
  scripts delegate to `ruvector hooks …` CLI calls; double invocation cost
  time, not repo state. No `.ruvector/` cleanup is in scope.
- **Only one stack provider can be live-tested locally** (`/stack:status`
  must be `READY_GRAPHITE` or `READY_GITHUB`). CI's `plugin-shell-tests`
  covers both plugins' scripts; the live check covers whichever is enabled.
- **Rollback.** `git revert` of the PR restores six static files and the old
  RULE 7 behaviour; no data or format migration.

## References

- Validator: `scripts/lib/plugin-rules.js:292-380` (RULE 7), `scripts/validate-plugin.js:144-148` (call site)
- Tests: `tests/integration/validate-plugin.test.ts:465-640`, `tests/integration/validate-plugin-characterization.test.ts:166`
- Generator hook authority: `scripts/lib/generate/emit-codex.js:16-21`
- Prose rule that was not enforced: `AGENTS.md:226`
- History: `docs/solutions/build-errors/claude-code-plugin-manifest-validation-errors.md`,
  `docs/solutions/build-errors/ci-schema-drift-hooks-inline-vs-string.md` ("Update — 2026-07-16"),
  `plans/complete/validate-plugin-js-hooks-file-shape-hardening.md`,
  `docs/research/claude-code-plugins-versioning-auto-upda.md:108` (already states auto-discovery)
- Upstream: https://code.claude.com/docs/en/plugins-reference, https://code.claude.com/docs/en/hooks,
  anthropics/claude-code#76297 (dedup keyed by plugin root), ScriptedAlchemy/agent-bundle#463 (same fix pattern)
- Changeset precedent: `.changeset/remove-yellow-mempalace.md`, `.changeset/thermonuclear-cross-host.md`
