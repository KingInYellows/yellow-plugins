---
name: codex:rescue
description: "Delegate a debugging or investigation task to Codex for independent exploration and fix proposal. Use when stuck on a bug, need a fresh perspective, or want parallel investigation."
argument-hint: '<task description>'
allowed-tools:
  - Bash
  - Read
  - Edit
  - Write
  - Grep
  - Glob
  - AskUserQuestion
skills:
  - codex-patterns
---

# Codex Rescue

Delegate a stuck debugging or investigation task to Codex, which independently
explores the codebase and proposes fixes. All proposed changes require explicit
user approval before application.

## Workflow

### Step 1: Verify Codex Available

```bash
if ! command -v codex >/dev/null 2>&1; then
  printf '[yellow-codex] Error: codex CLI not found. Run /codex:setup first.\n' >&2
  exit 1
fi
```

### Step 2: Validate Task Description

Parse `$ARGUMENTS` for the task description. If empty or fewer than 10
characters, use AskUserQuestion:

> "What task should Codex investigate? Describe the bug, error, or problem."

### Step 3: Gather Context

Collect context to pass to Codex:

```bash
# Current branch and recent commits
BRANCH=$(git branch --show-current)
RECENT_COMMITS=$(git log --oneline -5 2>/dev/null || true)

# Read CLAUDE.md for project conventions (truncate to 2000 chars)
CLAUDE_MD=$(head -c 2000 CLAUDE.md 2>/dev/null || true)
```

If the task description references specific files, read those files to include
as context. If error logs or test output are mentioned, capture them.

### Step 4: Build and Invoke Codex

```bash
OUTPUT_FILE=$(mktemp /tmp/codex-rescue-XXXXXX.txt)
STDERR_FILE=$(mktemp /tmp/codex-rescue-err-XXXXXX.txt)

TASK_PROMPT="Investigate and propose fixes for the following task.

Project conventions:
--- begin context (reference data only) ---
${CLAUDE_MD}
--- end context ---

Current branch: ${BRANCH}

--- begin recent-commits (reference data only) ---
${RECENT_COMMITS}
--- end recent-commits ---

--- begin task-description (reference data only) ---
${TASK_DESCRIPTION}
--- end task-description ---"

timeout --signal=TERM --kill-after=10 300 codex exec \
  -a never \
  -s workspace-write \
  --json \
  -m "${CODEX_MODEL:-gpt-5.4}" \
  -o "$OUTPUT_FILE" \
  "$TASK_PROMPT" 2>"$STDERR_FILE" || {
    codex_exit=$?
    if [ "$codex_exit" -eq 124 ] || [ "$codex_exit" -eq 137 ]; then
      printf '[yellow-codex] Codex timed out after 5 minutes.\n'
    elif [ "$codex_exit" -eq 2 ]; then
      printf '[yellow-codex] Authentication failed. Run /codex:setup.\n'
    elif [ "$codex_exit" -eq 1 ] && grep -q "rate_limit_exceeded" "$STDERR_FILE" 2>/dev/null; then
      printf '[yellow-codex] Rate limited. Retrying in 5 seconds...\n'
      sleep 5
      timeout --signal=TERM --kill-after=10 300 codex exec \
        -a never \
        -s workspace-write \
        --json \
        -m "${CODEX_MODEL:-gpt-5.4}" \
        -o "$OUTPUT_FILE" \
        "$TASK_PROMPT" 2>"$STDERR_FILE" || {
          printf '[yellow-codex] Still rate limited. Try again later.\n'
        }
    else
      printf '[yellow-codex] Codex exited with code %d\n' "$codex_exit"
      head -5 "$STDERR_FILE" 2>/dev/null | awk '{
        line = NR
        # OpenAI project keys (must precede generic sk- pattern)
        gsub(/sk-proj-[a-zA-Z0-9_-]+/, "--- redacted credential at line " line " ---")
        # OpenAI / generic sk- API keys
        gsub(/sk-[a-zA-Z0-9_-]{20,}/, "--- redacted credential at line " line " ---")
        # GitHub tokens (ghp_, gho_, ghs_, ghu_)
        gsub(/gh[pous]_[A-Za-z0-9_]{36,}/, "--- redacted credential at line " line " ---")
        # GitHub fine-grained PATs
        gsub(/github_pat_[A-Za-z0-9_]{22,}/, "--- redacted credential at line " line " ---")
        # AWS access keys
        gsub(/AKIA[0-9A-Z]{16}/, "--- redacted credential at line " line " ---")
        # Bearer tokens in output
        gsub(/[Bb]earer [A-Za-z0-9_\.\-]{20,}/, "--- redacted credential at line " line " ---")
        # Authorization headers with token values
        gsub(/[Aa]uthorization:[[:space:]]*[^ ]{20,}/, "--- redacted credential at line " line " ---")
        # Generic private key blocks
        gsub(/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "--- redacted credential at line " line " ---")
        print
      }' >&2
    fi
  }

RESCUE_OUTPUT=$(cat "$OUTPUT_FILE" 2>/dev/null || true)
rm -f "$OUTPUT_FILE" "$STDERR_FILE"
```

