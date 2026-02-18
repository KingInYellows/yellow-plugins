---
status: complete
priority: p3
issue_id: '043'
tags: [code-review, user-experience]
dependencies: []
---

# Polling Progress Feedback

## Problem Statement

Dev server readiness polling gives no progress feedback to user. Long startup
times appear as the command hanging. User may think the command is frozen and
interrupt it, when it's actually waiting for the dev server to start.

## Findings

- File: commands/browser-test/test.md
- Current behavior:
  - Command polls dev server URL in loop
  - No output during polling
  - May take 10-30+ seconds for large apps
  - User sees no indication of progress
  - Appears to hang between "Starting dev server" and "Dev server ready"
- User experience issues:
  - Cannot tell if polling is working or stuck
  - No sense of how long to wait
  - May interrupt command thinking it's frozen
  - No feedback on timeout approaching

## Proposed Solutions

### Option A: Add Progress Dots or Status Messages During Polling (Recommended)

- Print a dot or message each polling attempt
- Example: "Waiting for dev server..." followed by dots every 2 seconds
- Shows command is actively working
- Simple to implement
- Clear visual feedback

### Option B: Show Timeout Countdown

- Show remaining time until timeout
- Example: "Waiting for dev server (58s remaining)..."
- Update countdown each poll attempt
- More informative but requires timeout tracking
- May create anxiety if countdown is too visible

## Recommended Action

Implement Option A with enhancement from Option B. Show "Waiting for dev
server..." message before polling starts. Print a dot every 2 seconds during
polling. After timeout/2, show remaining time. This balances simplicity with
informativeness.

## Technical Details

```bash
# In test.md/explore.md polling loop
printf '[browser-test] Waiting for dev server at %s' "$base_url"
attempt=0
max_attempts=30
while ! curl -sf "$base_url" >/dev/null 2>&1; do
  attempt=$((attempt + 1))

  if [[ $attempt -ge $max_attempts ]]; then
    printf '\n[browser-test] Error: Dev server not ready after 60s\n' >&2
    exit 1
  fi

  # Show progress dot
  printf '.'

  # Show countdown after halfway point
  if [[ $attempt -ge $((max_attempts / 2)) ]]; then
    remaining=$((max_attempts - attempt))
    printf ' (%ss remaining)' $((remaining * 2))
  fi

  sleep 2
done
printf ' ready!\n'
```

Alternative simple version:

```bash
printf '[browser-test] Waiting for dev server'
while ! curl -sf "$base_url" >/dev/null 2>&1; do
  printf '.'
  sleep 2
done
printf ' ready!\n'
```

## Acceptance Criteria

- [ ] Add "Waiting for dev server..." message before polling
- [ ] Print progress dot every 2 seconds during polling
- [ ] Show "ready!" message when server is up
- [ ] Optional: show countdown after timeout/2
- [ ] Test with slow-starting dev server
- [ ] Ensure progress output is user-friendly
- [ ] Update both test.md and explore.md commands

## Work Log

| Date       | Action                          | Learnings                                                    |
| ---------- | ------------------------------- | ------------------------------------------------------------ |
| 2026-02-13 | Created from PR #11 code review | P3 UX finding - silent polling creates perception of hanging |

## Resources

- PR: #11 (yellow-browser-test plugin code review)
- Related files: commands/browser-test/test.md, commands/browser-test/explore.md
