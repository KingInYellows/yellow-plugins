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

3. **Preview up to 5 entry titles + metadata.** Read the first line of
   each of the five oldest pending files. The preview is **raw,
   post-redaction transcript bytes (first 80 chars of `transcript_tail`)
   — NOT a human-readable title.** The human-readable `candidate_text`
   is generated at drain time by `staging-scorer`, so it cannot be
   previewed without paying the Haiku cost first. Show metadata
   (`session_id`, `cwd`, file mtime) alongside the snippet so users with
   unintelligible preview content can still identify *which* session
   each entry came from.

   ```bash
   # find -type f ! -type l with -printf mtime sort → oldest first.
   # Matches Steps 1-2's symlink-safe enumeration; ls follows symlinks.
   # BSD find (macOS) does not support -printf — fall back to per-file
   # stat if -printf produces no output. session-start.sh uses the same
   # two-tier pattern; keeping parity here avoids regressing macOS users.
   PREVIEW_LIST=$(find "$STAGING_DIR/pending" -maxdepth 1 -name '*.jsonl' \
                    -type f ! -type l -printf '%T@ %p\n' 2>/dev/null \
                  | sort -n | head -5 | cut -d' ' -f2-)
   if [ -z "$PREVIEW_LIST" ]; then
     # BSD fallback: ${EPOCH}<TAB>${PATH} via stat -f
     PREVIEW_LIST=$(find "$STAGING_DIR/pending" -maxdepth 1 -name '*.jsonl' \
                      -type f ! -type l \
                      -exec stat -f '%m	%N' {} \; 2>/dev/null \
                    | sort -n | head -5 | cut -f2-)
   fi

   SAMPLES=""
   while IFS= read -r f; do
     [ -z "$f" ] && continue
     [ -L "$f" ] && continue   # skip symlinks — defense-in-depth
     title=$(jq -r '.transcript_tail | .[0:80] | gsub("\\n"; " ")' "$f" 2>/dev/null \
       || printf '(parse error)')
     [ -z "$title" ] && title='(empty)'
     # Metadata sidecar — helps user identify which session even if the
     # transcript snippet is unintelligible (binary, garbled, or empty
     # after redaction).
     sid=$(jq -r '.session_id // "?"' "$f" 2>/dev/null || printf '?')
     cwd=$(jq -r '.cwd // "?"' "$f" 2>/dev/null || printf '?')
     mtime=$(stat -c '%y' "$f" 2>/dev/null | cut -d. -f1 \
       || stat -f '%Sm' -t '%Y-%m-%d %H:%M:%S' "$f" 2>/dev/null \
       || printf '?')
     # Strip CR/LF + truncate cwd — `cwd` comes from raw hook input and
     # isn't sanitized on write, so unusual directory names can contain
     # newlines/control chars that would otherwise bleed into the
     # AskUserQuestion prompt context.
     sid=$(printf '%s' "$sid" | tr -d '\r\n' | cut -c1-64)
     cwd=$(printf '%s' "$cwd" | tr -d '\r\n' | cut -c1-80)
     title=$(printf '%s' "$title" | tr -d '\r\n' | cut -c1-80)
     SAMPLES="${SAMPLES}- $(basename -- "$f")  [session=${sid} cwd=${cwd} mtime=${mtime}]"$'\n'
     SAMPLES="${SAMPLES}    preview: ${title}"$'\n'
   done < <(printf '%s\n' "$PREVIEW_LIST")
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

6. **Resolve the claude binary + spawn the disowned drain subshell.**
   Single Bash block: each Bash tool call is a fresh subprocess, so
   `CLAUDE_BIN`, `PENDING_COUNT`, and `DRAIN_LOG` must all be derived
   in the same block that uses them. Identical dispatch to
   `hooks/scripts/session-start.sh` — the `EXIT` trap removes the lock;
   this command does NOT wait for drain completion. The
   `COMPOUND_DRAIN_CMD` override is gated on `BATS_VERSION` because
   without it any attacker who can plant the env var (malicious
   `.envrc`, shell profile) would have a production drain-hijack vector.

   ```bash
   # Re-source compound-staging.sh: helpers from Step 1's block are out
   # of scope here. Without this, cs_detect_auth_route +
   # cs_update_drain_budget would be undefined and manual drains would
   # log empty auth and never update drain-budget.json — silently
   # diverging from session-start.sh.
   . "${CLAUDE_PLUGIN_ROOT}/lib/compound-staging.sh"

   # Re-derive PENDING_COUNT from Step 2 — its variable is gone with the
   # previous subprocess. Substitute inline if the runner inlined Step 2.
   PENDING_COUNT=$(find "$STAGING_DIR/pending" -maxdepth 1 -name '*.jsonl' -type f 2>/dev/null \
     | wc -l | tr -d '[:space:]')

   # Resolve the claude binary (was Step 6 in earlier drafts; merged here
   # so the lock-cleanup-on-error path can run without a stranded subshell).
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

   # Restrictive perms on drain-logs/: drain logs can include transcript
   # fragments past redaction. Match session-start.sh (chmod 700 + umask 077
   # so log files default to 0600). Without this, world-readable logs would
   # leak session content on shared CI runners / multi-user machines.
   mkdir -p -- "$STAGING_DIR/drain-logs" 2>/dev/null || true
   chmod 700 -- "$STAGING_DIR/drain-logs" 2>/dev/null || true
   DRAIN_LOG="$STAGING_DIR/drain-logs/manual-$(date +%Y%m%d-%H%M%S).log"
   ( umask 077; : > "$DRAIN_LOG" ) 2>/dev/null || true

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

   # Wall-clock cap for the drain subshell (matches session-start.sh).
   # Without this, a hung `claude -p` would hold .drain-lock until the
   # stale-lock reaper fires on a future SessionStart.
   case "${COMPOUND_DRAIN_TIMEOUT_S:-600}" in
     ''|*[!0-9]*|0) COMPOUND_DRAIN_TIMEOUT_S=600 ;;
   esac

   # `timeout` is GNU coreutils; gracefully fall through if unavailable
   # (common default on macOS / BSD). Without this check the dispatch
   # would invoke a non-existent `timeout` binary, the subshell would
   # exit immediately, and the user would see a "dispatched" message
   # while no drain work actually ran. Mirrors session-start.sh.
   DRAIN_TIMEOUT_BIN=$(command -v timeout 2>/dev/null || true)

   # Export STAGING_DIR before the subshell so the EXIT trap can read it
   # by name (not by definition-time interpolation). The previous form
   # baked the path into a single-quoted string, so any `"` in the path
   # would break the trap payload and leak the lock — a project with
   # `"` in its name would silently disable concurrent-drain protection.
   export STAGING_DIR
   (
     trap 'rmdir "${STAGING_DIR}/.drain-lock" 2>/dev/null || true' EXIT INT TERM
     export COMPOUND_DRAIN_IN_PROGRESS=1
     printf '[compound:review-staged] manual drain dispatch %s (auth=%s, pending=%s, timeout=%s)\n' \
       "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$AUTH_ROUTE" "$PENDING_COUNT" \
       "${DRAIN_TIMEOUT_BIN:+${COMPOUND_DRAIN_TIMEOUT_S}s}${DRAIN_TIMEOUT_BIN:-none}" \
       >> "$DRAIN_LOG" 2>/dev/null
     # NOTE: --bare is intentionally NOT used here, mirroring
     # session-start.sh (commit 64541309 fix(yellow-core): PR #542
     # round-2 — remove --bare from drain (agent unreachable)).
     # --bare disables plugin auto-discovery in the child session, so
     # `Task(subagent_type: "yellow-core:workflow:staging-reviewer")`
     # cannot resolve the agent and the drain becomes a silent no-op
     # (user sees "dispatched" but no promotions happen). Hook recursion
     # is instead guarded by the COMPOUND_DRAIN_IN_PROGRESS env var
     # short-circuit at the top of stop.sh + session-start.sh.
     if [ -n "$DRAIN_TIMEOUT_BIN" ]; then
       "$DRAIN_TIMEOUT_BIN" --preserve-status "${COMPOUND_DRAIN_TIMEOUT_S}s" \
         "$CLAUDE_BIN" -p "$DRAIN_PROMPT" \
         --max-turns 50 \
         --permission-mode bypassPermissions \
         --output-format json \
         >> "$DRAIN_LOG" 2>&1
     else
       "$CLAUDE_BIN" -p "$DRAIN_PROMPT" \
         --max-turns 50 \
         --permission-mode bypassPermissions \
         --output-format json \
         >> "$DRAIN_LOG" 2>&1
     fi
     cs_update_drain_budget "$STAGING_DIR" "$AUTH_ROUTE" || true
   ) >/dev/null 2>&1 &
   disown

   # Report dispatch from the same block that defined DRAIN_LOG — the
   # variable would not survive a separate Bash tool call. The drain
   # runs asynchronously; the user gets the prompt back immediately.
   printf '[compound:review-staged] dispatched. Tail with: tail -f %s\n' "$DRAIN_LOG"
   ```

7. **Drain is asynchronous.** The disowned subshell continues writing
   to the drain log past return of this command. The `tail -f` line
   printed at the end of Step 6 is the canonical place to follow
   progress.

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