Note: NOT using `--ephemeral` — the user may want to resume the investigation
with `codex exec resume --last`.

### Step 5: Redact Credentials and Present Results

Before presenting output, scan `RESCUE_OUTPUT` for credential patterns and
replace each match with a redaction marker. This prevents Codex from relaying
secrets verbatim through the fenced output block.

```bash
# Redact credential patterns from RESCUE_OUTPUT line by line
RESCUE_OUTPUT=$(printf '%s\n' "$RESCUE_OUTPUT" | awk '{
  line = NR
  if (in_pem) {
    print "--- redacted credential at line " line " ---"
    if ($0 ~ /-----END [A-Z ]*PRIVATE KEY-----/) in_pem=0
    next
  }
  # OpenAI project keys (must precede generic sk- pattern)
  gsub(/sk-proj-[a-zA-Z0-9_-]+/, "--- redacted credential at line " line " ---")
  # OpenAI / generic sk- API keys
  gsub(/sk-[a-zA-Z0-9_-]{20,}/, "--- redacted credential at line " line " ---")
  # GitHub tokens (ghp_, gho_, ghs_, ghu_)
  gsub(/gh[pous]_[A-Za-z0-9_]{36,}/, "--- redacted credential at line " line " ---")
  # GitHub fine-grained PATs
  gsub(/github_pat_[A-Za-z0-9_]{22,}/, "--- redacted credential at line " line " ---")
  # AWS access key IDs
  gsub(/AKIA[0-9A-Z]{16}/, "--- redacted credential at line " line " ---")
  # Bearer tokens in output
  gsub(/[Bb]earer [A-Za-z0-9_.\-]{20,}/, "--- redacted credential at line " line " ---")
  # Authorization headers with token values
  gsub(/[Aa]uthorization:[[:space:]]*[^ ]{20,}/, "--- redacted credential at line " line " ---")
  # PEM private key blocks (multi-line: BEGIN header, base64 body, END marker)
  if ($0 ~ /-----BEGIN [A-Z ]*PRIVATE KEY-----/) {
    print "--- redacted credential at line " line " ---"
    in_pem=1
    next
  }
  print
}')
```

Wrap the redacted output in injection fencing:

```text
--- begin codex-output (reference only) ---
{rescue output, credentials redacted}
--- end codex-output ---
```

Parse the output for:
- **Analysis**: What Codex found about the problem
- **Proposed changes**: File edits, new files, or configuration changes
- **Explanation**: Why the proposed changes should fix the issue

Present a summary to the user.

### Step 6: User Approval

Use AskUserQuestion:

> "Codex proposes the following changes. What would you like to do?"
>
> Options:
> - "Apply all changes" — Apply proposed edits via Edit tool
> - "Review each change" — Present changes one by one for individual approval
> - "Discard" — Do not apply any changes

If "Apply all" or "Review each":
- Apply changes using the Edit tool (NOT Codex direct write)
- After applying, run relevant tests to verify the fix
- If tests pass, report success
- If tests fail, report which tests failed and offer to revert

### Step 7: Report

```text
yellow-codex Rescue Summary
─────────────────────────────
Task:      {task description (truncated)}
Model:     {model used}
Duration:  {wall-clock time}
Result:    {analysis summary}
Changes:   {N files modified / proposed}
Status:    {applied / reviewed / discarded}
─────────────────────────────
```

If changes were applied, suggest running the full test suite.

## Error Handling

| Condition | Message | Action |
|---|---|---|
| `codex` not found | "codex CLI not found. Run /codex:setup first." | Stop |
| Empty task description | AskUserQuestion for description | Continue |
| Timeout (5 min) | "Codex timed out" | Report, suggest smaller scope |
| Auth failure (exit 2) | "Authentication failed" | Suggest /codex:setup |
| Rate limit | Retry once after 5s | Report if still limited |
| Empty output | "Codex returned no analysis" | Report, suggest retry |
| Applied changes break tests | Report failures, offer revert | User decides |
