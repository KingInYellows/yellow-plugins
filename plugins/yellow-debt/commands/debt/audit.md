---
name: debt:audit
description: "Run comprehensive technical debt audit with parallel scanner agents. Use when you need to assess codebase health, identify AI-generated debt patterns, or scan for technical debt."
argument-hint: '[path] [--category <name>] [--severity <level>]'
allowed-tools:
  - Bash
  - Read
  - Write
  - Task
  - AskUserQuestion
---

# Technical Debt Audit Command

Runs a comprehensive technical debt audit by launching 5 parallel scanner
agents, then synthesizing results into a prioritized report with actionable todo
files.

## Arguments

- `[path]` — Optional path to limit scan scope (default: entire codebase)
- `--category <name>` — Run only specific scanner: ai-pattern, complexity,
  duplication, architecture, security-debt
- `--severity <level>` — Filter output to minimum severity: critical, high,
  medium, low

## Implementation

```bash
#!/usr/bin/env bash
set -euo pipefail

# Source validation library
# shellcheck source=../../lib/validate.sh
. "${CLAUDE_PLUGIN_ROOT}/lib/validate.sh"

# Parse arguments - normalize path before validation
RAW_PATH_FILTER="${1:-.}"

# Normalize path to prevent injection and handle relative paths
if [ "$RAW_PATH_FILTER" != "." ]; then
  PROJECT_ROOT=$(git rev-parse --show-toplevel)
  PATH_FILTER=$(realpath -m -- "$RAW_PATH_FILTER") || {
    printf 'ERROR: Failed to normalize path "%s"\n' "$RAW_PATH_FILTER" >&2
    exit 1
  }
  PATH_FILTER=$(realpath -m --relative-to="$PROJECT_ROOT" -- "$PATH_FILTER")
else
  PATH_FILTER="."
fi

CATEGORY_FILTER=""
SEVERITY_FILTER=""

shift || true
while [ $# -gt 0 ]; do
  case "$1" in
    --category)
      CATEGORY_FILTER="$2"
      validate_category "$CATEGORY_FILTER" || {
        printf 'ERROR: Invalid category "%s". Must be: ai-pattern, complexity, duplication, architecture, security-debt\n' "$CATEGORY_FILTER" >&2
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

# Validate normalized path
validate_file_path "$PATH_FILTER" || {
  printf 'ERROR: Invalid path "%s" (path traversal detected)\n' "$PATH_FILTER" >&2
  exit 1
}

# Verify path exists
if [ "$PATH_FILTER" != "." ] && [ ! -e "$PATH_FILTER" ]; then
  printf 'ERROR: Path "%s" does not exist\n' "$PATH_FILTER" >&2
  exit 1
fi

# Check git status (warn if uncommitted changes, don't block)
if ! git diff-index --quiet HEAD -- 2>/dev/null; then
  printf 'WARNING: You have uncommitted changes. Audit results may include work-in-progress code.\n' >&2
fi

# Create scanner output directory
mkdir -p .debt/scanner-output || {
  printf '[audit] ERROR: Failed to create .debt/scanner-output/\n' >&2
  exit 1
}

# Determine file list using extension-based filtering (performance optimization)
# Filters for common source code extensions instead of using file --mime-type
printf '[audit] Enumerating files...\n' >&2
git ls-files -z "$PATH_FILTER" 2>/dev/null | \
  grep -zE '\.(ts|tsx|js|jsx|py|rs|go|rb|java|c|cpp|h|hpp|cs|php|swift|kt|scala|sh|bash|zsh|md|yaml|yml|json|toml|sql)$' | \
  tr '\0' '\n' > .debt/file-list.txt || true

if [ ! -s .debt/file-list.txt ]; then
  printf '[audit] Warning: No source files found in %s\n' "$PATH_FILTER" >&2
  exit 0
fi

FILE_COUNT=$(wc -l < .debt/file-list.txt)
printf '[audit] Found %d source files to scan\n' "$FILE_COUNT" >&2

# Determine which scanners to run
if [ -n "$CATEGORY_FILTER" ]; then
  SCANNERS=("${CATEGORY_FILTER}")
else
  SCANNERS=(ai-pattern complexity duplication architecture security-debt)
fi

# Persist the scanner plan for the command body to orchestrate directly.
printf '[audit] Launching %d scanner(s)...\n' "${#SCANNERS[@]}" >&2
printf '%s\n' "${SCANNERS[@]}" > .debt/scanners-to-run.txt
if [ -n "$SEVERITY_FILTER" ]; then
  printf '%s\n' "$SEVERITY_FILTER" > .debt/severity-filter.txt
  printf '[audit] Severity filter: %s (written to .debt/severity-filter.txt)\n' "$SEVERITY_FILTER" >&2
else
  rm -f .debt/severity-filter.txt
fi
printf '[audit] Prepared scanner list in .debt/scanners-to-run.txt\n' >&2
printf '[audit] Run the listed scanner agents in parallel, then run yellow-debt:audit-synthesizer.\n' >&2
```

## Agent Orchestration

After the bash block succeeds:

1. Read `.debt/scanners-to-run.txt`.
2. Launch one Task per scanner in parallel using subagent type
   `yellow-debt:<scanner>-scanner`.
3. Each scanner prompt should instruct the agent to read
   `.debt/file-list.txt`, write findings to
   `.debt/scanner-output/<scanner>-scanner.json`, and if
   `.debt/severity-filter.txt` exists, filter to that minimum severity.
4. After all scanner tasks complete, launch `yellow-debt:audit-synthesizer` to merge
   `.debt/scanner-output/`, write the audit report to
   `docs/audits/YYYY-MM-DD-HHMMSS-audit-report.md`, and create todo files in
   `todos/debt/`.

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
- Audit report: `docs/audits/YYYY-MM-DD-HHMMSS-audit-report.md` (generated by
  synthesizer; per-run timestamp prevents same-day clobber)
- Todo files: `todos/debt/NNN-pending-SEVERITY-slug-HASH.md` (generated by
  synthesizer)

## Error Handling

**Scanner failures**: If ≤50% of scanners fail, audit continues with partial
results. If >50% fail, audit aborts.

**Synthesis failure**: Scanner outputs preserved in `.debt/scanner-output/` for
manual inspection or retry.

**File enumeration failure**: Usually indicates path doesn't exist or isn't
tracked by git.

## Recovery

If audit fails:

1. Check `.debt/scanner-output/` for scanner outputs
2. Re-run with `--category <name>` to retry specific scanner
3. Check logs for error messages with `[audit]` prefix
