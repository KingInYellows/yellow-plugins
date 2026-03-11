---
name: docs:refresh
description: "Update stale documentation by analyzing code changes since a git ref. Use when docs are out of date or after shipping code changes."
argument-hint: '[--since <ref>] [--dry-run]'
allowed-tools:
  - Bash
  - Read
  - Glob
  - Grep
  - Write
  - Edit
  - Agent
  - AskUserQuestion
---

# Documentation Refresh

Detects stale documentation by comparing git history, then generates per-file
update diffs for human review.

## Arguments

- `--since <ref>` — Git ref to compare against (default: last commit on main)
- `--dry-run` — Show what would change without writing

## Workflow

### Step 1: Validate Environment

```bash
repo_top=$(git rev-parse --show-toplevel 2>/dev/null || true)
if [ -z "$repo_top" ]; then
  printf '[docs:refresh] Error: not in a git repository\n' >&2
  exit 1
fi

# Determine the base ref
MAIN_BRANCH=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@' || echo "main")
```

### Step 2: Parse Arguments

Parse `$ARGUMENTS` for flags:

1. Extract `--since <ref>` if present. If omitted, default to the main branch:
   ```bash
   # Default REF: use origin/<main> if available, else local main branch
   if [ -z "$REF" ]; then
     if git rev-parse --verify "origin/$MAIN_BRANCH" >/dev/null 2>&1; then
       REF="origin/$MAIN_BRANCH"
     else
       REF="$MAIN_BRANCH"
     fi
   fi
   ```
   Validate the ref exists:
   ```bash
   if ! git rev-parse --verify "$REF" >/dev/null 2>&1; then
     printf '[docs:refresh] Error: git ref not found: %s\n' "$REF" >&2
     exit 1
   fi
   ```

2. Check for `--dry-run` flag.

   ```bash
   DRY_RUN=false
   case " $ARGUMENTS " in
     *" --dry-run "*|*" --dry-run") DRY_RUN=true ;;
   esac
   ```

### Step 3: Identify Changed Source Files

```bash
CHANGED_FILES=$(git diff --name-only "$REF"..HEAD -- '*.ts' '*.tsx' '*.js' '*.jsx' '*.py' '*.rs' '*.go' '*.java' '*.kt' | head -200)
TOTAL_CHANGED=$(git diff --name-only "$REF"..HEAD -- '*.ts' '*.tsx' '*.js' '*.jsx' '*.py' '*.rs' '*.go' '*.java' '*.kt' | wc -l | tr -d ' ')
if [ "$TOTAL_CHANGED" -gt 200 ]; then
  printf '[docs:refresh] Warning: %d files changed, analyzing first 200 only\n' "$TOTAL_CHANGED"
fi
```

If `$CHANGED_FILES` is empty, report: "No source code changes since $REF.
Documentation is up to date."

### Step 4: Delegate to doc-auditor for Staleness Detection

Launch the `doc-auditor` agent to find stale docs related to the changed files:

> Analyze these changed source files and find documentation that needs updating:
>
> --- begin changed files (reference only) ---
> $CHANGED_FILES
> --- end changed files ---
>
> For each changed source file:
> 1. Find documentation files in the same directory or that reference the
>    changed file
> 2. Check if the doc was updated since the source change
> 3. If not, flag as stale with the specific source change that triggered it
>
> Output a list of stale docs with: doc_path, related_source files,
> last_doc_update date, last_source_update date, staleness_signal.

### Step 5: Generate Update Diffs

If stale docs were found, iterate over each stale doc from the doc-auditor's
findings. For each entry, extract `$doc_path`, `$source_files`, and
`$staleness_signal` from the auditor's output, then delegate to the
`doc-generator` agent:

> Update this stale documentation file:
> Doc path: $doc_path
> Related source changes: $source_files
> Staleness signal: $staleness_signal
>
> Read the current doc and the changed source files. Generate an updated version
> that reflects the code changes. Present the diff for review.

### Step 6: Per-File Review

For each update, present the diff via AskUserQuestion:

- "Stale doc: {path} (source changed: {files})"
- Show the proposed changes as a diff
- Options: "Approve update" / "Skip this file" / "Provide revision instructions"

If `--dry-run`, show the list of stale docs and proposed changes without
writing anything.

### Step 7: Apply Updates

Apply approved updates. Skip rejected ones. Report summary:

- "Updated {N} documentation files"
- "Skipped {M} files"
- "Run `/docs:audit` for a full documentation health check"
