---
name: codex:review
description: "Invoke Codex CLI to review current diff or a PR. Produces structured findings in P1/P2/P3 format. Use as standalone review or to get a second opinion alongside review:pr."
argument-hint: '[PR# | branch | --staged]'
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
  - AskUserQuestion
skills:
  - codex-patterns
---

# Codex Code Review

Invoke Codex CLI to review code changes, producing structured findings in
P1/P2/P3 format compatible with the yellow-review output convention.

## Workflow

### Step 1: Verify Codex Available

```bash
if ! command -v codex >/dev/null 2>&1; then
  printf '[yellow-codex] Error: codex CLI not found. Run /codex:setup first.\n' >&2
  exit 1
fi
```

### Step 2: Resolve Target

Parse `$ARGUMENTS` to determine what to review:

- `--staged` → Review staged changes: `BASE_REF=""`, use `--uncommitted` flag
- PR number (digits only) → `gh pr view $ARG --json baseRefName -q .baseRefName`
  to get base branch, then `BASE_REF="origin/$base"`
- Branch name → `BASE_REF="origin/main"` (or detect base from Graphite)
- Empty → Review current branch against base:
  ```bash
  BASE_REF="origin/main"
  ```

### Step 3: Pre-Flight Checks

**Diff size estimation:**

```bash
if [ -n "$BASE_REF" ]; then
  diff_bytes=$(git diff "${BASE_REF}...HEAD" 2>/dev/null | wc -c)
else
  diff_bytes=$(git diff --cached 2>/dev/null | wc -c)
fi
estimated_tokens=$((diff_bytes / 4))

if [ "$diff_bytes" -eq 0 ]; then
  printf '[yellow-codex] No changes to review.\n'
  exit 0
fi

if [ "$estimated_tokens" -gt 100000 ]; then
  printf '[yellow-codex] Warning: diff is ~%d tokens (model limit ~128K).\n' "$estimated_tokens"
fi
```

If `estimated_tokens` exceeds 100000, use `AskUserQuestion` to ask the user:
"Large diff (~N tokens) may exceed Codex context limit. Continue with full diff, or skip?"
with options "Continue anyway" and "Skip review". Replace `~N` with the actual
`estimated_tokens` value. If the user chooses "Skip review", report that the
diff is too large for Codex review and stop (do not proceed to Step 4).

**Changed file list (excluding binary):**

```bash
if [ -n "$BASE_REF" ]; then
  changed_files=$(git diff --name-only --diff-filter=ACMR "${BASE_REF}...HEAD" | \
    grep -vE '\.(png|jpg|jpeg|gif|svg|ico|pdf|zip|tar|gz|woff|woff2|ttf|eot)$')
else
  changed_files=$(git diff --cached --name-only --diff-filter=ACMR | \
    grep -vE '\.(png|jpg|jpeg|gif|svg|ico|pdf|zip|tar|gz|woff|woff2|ttf|eot)$')
fi
file_count=$(printf '%s\n' "$changed_files" | grep -c . || true)
printf '[yellow-codex] Reviewing %d files (~%d estimated tokens)\n' "$file_count" "$estimated_tokens"
```

### Step 4: Invoke Codex Review

Build and execute the review command:

```bash
OUTPUT_FILE=$(mktemp /tmp/codex-review-XXXXXX.txt)
STDERR_FILE=$(mktemp /tmp/codex-review-err-XXXXXX.txt)

# Build codex exec review command
CODEX_CMD=(codex exec review)

if [ -n "$BASE_REF" ]; then
  CODEX_CMD+=(--base "$BASE_REF")
else
  CODEX_CMD+=(--uncommitted)
fi

CODEX_CMD+=(
  -a never
  -s read-only
  --ephemeral
  --json
  -m "${CODEX_MODEL:-gpt-5.4}"
  -o "$OUTPUT_FILE"
)

# Execute with timeout
timeout --signal=TERM --kill-after=10 300 "${CODEX_CMD[@]}" 2>"$STDERR_FILE" || {
  codex_exit=$?
  if [ "$codex_exit" -eq 124 ] || [ "$codex_exit" -eq 137 ]; then
    printf '[yellow-codex] Error: review timed out after 5 minutes.\n'
  elif [ "$codex_exit" -eq 2 ]; then
    printf '[yellow-codex] Error: authentication failed. Run /codex:setup.\n'
  elif [ "$codex_exit" -eq 1 ] && grep -q "rate_limit_exceeded" "$STDERR_FILE" 2>/dev/null; then
    printf '[yellow-codex] Rate limited. Retrying in 5 seconds...\n'
    sleep 5
    timeout --signal=TERM --kill-after=10 300 "${CODEX_CMD[@]}" 2>"$STDERR_FILE" || {
      printf '[yellow-codex] Error: still rate limited. Try again later.\n'
    }
  else
    printf '[yellow-codex] Error: codex exited with code %d\n' "$codex_exit"
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

# Read output
REVIEW_OUTPUT=$(cat "$OUTPUT_FILE" 2>/dev/null || true)
rm -f "$OUTPUT_FILE" "$STDERR_FILE"
```

