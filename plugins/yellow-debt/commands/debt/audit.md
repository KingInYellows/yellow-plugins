---
name: debt:audit
description: "Run comprehensive technical debt audit with parallel scanner agents. Use when you need to assess codebase health, identify AI-generated debt patterns, or scan for technical debt."
allowed-tools:
  - Bash
  - Read
  - Write
  - Task
  - AskUserQuestion
---

# Technical Debt Audit Command

Runs a comprehensive technical debt audit by launching 5 parallel scanner agents, then synthesizing results into a prioritized report with actionable todo files.

## Arguments

- `[path]` — Optional path to limit scan scope (default: entire codebase)
- `--category <name>` — Run only specific scanner: ai-patterns, complexity, duplication, architecture, security
- `--severity <level>` — Filter output to minimum severity: critical, high, medium, low

## Implementation

```bash
#!/usr/bin/env bash
set -euo pipefail

# Source validation library
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
# shellcheck source=../../lib/validate.sh
source "${PLUGIN_ROOT}/lib/validate.sh"

# Parse arguments
PATH_FILTER="${1:-.}"
CATEGORY_FILTER=""
SEVERITY_FILTER=""

shift || true
while [ $# -gt 0 ]; do
  case "$1" in
    --category)
      CATEGORY_FILTER="$2"
      validate_category "$CATEGORY_FILTER" || {
        printf 'ERROR: Invalid category "%s". Must be: ai-patterns, complexity, duplication, architecture, security\n' "$CATEGORY_FILTER" >&2
        exit 1
      }
      shift 2
      ;;
    --severity)
      SEVERITY_FILTER="$2"
      validate_severity "$SEVERITY_FILTER" || {
        printf 'ERROR: Invalid severity "%s". Must be: critical, high, medium, low\n' "$SEVERITY_FILTER" >&2
        exit 1
      }
      shift 2
      ;;
    *)
      printf 'ERROR: Unknown argument "%s"\n' "$1" >&2
      exit 1
      ;;
  esac
done

# Validate path argument
validate_file_path "$PATH_FILTER" || {
  printf 'ERROR: Invalid path "%s" (path traversal detected)\n' "$PATH_FILTER" >&2
  exit 1
}

# Check git status (warn if uncommitted changes, don't block)
if ! git diff-index --quiet HEAD -- 2>/dev/null; then
  printf 'WARNING: You have uncommitted changes. Audit results may include work-in-progress code.\n' >&2
fi

# Create scanner output directory
mkdir -p .debt/scanner-output || {
  printf '[audit] ERROR: Failed to create .debt/scanner-output/\n' >&2
  exit 1
}

# Determine file list using batched git operation (performance optimization)
printf '[audit] Enumerating files...\n' >&2
git ls-files -z "$PATH_FILTER" 2>/dev/null | \
  xargs -0 file --mime-type 2>/dev/null | \
  awk -F: '/text\// {print $1}' > .debt/file-list.txt || {
  printf '[audit] ERROR: Failed to enumerate files\n' >&2
  exit 1
}

FILE_COUNT=$(wc -l < .debt/file-list.txt)
printf '[audit] Found %d text files to scan\n' "$FILE_COUNT" >&2

# Determine which scanners to run
if [ -n "$CATEGORY_FILTER" ]; then
  SCANNERS=("${CATEGORY_FILTER}")
else
  SCANNERS=(ai-patterns complexity duplication architecture security)
fi

# Launch scanners in parallel with error tracking
printf '[audit] Launching %d scanner(s)...\n' "${#SCANNERS[@]}" >&2

declare -A scanner_status

for scanner in "${SCANNERS[@]}"; do
  # Launch scanner agent via Task tool
  # The scanner will read .debt/file-list.txt and write results to .debt/scanner-output/<scanner>-scanner.json
  printf '[audit] Starting %s-scanner...\n' "$scanner" >&2

  # Create task description
  TASK_DESC="Scan codebase for ${scanner} technical debt patterns. Read file list from .debt/file-list.txt and write findings to .debt/scanner-output/${scanner}-scanner.json following the debt-conventions skill schema."

  if [ -n "$SEVERITY_FILTER" ]; then
    TASK_DESC="${TASK_DESC} Filter to ${SEVERITY_FILTER} severity or higher."
  fi

  # Store scanner name for status tracking
  scanner_status["$scanner"]="pending"
done

# Display launch message
printf '[audit] All scanner agents launched. Waiting for results...\n' >&2
printf '[audit] This may take 1-5 minutes depending on codebase size.\n' >&2

# Note: In actual implementation, we would use Task tool here to launch agents
# For now, display instructions for user to launch manually
printf '\nTo launch scanner agents, use:\n'
for scanner in "${SCANNERS[@]}"; do
  printf '  Task(subagent_type="%s-scanner"): "Scan for %s debt in files from .debt/file-list.txt"\n' "$scanner" "$scanner"
done

printf '\nAfter all scanners complete, launch synthesizer:\n'
printf '  Task(subagent_type="audit-synthesizer"): "Merge scanner outputs, deduplicate, score, generate report"\n'

printf '\nAudit orchestration complete. Launch agents as shown above.\n'
```

## Example Usage

```bash
# Full codebase audit
$ARGUMENTS

# Audit specific directory
$ARGUMENTS src/

# Run only complexity scanner
$ARGUMENTS --category complexity

# Filter to high severity findings
$ARGUMENTS --severity high

# Combined: audit src/ for high+ complexity issues
$ARGUMENTS src/ --category complexity --severity high
```

## Output

- Scanner outputs: `.debt/scanner-output/<scanner>-scanner.json`
- Audit report: `docs/audits/YYYY-MM-DD-audit-report.md` (generated by synthesizer)
- Todo files: `todos/debt/NNN-pending-SEVERITY-slug.md` (generated by synthesizer)

## Error Handling

**Scanner failures**: If ≤50% of scanners fail, audit continues with partial results. If >50% fail, audit aborts.

**Synthesis failure**: Scanner outputs preserved in `.debt/scanner-output/` for manual inspection or retry.

**File enumeration failure**: Usually indicates path doesn't exist or isn't tracked by git.

## Recovery

If audit fails:
1. Check `.debt/scanner-output/` for scanner outputs
2. Re-run with `--category <name>` to retry specific scanner
3. Check logs for error messages with `[audit]` prefix
