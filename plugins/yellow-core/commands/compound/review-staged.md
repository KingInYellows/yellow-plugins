---
name: compound:review-staged
description: Manually drain the compound-staging ledger ahead of the SessionStart auto-drain threshold. Use when you want to flush pending session-transcript entries to docs/solutions/ + MEMORY.md right now (e.g., before context window cycles) without waiting for count >= 5 or oldest > 48h.
argument-hint: ''
allowed-tools:
  - Bash
  - AskUserQuestion
  - Read
  - Glob
---

# /compound:review-staged

Manually trigger a drain of yellow-core's per-project compound-staging
ledger. Identical dispatch path to the SessionStart auto-drain — same
disowned `claude -p` subshell, same staging-reviewer/scorer/promoter
chain — but bypasses the count + age thresholds and includes an
explicit M3 confirmation gate before any bulk write.

Use this when:

- You just had a high-signal session and don't want to wait for the
  next SessionStart drain.
- You suspect pending entries are about to be PII-reaped (>7 days old)
  and want to capture what's worth saving first.
- You're debugging the pipeline and want a controlled dispatch.

## Steps

1. **Locate the staging dir.**

   ```bash
   . "${CLAUDE_PLUGIN_ROOT}/lib/compound-staging.sh"
   GIT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
   PROJECT_SLUG=$(cs_derive_project_slug "$GIT_ROOT")
   STAGING_DIR=$(cs_staging_dir_for_slug "$PROJECT_SLUG")
   if [ ! -d "$STAGING_DIR/pending" ]; then
     printf '[compound:review-staged] No staging dir at %s. Nothing to drain.\n' "$STAGING_DIR"
     exit 0
   fi
   ```

   Capture the resolved paths and substitute the values inline into the
   bash blocks below — variables do not survive across separate Bash
   tool calls.

2. **Count pending entries.**

   ```bash
   PENDING_COUNT=$(find "$STAGING_DIR/pending" -maxdepth 1 -name '*.jsonl' -type f 2>/dev/null \
     | wc -l | tr -d '[:space:]')
   if [ "${PENDING_COUNT:-0}" -eq 0 ]; then
     printf '[compound:review-staged] 0 pending entries. Nothing to drain.\n'
     exit 0
   fi
   printf '[compound:review-staged] %s pending entries\n' "$PENDING_COUNT"
   ```

   If `PENDING_COUNT == 0`, exit. Do not proceed to the confirmation.

3. **Preview up to 5 entry titles.** Read the first line of each of the
   five oldest pending files; extract the first 80 chars of
   `transcript_tail` for context.

   ```bash
   SAMPLES=""
   while IFS= read -r f; do
     [ -z "$f" ] && continue
     [ -L "$f" ] && continue   # skip symlinks — defense-in-depth
     title=$(jq -r '.transcript_tail | .[0:80] | gsub("\\n"; " ")' "$f" 2>/dev/null \
       || printf '(parse error)')
     SAMPLES="${SAMPLES}- $(basename -- "$f"): ${title}"$'\n'
   # find -type f ! -type l with -printf mtime sort → oldest first.
   # Matches Steps 1-2's symlink-safe enumeration; ls follows symlinks.
   done < <(find "$STAGING_DIR/pending" -maxdepth 1 -name '*.jsonl' \
              -type f ! -type l -printf '%T@ %p\n' 2>/dev/null \
            | sort -n | head -5 | cut -d' ' -f2-)
   printf '%s\n' "$SAMPLES"
   ```

4. **M3 confirmation gate (MANDATORY).** This step is required — manual
   drain is a bulk write that the user must explicitly approve. Use the
   `AskUserQuestion` tool with a single question and two options:

   - **Question:** `Drain N pending entries to docs/solutions/ and MEMORY.md? Sample titles above.` (substitute N)
   - **Header:** `Drain staging`
   - **Options:**
     - Label: `Drain all N entries`, description: `Spawn disowned claude -p drain session; non-blocking. Promotions land in docs/solutions/<category>/<slug>.md and append to MEMORY.md ## Session Notes.`
     - Label: `Cancel`, description: `Make no changes. Pending entries remain for next SessionStart auto-drain or future manual /compound:review-staged.`

   **If the user selects Cancel:** print `[compound:review-staged] Cancelled by user. No changes.` and exit. Make no writes.

5. **Acquire drain lock.** Atomic `mkdir`. If lock exists, another drain
   is in flight (or a stale lock not yet reaped) — refuse to spawn a
   concurrent dispatch.

   ```bash
   if ! mkdir "$STAGING_DIR/.drain-lock" 2>/dev/null; then
     printf '[compound:review-staged] Concurrent drain already in flight (.drain-lock exists). Try again in a few minutes.\n' >&2
     exit 1
   fi
   ```

