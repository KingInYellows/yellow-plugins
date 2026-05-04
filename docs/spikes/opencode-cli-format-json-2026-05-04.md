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
SESSION_ID=$(jq -r 'first(.part.snapshot.sessionID // empty)' "$OUTPUT_FILE" 2>/dev/null)
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
SESSION_ID=$(jq -r 'first(.part.snapshot.sessionID // empty)' "$OUTPUT_FILE" 2>/dev/null)

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
