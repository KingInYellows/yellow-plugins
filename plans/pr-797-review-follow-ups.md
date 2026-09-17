# PR #797 review follow-ups: hooks policy, quoting, ruvector provenance, codex model

## Problem Statement

The `/review:pr` pass on PR #797 (remove `hooks/hooks.json` mirrors) surfaced
four independent defects. None blocks #797; each is a small, self-contained
change in a different subsystem:

1. **RULE 7 carve-out.** `validate-plugin.js` only rejects `hooks/hooks.json`
   when inline hooks coexist. A hooks-only file still passes, which in this
   catalog-generated repo is an un-cataloged hook source: `emit-codex.js`
   never mirrors it, RULE 6/8 script checks never run over it, and
   `generate-manifests --check` cannot see it.
2. **Unquoted `${CLAUDE_PLUGIN_ROOT}`.** 15 of 18 catalog hook commands run
   through `sh -c` with the placeholder unquoted; a plugin-cache path with a
   space word-splits and the hook fails open (PreToolUse guards silently do
   not run). Official guidance: "in shell form, wrap each placeholder in
   double quotes".
3. **ruvector embedder provenance.** The local store is stamped
   `{embedderKind: hash, dimension: 64}` while the active embedder is
   `onnx-minilm/384`; `hooks_remember` is refused (ADR-210) but `hooks_recall`
   still works, so the write loss is silent. Nothing in the plugin detects it.
