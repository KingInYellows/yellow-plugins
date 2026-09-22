# yellow-ruvector hook contract (Deliverable A)

State: `READY_FOR_SUBMISSION_APPROVAL` for the plugin fixes.
Upgrade decision: `UPGRADE_BLOCKED_UPSTREAM` (RuVector #995). The
shipping pin stays `ruvector@0.2.34`.

## Baseline

- Repo: `KingInYellows/yellow-plugins`
- Primary checkout: `/agent/repos/yellow-plugins` (left clean)
- Worktree: `/tmp/yellow-plugins-ruvector-a`
- Branch: `cursor/yellow-ruvector-hook-contract-5276`
- Base SHA: `22cfd85b4017eafe012de685a5d3b69c76de1fb9`
- Open PRs on the repo at assignment time: none
- Node `v22.22.2`, pnpm `8.15.0` (the nvm Node on this VM)
- `claude` is not installed. No `.yellow-stack.yml`. Stack classify
  cannot return `READY_GRAPHITE` or `READY_GITHUB`. This change stops at
  a local commit. No push.
- Host `ruvector` binary was absent. `~/.ruvector` was absent and was
  not created. No live store, global npm install, or host settings
  change.

## Reproduced, then fixed

Synthetic fixtures only, against the pre-change scripts on
`ruvector@0.2.34`. Independent confirmation is in the verifier note
`yellow-ruvector-evidence.md` (not owned by this change).

- `UserPromptSubmit` read `user_prompt` and ignored the documented
  string field `prompt`. Objects, numbers, and arrays were passed
  through as the recall query. Both fields present: `user_prompt` won.
- Recall was returned in `systemMessage`. `UserPromptSubmit` and
  `SessionStart` did not emit
  `hookSpecificOutput.additionalContext`.
- Bash `PostToolUse` turned a missing status, a host `tool_response`
  (`stdout` / `stderr` / `interrupted` / `isImage`, no `exit_code`),
  and a `PostToolUseFailure` into
  `hooks post-command --error "exit code 1"`.
- Edit and Write always got `hooks post-edit --success`, including a
  failure event and a payload with no host event.
- `PostToolUseFailure` was not registered.
- `user-prompt-submit.sh` and `stop.sh` fell through to unpinned
  `npx --no ruvector` when the global binary was absent.

The fix:

- `user-prompt-submit.sh` reads only a string `prompt`. Non-strings
  and `user_prompt` are not the query. Recall is fenced as untrusted
  reference and emitted with `emit_recall_json` as
  `hookSpecificOutput.additionalContext` (`hookEventName`
  `UserPromptSubmit`). The body is capped before the fence. There is
  no `decision` or `permissionDecision`. A missing binary, a failed
  recall, or a short prompt exits 0 with the allow payload and no
  context. The direct `ruvector` binary is required.
- `session-start.sh` puts recalled learnings in
  `additionalContext` (`hookEventName` `SessionStart`). The embedder
  provenance note stays on `systemMessage` and is not concatenated
  into the recall.
- `post-tool-use.sh` is registered for `PostToolUse` and
  `PostToolUseFailure`. A Bash `PostToolUse` with a `tool_response`
  object and `interrupted` not true is `--success`. A missing
  `tool_response` is unknown. `interrupted` or `is_interrupt` is an
  interrupt. A `PostToolUseFailure` whose error first line is exactly
  `Exit code N` is `--error "exit code N"`. A bare error is unknown.
  Edit, Write, and MultiEdit record `--success` only when
  `hook_event_name` is `PostToolUse`. Unknown and interrupt make no
  upstream call and are not described as saved. `tool_result` is not
  read. Solution-doc paths stay skipped. MultiEdit paths are
  deduped.
- `permission:"allow"` remains the existing Cursor Claude-plugin
  bridge field on the allow payload. It is not Claude
  `permissionDecision` and does not authorize a tool or a prompt.
  PreToolUse still uses `json_exit`. This is not a claim of native
  Cursor support or host parity.
- Setup, status, and upgrade text stay on `ruvector@0.2.34`.
  `hooks_remember` and `hooks_pretrain` without a persistence
  acknowledgement are not saved.

## Already correct, left in place

- `pre-tool-use.sh` already reads `tool_input` and emits the allow
  payload.
- `session-start.sh` and `post-tool-use.sh` already skipped `npx`
  inside the hook budget.
- `scripts/install.sh` `RUVECTOR_DEFAULT_VERSION` and the catalog MCP
  spec were already `ruvector@0.2.34`.
- `seed-solutions.md` npx specs were already pinned.
- Worktree store-heal, the provenance jq check, and the pin-sync bats
  already matched the pin.

## Frozen candidate, not this commit

`ruvector@0.3.1`, published `2026-09-16T20:21:08.859Z`, tarball
SHA-256 `4b3cb7dfff8d2ec78d73c709c54c294f3165c206a2058342a3886a66423207a2`.
Registry `latest` `0.3.2` was hashed by the verifier and is not the
candidate. Neither tarball has `gitHead`. Their `mcp-server.js` files
still match open RuVector #995. This commit does not vendor, patch, or
download that tarball.

## Tests

Synthetic hook fixtures. No live Claude or Cursor host, no real
`.ruvector` store.

- `pnpm dlx bats@1.11.0 tests` in `plugins/yellow-ruvector`: 131 passed.
- `pnpm validate:schemas`, `validate:generated`, `validate:versions`,
  `validate:plugins`, `lint:plugins` (0 errors), `test:unit`,
  `test:integration` (46 files passed, 1 skipped), `lint`, `typecheck`:
  passed.
- `validate-solutions` against the two modified solution docs: 0
  errors. Those docs already had frontmatter; the check is
  diff-scoped to `origin/main...HEAD`, so it sees them after this
  commit.
- `pnpm format:check` fails on 986 files, including these paths at
  the base commit. Not introduced here.

## PR description

### Summary

- yellow-ruvector hooks read the documented Claude payloads and keep
  the ruvector pin at 0.2.34.
- UserPromptSubmit uses the string field `prompt`. Recalled text for
  UserPromptSubmit and SessionStart is
  `hookSpecificOutput.additionalContext`. The SessionStart provenance
  warning stays on `systemMessage`.
- PostToolUse and PostToolUseFailure record an edit or bash outcome
  only for an explicit success or an `Exit code N` failure. Unknown
  and interrupt are not submitted upstream.

### Stack context

Single commit on `cursor/yellow-ruvector-hook-contract-5276` from
`main` at `22cfd85b4017eafe012de685a5d3b69c76de1fb9`. Not stacked.
Stack provider was not READY (`claude` absent), so this was not
submitted.

### Test plan

- yellow-ruvector bats (131) on synthetic fixtures.
- Schema, generated-manifest, version, plugin, plugin-markdown,
  unit, integration, eslint, and typecheck gates above.

### Solution doc

Skip: behavior is covered by updates to
`docs/solutions/code-quality/posttooluse-hook-input-schema-field-paths.md`
and
`docs/solutions/logic-errors/write-freeze-invariant-omits-passive-hook-path.md`.

### Notes for reviewers

- `permission:"allow"` is the existing Cursor bridge field, not a
  Claude permission decision.
- Edit and Write `--success` is tied to `hook_event_name`
  `PostToolUse`, because that event is the success signal. A failure
  event or a missing event is not submitted.
- Do not treat this commit as qualification of ruvector 0.3.1.

## Follow-up on the published 0.2.34 behavior

Verifier evidence is in `yellow-ruvector-evidence.md`. This section
records the two bounded plugin-side fixes asked after that evidence.
`hooks_remember` stays enabled. The 64-vs-256 hash mismatch is left
as the upstream refusal both sides already make. #995 stays
`UPGRADE_BLOCKED_UPSTREAM`. No 0.3.1 or 0.3.2 pin, vendor, or patch.

### MCP allowlist — landed

The catalog MCP launch set no `RUVECTOR_MCP_ALLOW` and no
`RUVECTOR_MCP_PROFILE`. On published 0.2.34 that empty case lists
every tool. A profile plus an allowlist unions the extra tools, and
an empty, blank, or misspelled profile is the same full list.

`catalog/plugins/yellow-ruvector.json` now sets only:

`RUVECTOR_MCP_ALLOW=hooks_capabilities,hooks_pretrain,hooks_recall,hooks_remember,hooks_stats`

No `RUVECTOR_MCP_PROFILE` and no `RUVECTOR_MCP_DENY`. Those five names
are the MCP tools the plugin commands and agents call.
`plugins/yellow-ruvector/tests/mcp-allowlist.bats` checks the catalog
and the generated `plugin.json` launch spec against that list and
against the `mcp__plugin_yellow-ruvector_ruvector__*` references.

### Explicit store path — not landed

Published `ruvector@0.2.34` does not honor an explicit store path.
`bin/cli.js` and `bin/mcp-server.js` `getIntelPath()` look at
`cwd/.ruvector`, then `cwd/.claude`, then `~/.ruvector/intelligence.json`
when that file exists. Neither function reads `RUVECTOR_STORAGE_PATH`
or any other store argument. A search of the 0.2.34 package finds no
`STORAGE_PATH`. The plugin env of that name stays documentation of
intent. A wrapper that forced a path the binary ignores would pretend
the setting works, so this fix stops here. Unknown cwd still selects
`~/.ruvector` when that file exists.
