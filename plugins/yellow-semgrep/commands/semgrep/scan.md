---
name: semgrep:scan
description: "Run local Semgrep scan and compare results with platform findings. Use when user says 'scan for issues', 'check security', 'run semgrep', or wants to verify local code against the Semgrep platform."
argument-hint: '[--changed-only] [--severity error,warning]'
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
  - Skill
  - AskUserQuestion
  - mcp__plugin_yellow-semgrep_semgrep__semgrep_scan
---

# Local Semgrep Scan

Run a local Semgrep scan on the workspace and compare results with findings on
the Semgrep AppSec Platform.

## Workflow

### Step 1: Validate Prerequisites

Check `semgrep` CLI is available. Check `SEMGREP_APP_TOKEN` if platform
comparison is desired.

### Step 2: Parse Arguments

Parse `$ARGUMENTS` for:

- **`--changed-only`:** Scope scan to files modified since last commit
- **`--severity error,warning`:** Filter by severity level

### Step 3: Determine Scan Scope

Default: full workspace.

If `--changed-only`:
```bash
CHANGED_FILES=$(git diff --name-only HEAD 2>/dev/null)
if [ -z "$CHANGED_FILES" ]; then
  printf '[yellow-semgrep] No changed files detected.\n'
  exit 0
fi
```

### Step 4: Run Local Scan

```bash
semgrep scan --config auto --json --metrics off ${INCLUDE_FLAGS} 2>/dev/null
```

If `--changed-only`, add `--include` flags for each changed file.

Parse JSON output for findings. Group by severity and rule.

Alternatively, use the MCP `semgrep_scan` tool for files:
```
mcp__plugin_yellow-semgrep_semgrep__semgrep_scan
  code_files: [{ path: "/absolute/path/to/file.py" }]
```

### Step 5: Compare with Platform (Optional)

If `SEMGREP_APP_TOKEN` is available, fetch platform findings for the same repo
and compare:

- **Local only:** Findings present locally but not on platform (new issues)
- **Platform only:** Findings on platform but not locally (possibly fixed)
- **Both:** Findings present in both (confirmed issues)

### Step 6: Display Results

```
Local Semgrep Scan Results — {repo_name}
═════════════════════════════════════════

Findings: {total_count}
  CRITICAL: {n}   HIGH: {n}   MEDIUM: {n}   LOW: {n}

Top Rules:
  {check_id}     {count} findings    {severity}
  ...

{If platform comparison available:}
Platform Comparison:
  New (local only):     {n} findings
  Confirmed (both):     {n} findings
  Resolved (platform only): {n} findings
```

## Error Handling

- `semgrep` not installed: "semgrep CLI required. Install: pip install semgrep"
- Scan timeout: "Scan timed out. Try --changed-only for smaller scope."
- Parse error: "Could not parse scan output. Run with --debug for details."
