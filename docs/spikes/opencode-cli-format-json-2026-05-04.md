# Spike: OpenCode CLI `--format json` Event Stream & Session Cleanup

**Date:** 2026-05-04
**Plan task:** PR1 task 1.2 + 1.3 (yellow-council)
**OpenCode CLI version tested:** 1.14.33

## Summary

OpenCode CLI's non-interactive invocation is `opencode run "<message>"` with `--format json` for structured event stream. Key findings:

- **Persistent SQLite sessions** in `~/.local/share/opencode/` — every `opencode run` invocation creates a new session that persists. Cleanup via `opencode session delete <id>` is required to prevent unbounded growth.
- **Major-version upgrades trigger a one-time SQLite migration** that can take several minutes on first run after the upgrade. yellow-council must tolerate this (or document that users should run `opencode run "test"` once interactively after upgrading).
- **JSON event stream schema** is loosely documented; community cheatsheet (takopi.dev) is the most reliable reference.
- **Recommended install:** `curl -fsSL https://opencode.ai/install | bash` OR `npm install -g opencode-ai`. `opencode upgrade` works for self-update.

## Verified Invocation Pattern (from official docs + community cheatsheet)

Source: <https://opencode.ai/docs/cli/>

```bash
# Non-interactive run
opencode run "Explain how closures work in JavaScript"

# Structured JSON event stream
opencode run --format json "..."

# Continue last session
opencode run --continue "follow-up question"

# Specific session
opencode run --session ses_XXXXX "follow-up"

# Specific model + variant
opencode run --model anthropic/claude-sonnet-4-5 --variant high "..."
```

### Event types in `--format json` stream (community-documented)

Source: <https://takopi.dev/reference/runners/opencode/stream-json-cheatsheet/>

| Event type | Key fields | Purpose |
|------------|-----------|---------|
| `step_start` | `sessionID`, `part.type="step-start"`, `part.snapshot` | Step begins |
| `text` | `part.text` (string), `part.time` | Model text output (may emit multiple per turn) |
| `tool_use` | `part.tool`, `part.state.input`, `part.state.output`, `part.state.status` | Tool invocations (read/write/edit) |
| `step_finish` | `part.reason`, `part.cost`, `part.tokens` | Step ends — `reason: "stop"` is terminal |
| `error` | `error.name`, `error.data.message` | Session error |

**Final assistant message extraction (jq):**
```bash
ASSISTANT_TEXT=$(jq -r 'select(.type=="text") | .part.text' "$OUTPUT_FILE" | tr -d '\000')
```

Concatenate all `text` events for the full response. Multiple `text` events can be emitted per turn (streaming chunks).

**Session ID extraction (jq):**
```bash
SESSION_ID=$(jq -r 'first(.sessionID // empty)' "$OUTPUT_FILE" 2>/dev/null)
```

## Recommended yellow-council Invocation

For `opencode-reviewer.md` agent body:

```bash
timeout --signal=TERM --kill-after=10 "${COUNCIL_TIMEOUT:-600}" \
  opencode run \
    --format json \
    --variant "${COUNCIL_OPENCODE_VARIANT:-high}" \
    "<full-pack-prompt>" \
  > "$OUTPUT_FILE" 2> "$STDERR_FILE"
CLI_EXIT=$?

# Extract session ID for cleanup
SESSION_ID=$(jq -r 'first(.sessionID // empty)' "$OUTPUT_FILE" 2>/dev/null)

# Check for error events FIRST (jq stops on first hit, fast)
ERROR_MSG=$(jq -r 'select(.type=="error") | .error.data.message' "$OUTPUT_FILE" 2>/dev/null | head -1)

if [ -n "$ERROR_MSG" ]; then
  printf '[opencode-reviewer] OpenCode error: %s\n' "$ERROR_MSG" >&2
  # mark this reviewer as ERROR exit_status; continue to cleanup
fi

# Extract assistant text (concatenate all text events)
ASSISTANT_TEXT=$(jq -r 'select(.type=="text") | .part.text' "$OUTPUT_FILE" 2>/dev/null | tr -d '\000')

# Apply 11-pattern redaction to ASSISTANT_TEXT (NOT to raw JSONL — JSONL contains tool_use events with embedded file content)

# Cleanup session
if [ -n "$SESSION_ID" ]; then
  opencode session delete "$SESSION_ID" 2>/dev/null \
    || printf '[opencode-reviewer] Warning: failed to delete session %s\n' "$SESSION_ID" >&2
fi
```

