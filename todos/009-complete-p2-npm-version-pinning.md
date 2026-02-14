---
status: ready
priority: p2
issue_id: "009"
tags: [code-review, security, supply-chain]
dependencies: []
---

# npm install Without Version Pinning Risks Supply Chain Attack

## Problem Statement

The install script installs `ruvector` without version pinning by default. While `--ignore-scripts` mitigates post-install attacks, malicious code in the package itself executes when `npx ruvector` runs.

**Why it matters:** Supply chain compromise, breaking changes between versions, non-reproducible installs.

## Findings

- **Security Sentinel (H4):** No default version pin, --ignore-scripts only partial mitigation

## Proposed Solutions

### Option A: Pin to known-good version (Recommended)
- Set `RUVECTOR_VERSION="${RUVECTOR_VERSION:-0.1.x}"` as default
- Allow override via environment variable
- **Effort:** Small (30 min)
- **Risk:** Low

## Acceptance Criteria

- [ ] Default install pins to specific version
- [ ] User can override with RUVECTOR_VERSION env var
- [ ] Version documented in plugin.json or CLAUDE.md

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-12 | Created from PR #10 code review | Security H4 |

## Resources

- PR: #10
