---
status: complete
priority: p3
issue_id: "041"
tags: [code-review, user-experience]
dependencies: []
---

# NPM Install Error Context

## Problem Statement
If npm install fails in install-agent-browser.sh, only the npm error output is shown. No guidance about common failures (permission issues, network, node version). Users may not know how to troubleshoot or what to check next.

## Findings
- File: scripts/install-agent-browser.sh
- Current behavior on npm install failure:
  - Script exits with npm error output
  - Error may be cryptic (e.g., "EACCES", "ERESOLVE")
  - No context about common failure modes
  - No suggestions for troubleshooting
- Common failure scenarios:
  - Node version too old (agent-browser requires Node 18+)
  - npm permission issues (global install without sudo)
  - Network/proxy issues blocking registry access
  - Disk space insufficient for node_modules
  - Corrupt npm cache

## Proposed Solutions
### Option A: Add Error Handler with Common Failure Troubleshooting (Recommended)
- Wrap npm install in error handler
- On failure, show:
  - What failed (npm install agent-browser)
  - Common causes and how to check
  - Suggested remediation steps
- Check prerequisites before npm install
- Provide contextual help based on error type

### Option B: Add Prerequisite Checks
- Check node version before npm install
- Check npm version
- Check disk space
- Check network connectivity to registry
- Show clear error if prerequisites not met
- Prevent npm install from running if environment is wrong

## Recommended Action
Implement both Option A and Option B. Add prerequisite checks for node/npm version. Wrap npm install in error handler that provides troubleshooting context. Show common failure modes and remediation steps.

## Technical Details
```bash
# Add prerequisite checks
node_version=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
if [[ "$node_version" -lt 18 ]]; then
  printf '[install] Error: agent-browser requires Node 18+\n' >&2
  printf 'Current version: %s\n' "$(node --version)" >&2
  printf 'Install latest Node from https://nodejs.org/\n' >&2
  exit 1
fi

# Wrap npm install with error handler
if ! npm install -g agent-browser; then
  printf '\n[install] Error: npm install failed\n' >&2
  printf 'Common causes:\n' >&2
  printf '  1. Permission issues - try with sudo or fix npm permissions\n' >&2
  printf '  2. Network issues - check proxy/firewall settings\n' >&2
  printf '  3. Disk space - check available space in node_modules\n' >&2
  printf '  4. Corrupt cache - run: npm cache clean --force\n' >&2
  printf '\nNode version: %s\n' "$(node --version)" >&2
  printf 'npm version: %s\n' "$(npm --version)" >&2
  exit 1
fi
```

## Acceptance Criteria
- [ ] Add node version check (requires 18+)
- [ ] Add npm version check (requires recent npm)
- [ ] Wrap npm install in error handler
- [ ] Show common failure causes on error
- [ ] Show troubleshooting steps on error
- [ ] Show environment info (node/npm versions) on error
- [ ] Test with old node version (should fail with clear message)

## Work Log
| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-13 | Created from PR #11 code review | P3 UX finding - improves troubleshooting experience |

## Resources
- PR: #11 (yellow-browser-test plugin code review)
- Related files: scripts/install-agent-browser.sh