**Flag rationale:**
- `--format json`: structured event stream; required for reliable text extraction.
- `--variant high`: default reasoning effort. `max` is significantly slower/costlier — reserve for explicit user override via `COUNCIL_OPENCODE_VARIANT=max`. `minimal` is too brief for council use.
- `opencode session delete`: ALWAYS run after capture to prevent session accumulation in `~/.local/share/opencode/`.
- **Do NOT use `--dangerously-skip-permissions`** (the OpenCode equivalent of Gemini `--yolo` — same risk profile).

## Spike Test Environment Observations (2026-05-04, WSL2)

In this WSL2 shell, `opencode run "..." --format json` triggered a one-time SQLite migration after the upgrade from 1.1.23 → 1.14.33. The migration emitted progress to stderr:
```
Performing one time database migration, may take a few minutes...
sqlite-migration:0
sqlite-migration:1
...
sqlite-migration:8
```

The migration exceeded the 60-second test timeout. Community-reported migration time on similar version jumps is 2–5 minutes. Subsequent invocations should not pay this cost.

**For PR2 implementation:**
- Document in CLAUDE.md "Known Limitations": after major OpenCode upgrades, the first invocation may take several minutes due to SQLite migration. Recommend users run `opencode run "test"` once interactively before invoking `/council`.
- Add an opencode-reviewer warning if `STDERR_FILE` contains "sqlite-migration": message back to user "OpenCode is performing a one-time database migration; council results delayed."

## OpenRouter Routing Spike (2026-10-03)

Gate for yellow-council V2 shell 04 (R19/R20). Run on opencode 1.18.34 (upgraded
from 1.14.33, which the sections above were written against), WSL2, probes run
with `--pure` from `/tmp`. The `~/.config/opencode` directory was snapshotted
first (see
`docs/solutions/integration-issues/opencode-cli-listing-rewrites-user-config-in-place.md`);
afterwards `opencode.json` and `tui.json` were unchanged, and the only config
difference outside `node_modules` was a plugin debug log.

**Default slug.** `opencode models openrouter` lists
`openrouter/deepseek/deepseek-v4-pro` (also a dated `-0813` variant and
`openrouter/~deepseek/deepseek-pro-latest`). That is the R19 default.
`opencode models opencode` (OpenCode Zen) lists `opencode/deepseek-v4-pro`,
a verified alternative for `COUNCIL_OPENCODE_MODEL`, not the default.

**Success call.** `opencode run --pure --format json --variant high --model
openrouter/deepseek/deepseek-v4-pro "reply with the single word ok"` exits 0
and emits `step_start`, `text` (`part.text` = `ok`) and `step_finish`. The
`--format json` event shape (`type`, `sessionID`, `part.*`) and `--variant`
are unchanged on 1.18.34. One call cost about $0.008: opencode sent ~38k input
tokens for a one-word prompt, so a near-empty OpenRouter balance fails even
tiny prompts.

**Credential reaches a non-TTY subprocess.** The same smoke call run from a
throwaway Agent-spawned Bash subprocess (the context opencode-reviewer runs in)
also exits 0 with `ok`. The key is stored in `auth.json` (type `api`), not in a
keyring, so the codex non-TTY failure mode does not apply.