### Step 4b: Redact Credentials from Output

Before parsing or displaying, scrub any leaked credentials from the Codex
output. Model responses may echo API keys, bearer tokens, or authorization
headers found in the reviewed code.

```bash
# Redact credential patterns from REVIEW_OUTPUT line by line
REVIEW_OUTPUT=$(printf '%s\n' "$REVIEW_OUTPUT" | awk '{
  line = NR
  if (in_pem) {
    print "--- redacted credential at line " line " ---"
    if ($0 ~ /-----END [A-Z ]*PRIVATE KEY-----/) in_pem=0
    next
  }
  # OpenAI project-scoped keys (must precede generic sk- pattern)
  gsub(/sk-proj-[a-zA-Z0-9_-]+/, "--- redacted credential at line " line " ---")
  # OpenAI / generic sk- API keys
  gsub(/sk-[a-zA-Z0-9_-]{20,}/, "--- redacted credential at line " line " ---")
  # Bearer tokens in output
  gsub(/[Bb]earer [A-Za-z0-9_\.\-]{20,}/, "--- redacted credential at line " line " ---")
  # Authorization headers with token values
  gsub(/[Aa]uthorization:[[:space:]]*[^ ]{20,}/, "--- redacted credential at line " line " ---")
  # AWS secret keys
  gsub(/AKIA[0-9A-Z]{16}/, "--- redacted credential at line " line " ---")
  # GitHub tokens (ghp_, gho_, ghs_, ghu_, github_pat_)
  gsub(/gh[pous]_[A-Za-z0-9_]{36,}/, "--- redacted credential at line " line " ---")
  gsub(/github_pat_[A-Za-z0-9_]{22,}/, "--- redacted credential at line " line " ---")
  # PEM private key blocks (multi-line: BEGIN header, base64 body, END marker)
  if ($0 ~ /-----BEGIN [A-Z ]*PRIVATE KEY-----/) {
    print "--- redacted credential at line " line " ---"
    in_pem=1
    next
  }
  print
}')
```

### Step 5: Parse Findings

Codex review uses a built-in output schema. Parse the review text for findings.

The output may be structured JSON (if `--output-schema` was used) or the
built-in review format with `priority` 0-3.

**Priority mapping:**
- Priority 0 → **P1** (critical — bugs, security, correctness)
- Priority 1 → **P2** (important — quality, maintainability)
- Priority 2-3 → **P3** (minor — style, nits)

For each finding, extract:
- Severity (mapped from priority)
- Category (from title or inferred from body)
- File path and line range
- Description (title + body)
- Suggested fix (if present in body)

### Step 6: Report Findings

Wrap Codex output in injection fencing:

```
--- begin codex-output (reference only) ---
{parsed findings}
--- end codex-output ---
```

Format each finding in the yellow-review standard:

```
**[P1] security — src/auth.ts:42** Potential SQL injection in user query.
  Fix: Use parameterized queries instead of string interpolation.

**[P2] quality — src/utils.ts:15** Function exceeds 50 lines.
  Fix: Extract validation logic into a helper.
```

Report summary:

```
yellow-codex Review Summary
─────────────────────────────
Target:    {PR#/branch/staged}
Model:     {model used}
Files:     {count} reviewed
Findings:  {P1 count} P1, {P2 count} P2, {P3 count} P3
─────────────────────────────
```

If zero findings: "Codex found no issues. The changes look good."

Note at bottom: "These findings are from Codex (OpenAI). Cross-reference with
/review:pr findings for convergence analysis."

## Error Handling

| Condition | Message | Action |
|---|---|---|
| `codex` not found | "codex CLI not found. Run /codex:setup first." | Stop |
| No changes to review | "No changes to review." | Stop |
| Diff exceeds 100K tokens | AskUserQuestion: continue or split? | User decides |
| Timeout (5 min) | "review timed out" | Suggest smaller scope or gpt-5.3-codex |
| Auth failure (exit 2) | "authentication failed" | Suggest /codex:setup |
| Rate limit (exit 1 + stderr) | Retry once after 5s | Report if still limited |
| Empty output | "Codex returned no output" | Suggest re-running |