6. **Resolve the claude binary.** Allow override via `COMPOUND_DRAIN_CMD`
   ONLY when running under bats (test harness). Without the
   `BATS_VERSION` gate, this would be a production drain-hijack vector
   for any attacker who can plant the env var (e.g., via a malicious
   `.envrc` or shell profile).

   ```bash
   CLAUDE_BIN=""
   if [ -n "${COMPOUND_DRAIN_CMD:-}" ] && [ -n "${BATS_VERSION:-}" ]; then
     CLAUDE_BIN="$COMPOUND_DRAIN_CMD"
   else
     CLAUDE_BIN="$(command -v claude 2>/dev/null)"
   fi
   if [ -z "$CLAUDE_BIN" ] || [ ! -x "$CLAUDE_BIN" ]; then
     rmdir "$STAGING_DIR/.drain-lock" 2>/dev/null || true
     printf '[compound:review-staged] claude binary not found. Install Claude Code CLI.\n' >&2
     exit 1
   fi
   ```

7. **Spawn the disowned drain subshell.** Identical to
   `hooks/scripts/session-start.sh`'s dispatch — the `EXIT` trap removes
   the lock; this command does NOT wait for drain completion.

   ```bash
   mkdir -p -- "$STAGING_DIR/drain-logs" 2>/dev/null || true
   DRAIN_LOG="$STAGING_DIR/drain-logs/manual-$(date +%Y%m%d-%H%M%S).log"
   AUTH_ROUTE=$(cs_detect_auth_route)
   # Strip newlines from interpolated paths as defense-in-depth against
   # a CWD/git-root containing literal LF (very rare but possible). The
   # fence below would close prematurely if a newline escaped the value.
   STAGING_DIR_SAFE=$(printf '%s' "$STAGING_DIR" | tr -d '\n\r')
   GIT_ROOT_SAFE=$(printf '%s' "$GIT_ROOT" | tr -d '\n\r')
   DRAIN_PROMPT=$(printf '%s\n' \
     'Invoke the staging-reviewer agent (yellow-core:workflow:staging-reviewer) via Task.' \
     '' \
     'Goal: drain the compound-staging ledger and promote eligible entries.' \
     '' \
     '--- begin paths (reference only) ---' \
     "Staging dir: $STAGING_DIR_SAFE" \
     "Project: $GIT_ROOT_SAFE" \
     '--- end paths ---' \
     '' \
     'Do NOT ask the user any questions. This drain is non-interactive.' \
     'On completion, write a one-line summary to stdout and exit.')

   (
     trap 'rmdir "'"$STAGING_DIR"'/.drain-lock" 2>/dev/null || true' EXIT INT TERM
     export COMPOUND_DRAIN_IN_PROGRESS=1
     printf '[compound:review-staged] manual drain dispatch %s (auth=%s, pending=%s)\n' \
       "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$AUTH_ROUTE" "$PENDING_COUNT" >> "$DRAIN_LOG" 2>/dev/null
     # --bare is the primary recursion guard: skips auto-discovery of
     # hooks, skills, plugins, MCP servers, CLAUDE.md in the child session.
     # Without it, the child fires its own SessionStart hook and cascades.
     # See docs/solutions/code-quality/claude-code-bare-flag-and-hook-recursion-guard.md.
     "$CLAUDE_BIN" -p "$DRAIN_PROMPT" \
       --bare \
       --max-turns 50 \
       --permission-mode bypassPermissions \
       --output-format json \
       >> "$DRAIN_LOG" 2>&1
     cs_update_drain_budget "$STAGING_DIR" "$AUTH_ROUTE" || true
   ) >/dev/null 2>&1 &
   disown
   ```

8. **Report and exit.** The drain runs asynchronously; this command
   reports the dispatch and returns immediately. Tail the drain log to
   see progress.

   ```bash
   printf '[compound:review-staged] dispatched. Tail with: tail -f %s\n' "$DRAIN_LOG"
   ```

## Behavior notes

- **Non-blocking.** The drain runs in a disowned subshell. The user gets
  the prompt back immediately.
- **No double-dispatch.** The `.drain-lock` (shared with the SessionStart
  hook) prevents concurrent drains. If a SessionStart drain is already
  in flight, this command refuses.
- **No turn-budget cost to the main session.** The drain `claude -p`
  process is an independent session with its own context window. The
  COMPOUND_DRAIN_IN_PROGRESS env var prevents recursion (the drain's
  own Stop + SessionStart hooks no-op).
- **Drain log location:** `~/.claude/projects/<slug>/compound-staging/drain-logs/manual-<timestamp>.log`
- **Reapers still active:** the SessionStart hook's PII TTL reaper still
  deletes pending entries older than 7 days regardless of manual
  invocations.

## When NOT to use

- When the SessionStart auto-drain just fired (check `drain-logs/` for
  a recent log). Wait until that drain completes.
- When you're inside a drain `claude -p` session yourself
  (`COMPOUND_DRAIN_IN_PROGRESS=1` is set). The command works but the
  nested drain will recurse-guard at every hook fire.
- When `pnpm validate:schemas` would catch the same pattern via repo
  lint. The compound pipeline is for content learnings, not lint rules.

## References

- `plans/background-compounding-triggers.md` — full architecture
- `plugins/yellow-core/hooks/scripts/session-start.sh` — the
  auto-dispatch path this command mirrors
- `plugins/yellow-core/agents/workflow/staging-reviewer.md` — drain
  orchestrator
- `plugins/yellow-core/lib/compound-staging.sh` — sourceable helpers
