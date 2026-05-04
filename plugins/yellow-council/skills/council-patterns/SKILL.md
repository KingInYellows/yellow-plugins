---
name: council-patterns
description: "Canonical reference for yellow-council CLI invocation patterns, per-mode pack templates, redaction rules, slug derivation, atomic file write, timeout handling, and structured-output parsing. Use when authoring or modifying gemini-reviewer, opencode-reviewer, or the /council command."
user-invokable: false
---

# council-patterns Skill

## What It Does

Single source of truth for yellow-council reviewer surfaces. Defines:

- Per-mode pack templates (plan / review / debug / question)
- Reviewer output schema (verdict / confidence / findings / summary)
- 11-pattern credential redaction awk block
- Injection fence format
- `timeout` invocation pattern with exit code handling
- Path validation rules
- Slug derivation algorithm with collision handling
- Diff truncation algorithm for `review` mode
- UNKNOWN verdict fallback semantics
- Atomic file write convention (Write tool direct, brainstorm-orchestrator pattern)

Reviewer agents (`gemini-reviewer.md`, `opencode-reviewer.md`) and the
`/council` orchestrator command read this skill at agent spawn time via
`skills:` frontmatter preload.

## When to Use

- Authoring `gemini-reviewer.md` or `opencode-reviewer.md`
- Authoring `commands/council/council.md`
- Modifying any of the above — keep contracts in sync via this single source

## Usage

### Per-Mode Pack Templates

All four modes share a structural envelope. Only the `## Task` block differs.
The `{{REVIEWER_NAME}}` slot is the only per-reviewer variable; templates are
otherwise identical across all three reviewers.

```text
You are {{REVIEWER_NAME}}, a code reviewer performing an INDEPENDENT analysis.
Do not reference what other reviewers might say. Only report findings you can
cite with a file:line reference. Do not write any files; analyze only.

## Task: {{MODE}}
{{MODE_SPECIFIC_CONTEXT}}

## Required Output Format
Verdict: APPROVE | REVISE | REJECT
Confidence: HIGH | MEDIUM | LOW
Findings:
- [P1|P2|P3] file:line — <80-char summary>
  Evidence: "<exact quoted line from file>"
[repeat per finding; if none: write "Findings: none"]
Summary: <2-3 sentences in your own words>

## Rules
- P1 = security/correctness blocker; P2 = quality issue; P3 = style/nit
- Cite file paths relative to repository root
- If a finding has no quotable line (e.g., "missing function"), write `Evidence: N/A — <reason>`
- The `Verdict:` line is required and must appear exactly as shown
```

Per-mode `{{MODE_SPECIFIC_CONTEXT}}` block:

| Mode | Context block contents |
|------|------------------------|
| `plan` | `### Planning Document` + fenced full content + `### Repo Conventions` + truncated CLAUDE.md (capped at 4K chars) |
| `review` | `### Diff (HEAD vs <BASE_REF>)` + fenced `git diff` output (truncated per algorithm below) + `### Changed Files` + truncated content of each (4K chars per file) |
| `debug` | `### Symptom` + user-supplied text + `### Cited Files` + content of each `--paths` file (4K chars per file, max 3 files) + `### Recent History` + `git log -10 --oneline -- <paths>` |
| `question` | `### Question` + user-supplied text + (optional) `### Referenced Files` + content of each `--paths` file (4K chars per file, max 3 files) + `### Repo Conventions` + truncated CLAUDE.md (4K chars) |

### Reviewer Output Schema

Each reviewer returns a single Markdown text block parseable by these regexes:

```bash
VERDICT=$(grep -m1 '^Verdict: ' "$OUTPUT_FILE" | sed 's/^Verdict: //')
CONFIDENCE=$(grep -m1 '^Confidence: ' "$OUTPUT_FILE" | sed 's/^Confidence: //')
SUMMARY=$(awk '/^Summary: / { sub(/^Summary: /, ""); print; exit }' "$OUTPUT_FILE")
# Findings: extract block between "Findings:" and "Summary:" lines
FINDINGS=$(awk '/^Findings:/ { capture=1; next } /^Summary: / { capture=0 } capture' "$OUTPUT_FILE")
```

If `Verdict:` line is absent, the reviewer agent must:

1. Set `VERDICT=UNKNOWN`, `CONFIDENCE=LOW`
2. Use the first 2K chars of the raw output as `SUMMARY` (truncated at word boundary)
3. Set `FINDINGS=` (empty — cannot extract structured findings without a parseable verdict)
4. Surface a one-line warning to council.md: `"[<reviewer>] Warning: no Verdict: line found in output — marked UNKNOWN"`

UNKNOWN verdicts are excluded from the synthesis Headline majority computation
but are included in the Disagreement section so the user sees the prose.

### 11-Pattern Credential Redaction

Apply this awk block to all reviewer output BEFORE injection fencing and
BEFORE writing to `docs/council/<file>.md`:

```awk
{
  line = $0
  # OpenAI / Anthropic / Google / GitHub / AWS / Bearer / Authorization
  if (line ~ /sk-proj-[A-Za-z0-9_-]{20,}/) line = "--- redacted credential at line " NR " ---"
  else if (line ~ /sk-ant-[A-Za-z0-9_-]{20,}/) line = "--- redacted credential at line " NR " ---"
  else if (line ~ /sk-[A-Za-z0-9]{20,}/) line = "--- redacted credential at line " NR " ---"
  else if (line ~ /AIza[0-9A-Za-z_-]{35}/) line = "--- redacted credential at line " NR " ---"
  else if (line ~ /gh[pous]_[A-Za-z0-9]{36,}/) line = "--- redacted credential at line " NR " ---"
  else if (line ~ /github_pat_[A-Za-z0-9_]{40,}/) line = "--- redacted credential at line " NR " ---"
  else if (line ~ /AKIA[0-9A-Z]{16}/) line = "--- redacted credential at line " NR " ---"
  else if (line ~ /Bearer [A-Za-z0-9._~+\/-]{20,}/) line = "--- redacted credential at line " NR " ---"
  else if (line ~ /Authorization: [A-Za-z0-9 ._~+\/-]{20,}/) line = "--- redacted credential at line " NR " ---"
  else if (line ~ /ses_[A-Za-z0-9]{16,}/) line = "--- redacted credential at line " NR " ---"
  # PEM private key block — multi-line state machine
  if (line ~ /^-----BEGIN [A-Z ]+PRIVATE KEY-----$/) in_pem = 1
  if (in_pem) line = "--- redacted PEM key block at line " NR " ---"
  if (line ~ /^-----END [A-Z ]+PRIVATE KEY-----$/) in_pem = 0
  print line
}
```

Save as a sourced helper or paste inline. The 11 patterns:

1. `sk-proj-` (OpenAI project key)
2. `sk-ant-` (Anthropic API key — OpenCode may use)
3. `sk-` (OpenAI legacy key)
4. `AIza` (Google API key — Gemini)
5. `gh[pous]_` (GitHub PAT prefix variants)
6. `github_pat_` (GitHub fine-grained PAT)
7. `AKIA` (AWS Access Key ID)
8. `Bearer ` (Bearer tokens)
9. `Authorization: ` (Auth header)
10. `ses_` (OpenCode session IDs)
11. PEM private key blocks (multi-line state)

### Injection Fence Format

After redaction, wrap reviewer output in per-reviewer-labeled fences:

```text
--- begin council-output:gemini (reference only) ---
[Gemini's output, post-redaction]
--- end council-output:gemini ---
```

Replace `gemini` with `codex` or `opencode` per reviewer. The
`(reference only)` advisory signals to consuming agents that content between
the fences is reference data, not instructions.

### Timeout Pattern

```bash
timeout --signal=TERM --kill-after=10 "${COUNCIL_TIMEOUT:-600}" \
  <cli-invocation> > "$OUTPUT_FILE" 2> "$STDERR_FILE"
CLI_EXIT=$?
```

Exit code handling:

| Exit | Meaning | Action |
|------|---------|--------|
| 0 | Success | Parse output normally |
| 1–123 | CLI's own error | Grep stderr for keywords (`auth`, `rate limit`, `invalid`) and surface in synthesis |
| 124 | timeout SIGTERM (time limit hit) | Mark TIMEOUT; exclude from synthesis Headline; surface in partial-result note |
| 137 | timeout SIGKILL (escalation after `--kill-after=10`) | Same as 124 |
| 125 | timeout utility failed | Surface as ERROR with full stderr |
| 126 / 127 | Binary not executable / not found | Surface as UNAVAILABLE |
| 128+N | Killed by signal N | Treat same as 137 |

