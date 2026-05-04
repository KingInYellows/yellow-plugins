---
name: council
description: "On-demand cross-lineage code review fanning out to Codex (via yellow-codex), Gemini, and OpenCode CLIs in parallel for advisory consensus. Modes: plan | review | debug | question."
argument-hint: '<plan|review|debug|question> [args]'
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
  - Task
  - AskUserQuestion
  - Write
skills:
  - council-patterns
---

# /council — Cross-Lineage Code Review

Fan out a context pack to Codex, Gemini, and OpenCode reviewers in parallel,
synthesize their verdicts inline, and persist the full report to
`docs/council/<date>-<mode>-<slug>.md`.

Output is **advisory and on-demand only** — never blocks merges, never
auto-commits, never auto-triggers. The user decides what to do with the
verdicts.

Read `council-patterns` skill for canonical CLI invocation patterns,
per-mode pack templates, redaction rules, slug derivation, timeout handling,
and atomic file write conventions.

## Workflow

> **Subshell isolation:** Each `bash` block below runs as a fresh subprocess.
> Variables, functions, and `cd` do not persist across blocks. Each block that
> needs `GIT_ROOT`, `MODE`, or `REST` re-derives those values from
> `$CLAUDE_PROJECT_DIR` / `$ARGUMENTS` / git at the top of that block.

### Step 1: Pre-flight prerequisites

```bash
# Required system tools
for tool in bash git timeout jq mktemp awk sed grep; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    printf '[council] Error: required tool "%s" not found\n' "$tool" >&2
    exit 1
  fi
done

# Bash 4.3+ check
BASH_MAJOR=${BASH_VERSINFO[0]:-0}
BASH_MINOR=${BASH_VERSINFO[1]:-0}
if [ "$BASH_MAJOR" -lt 4 ] || ([ "$BASH_MAJOR" -eq 4 ] && [ "$BASH_MINOR" -lt 3 ]); then
  printf '[council] Error: bash 4.3+ required, found %d.%d\n' "$BASH_MAJOR" "$BASH_MINOR" >&2
  exit 1
fi

# Verify we're in a git repo (most modes need git context)
GIT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || {
  printf '[council] Error: not in a git repository\n' >&2
  exit 1
}
cd "$GIT_ROOT"
```

If any of the above exits non-zero, stop. Do not proceed.

### Step 2: Argument parsing — mode dispatch

The user invokes `/council <mode> [args]`. Parse `$ARGUMENTS`:

```bash
MODE=$(printf '%s' "$ARGUMENTS" | awk '{print $1}')
REST=$(printf '%s' "$ARGUMENTS" | sed -E 's/^[^ ]+ *//')

case "$MODE" in
  plan|review|debug|question)
    # main logic continues below
    ;;
  fleet)
    printf '[council] fleet management not available in V1 — coming in V2\n'
    exit 0
    ;;
  "")
    # Bare /council — print help
    printf '[council] Usage: /council <mode> [args]\n\n'
    printf 'Modes:\n'
    printf '  plan <path-or-text>             Council on a planning doc or design proposal\n'
    printf '  review [--base <ref>]           Council on the current diff\n'
    printf '  debug "<symptom>" [--paths]     Council on a debug investigation\n'
    printf '  question "<text>" [--paths]    Open-ended council consultation\n\n'
    printf 'Configuration env vars (see plugin CLAUDE.md):\n'
    printf '  COUNCIL_TIMEOUT (default 600), COUNCIL_OPENCODE_VARIANT (high),\n'
    printf '  COUNCIL_PATH_CHAR_CAP (8000), COUNCIL_PATH_MAX_FILES (3)\n'
    exit 0
    ;;
  *)
    printf '[council] Error: unknown mode "%s"\n' "$MODE" >&2
    printf '[council] Valid modes: plan, review, debug, question\n' >&2
    exit 1
    ;;
esac
```

### Step 3: Per-mode input validation and pack assembly

Read the `council-patterns` skill for the per-mode pack template.

For each mode:

**`plan` mode:** `$REST` is either a file path or freeform text.
- If it's a file path: validate path (per skill `validate_path` function), read file content, cap at 100K chars total pack budget.
- If it's freeform: use as-is, cap at 100K chars.
- Pack: `## Task: plan` + `### Planning Document` + content + `### Repo Conventions` + truncated CLAUDE.md (first 4K chars).

