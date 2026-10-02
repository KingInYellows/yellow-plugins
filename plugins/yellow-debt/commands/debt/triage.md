---
name: debt:triage
description: 'Interactive review and prioritization of pending debt findings. Use when you need to accept, reject, defer, or close as won''t fix findings from an audit.'
argument-hint: '[--category <name>] [--priority <level>]'
allowed-tools:
  - Bash
  - Read
  - AskUserQuestion
  # Write is used only to create the defer- or won't-fix-reason file in a
  # private temp directory. Todo transitions still go through transition_todo_state() in
  # validate.sh using Bash shell I/O (>, mv, rm).
  - Write
---

# Technical Debt Triage Command

Interactively review pending technical debt findings and decide to accept
(ready), reject (deleted), defer (deferred), or close as won't fix (wont-fix)
each one.

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

List the pending todo files. `debt_pending_todos` keeps a file only when its
name fits the todo pattern and its frontmatter status is also `pending`: a
closed legacy todo that still has `-pending-` in its name is reported on stderr
and left out, because Accept, Reject and Defer would all fail on it (repair it
with the recipe in "Triage Decisions" below):

```bash
# lib/validate.sh is bash-only: run this block in bash even when the Bash
# tool's shell is zsh (bash reads the script from fd 3, so stdin stays free).
bash /dev/fd/3 3<<'__YELLOW_DEBT_BASH__'
. "${CLAUDE_PLUGIN_ROOT}/lib/validate.sh"
GIT_ROOT="$(git rev-parse --show-toplevel)" || {
  printf '[debt:triage] Error: not inside a git repository\n' >&2
  exit 1
}
cd "$GIT_ROOT" || exit 1
debt_pending_todos | LC_ALL=C sort
__YELLOW_DEBT_BASH__
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
(`{id}-{status}-{severity}-{slug}[-{hash}].md`) or from frontmatter if the
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
accepted/rejected/deferred/won't-fix in your conversation context (NOT as shell variables
— each Bash tool call is a separate subprocess).

### Per-Finding Steps

1. **Read the todo file** using the Read tool to get its full content.

2. **Present finding summary** using AskUserQuestion:

   Show the finding title, category, severity, effort, affected files, finding
   description, and suggested remediation.

   Options:
   - "Accept — mark as ready for remediation"
   - "Reject — mark as false positive (will be deleted)"
   - "Defer or won't fix — valid, not fixing now"
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

   **On Defer or won't fix:**
   Use AskUserQuestion: "Defer this finding to re-evaluate later, or close it as
   won't fix?"
   - "Defer — postpone with reason"
   - "Won't fix — valid, deliberately not fixing"
   - "Cancel — go back"

   **On Defer or won't fix — Cancel:** Do not run `transition_todo_state`.
   Return to the same finding's main options. Do not increment any count.

   **On Defer:**
   Use AskUserQuestion:
   - Prompt: "Why defer this finding? (Max 200 characters — leave blank to skip reason)"
   - Options: "Other" / "Cancel — go back without deferring"

   The "Other" option opens a free-text input field — use the entered text as the
   defer reason.

   **On Defer — Cancel:** Do not run `transition_todo_state`. Return to the
   same finding's main options (Accept/Reject/Defer or won't fix/Stop). Do not
   increment any count.

   **On Defer — Submit reason:** The reason is untrusted free text. Never place
   it in shell text (no heredoc, no quoting): a line matching a heredoc
   delimiter would end the heredoc and run the following lines as commands.
   Pass it through a file instead.

   1. Create a private directory atomically (mode 0700, so no other user can
      claim paths inside it):
      ```bash
      mktemp -d "${TMPDIR:-/tmp}/debt-reason.XXXXXX"
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
debt_refuse_symlinks "$2" "$2/reason.txt" || exit 1
[ -f "$2/reason.txt" ] || { printf '[debt:triage] Error: reason file missing\n' >&2; exit 1; }
DEFER_REASON=$(tr -d '\n\r' < "$2/reason.txt") || exit 1
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

   **On Won't fix:**
   Use AskUserQuestion:
   - Prompt: "Why is this finding not being fixed? (Max 200 characters — leave blank to skip reason)"
   - Options: "Other" / "Cancel — go back without closing"

   The "Other" option opens a free-text input field — use the entered text as the
   won't-fix reason.

   **On Won't fix — Cancel:** Do not run `transition_todo_state`. Return to the
   same finding's main options. Do not increment any count.

   **On Won't fix — Submit reason:** The reason is untrusted free text. Pass it
   through a file exactly as in Defer (private directory from
   `mktemp -d "${TMPDIR:-/tmp}/debt-reason.XXXXXX"`, then the Write tool to
   create `<dir>/reason.txt`), then run the transition with the id and the
   directory as single-quoted operands:
