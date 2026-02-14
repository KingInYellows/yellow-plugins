---
status: complete
priority: p3
issue_id: "042"
tags: [code-review, user-experience]
dependencies: []
---

# Chromium Install Failure Handling

## Problem Statement
`npx agent-browser install-chromium` failure is not explicitly handled. Script has `set -e` so it would exit, but error message would be raw npx output with no context. User may not understand what failed or why.

## Findings
- File: scripts/install-agent-browser.sh
- Current behavior:
  - `npx agent-browser install-chromium` runs with no error handler
  - Script exits on failure (due to `set -e`)
  - Error is raw output from npx/agent-browser
  - No context about what this step does or why it's needed
- Common failure scenarios:
  - Insufficient disk space (chromium is ~300MB)
  - Network timeout during download
  - Permission issues writing to cache directory
  - Platform not supported (rare)
  - Download mirror blocked by firewall

## Proposed Solutions
### Option A: Add Trap with User-Friendly Error Message (Recommended)
- Wrap chromium install in error handler
- On failure, show:
  - What failed (chromium download)
  - Why it's needed (headless browser for testing)
  - Common causes and troubleshooting
  - Suggested remediation steps
- Provide context about disk space and network requirements

### Option B: Check Disk Space Before Chromium Download
- Check available disk space before download
- Warn if less than 500MB available
- Show clear error if insufficient space
- Prevent download attempt if space is low
- More proactive but requires platform-specific disk check

## Recommended Action
Implement both Option A and Option B. Check disk space before download. Wrap chromium install in error handler with user-friendly message. Show troubleshooting steps on failure.

## Technical Details
```bash
# Add disk space check (Linux/macOS)
cache_dir="${HOME}/.cache/agent-browser"
available_mb=$(df -m "$HOME" | awk 'NR==2 {print $4}')
if [[ "$available_mb" -lt 500 ]]; then
  printf '[install] Warning: Low disk space (%s MB available)\n' "$available_mb" >&2
  printf 'Chromium download requires ~300MB\n' >&2
fi

# Wrap chromium install with error handler
printf '[install] Downloading chromium browser...\n'
if ! npx agent-browser install-chromium; then
  printf '\n[install] Error: Chromium download failed\n' >&2
  printf 'Common causes:\n' >&2
  printf '  1. Network timeout - check internet connection\n' >&2
  printf '  2. Insufficient disk space - need ~300MB free\n' >&2
  printf '  3. Permission issues - check ~/.cache/agent-browser permissions\n' >&2
  printf '  4. Firewall blocking download - check proxy settings\n' >&2
  printf '\nAvailable disk space: %s MB\n' "$available_mb" >&2
  exit 1
fi
printf '[install] Chromium installed successfully\n'
```

## Acceptance Criteria
- [ ] Add disk space check before chromium download
- [ ] Warn if disk space is low (<500MB)
- [ ] Wrap install-chromium in error handler
- [ ] Show common failure causes on error
- [ ] Show troubleshooting steps on error
- [ ] Show disk space info on error
- [ ] Add progress message before/after download
- [ ] Test with insufficient disk space (should show clear error)

## Work Log
| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-13 | Created from PR #11 code review | P3 UX finding - chromium download is common failure point |

## Resources
- PR: #11 (yellow-browser-test plugin code review)
- Related files: scripts/install-agent-browser.sh
