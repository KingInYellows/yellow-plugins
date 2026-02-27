---
name: debt:triage
description: 'Interactive review and prioritization of pending debt findings. Use when you need to accept, reject, or defer findings from an audit.'
argument-hint: '[--category <name>] [--priority <level>]'
allowed-tools:
  - Bash
  - Read
  - AskUserQuestion
  # Note: Write is intentionally absent — all file transitions happen via
  # transition_todo_state() in validate.sh using Bash shell I/O (>, mv, rm),
  # not via the Claude Code Write tool.
---

# Technical Debt Triage Command

Interactively review pending technical debt findings and decide to accept
(ready), reject (deleted), or defer (deferred) each one.

## Step 1: Prerequisites

Verify `yq` is available and is the kislyuk/yq variant (required for YAML
frontmatter manipulation — `mikefarah/yq` uses incompatible flags):

```bash
command -v yq >/dev/null 2>&1 || {
  printf '[debt:triage] Error: yq is required. Install: pip install yq\n' >&2
  exit 1
}
yq --help 2>&1 | grep -qi 'jq wrapper\|kislyuk' || {
  printf '[debt:triage] Error: kislyuk/yq required (pip install yq). mikefarah/yq is incompatible.\n' >&2
  exit 1
}
```

If the above exits non-zero, stop. Do not proceed.

## Step 2: Discover Findings

Find all pending todo files, anchored to git root:

```bash
GIT_ROOT="$(git rev-parse --show-toplevel)" || {
  printf '[debt:triage] Error: not inside a git repository\n' >&2
  exit 1
}
find "$GIT_ROOT/todos/debt" -name '*-pending-*.md' 2>/dev/null | sort
```

If no files found: report "No pending findings to triage. Run /debt:audit to
generate findings." and stop.

## Step 3: Parse Arguments and Filter

Parse `$ARGUMENTS` for optional filters:

- `--category <name>` — filter to: ai-patterns, complexity, duplication,
  architecture, security
- `--priority <level>` — filter to minimum priority: p1, p2, p3, p4

Guard against `--flag` missing value: if the next argument starts with `--` or
is empty, report the error and stop.

Apply filters by reading each file's frontmatter. After filtering, if no files
remain: report "No pending findings match the filter criteria." and stop.

## Step 4: Sort by Severity

Sort filtered findings by severity: critical first, then high, medium, low.
Extract severity from the filename pattern
(`{id}-{status}-{severity}-{slug}-{hash}.md`) or from frontmatter if the
pattern doesn't match.

## Step 5: Pre-Loop Overview (M3 Pattern)

Always present a summary first using AskUserQuestion before starting the loop:

"Found N findings (X critical, Y high, Z medium, W low). Proceed with triage?"

Options:
- "Yes, start triage"
- "Cancel"

If user selects Cancel: output "Triage cancelled." and stop. Do not proceed.

## Step 6: Triage Loop

For each finding in severity order, maintain running counts of
accepted/rejected/deferred in your conversation context (NOT as shell variables
— each Bash tool call is a separate subprocess).

### Per-Finding Steps

1. **Read the todo file** using the Read tool to get its full content.

2. **Present finding summary** using AskUserQuestion:

   Show the finding title, category, severity, effort, affected files, finding
   description, and suggested remediation.

   Options:
   - "Accept — mark as ready for remediation"
   - "Reject — mark as false positive (will be deleted)"
   - "Defer — postpone with reason"
   - "Stop — end triage session"

3. **Handle user choice:**

   In each bash command below, replace `$TODO_PATH` with the actual absolute
   path of the current finding file (from Step 2's discovery results).

   **On Accept:**
   ```bash
   . "${CLAUDE_PLUGIN_ROOT}/lib/validate.sh"
   transition_todo_state "/absolute/path/to/file.md" ready || {
     printf '[debt:triage] Error: transition failed\n' >&2
     exit 1
   }
   ```
   If the above exits non-zero, stop. Report the error. Do not increment any count.
   Otherwise increment your accepted count.

   **On Reject:**
   ```bash
   . "${CLAUDE_PLUGIN_ROOT}/lib/validate.sh"
   transition_todo_state "/absolute/path/to/file.md" deleted || {
     printf '[debt:triage] Error: transition failed\n' >&2
     exit 1
   }
   ```
   If the above exits non-zero, stop. Report the error. Do not increment any count.
   Otherwise increment your rejected count.

   **On Defer:**
   Use AskUserQuestion:
   - Prompt: "Why defer this finding? (Max 200 characters — leave blank to skip reason)"
   - Options: "Other" / "Cancel — go back without deferring"

   The "Other" option opens a free-text input field — use the entered text as the
   defer reason.

   **On Defer — Cancel:** Do not run `transition_todo_state`. Return to the
   same finding's main options (Accept/Reject/Defer/Stop). Do not increment
   any count.

   **On Defer — Submit reason:** Use a heredoc to pass the reason safely
   (avoids quoting issues with special characters). Use `__EOF_DEFER_REASON__`
   as the delimiter (avoids collision if the reason text contains common words).
   Ensure the closing delimiter is at column 0 with no leading whitespace:
   ```bash
. "${CLAUDE_PLUGIN_ROOT}/lib/validate.sh"
DEFER_REASON=$(cat <<'__EOF_DEFER_REASON__'
<paste the actual defer reason text verbatim here>
__EOF_DEFER_REASON__
)
DEFER_REASON=$(printf '%s' "$DEFER_REASON" | tr -d '\n\r')
transition_todo_state "/absolute/path/to/file.md" deferred "$DEFER_REASON" || {
  printf '[debt:triage] Error: transition failed\n' >&2
  exit 1
}
   ```
   If the above exits non-zero, stop. Report the error. Do not increment any count.
   Otherwise increment your deferred count.

   **On Defer — empty reason (blank "Other" input):** Call without third argument:
   ```bash
. "${CLAUDE_PLUGIN_ROOT}/lib/validate.sh"
transition_todo_state "/absolute/path/to/file.md" deferred || {
  printf '[debt:triage] Error: transition failed\n' >&2
  exit 1
}
   ```
   If the above exits non-zero, stop. Report the error. Do not increment any count.
   Otherwise increment your deferred count.

   **On Stop:**
   Break out of the loop and proceed to the summary.

## Step 7: Final Summary

Present totals:

"Triage complete: N accepted, M rejected, P deferred, Q remaining.
Run /debt:fix to begin remediation of accepted findings."

## Triage Decisions

**Accept** → Transitions to `ready` state
- Finding is valid and should be fixed
- Will appear in `/debt:fix` workflow
- Can be synced to Linear via `/debt:sync`

**Reject** → Transitions to `deleted` state
- Finding is false positive
- File will be removed from todos/debt/
- Can be recovered from git history if needed

**Defer** → Transitions to `deferred` state with reason
- Valid finding but not addressing now
- Optional reason (validated: no newlines, max 200 chars)
- Will be re-evaluated in next audit

## Error Recovery

If triage is interrupted:
- All decisions made so far are persisted (atomic state transitions via flock)
- Re-run `/debt:triage` to continue from remaining pending findings
- Previously triaged items won't be shown again
