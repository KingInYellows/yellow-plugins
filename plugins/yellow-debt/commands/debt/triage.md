---
name: debt:triage
description: 'Interactive review and prioritization of pending debt findings. Use when you need to accept, reject, or defer findings from an audit.'
argument-hint: '[--category <name>] [--priority <level>]'
allowed-tools:
  - Bash
  - Read
  - AskUserQuestion
  # Write is used only to create the defer-reason file in a private temp
  # directory. Todo transitions still go through transition_todo_state() in
  # validate.sh using Bash shell I/O (>, mv, rm).
  - Write
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
cd "$GIT_ROOT" || exit 1
if [ -L todos ] || [ -L todos/debt ]; then
  printf '[debt:triage] Error: todos/ or todos/debt/ is a symlink; refusing\n' >&2
  exit 1
fi
# Only names that fit {id}-pending-{severity}-{slug}[-{hash}].md are listed;
# the repository controls these names, so anything else is skipped.
all_todos=$(find todos/debt -maxdepth 1 -type f -name '*-pending-*.md' 2>/dev/null | LC_ALL=C sort)
todo_list=$(printf '%s\n' "$all_todos" \
  | LC_ALL=C grep -E '^todos/debt/[0-9]{1,6}-pending-(critical|high|medium|low)-[a-z0-9]+(-[a-z0-9]+)*\.md$' || true)
all_count=$(printf '%s' "$all_todos" | grep -c . || true)
kept_count=$(printf '%s' "$todo_list" | grep -c . || true)
if [ "$all_count" -gt "$kept_count" ]; then
  printf '[debt:triage] Warning: skipped %d file(s) whose names do not fit the todo pattern\n' \
    "$((all_count - kept_count))" >&2
fi
[ -z "$todo_list" ] || printf '%s\n' "$todo_list"
```

If no files are listed: report "No pending findings to triage. Run /debt:audit
to generate findings." and stop. Each finding's id is the leading digits of
its filename (e.g. `042` for `todos/debt/042-pending-high-…md`).

## Step 3: Parse Arguments and Filter

Parse `$ARGUMENTS` for optional filters:

- `--category <name>` — filter to: ai-pattern, complexity, duplication,
  architecture, security-debt
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

## Step 5: Pre-Loop Overview (user confirmation gate)

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

   In each bash command below, replace `<todo-id>` with the current
   finding's numeric id (the leading digits of its filename from Step 2),
   single-quoted. Stop if it is not 1–6 digits. Never paste the path or any
   other part of the filename into a block: the block finds the file itself.

   **On Accept:**
```bash
# lib/validate.sh is bash-only: run this block in bash even when the Bash
# tool's shell is zsh (bash reads the script from fd 3, so stdin stays free).
bash /dev/fd/3 '<todo-id>' 3<<'__YELLOW_DEBT_BASH__'
. "${CLAUDE_PLUGIN_ROOT}/lib/validate.sh"
cd "$(git rev-parse --show-toplevel)" || exit 1
todo_file=$(debt_resolve_todo "$1" pending) || exit 1
transition_todo_state "$todo_file" ready || {
  printf '[debt:triage] Error: transition failed\n' >&2
  exit 1
}
__YELLOW_DEBT_BASH__
```
   If the above exits non-zero, stop. Report the error. Do not increment any count.
   Otherwise increment your accepted count.

   **On Reject:**
```bash
# lib/validate.sh is bash-only: run this block in bash even when the Bash
# tool's shell is zsh (bash reads the script from fd 3, so stdin stays free).
bash /dev/fd/3 '<todo-id>' 3<<'__YELLOW_DEBT_BASH__'
. "${CLAUDE_PLUGIN_ROOT}/lib/validate.sh"
cd "$(git rev-parse --show-toplevel)" || exit 1
todo_file=$(debt_resolve_todo "$1" pending) || exit 1
transition_todo_state "$todo_file" deleted || {
  printf '[debt:triage] Error: transition failed\n' >&2
  exit 1
}
__YELLOW_DEBT_BASH__
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

   **On Defer — Submit reason:** The reason is untrusted free text. Never place
   it in shell text (no heredoc, no quoting): a line matching a heredoc
   delimiter would end the heredoc and run the following lines as commands.
   Pass it through a file instead.

   1. Create a private directory atomically (mode 0700, so no other user can
      claim paths inside it):
      ```bash
      mktemp -d "${TMPDIR:-/tmp}/debt-defer.XXXXXX"
      ```
   2. Use the Write tool (not Bash) to create `<dir>/reason.txt` inside the
      printed directory, with the reason text as its content.
   3. Run the transition with the id and the directory as single-quoted
      operands. The child strips newlines, transitions, then removes the file
      and directory:
```bash
# lib/validate.sh is bash-only: run this block in bash even when the Bash
# tool's shell is zsh (bash reads the script from fd 3, so stdin stays free).
bash /dev/fd/3 '<todo-id>' '<reason-dir>' 3<<'__YELLOW_DEBT_BASH__'
. "${CLAUDE_PLUGIN_ROOT}/lib/validate.sh"
DEFER_REASON=$(tr -d '\n\r' < "$2/reason.txt")
rm -f -- "$2/reason.txt"
rmdir -- "$2"
cd "$(git rev-parse --show-toplevel)" || exit 1
todo_file=$(debt_resolve_todo "$1" pending) || exit 1
transition_todo_state "$todo_file" deferred "$DEFER_REASON" || {
printf '[debt:triage] Error: transition failed\n' >&2
exit 1
}
__YELLOW_DEBT_BASH__
```
   If the above exits non-zero, stop. Report the error. Do not increment any count.
   Otherwise increment your deferred count.

   **On Defer — empty reason (blank "Other" input):** Call without third argument:
```bash
# lib/validate.sh is bash-only: run this block in bash even when the Bash
# tool's shell is zsh (bash reads the script from fd 3, so stdin stays free).
bash /dev/fd/3 '<todo-id>' 3<<'__YELLOW_DEBT_BASH__'
. "${CLAUDE_PLUGIN_ROOT}/lib/validate.sh"
cd "$(git rev-parse --show-toplevel)" || exit 1
todo_file=$(debt_resolve_todo "$1" pending) || exit 1
transition_todo_state "$todo_file" deferred || {
printf '[debt:triage] Error: transition failed\n' >&2
exit 1
}
__YELLOW_DEBT_BASH__
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
- All decisions made so far are persisted (atomic state transitions under a lock)
- Re-run `/debt:triage` to continue from remaining pending findings
- Previously triaged items won't be shown again