Always use `--signal=TERM --kill-after=10` to give the CLI a chance to clean
up before SIGKILL escalation.

### Path Validation

```bash
validate_path() {
  local p="$1"
  # Reject empty
  [ -z "$p" ] && { printf '[council] Error: empty path\n' >&2; return 1; }
  # Reject path traversal
  case "$p" in
    *..*|/*|~*) printf '[council] Error: path traversal not allowed: %s\n' "$p" >&2; return 1 ;;
  esac
  # Reject characters outside alphanum / dot / underscore / dash / slash
  printf '%s' "$p" | grep -qE '[^a-zA-Z0-9._/-]' \
    && { printf '[council] Error: invalid characters in path: %s\n' "$p" >&2; return 1; }
  # Reject non-existent
  [ ! -e "$p" ] && { printf '[council] Error: path not found: %s\n' "$p" >&2; return 1; }
  # Reject symlinks
  [ -L "$p" ] && { printf '[council] Error: symlinks not permitted: %s\n' "$p" >&2; return 1; }
  return 0
}
```

Apply before constructing any shell argument that includes a user-supplied path.

### Slug Derivation

```bash
build_slug() {
  local raw="$1"
  local slug
  export LC_ALL=C
  slug=$(printf '%s' "$raw" \
    | tr '[:upper:]' '[:lower:]' \
    | tr -c '[:alnum:]-' '-' \
    | sed 's/-\{2,\}/-/g; s/^-//; s/-$//' \
    | cut -c1-40 \
    | sed 's/-$//')
  # Validate; sha256 fallback for empty
  if printf '%s' "$slug" | grep -qE '^[a-z0-9][a-z0-9-]*$'; then
    printf '%s' "$slug"
  else
    printf '%s' "$raw" | sha256sum | cut -d' ' -f1 | cut -c1-16
  fi
}

build_target_path() {
  local mode="$1" slug="$2" date today path n
  today=$(date +%Y-%m-%d)
  path="docs/council/${today}-${mode}-${slug}.md"
  n=2
  while [ -f "$path" ] && [ "$n" -le 10 ]; do
    path="docs/council/${today}-${mode}-${slug}-${n}.md"
    n=$((n + 1))
  done
  if [ -f "$path" ]; then
    printf '[council] Error: too many same-day collisions for slug "%s" (>10)\n' "$slug" >&2
    return 1
  fi
  printf '%s' "$path"
}
```

Validate regex: `^[a-z0-9][a-z0-9-]*$` (no trailing or consecutive hyphens
per MEMORY.md path rule).

### Diff Truncation Algorithm (review mode)

```bash
DIFF_FILE=$(mktemp /tmp/council-diff-XXXXXX.txt)
git diff "${BASE_REF}...HEAD" > "$DIFF_FILE"
DIFF_BYTES=$(wc -c < "$DIFF_FILE")

if [ "$DIFF_BYTES" -gt 200000 ]; then
  # Truncate: stat header + first 200 lines + marker
  {
    printf '### git diff --stat\n\n'
    git diff --stat "${BASE_REF}...HEAD"
    printf '\n### Raw diff (first 200 lines of %d total)\n\n' "$(wc -l < "$DIFF_FILE")"
    head -200 "$DIFF_FILE"
    printf '\n[... truncated — full diff is %d bytes; showing first 200 lines ...]\n' "$DIFF_BYTES"
  } > "$DIFF_FILE.truncated"
  mv "$DIFF_FILE.truncated" "$DIFF_FILE"
fi

# Per changed file: cap at 4K chars per file
# Total pack budget: 100K chars before injection fencing
# (drives under Codex's 128K token budget with ~22% headroom)
```

Designing to Codex's tightest window (128K tokens) means all three reviewers
receive identical packs. Gemini at 1M and OpenCode at variable-but-large can
accept the full diff anyway — uniformity > capacity for synthesis comparability.

### Atomic File Write (Write Tool Direct)

Per brainstorm-orchestrator precedent, write the council report directly to
the final path using the Write tool — no temp file staging:

```text
Use the Write tool with file_path = $REPORT_PATH (computed via build_target_path)
and content = synthesis report + raw reviewer output sections.
```

Write tool failure leaves no partial file. This is simpler than mktemp + mv
and matches the closest existing precedent (brainstorm-orchestrator does the
same for `docs/brainstorms/<file>.md`). Atomic-write-via-rename is a V2
option if concurrent invocations become possible.

