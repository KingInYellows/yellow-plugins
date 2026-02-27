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
- `--category <name>` — Run only specific scanner: ai-patterns, complexity,
  duplication, architecture, security
- `--severity <level>` — Filter output to minimum severity: critical, high,
  medium, low

## Implementation

```bash
#!/usr/bin/env bash
set -euo pipefail

# Source validation library
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
# shellcheck source=../../lib/validate.sh
source "${PLUGIN_ROOT}/lib/validate.sh"

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

# Output Task tool orchestration instructions for Claude
printf '\n=== AGENT ORCHESTRATION REQUIRED ===\n'
printf 'Launch the following scanner agents in PARALLEL:\n\n'

for scanner in "${SCANNERS[@]}"; do
  TASK_DESC="Scan codebase for ${scanner} technical debt patterns. Read file list from .debt/file-list.txt and write findings to .debt/scanner-output/${scanner}-scanner.json following the debt-conventions skill schema."
  if [ -n "$SEVERITY_FILTER" ]; then
    TASK_DESC="${TASK_DESC} Filter to ${SEVERITY_FILTER} severity or higher."
  fi

  # Output Task tool call for Claude to execute
  cat <<EOF
Task(
  subagent_type="${scanner}-scanner",
  description="Scan for ${scanner} technical debt",
  prompt="${TASK_DESC}"
)
EOF
  printf '\n'
done

printf 'After ALL scanner agents complete, launch the synthesizer:\n\n'
cat <<EOF
Task(
  subagent_type="audit-synthesizer",
  description="Synthesize scanner outputs into report",
  prompt="Merge scanner outputs from .debt/scanner-output/, deduplicate findings using debt-conventions scoring, generate audit report at docs/audits/$(date +%Y-%m-%d)-audit-report.md and create todo files in todos/debt/ following atomic state conventions."
)
EOF

printf '\n=== END ORCHESTRATION ===\n'
printf '[audit] Setup complete. Launch agents as shown above.\n' >&2
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
- Audit report: `docs/audits/YYYY-MM-DD-audit-report.md` (generated by
  synthesizer)
- Todo files: `todos/debt/NNN-pending-SEVERITY-slug.md` (generated by
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