4. **yellow-codex model default.** Every `codex exec` call hardcodes
   `-m "${CODEX_MODEL:-gpt-5.4}"`; ChatGPT-account auth rejects it with a 400
   (exit 1, not 2), OpenAI now lists gpt-5.4 as legacy, and the exit-1 arm
   only recognises rate limits. Separately, ~12 `mktemp` + plain `>` sites in
   the plugin break under zsh `noclobber` (July's sweep doc listed them).

Beneficiaries: contributors (1, 2 — invariants enforced, not prose),
every marketplace user on macOS/Windows paths with spaces (2), anyone
running yellow-ruvector past the ONNX default switch (3), ChatGPT-plan Codex
users (4).

## Current State

- `scripts/lib/plugin-rules.js:232` `ruleHooksJson(pluginDir, hasInlineHooks, errors)`
  — coexistence error only; parse/shape/per-event checks still run for
  hooks-only files. RULE 6's string-pointer warning (`:211-222`) is dead:
  `schemas/plugin.schema.json` allows only `inlineHooks`.
- No generator emits `hooks/hooks.json`; `generate-manifests.js:917` registers
  only `hooks/codex-hooks.json` as a stale-artifact candidate.
- `scripts/lib/plugin-paths.js:52-60` `resolveHookScriptPath` matches
  `^bash\s+` only — `node` hook commands (gt-workflow, github-workflow,
  yellow-ci) get no path/containment check at all.
- Catalog quoting: unquoted at `catalog/plugins/{gt-workflow:33,45, yellow-ci:25,
  yellow-composio:50, yellow-core:26,38, yellow-debt:23, yellow-morph:45,
  yellow-research:99, yellow-ruvector:40,52,64,76,88, yellow-semgrep:43}.json`;
  quoted at `github-workflow:28,40`, `yellow-core:50`.
- `.ruvector/intelligence.json` carries `embeddingProvenance`; `ruvector hooks
  doctor` does not compare it to the active embedder; `npx -y ruvector@0.2.34
  hooks reembed --dry-run` prints JSON `{wouldReembed, targetProvenance}`
  (541 pending locally). `/ruvector:status` only calls `hooks_stats`.
  `RUVECTOR_EMBEDDER` is not set anywhere in the plugin.
- yellow-codex: `-m "${CODEX_MODEL:-gpt-5.4}"` at `agents/review/codex-reviewer.md:348,~419`,
  `agents/research/codex-analyst.md:92`, `agents/workflow/codex-executor.md:88`,
  `commands/codex/rescue.md:144,165`, `commands/codex/review.md:234,520`,
  `skills/codex-patterns/SKILL.md:56,115,131`; `commands/codex/setup.md:197`
  hardcodes `-m gpt-5.4-mini`; model table at `SKILL.md:178-182`; `CLAUDE.md:101-105,135`.
  Verified 2026-09-16: `codex exec` with no `-m` resolves `gpt-6-astra` and
  succeeds under ChatGPT auth on codex-cli 0.153.3.
- Noclobber sites (no `>|` anywhere in the plugin): `codex-executor.md:90`,
  `codex-analyst.md:94`, `review.md:171,173`, `codex-reviewer.md:181,260,349,420,911`,
  `codex-patterns/SKILL.md:40`, `setup.md:197`, `rescue.md:~144`. These are
  inline fenced snippets the agent runs in its own shell (zsh here), so the
  fix applies to all of them.

## Proposed Solution

Four workstreams, each its own PR. WS1 stacks on `agent/fix/remove-hooks-json-mirrors`
(#797) because it edits the function #797 introduced; WS2–WS4 branch from
`main` in parallel. WS2 and WS3 both bump `yellow-ruvector` — land WS2 first
and rebase WS3, or merge their changesets if they land together.

- **WS1** — RULE 7 errors on any `hooks/hooks.json`; one message, "delete the
  file; hook config lives in `catalog/`". Drop the now-pointless shape
  checks, retire the hooks-only tests, delete the dead RULE 6 string branch,
  register the path as a stale-artifact candidate so `--check` catches it too.
- **WS2** — quote the placeholder in all 15 commands, regenerate, add a RULE 6
  warning for unquoted `${CLAUDE_PLUGIN_ROOT}`, extend `resolveHookScriptPath`
  to `node` commands (closes the containment gap), regression fixture with a
  space in the path. Shell form kept over exec form: exec form is a catalog
  schema change and `emit-codex.js`'s entrypoint rewrite assumes a string.
- **WS3** — (a) one-time local reembed runbook (not a PR); (b) SessionStart
  cheap check + `/ruvector:status` definitive check with remediation; (c)
  `docs/solutions/` entry for the ADR-210 refusal.
- **WS4** — omit `-m` unless `CODEX_MODEL` is set; keep an explicit
  non-legacy mini model only for the setup smoke test; exit-1 arm recognises
  model rejection; `>|`/`2>|` sweep; output contract unchanged.

## Implementation Plan

### WS1: RULE 7 — hook config only from catalog/ (stack on #797)

- [x] 1.1 `scripts/lib/plugin-rules.js` `ruleHooksJson`: if the file exists,
      `addError` unconditionally — `hooks/hooks.json: not allowed — Claude Code
      auto-loads it as a second hook source; hook config lives in
      catalog/plugins/<name>.json#hooks and is generated into plugin.json.
      Delete this file (and codex-hooks.json is generated, never hand-written).`
      Remove the parse/shape/per-event branches (nothing left to validate
      once presence is fatal). Signature becomes `ruleHooksJson(pluginDir, errors)`;
      update the call site in `scripts/validate-plugin.js:148` and drop the
      now-unused `hasInlineHooks` plumbing only if nothing else uses it
      (RULE 6 still does — keep it there).
- [x] 1.2 Delete the RULE 6 string-pointer branch (`plugin-rules.js:211-222`)
      and its test `validate-plugin.test.ts:190` ("warns on hooks-string
      anti-pattern"); the schema already rejects string `hooks`, so the branch
      is unreachable when `validate:schemas` runs — say "unreachable under the
      schema gate", not "dead", in the changeset.
- [x] 1.3 Tests: replace `validate-plugin.test.ts:465` (coexistence),
      `:573`, `:634`, `:652` (hooks-only trio) with two cases — file present
      with inline hooks → error; file present without inline hooks → same
      error — and keep the parse-failure/`null`/events-at-top-level cases only
      if they still add signal (they now all produce the single presence
      error; collapse to one). Update the characterization fixture
      `validate-plugin-characterization.test.ts:165` (`bad-hooks-json`) and
      refresh its snapshot with `pnpm vitest run tests/integration/validate-plugin-characterization.test.ts -u`.
- [x] 1.4 `scripts/generate-manifests.js` (~917): add
      `join(pluginRoot, 'hooks', 'hooks.json')` to the stale-artifact sweep so
      `pnpm validate:generated` also fails on a reintroduced file. Add a case to
      `tests/integration/generate-manifests-codex.test.ts` next to the R20
      decoy test (`:537`) asserting `--check` reports it.
- [x] 1.5 Docs: `AGENTS.md:220-232` (drop "also run for hooks-only plugins";
      state the file is forbidden), `docs/plugin-validation-guide.md:224-230`,
      `docs/plugin-template.md:196-199` (say the file must not exist, not just
      that the path form is rejected), `CONTRIBUTING.md:461,491` wording.
- [x] 1.6 Changeset: none needed for plugins (validator + docs only) — confirm
      `changeset-check` accepts a no-plugin-change PR, else add an empty
      changeset (`pnpm changeset --empty`).

### WS2: quote `${CLAUDE_PLUGIN_ROOT}` in catalog hook commands

- [x] 2.1 Edit the 15 catalog commands to `bash "${CLAUDE_PLUGIN_ROOT}/…"` /
      `node "${CLAUDE_PLUGIN_ROOT}/…"` (match `github-workflow.json:28`).
      `pnpm generate:manifests`; confirm `hooks/codex-hooks.json` for yellow-ci
      and gt-workflow regenerate with the quoted form and the
      `entrypoint-codex.js` rewrite intact.
      *(landed on PR #799, branch `agent/fix/quote-plugin-root-hook-commands`,
      stacked on #797 — not present in this branch's own catalog.)*
- [x] 2.2 `scripts/lib/plugin-paths.js` `resolveHookScriptPath`: accept
      `^(bash|node)\s+` so `node` commands get the same existence and
      containment checks; keep the bash-only `set -e`/decision-output content
      checks in `validateHookScriptPath` gated on the interpreter (a `.js`
      entrypoint has no shebang contract). Update `ruleInlineHookScripts`'s
      escape check (`plugin-rules.js:199`) to cover `node` too.
- [x] 2.3 New RULE 6 warning in `ruleInlineHookScripts`: any `command`
      containing `${CLAUDE_PLUGIN_ROOT}` not immediately preceded by `"` →
      `logWarning('hook command has unquoted ${CLAUDE_PLUGIN_ROOT} — word-splits
      on paths with spaces; quote it')`. Warning, not error, so third-party
      catalogs are not broken; the catalog itself will be clean.
- [x] 2.4 Tests in `tests/integration/validate-plugin.test.ts`: (a) quoted
      `node "${CLAUDE_PLUGIN_ROOT}/hooks/x.js"` with a missing file → error;
      (b) a plugin dir created under a temp path containing a space, quoted
      command → passes, unquoted → warning; (c) `node` command escaping the
      plugin dir → error.
- [x] 2.5 Refresh `tests/integration/generate-manifests-characterization.test.ts`
      snapshot (`vitest -u`) — generated `plugin.json` bytes change for nine
      plugins. Run `pnpm validate:generated`, `validate:versions`.
- [x] 2.6 One changeset file listing all nine plugins at `patch`
      (gt-workflow, yellow-ci, yellow-composio, yellow-core, yellow-debt,
      yellow-morph, yellow-research, yellow-ruvector, yellow-semgrep) —
      multi-package single file is the repo convention
      (`.changeset/quote-plugin-root-hook-commands.md` on PR #799, branch
      `agent/fix/quote-plugin-root-hook-commands`; not
      `.changeset/remove-hooks-json-mirrors.md`, which is the separate WS1
      changeset for six other plugins, including `github-workflow`).
- [x] 2.7 Live check on the enabled provider: run one gated `git push` through
      gt-workflow's PreToolUse and one Edit through yellow-ruvector's; both
      still fire once.

### WS3: ruvector embedder provenance

- [x] 3.1 Local runbook (no PR; do first, in a session with no other ruvector
      writes pending): `npx -y --ignore-scripts ruvector@0.2.34 hooks reembed --dry-run`
      (541 at planning time; actual dry-run reported 754), then `… hooks
      reembed`, confirm the JSON `targetProvenance` is `onnx-minilm/384`,
      then **restart Claude Code** (the running MCP server holds the
      pre-reembed snapshot — `seed-solutions.md` Step 5.2). Verify with
      `hooks_remember` + `hooks_recall` round-trip. *(Executed 2026-09-16:
      dry-run 754 → reembed 756 vectors, 0 dropped, stamp now
      onnx-minilm/all-MiniLM-L6-v2/384; pre-reembed copy in the session
      scratchpad. Verified 2026-09-17 in a fresh session: PROVENANCE: OK
      (store and target both onnx-minilm/all-MiniLM-L6-v2/384-dim, 756
      vectors); `hooks_remember` → `hooks_recall` round-trip succeeded, the
      write stored as memory 757 and returned as the top recall hit.)*
- [x] 3.2 `plugins/yellow-ruvector/hooks/scripts/session-start.sh`: cheap
      check inside the 3s budget — if `.ruvector/intelligence.json` exists,
      has `embeddingProvenance`, its `embedderKind` is `hash`, and
      `RUVECTOR_EMBEDDER` is not `hash`, append one line to the systemMessage:
      `[ruvector] store is hash-embedded (64d); the default embedder is
      onnx-minilm — memory writes are refused until you run /ruvector:status`.
      Absent file or absent `embeddingProvenance` → silent (fresh/legacy store,
      not a mismatch). jq only; no model load.
- [x] 3.3 `plugins/yellow-ruvector/commands/ruvector/status.md`: new step —
      run `npx -y --ignore-scripts ruvector@0.2.34 hooks reembed --dry-run`,
      parse `wouldReembed` / `wouldDrop` / `targetProvenance`; compare
      `targetProvenance` (embedderKind, modelId, dimension — all three) with the
      store's `embeddingProvenance`. Report `PROVENANCE: OK` or `MISMATCH
      (store hash/64 → active onnx-minilm/384, 541 vectors pending)` with the
      exact reembed + restart remediation. `wouldReembed > 0` with matching
      stamps = interrupted reembed; report that case explicitly.
- [x] 3.4 Bats: extend `plugins/yellow-ruvector/tests/session-start.bats` with
      fixtures for (hash stamp → warning line), (onnx stamp → no line), (no
      stamp → no line), (`RUVECTOR_EMBEDDER=hash` → no line). Keep under the
      existing per-call timeouts.
- [x] 3.5 `docs/solutions/integration-issues/ruvector-adr210-embedding-provenance-refusal.md`
      — frontmatter per an existing entry (`validate-solutions.js` gates it):
      symptom (refusal text), why recall still works (writes gated, reads
      not), remediation, and the "restart after reembed" trap. Reference
      `skills/memory-query/SKILL.md:114` and `seed-solutions.md` Step 6.
- [x] 3.6 Changeset `yellow-ruvector: patch`; README/CLAUDE.md note for the new
      status output; `pnpm validate:agents && pnpm lint:plugins`.

### WS4: yellow-codex model default, exit-1 diagnostics, noclobber

- [x] 4.1 Replace every `-m "${CODEX_MODEL:-gpt-5.4}"` with
      `${CODEX_MODEL:+-m "$CODEX_MODEL"}` (codex resolves the model from its
      config precedence when `-m` is absent — verified: `gpt-6-astra` under
      ChatGPT auth). Sites: `codex-reviewer.md:348,~419`, `codex-analyst.md:92`,
      `codex-executor.md:88`, `rescue.md:144,165`, `review.md:234,520`,
      `codex-patterns/SKILL.md:56,115,131`. Check each site's array/quoting
      form so the empty expansion does not leave a stray argument.
- [x] 4.2 `commands/codex/setup.md:197` smoke test: keep an explicit cheap
      model but make it overridable and non-legacy —
      `-m "${CODEX_SMOKE_MODEL:-gpt-5.6-luna}"` — and on a 400 `not supported
      … ChatGPT account` retry once with no `-m` before reporting failure, so
      setup passes on both auth types.
- [x] 4.3 `skills/codex-patterns/SKILL.md:178-182` model table + `CLAUDE.md:101-105,135`:
      document "no `-m` by default; `CODEX_MODEL` overrides; gpt-5.4 /
      gpt-5.4-mini are legacy; ChatGPT accounts reject gpt-5.x-codex names";
      link `docs/solutions/integration-issues/codex-cli-exec-review-flags-rejected-0140.md`
      (2026-09-05 update) and append a dated update there.
- [x] 4.4 `codex-reviewer.md:405-414` exit-1 arm: before the generic fallback,
      `grep -q 'not supported when using Codex with a ChatGPT account\|invalid_request_error' "$STDERR_FILE"`
      → `summary=Codex rejected model <name>: set CODEX_MODEL to a model your
      account allows (or unset it to use the account default).` Same
      structured 6-key return; `verdict=UNAVAILABLE`.
- [x] 4.5 Noclobber sweep: change every `mktemp` + same-block `>`/`2>` to
      `>|`/`2>|` at the listed sites. Done-criterion: a direct-site scan
      rather than a line-window grep, since a mktemp-backed variable's
      redirect can land far from its assignment (e.g. `codex-analyst.md`'s
      `STDERR_FILE` mktemp and its later `2>"$STDERR_FILE"`) —
      `rg -n '(^|[^>|])>\s*"?\$[A-Z_]*(FILE|OUT|ERR)' plugins/yellow-codex`
      returns nothing. Append a dated update to
      `docs/solutions/logic-errors/zsh-noclobber-mktemp-stderr-redirect.md`.
- [x] 4.6 Contract check: run `/codex:review` (or the reviewer agent) on a
      small diff before and after; assert the return still has
      `verdict=`, `confidence=`, `summary=`, `fenced_output_path=`,
      `findings_block_begin/end` lines. Changeset `yellow-codex: patch`;
      `pnpm validate:agents && pnpm lint:plugins`.

### WS5: gt-workflow push guard reads `tool_input.command`

- [x] 5.1 `plugins/gt-workflow/hooks/scripts/lib/policy-check-git-push.js:28`:
      read `camelCaseEnvelope.toolInput?.command` (string-typed, else `''`),
      mirroring `plugins/github-workflow/hooks/scripts/lib/policy-check-git-push.js:84`
      and gt-workflow's own `policy-check-commit-message.js:49`. Drop the
      root-level `.command` read entirely — no real host sends it; keeping a
      fallback would preserve the fail-open path for a malformed envelope.
      Update the JSDoc param type.
- [x] 5.2 Fixtures `plugins/gt-workflow/tests/fixtures/hooks/check-git-push/*.stdin`
      (`plain-block`, `metachar-*`, `allowed-non-push`): nest the command as
      `{"tool_name":"Bash","tool_input":{"command":…}}` — the shape Claude
      Code and Codex actually send. Golden outputs are unchanged (same
      deny/allow decisions). Add `root-level-command-ignored.stdin` +
      `.golden.txt` (flat `{"command":"git push"}` → allow, exit 0, no
      output) so the old shape is pinned as non-blocking, and a matching
      `@test` in `hook-parity.bats`.
- [x] 5.3 Live check: `printf '%s' '{"tool_name":"Bash","tool_input":{"command":"git push origin main"}}' | node plugins/gt-workflow/hooks/scripts/entrypoint-claude.js --hook check-git-push`
      → exit 2 with the block message; same payload through
      `entrypoint-codex.js` → camelCase `hookSpecificOutput` deny. `bats tests/`
      from the plugin dir green.
- [x] 5.4 Docs: `docs/solutions/code-quality/posttooluse-hook-input-schema-field-paths.md`
      — append a dated update: gt-workflow now reads the real path; the
      "preserved for characterization parity" note in github-workflow's
      `policy-check-git-push.js:76-83` comment is stale → trim it to the
      one-line field-path statement. `plugins/gt-workflow/CLAUDE.md:218`
      backstop bullet unchanged (behaviour now matches the prose).
- [x] 5.5 Changeset `gt-workflow: patch` — "PreToolUse `git push` backstop
      now reads `tool_input.command`; it previously read a root-level
      `command` that no host sends, so raw `git push` was never blocked".
      `pnpm validate:agents && pnpm lint:plugins` (CLAUDE.md untouched, but
      run anyway).

## Technical Details

Files to modify — WS1: `scripts/lib/plugin-rules.js`, `scripts/validate-plugin.js`,
`scripts/generate-manifests.js`, `tests/integration/validate-plugin.test.ts`,
`tests/integration/validate-plugin-characterization.test.ts` (+snapshot),
`tests/integration/generate-manifests-codex.test.ts`, `AGENTS.md`,
`docs/plugin-validation-guide.md`, `docs/plugin-template.md`, `CONTRIBUTING.md`.
WS2: 9 `catalog/plugins/*.json`, generated `plugins/*/.claude-plugin/plugin.json`,
`plugins/{yellow-ci,gt-workflow}/hooks/codex-hooks.json`, `scripts/lib/plugin-paths.js`,
`scripts/lib/plugin-rules.js`, `tests/integration/validate-plugin.test.ts`,
generate-manifests snapshot, one changeset. WS3: `plugins/yellow-ruvector/hooks/scripts/session-start.sh`,
`commands/ruvector/status.md`, `tests/session-start.bats`, new solution doc,
changeset. WS4: the yellow-codex files listed above, two solution-doc updates,
changeset. WS5: `plugins/gt-workflow/hooks/scripts/lib/policy-check-git-push.js`,
`plugins/gt-workflow/tests/fixtures/hooks/check-git-push/*`,
`plugins/gt-workflow/tests/hook-parity.bats`,
`plugins/github-workflow/hooks/scripts/lib/policy-check-git-push.js` (comment
only), `docs/solutions/code-quality/posttooluse-hook-input-schema-field-paths.md`,
changeset.

No new dependencies. No schema changes. WS1 removes ~60 lines; WS2 changes
generated bytes for nine plugins.

## Acceptance Criteria

1. WS1: `pnpm validate:plugins` fails with the presence message for a fixture
   with `hooks/hooks.json` regardless of inline hooks; `pnpm validate:generated`
   fails on the same fixture; current tree passes both; no test references
   hooks-only as a passing category.
2. WS2: `rg -n 'CLAUDE_PLUGIN_ROOT' catalog/plugins/*.json | rg -v '"\$\{CLAUDE_PLUGIN_ROOT\}'`
   is empty; a temp plugin under a path with a space validates and its hook
   runs (bats or manual); `node` escape fixture errors; snapshot refreshed;
   `validate:versions` passes after `apply:changesets`.
3. WS3: after 3.1, `hooks_remember` succeeds and `hooks_recall` returns it;
   with a hash-stamped store the SessionStart line appears once; `/ruvector:status`
   reports `PROVENANCE: MISMATCH` with `wouldReembed` before and `OK` after.
4. WS4: `rg -n 'gpt-5\.4' plugins/yellow-codex` returns only the model table's
   "legacy" row; `/codex:review` succeeds with `CODEX_MODEL` unset under
   ChatGPT auth; the exit-1 arm's summary names the rejected model; the
   noclobber done-criterion grep is empty; `/review:pr` still parses the
   codex return.
5. WS5: the nested-envelope payload exits 2 with the block message on both
   entrypoints; the flat `{"command": …}` payload is allowed; gt-workflow
   `bats tests/` green.
6. All: `pnpm validate:schemas && pnpm test:integration && pnpm lint && pnpm typecheck`
   green; plugin Markdown changes pass `pnpm validate:agents && pnpm lint:plugins`.

## Edge Cases

- **Third-party plugins that legitimately use hooks-only.** WS1 is repo
  policy for this marketplace, not a Claude Code rule; the error message says
  so and names `catalog/`. Upstream still documents hooks-only as valid.
- **Windows Git Bash / PowerShell** run the same shell-form command; double
  quotes are correct for both.
- **Fresh `.ruvector/` with no `embeddingProvenance`** → no warning (legacy or
  empty store), only `/ruvector:status` reports it as "unstamped".
- **`RUVECTOR_EMBEDDER=hash` on purpose** → SessionStart stays silent.
- **Reembed interrupted** → stamps match but `wouldReembed > 0`; status must
  say "reembed incomplete", not "OK".
- **User with `model` set in `~/.codex/config.toml`** → omitting `-m` honours
  it (config precedence); `CODEX_MODEL` still wins when set.
- **Bash-shebang `.sh` scripts** are unaffected by zsh `noclobber`; the sweep
  targets inline snippets only.
- **WS1 stacks on #797**: if #797 merges first, `gt sync`/restack WS1 onto main.

## Follow-ups surfaced during execution

- **gt-workflow push guard reads the wrong field** (found during 2.7) —
  promoted to WS5 / stack item 5. github-workflow's sibling already reads
  `tool_input.command` and its comment records that gt-workflow's root-level
  read was kept only for characterization parity with the deleted
  `check-git-push.sh`; that parity is no longer worth a fail-open backstop.

- **Deferred P3s from the Phase 3 review pass (2026-09-16)**, all
  by-design or out of scope for this stack:
  - WS1 / PR #798: apply mode deletes a hand-authored
    `plugins/*/hooks/hooks.json` (the stale-sweep entry), and RULE 7 errors
    on any `hooks/hooks.json` first in `validate:plugins`. Neither behaviour
    exists on this branch — both land on the sibling stacked branch
    `agent/feat/rule7-reject-hooks-json` (PR #798). If that ever bites,
    switch apply mode to report-only for that candidate.
  - RULE 6's unquoted-placeholder check is a warning, not an error (WS2's
    explicit choice so third-party catalogs keep validating). Promote to an
    error for first-party catalogs if a regression ever ships.
  - `node` hook entrypoints skip the decision-output content check
    (`validateHookScriptPath` returns after existence/containment for
    non-bash). A relaxed check for `process.exitCode = 2` /
    `hookSpecificOutput` would catch a future fail-open node PreToolUse hook.
  - `mcpServers[].command` values are still `${CLAUDE_PLUGIN_ROOT}/bin/…`
    unquoted — exec form, spawned directly, not through `sh -c`; not the
    same bug class. Verify against the docs before touching.
  - Cross-plugin duplication of the `jq -n … systemMessage` idiom
    (`yellow-debt/hooks/scripts/session-start.sh:49` and others);
    PR #800 adds `emit_message_json` to yellow-ruvector's `hook-json.sh` —
    the same helper could be lifted into the other plugins' libs.
  - `/codex:setup`'s smoke test uses a 15 s per-call timeout; a slow first
    probe under ChatGPT auth produced a one-off "no response" during
    verification. Consider 30 s for the retry.

## References

- Prior PR: #797 (`plans/fix-hooks-json-mirror-double-registration.md`)
- Validator: `scripts/lib/plugin-rules.js:169-291`, `scripts/lib/plugin-paths.js:52-62`,
  `scripts/validate-plugin.js:142-152`; stale sweep `scripts/generate-manifests.js:~917`
- Schema: `schemas/plugin.schema.json` (`inlineHooks`, ~96 and ~191)
- Upstream: https://code.claude.com/docs/en/plugins-reference (hooks-only is valid),
  https://code.claude.com/docs/en/hooks (shell form via `sh -c`; quote placeholders)
- ruvector: https://github.com/ruvnet/RuVector/blob/main/docs/adr/ADR-210-default-on-semantic-embeddings-minilm.md;
  `plugins/yellow-ruvector/commands/ruvector/seed-solutions.md` Steps 5.2/6;
  `skills/memory-query/SKILL.md:114`
- Codex: https://github.com/openai/codex/issues/14190, https://learn.chatgpt.com/docs/models;
  `docs/solutions/integration-issues/codex-cli-exec-review-flags-rejected-0140.md` (2026-09-05 update)
- Noclobber: `docs/solutions/logic-errors/zsh-noclobber-mktemp-stderr-redirect.md` (2026-07-18 sweep)
- Learnings: `docs/solutions/build-errors/ci-schema-drift-hooks-inline-vs-string.md`,
  `docs/solutions/integration-issues/cross-host-hook-envelope-node-runtime.md`

## Stack Decomposition
<!-- stack-topology: parallel -->
<!-- stack-trunk: agent/fix/remove-hooks-json-mirrors -->

Trunk is PR #797's branch on purpose: item 1 edits `ruleHooksJson`, which
only exists there. After #797 merges, `gt sync` restacks all four onto `main`.
Task 3.1 (local reembed) is an ops step, not a branch — run it before item 3.

## Stack Progress
<!-- Updated by flow:work. Do not edit manually. -->
- [x] 1. agent/feat/rule7-reject-hooks-json (completed 2026-09-16)
- [x] 2. agent/fix/quote-plugin-root-hook-commands (completed 2026-09-16)
- [x] 3. agent/feat/ruvector-provenance-check (completed 2026-09-16)
- [x] 4. agent/fix/codex-model-default-noclobber (completed 2026-09-16)
- [x] 5. agent/fix/gt-push-guard-tool-input (completed 2026-09-16)

### 1. agent/feat/rule7-reject-hooks-json

- **Type:** feat
- **Description:** validate: reject any plugins/*/hooks/hooks.json — hook config only from catalog/
- **Scope:** scripts/lib/plugin-rules.js, scripts/validate-plugin.js, scripts/generate-manifests.js, tests/integration/validate-plugin.test.ts, tests/integration/validate-plugin-characterization.test.ts, tests/integration/__snapshots__/validate-plugin-characterization.test.ts.snap, tests/integration/generate-manifests-codex.test.ts, AGENTS.md, docs/plugin-validation-guide.md, docs/plugin-template.md, CONTRIBUTING.md
- **Tasks:** 1.1, 1.2, 1.3, 1.4, 1.5, 1.6
- **Depends on:** (none)

### 2. agent/fix/quote-plugin-root-hook-commands

- **Type:** fix
- **Description:** catalog: quote ${CLAUDE_PLUGIN_ROOT} in hook commands; validate node hooks; warn on unquoted placeholders
- **Scope:** catalog/plugins/gt-workflow.json, catalog/plugins/yellow-ci.json, catalog/plugins/yellow-composio.json, catalog/plugins/yellow-core.json, catalog/plugins/yellow-debt.json, catalog/plugins/yellow-morph.json, catalog/plugins/yellow-research.json, catalog/plugins/yellow-ruvector.json, catalog/plugins/yellow-semgrep.json, plugins/*/.claude-plugin/plugin.json, plugins/yellow-ci/hooks/codex-hooks.json, plugins/gt-workflow/hooks/codex-hooks.json, scripts/lib/plugin-paths.js, scripts/lib/plugin-rules.js, tests/integration/validate-plugin.test.ts, tests/integration/__snapshots__/generate-manifests-characterization.test.ts.snap, .changeset/
- **Tasks:** 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7
- **Depends on:** (none)

### 3. agent/feat/ruvector-provenance-check

- **Type:** feat
- **Description:** yellow-ruvector: detect embedder-provenance mismatch in SessionStart and /ruvector:status
- **Scope:** plugins/yellow-ruvector/hooks/scripts/session-start.sh, plugins/yellow-ruvector/commands/ruvector/status.md, plugins/yellow-ruvector/tests/session-start.bats, plugins/yellow-ruvector/README.md, plugins/yellow-ruvector/CLAUDE.md, docs/solutions/integration-issues/ruvector-adr210-embedding-provenance-refusal.md, .changeset/
- **Tasks:** 3.2, 3.3, 3.4, 3.5, 3.6
- **Depends on:** (none)

### 4. agent/fix/codex-model-default-noclobber

- **Type:** fix
- **Description:** yellow-codex: drop hardcoded gpt-5.4, diagnose model rejection, noclobber-safe redirects
- **Scope:** plugins/yellow-codex/agents/review/codex-reviewer.md, plugins/yellow-codex/agents/research/codex-analyst.md, plugins/yellow-codex/agents/workflow/codex-executor.md, plugins/yellow-codex/commands/codex/review.md, plugins/yellow-codex/commands/codex/rescue.md, plugins/yellow-codex/commands/codex/setup.md, plugins/yellow-codex/skills/codex-patterns/SKILL.md, plugins/yellow-codex/CLAUDE.md, docs/solutions/integration-issues/codex-cli-exec-review-flags-rejected-0140.md, docs/solutions/logic-errors/zsh-noclobber-mktemp-stderr-redirect.md, .changeset/
- **Tasks:** 4.1, 4.2, 4.3, 4.4, 4.5, 4.6
- **Depends on:** (none)

### 5. agent/fix/gt-push-guard-tool-input

- **Type:** fix
- **Description:** gt-workflow: PreToolUse git-push backstop reads tool_input.command (was root-level command; never blocked)
- **Scope:** plugins/gt-workflow/hooks/scripts/lib/policy-check-git-push.js, plugins/gt-workflow/tests/fixtures/hooks/check-git-push/, plugins/gt-workflow/tests/hook-parity.bats, plugins/github-workflow/hooks/scripts/lib/policy-check-git-push.js, docs/solutions/code-quality/posttooluse-hook-input-schema-field-paths.md, .changeset/
- **Tasks:** 5.1, 5.2, 5.3, 5.4, 5.5
- **Depends on:** (none)