```bash
# lib/validate.sh is bash-only: run this block in bash even when the Bash
# tool's shell is zsh (bash reads the script from fd 3, so stdin stays free).
bash /dev/fd/3 '<todo-id>' '<reason-dir>' 3<<'__YELLOW_DEBT_BASH__'
. "${CLAUDE_PLUGIN_ROOT}/lib/validate.sh"
debt_refuse_symlinks "$2" "$2/reason.txt" || exit 1
[ -f "$2/reason.txt" ] || { printf '[debt:triage] Error: reason file missing\n' >&2; exit 1; }
REASON=$(tr -d '\n\r' < "$2/reason.txt") || exit 1
rm -f -- "$2/reason.txt"
rmdir -- "$2"
cd "$(git rev-parse --show-toplevel)" || exit 1
todo_file=$(debt_resolve_todo "$1" pending) || exit 1
transition_todo_state "$todo_file" wont-fix "$REASON" || {
printf '[debt:triage] Error: transition failed\n' >&2
exit 1
}
__YELLOW_DEBT_BASH__
```
   If the above exits non-zero, stop. Report the error. Do not increment any count.
   Otherwise increment your won't-fix count.

   **On Won't fix — empty reason (blank "Other" input):** Call without third argument:
```bash
# lib/validate.sh is bash-only: run this block in bash even when the Bash
# tool's shell is zsh (bash reads the script from fd 3, so stdin stays free).
bash /dev/fd/3 '<todo-id>' 3<<'__YELLOW_DEBT_BASH__'
. "${CLAUDE_PLUGIN_ROOT}/lib/validate.sh"
cd "$(git rev-parse --show-toplevel)" || exit 1
todo_file=$(debt_resolve_todo "$1" pending) || exit 1
transition_todo_state "$todo_file" wont-fix || {
printf '[debt:triage] Error: transition failed\n' >&2
exit 1
}
__YELLOW_DEBT_BASH__
```
   If the above exits non-zero, stop. Report the error. Do not increment any count.
   Otherwise increment your won't-fix count.

   **On Stop:**
   Break out of the loop and proceed to the summary.

## Step 7: Final Summary

Present totals:

"Triage complete: N accepted, M rejected, P deferred, R won't fix, Q remaining.
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
- Optional reason (newlines stripped, truncated to 200 characters)
- Kept in `todos/debt/`, but a re-audit does not skip it: the finding comes
  back as a new pending todo while the code still has the problem

**Won't fix** → Transitions to `wont-fix` state with optional reason
- Valid finding that is deliberately not being fixed
- The file is kept in `todos/debt/` (with `wont_fix_reason`) and stamped with
  the finding's fingerprint, so a re-audit recognises it and does not recreate
  it. Reject (`deleted`) is kept and stamped the same way; the difference is
  meaning: Reject says the finding was wrong
- Optional reason (newlines stripped, truncated to 200 characters)
- Reopen with `transition_todo_state … pending` if the decision changes
- Its Linear issue, if synced, is not touched: close it by hand
- A finding that is already `ready`, `in-progress` or `deferred` is closed with
  the helper directly. Replace `<current-status>` with `ready`, `in-progress`
  or `deferred`. To record a reason, make the private directory and `reason.txt`
  as in Defer and pass the directory as `'<reason-dir>'`; pass `'-'` for none:
```bash
# lib/validate.sh is bash-only: run this block in bash even when the Bash
# tool's shell is zsh (bash reads the script from fd 3, so stdin stays free).
bash /dev/fd/3 '<todo-id>' '<current-status>' '<reason-dir>' 3<<'__YELLOW_DEBT_BASH__'
. "${CLAUDE_PLUGIN_ROOT}/lib/validate.sh"
REASON=""
if [ "$3" != "-" ]; then
  debt_refuse_symlinks "$3" "$3/reason.txt" || exit 1
  [ -f "$3/reason.txt" ] || { printf '[debt:triage] Error: reason file missing\n' >&2; exit 1; }
  REASON=$(tr -d '\n\r' < "$3/reason.txt") || exit 1
  rm -f -- "$3/reason.txt"
  rmdir -- "$3"
fi
cd "$(git rev-parse --show-toplevel)" || exit 1
todo_file=$(debt_resolve_todo "$1" "$2") || exit 1
transition_todo_state "$todo_file" wont-fix "$REASON" || {
printf '[debt:triage] Error: transition failed\n' >&2
exit 1
}
__YELLOW_DEBT_BASH__
```

## Error Recovery

If triage is interrupted:
- All decisions made so far are persisted (atomic state transitions under a lock)
- Re-run `/debt:triage` to continue from remaining pending findings
- Previously triaged items won't be shown again