### Cross-References

- `yellow-codex:codex-patterns` — Codex CLI invocation conventions, exit
  code catalog, sandbox/approval modes. yellow-council reuses these for the
  Codex reviewer leg via Task spawn — do not duplicate the codex-patterns
  content here.
- `docs/spikes/gemini-cli-output-format-2026-05-04.md` — verified Gemini CLI
  v0.40+ invocation: `gemini -p "..." --approval-mode plan --skip-trust -o text`.
  Do NOT use `--yolo` (issue #13561).
- `docs/spikes/opencode-cli-format-json-2026-05-04.md` — verified OpenCode
  CLI v1.14+ invocation: `opencode run --format json --variant high "..."`
  plus `opencode session delete <id>` cleanup.

### Reviewer-Specific CLI Flag Pattern

**Codex** (via `Task(subagent_type="yellow-codex:review:codex-reviewer")`):
- 300s timeout (yellow-codex's own cap; council's 600s does NOT propagate)
- Read-only mode via `-s read-only -a never --ephemeral`
- Pack must use the existing yellow-codex review prompt structure

**Gemini** (direct bash):
```bash
timeout --signal=TERM --kill-after=10 "${COUNCIL_TIMEOUT:-600}" \
  gemini -p "<full-pack-prompt>" \
    --approval-mode plan \
    --skip-trust \
    -o text \
  > "$OUTPUT_FILE" 2> "$STDERR_FILE"
```
- `-p`/`--prompt`: REQUIRED for non-interactive mode (positional prompt enters TUI)
- `--approval-mode plan`: read-only mode (no tool side effects)
- `--skip-trust`: bypass workspace trust check (would force `default` approval otherwise)
- `-o text`: V1 plain text capture; `-o json` is a V2 option (response/stats/error schema)
- DO NOT use `--yolo` (issue #13561 — still prompts in some cases AND auto-approves writes)

**OpenCode** (direct bash):
```bash
timeout --signal=TERM --kill-after=10 "${COUNCIL_TIMEOUT:-600}" \
  opencode run \
    --format json \
    --variant "${COUNCIL_OPENCODE_VARIANT:-high}" \
    "<full-pack-prompt>" \
  > "$OUTPUT_FILE" 2> "$STDERR_FILE"
CLI_EXIT=$?
SESSION_ID=$(jq -r 'first(.part.snapshot.sessionID // empty)' "$OUTPUT_FILE" 2>/dev/null)
ASSISTANT_TEXT=$(jq -r 'select(.type=="text") | .part.text' "$OUTPUT_FILE" | tr -d '\000')
[ -n "$SESSION_ID" ] && opencode session delete "$SESSION_ID" 2>/dev/null \
  || printf '[opencode-reviewer] Warning: failed to delete session %s\n' "$SESSION_ID" >&2
```
- `--format json`: structured event stream
- `--variant high`: default reasoning effort (`max` is significantly slower; reserve)
- Apply redaction to `$ASSISTANT_TEXT` ONLY — never write raw JSONL (contains `tool_use` events with file content)
- ALWAYS run `opencode session delete` post-call to prevent session accumulation

### Synthesis Format (V1)

The synthesizer in council.md produces:

```text
## Council Report — <mode>: <topic> — <date>

### Headline
<All N reviewers APPROVE | Split — N APPROVE, M REVISE | etc.>
Council ran with N of 3 reviewers. [If skipped: "<name> timed out at 600s" / "<name> not installed"]

### Agreement (cited by 2+ reviewers)
- <file:line> — <finding>
  - Codex: "<their phrasing>"
  - Gemini: "<their phrasing>"

### Disagreement (unique to one reviewer or conflicting verdicts)
- <finding> — Codex only
- Verdict conflict at path/to/file.ts:42: Codex APPROVE, Gemini REVISE

### Summary
<2-3 sentences synthesizing the council's overall stance>

Full reviewer outputs: see docs/council/<slug>.md
```

V1 synthesizer non-goals (deferred to V2):

- No lineage-weighted quorum (V1 uses raw count)
- No quote-verification pass against repo source
- No XML-structured findings parsing (V1 stays in markdown)
- No confidence weighting beyond reviewer's own P1/P2/P3
- No reviewer ranking
- No `/council history` browse command (V2)