**`review` mode:** Optional `--base <ref>` flag.
- Default `BASE_REF`:
  ```bash
  UPSTREAM=$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null)
  if [ -n "$UPSTREAM" ]; then
    BASE_BRANCH=$(printf '%s\n' "$UPSTREAM" | sed 's|.*/||')
  else
    BASE_BRANCH="main"
  fi
  BASE_REF=$(git merge-base HEAD "origin/${BASE_BRANCH}")
  ```
- Get diff: `git diff "${BASE_REF}...HEAD"`
- If diff exceeds 200K bytes: apply truncation algorithm (see skill — `git diff --stat` + first 200 lines + marker).
- Per changed file: `git diff --name-only "${BASE_REF}...HEAD"` then read each file capped at 4K chars.
- Pack: `## Task: review` + `### Diff` + truncated diff + `### Changed Files` + per-file content.

**`debug` mode:** `$REST` starts with quoted symptom text, then optional `--paths file1,file2,...`.
- Parse symptom (first quoted block).
- Parse `--paths`: validate each (limit 3 files, 8K chars each).
- For each path: capture `git log -10 --oneline -- "$path"` for recent history.
- Pack: `## Task: debug` + `### Symptom` + symptom text + `### Cited Files` + content + `### Recent History` + git log output.

**`question` mode:** `$REST` starts with quoted text, then optional `--paths`.
- Parse question (first quoted block).
- Parse `--paths` (same as debug).
- Pack: `## Task: question` + `### Question` + text + `### Referenced Files` (if any) + content + `### Repo Conventions` + truncated CLAUDE.md.

For all modes, append the standard `## Required Output Format` block from
the `council-patterns` skill at the end of the pack. This is what makes
each reviewer emit `Verdict: / Confidence: / Findings: / Summary:`.

Path validation MUST use the skill's `validate_path` function. Reject:

- Empty paths
- Path traversal (`..`, leading `/`, leading `~`)
- Characters outside `[a-zA-Z0-9._/-]`
- Non-existent paths
- Symlinks

Per-file content cap: `${COUNCIL_PATH_CHAR_CAP:-8000}` chars.
Per-invocation file count cap: `${COUNCIL_PATH_MAX_FILES:-3}`.

### Step 4: Parallel reviewer fan-out via Task

Spawn all three reviewers in a SINGLE message (Claude Code runs them
concurrently). The pack is the SAME for all three; only `{{REVIEWER_NAME}}`
in the prompt template differs.

In a single tool-call message, invoke:

1. `Task(subagent_type="yellow-codex:review:codex-reviewer", prompt=<pack with REVIEWER_NAME=Codex>)`
   - If yellow-codex is not installed, the spawn fails. Catch and mark Codex
     as `UNAVAILABLE (yellow-codex not installed)` in synthesis.
2. `Task(subagent_type="yellow-council:review:gemini-reviewer", prompt=<pack with REVIEWER_NAME=Gemini>)`
3. `Task(subagent_type="yellow-council:review:opencode-reviewer", prompt=<pack with REVIEWER_NAME=OpenCode>)`

Wait for all three Tasks to return. Each reviewer returns:

```text
verdict=<APPROVE|REVISE|REJECT|UNKNOWN|TIMEOUT|ERROR|UNAVAILABLE>
confidence=<HIGH|MEDIUM|LOW|N/A>
summary=<2-3 sentence summary>
fenced_output_path=<path to /tmp/council-<reviewer>-fenced-XXXXXX.txt>
findings_block_begin
<findings text>
findings_block_end
```

Parse each return value into structured data:

```bash
parse_reviewer_return() {
  local reviewer_output="$1"
  local reviewer_name="$2"
  local verdict confidence summary fenced_path findings
  verdict=$(printf '%s' "$reviewer_output" | grep -m1 '^verdict=' | sed 's/^verdict=//')
  confidence=$(printf '%s' "$reviewer_output" | grep -m1 '^confidence=' | sed 's/^confidence=//')
  summary=$(printf '%s' "$reviewer_output" | grep -m1 '^summary=' | sed 's/^summary=//')
  fenced_path=$(printf '%s' "$reviewer_output" | grep -m1 '^fenced_output_path=' | sed 's/^fenced_output_path=//')
  findings=$(printf '%s' "$reviewer_output" | awk '/^findings_block_begin$/{flag=1;next} /^findings_block_end$/{flag=0} flag')
  printf '[%s] verdict=%s confidence=%s\n' "$reviewer_name" "$verdict" "$confidence"
  # store in associative arrays for synthesis
}
```

If any reviewer's `verdict` is `TIMEOUT`, `ERROR`, or `UNAVAILABLE`, surface
the partial-result note in the synthesis Headline.

### Step 5: Synthesis — V1 simple

The V1 synthesizer produces:

```text
## Council Report — <mode>: <slug> — <date>

### Headline
<One-line summary based on counts:>
- All 3 reviewers APPROVE
- Split — N APPROVE, M REVISE
- All 3 reviewers REVISE
- Council ran with N of 3 reviewers (<excluded reviewers> <reason>)

### Agreement (cited by 2+ reviewers)
- <file:line> — <finding>
  - Codex: "<their phrasing>"
  - Gemini: "<their phrasing>"
  [...]

### Disagreement (unique to one reviewer or conflicting verdicts)
- <finding> — Codex only
- Verdict conflict at <file:line>: Codex APPROVE, Gemini REVISE
  - Codex: "<phrasing>"
  - Gemini: "<phrasing>"

### Summary
<2-3 sentences synthesizing the council's overall stance>

Full reviewer outputs: see <REPORT_PATH>
```

V1 synthesizer rules:

1. **Headline majority count:** Only count `APPROVE | REVISE | REJECT`
   verdicts. Exclude `UNKNOWN`, `TIMEOUT`, `ERROR`, `UNAVAILABLE`.
2. **Agreement matching:** Group findings by `file:line` substring match. If
   two reviewers cite the same file:line, that's an agreement. Quote each
   verbatim — no de-duplication of phrasing.
3. **Disagreement bucket:** Anything not in Agreement. Includes verdict
   conflicts (e.g., Codex APPROVE on a file Gemini wants revised).
4. **Excluded-reviewer notes:** If any reviewer was excluded (TIMEOUT, ERROR,
   etc.), mention this in the Headline AND list their summary in a separate
   `### Reviewer Status` section (1 line per excluded reviewer).
5. **No weighting, no scoring, no quote verification.** V1 is descriptive,
   not adjudicative.

Construct the synthesis report as a single markdown string (`SYNTHESIS_MD`).

### Step 6: Slug + target path derivation

Use the skill's `build_slug` and `build_target_path` helpers:

```bash
# Re-derive state — each bash block runs in a fresh subprocess
MODE=$(printf '%s' "$ARGUMENTS" | awk '{print $1}')
REST=$(printf '%s' "$ARGUMENTS" | sed -E 's/^[^ ]+ *//')
GIT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || { printf '[council] Error: not in a git repository\n' >&2; exit 1; }
cd "$GIT_ROOT"

# For plan mode with a file path: use filename stem
# For other modes / text input: use first N words of input
case "$MODE" in
  plan)
    if [ -f "$REST" ]; then
      SLUG_BASE=$(basename "$REST" .md | sed 's/\..*//')
    else
      SLUG_BASE=$(printf '%s' "$REST" | head -c 80)
    fi
    ;;
  review)
    SLUG_BASE=$(git rev-parse --abbrev-ref HEAD)
    ;;
  debug|question)
    SLUG_BASE=$(printf '%s' "$REST" | head -c 80)
    ;;
esac

SLUG=$(build_slug "$SLUG_BASE")
REPORT_PATH=$(build_target_path "$MODE" "$SLUG") || exit 1
REPORT_PATH_ABS="${CLAUDE_PROJECT_DIR:-$(pwd)}/${REPORT_PATH}"

# Ensure docs/council/ directory exists
mkdir -p "$(dirname "$REPORT_PATH_ABS")" || {
  printf '[council] Error: cannot create %s\n' "$(dirname "$REPORT_PATH_ABS")" >&2
  exit 1
}
```

### Step 7: Construct full report content

```bash
REPORT_CONTENT=$(printf '%s\n\n' "$SYNTHESIS_MD")

# Append reviewer raw output sections from fenced_output_path files
for reviewer in codex gemini opencode; do
  fenced_path="${REVIEWER_FENCED_PATHS[$reviewer]}"
  if [ -n "$fenced_path" ] && [ -f "$fenced_path" ]; then
    REPORT_CONTENT="${REPORT_CONTENT}

## ${reviewer^} Output

$(cat "$fenced_path")
"
  else
    REPORT_CONTENT="${REPORT_CONTENT}

## ${reviewer^} Output

(reviewer was ${REVIEWER_VERDICTS[$reviewer]} — no output captured)
"
  fi
done
```

### Step 8: M3 confirmation gate (AskUserQuestion)

Per MEMORY.md "M3 before bulk writes — no threshold," every file write must
be gated by AskUserQuestion. Show the user:

- Resolved `$REPORT_PATH` (repo-relative path shown to user)
- Headline summary (one line)
- Two-line synthesis preview

Use `AskUserQuestion` with these options:

> "Save council report to `<REPORT_PATH>`?" (show repo-relative path)
>
> Options:
> - "Save report (Recommended)" — write the file and proceed
> - "Cancel" — skip the file write, exit without saving

If user selects **Cancel**:

```bash
printf '[council] Report not saved.\n'
# Cleanup all fenced output files
for fenced_path in "${REVIEWER_FENCED_PATHS[@]}"; do
  [ -n "$fenced_path" ] && rm -f "$fenced_path"
done
exit 0
```

If user selects **Save report**: continue to Step 9.

### Step 9: Atomic file write via Write tool

Per `council-patterns` SKILL atomic-write convention (Option B —
brainstorm-orchestrator pattern):

```text
Use the Write tool with:
  file_path = $REPORT_PATH_ABS  (absolute path: "${CLAUDE_PROJECT_DIR:-$(pwd)}/${REPORT_PATH}")
  content = $REPORT_CONTENT
```

The Write tool either succeeds (file fully written) or fails (no partial
file). No mktemp + mv staging; no `.gitignore` additions needed.

After the Write tool succeeds, verify:

```bash
if [ ! -f "$REPORT_PATH_ABS" ]; then
  printf '[council] Error: file write reported success but file not found at %s\n' "$REPORT_PATH_ABS" >&2
  exit 1
fi

# Cleanup fenced output files (no longer needed; content is in the report file)
for fenced_path in "${REVIEWER_FENCED_PATHS[@]}"; do
  [ -n "$fenced_path" ] && rm -f "$fenced_path"
done
```

### Step 10: Inline conversation output

Print the synthesis report (Headline + Agreement + Disagreement + Summary)
directly to the user. Do NOT paste raw reviewer outputs inline — reference
the file path:

```text
$SYNTHESIS_MD

Full reviewer outputs and detailed findings: $REPORT_PATH
```

This is the final output of the command. Exit 0.

## Failure Modes

| Scenario | Behavior |
|----------|----------|
| Bare `/council` (no mode) | Print 4-mode help; exit 0 |
| `/council fleet` | Print "fleet management not available in V1 — coming in V2"; exit 0 |
| `/council unknownmode` | Print error + 4-mode help; exit 1 |
| Path traversal in `--paths` | Reject with `[council] Error: path traversal not allowed`; exit 1 |
| Shell metacharacters in path | Reject with `[council] Error: invalid characters in path`; exit 1 |
| Non-existent path | Reject with `[council] Error: path not found`; exit 1 |
| Empty `debug`/`question` text | Reject with mode-specific usage; exit 1 |
| `--paths` exceeds `COUNCIL_PATH_MAX_FILES` | Reject with limit message; exit 1 |
| All 3 reviewers TIMEOUT/ERROR/UNAVAILABLE | Headline: "Council failed: 0 of 3 reviewers returned verdicts"; M3 still asks; user can save or cancel |
| 1-2 of 3 reviewers fail | Headline: "Council ran with N of 3 reviewers"; synthesis proceeds with remaining |
| yellow-codex not installed | Codex marked UNAVAILABLE; Gemini + OpenCode still run |
| Slug collision >10 same-day | Error: "too many same-day collisions for slug X (>10)"; exit 1 |
| User selects Cancel at M3 | Print "Report not saved"; cleanup temps; exit 0 |
| `docs/council/` not writable | mkdir -p fails; exit 1 |
| Bash < 4.3 | Pre-flight error; exit 1 |
| `jq` missing | Pre-flight error; exit 1 |
| Git not in repo | Pre-flight error; exit 1 |

## Configuration

| Var | Default | Purpose |
|-----|---------|---------|
| `COUNCIL_TIMEOUT` | 600 | Per-reviewer timeout in seconds |
| `COUNCIL_OPENCODE_VARIANT` | high | OpenCode reasoning effort (high/max/minimal) |
| `COUNCIL_PATH_CHAR_CAP` | 8000 | Per-file content cap for `--paths` |
| `COUNCIL_PATH_MAX_FILES` | 3 | Max `--paths` files per invocation |

## V2 Trajectory (NOT implemented in V1)

- `/council fleet status` — show persistent reviewer session state
- `/council fleet restart` — restart wedged sessions
- `/council review --round 2` — multi-round iterative review with prior-round
  context injection
- Lineage-weighted quorum aggregation in synthesis (replaces V1 raw count)
- Quote-verification pass against repository source (downgrade unverifiable
  findings)
- XML evidence contract for findings output
- `/council history` browse command

V1 reserves the `fleet` subcommand word with a "coming in V2" stub so V2's
PR can wire it without naming conflicts.
