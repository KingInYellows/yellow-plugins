# Fix Strategy Patterns

## Decision Tree

```
START: Finding received with check_id, path, line
  │
  ├─ Does file exist locally?
  │   NO → "File not found. [Mark fixed] [Skip] [Enter path]"
  │
  ├─ Does file have uncommitted changes?
  │   YES → "Uncommitted changes on {path}. [Stash and proceed] [Abort]"
  │
  ├─ Is finding still present locally? (pre-fix scan)
  │   NO → "Finding not present locally. [Mark fixed on platform] [Skip]"
  │
  ├─ Does rule have autofix?
  │   semgrep scan --config "r/{check_id}" --autofix --dryrun --metrics off "{path}"
  │   │
  │   ├─ YES (diff produced):
  │   │   ├─ Run language syntax check on proposed output
  │   │   │   ├─ PASS → Show diff, ask user approval
  │   │   │   └─ FAIL → Fall through to LLM fix
  │   │   └─ Apply: semgrep scan --config "r/{check_id}" --autofix --metrics off "{path}"
  │   │
  │   └─ NO (no diff / no fix: key in rule):
  │       └─ Spawn finding-fixer agent
  │           Context: { check_id, severity, message, cwe, path, line, code }
  │           Agent generates minimal targeted fix
  │           Show diff, ask user approval
  │           Apply via Edit tool
  │
  ├─ VERIFY (spawn scan-verifier)
  │   ├─ Re-scan with same rule → finding gone?
  │   │   NO → "Fix did not resolve finding. [Revert] [Retry with LLM]"
  │   │
  │   ├─ Full rescan → new findings introduced?
  │   │   YES → "New findings at modified lines. [Proceed anyway] [Revert]"
  │   │
  │   └─ PASS → Proceed to triage update
  │
  └─ UPDATE TRIAGE STATE
      POST /deployments/{slug}/triage with explicit issue_ids
      Parse succeeded/failed/skipped arrays
```

## Autofix Detection

The `fixable` field in the finding response indicates whether the rule has a
`fix:` key. However, this is not always reliable — always attempt
`--autofix --dryrun` regardless.

## Common Fix Pattern Categories

### Input Validation (CWE-20, CWE-89, CWE-79)

- SQL injection: parameterized queries replace string concatenation
- XSS: output encoding/escaping
- Command injection: input sanitization, allowlisting

### Dangerous Functions (CWE-95, CWE-78)

- `eval()` → safer alternatives (JSON.parse, ast.literal_eval)
- `exec()` → function dispatch tables
- `os.system()` → subprocess with shell=False

### Cryptography (CWE-327, CWE-328)

- Weak hash algorithms → SHA-256/SHA-3
- Hardcoded secrets → environment variables
- Insecure random → cryptographic random

### Path Traversal (CWE-22)

- User-controlled paths → path normalization + prefix check
- `..` in paths → canonical path resolution

## Batch Fix Ordering

When processing multiple findings in `/semgrep:fix-batch`:

1. Group by file path
2. Within each file, sort by line number descending (fix bottom-up to avoid
   line number shifts)
3. Between files, sort by severity (critical first)
4. After each fix in the same file, re-fetch finding locations (line numbers
   may have shifted)

## Git State Safety

```bash
# Check if specific file has uncommitted changes
if git diff --name-only -- "${FILE}" | grep -q .; then
  # File has unstaged changes
  DIRTY=true
fi
if git diff --cached --name-only -- "${FILE}" | grep -q .; then
  # File has staged changes
  DIRTY=true
fi
```

## Revert Pattern

If a fix fails verification or user rejects:

```bash
git checkout -- "${FILE}"
```

This reverts ALL changes to the file. If the fix was applied via
`semgrep --autofix`, this cleanly restores the original.