**Credential check without printing the key.** `opencode auth list` (accepts
`--pure`) prints a `Credentials` section and an `Environment` section. After
stripping ANSI colour codes, `grep -E '●[[:space:]]+OpenRouter'` matches when
OpenRouter is available either as a stored credential
(`●  OpenRouter api`) or through `OPENROUTER_API_KEY` (listed under
`Environment`). It prints no key material. With `XDG_DATA_HOME` pointed at an
empty directory it reports 0 credentials and the matcher finds nothing, so
that variable isolates `auth.json` for tests. `OPENROUTER_API_KEY` in the
environment is honored: `auth list` shows it, and a run then reaches the
provider (a dummy value returns an `APIError`, `statusCode` 401, message
"Missing Authentication header", `isRetryable` false).

**Error events on 1.18.34.** The `error` event fields at
`opencode-reviewer.md` (`.error.name`, `.error.data.message`) still exist, but
the model and authentication cases are opaque there:

| Case | Exit | `error` event |
|------|------|---------------|
| Unknown slug on a real provider (`openrouter/deepseek/no-such-model-xyz`) | 1 | `name` `UnknownError`, `data.message` "Unexpected server error. Check server logs for details.", `data.ref` `err_...` |
| Unknown provider (`bogus/model`) | 1 | same |
| Provider with no credential (`mistral/...`) | 1 | same |
| OpenRouter with no credential (default slug, `XDG_DATA_HOME` isolated) | 1 | same |
| Invalid key (dummy `OPENROUTER_API_KEY`) | 1 | `name` `APIError`, `data.statusCode` 401, `data.isRetryable` false |
| Insufficient credits (pre-captured 2026-10-03, not reproduced: balance had recovered) | 1 | `name` `APIError`, `data.statusCode` 402, `data.isRetryable` false, message "This request requires more credits, or fewer max_tokens. You requested up to 32000 tokens, but can only afford N..." (the message embeds an account key-management link; do not copy it) |

The first four rows are indistinguishable from each other, and from any other
server error, in the JSON event. The cause is only on stderr with
`--print-logs --log-level ERROR`:
`ProviderModelNotFoundError: Model not found: <slug>. Did you mean: ...`. An
unauthenticated provider fails this way because its models are never loaded.
The stdout JSON stream is unchanged by those flags and a successful run prints
nothing extra at ERROR level. opencode-reviewer therefore passes
`--print-logs --log-level ERROR` and classifies `ProviderModelNotFoundError`
(plus HTTP 401/403) as `UNAVAILABLE`, and HTTP 402 / "requires more credits"
as `QUOTA_EXHAUSTED`.

## Gotchas to Watch For

1. **Persistent sessions accumulate.** `~/.local/share/opencode/` grows unbounded without explicit `opencode session delete`. yellow-council MUST clean up after every invocation.
2. **`tool_use` events embed file content.** If the model decides to invoke `read`/`write`/`edit` tools (which it shouldn't for read-only review prompts), `part.state.input` and `part.state.output` contain full file contents. Apply credential redaction to the EXTRACTED assistant text, not just the raw JSONL — but never write the raw JSONL to `docs/council/` reports.
3. **`--variant max` is significantly slower.** May approach the 600s timeout for complex prompts. `high` is the safe default.
4. **Major-version upgrades trigger SQLite migration.** First invocation post-upgrade can take minutes. Document and tolerate.

## References

- OpenCode CLI docs: <https://opencode.ai/docs/cli/>
- OpenCode config docs: <https://opencode.ai/docs/config/>
- OpenCode `--format json` event schema (community): <https://takopi.dev/reference/runners/opencode/stream-json-cheatsheet/>
- OpenCode CLI cheat sheet: <https://computingforgeeks.com/opencode-cli-cheat-sheet/>
- SST release notes (latest opencode versions): <https://releasebot.io/updates/sst>
- npm package: `opencode-ai` — <https://www.npmjs.com/package/opencode-ai>
- Install script: `curl -fsSL https://opencode.ai/install | bash`
