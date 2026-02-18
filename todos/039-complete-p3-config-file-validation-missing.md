---
status: complete
priority: p3
issue_id: '039'
tags: [code-review, reliability]
dependencies: []
---

# Config File Validation Missing

## Problem Statement

Setup command writes YAML config to `.claude/yellow-browser-test.local.md` but
no validation that the written config is well-formed YAML. Malformed config
would break subsequent test/explore commands with cryptic errors.

## Findings

- File: commands/browser-test/setup.md
- Setup writes config file with user-provided values
- No read-back validation after write
- If YAML is malformed (e.g., unescaped special chars in baseURL), yq/jq parsing
  fails
- Test/explore commands would fail with generic "cannot parse config" error
- User might not realize setup produced invalid config
- Common failure modes:
  - Special chars in authCredentials (passwords with quotes/colons)
  - Invalid YAML indentation
  - Write tool producing malformed output

## Proposed Solutions

### Option A: Add Config Read-Back Validation Step (Recommended)

- After writing config, read it back with yq
- Parse all required fields (baseURL, authType, authCredentials)
- If parsing fails, show clear error and ask user to re-run setup
- Validate field values (e.g., baseURL is valid URL)
- Prevents silent failures in subsequent commands

### Option B: Use JSON Instead of YAML for Simpler Parsing

- Change config format from YAML to JSON
- JSON is simpler to parse and validate
- Less risk of indentation/escaping issues
- Would require updating test/explore commands to use jq instead of yq
- Breaking change for existing users

## Recommended Action

Implement Option A. Add validation step to setup.md after config write. Use yq
to parse config and verify required fields. Show clear error if validation
fails. Document config schema validation in test-conventions skill.

## Technical Details

```bash
# Add to setup.md after Write tool call
# Validate config was written correctly
if ! yq eval '.baseURL' "$config_file" >/dev/null 2>&1; then
  printf '[setup] Error: Config file is malformed YAML\n' >&2
  printf 'Please re-run setup and check for special characters in credentials\n' >&2
  exit 1
fi

# Validate required fields
base_url=$(yq eval '.baseURL' "$config_file")
auth_type=$(yq eval '.authType' "$config_file")
if [[ -z "$base_url" ]] || [[ -z "$auth_type" ]]; then
  printf '[setup] Error: Config is missing required fields\n' >&2
  exit 1
fi

# Validate baseURL format
if ! [[ "$base_url" =~ ^https?:// ]]; then
  printf '[setup] Error: baseURL must start with http:// or https://\n' >&2
  exit 1
fi

printf '[setup] Config validated successfully\n'
```

## Acceptance Criteria

- [ ] Add config validation step to setup.md after Write tool
- [ ] Validate YAML is well-formed using yq
- [ ] Validate required fields are present (baseURL, authType, authCredentials)
- [ ] Validate baseURL format (starts with http/https)
- [ ] Show clear error message if validation fails
- [ ] Document validation in test-conventions skill

## Work Log

| Date       | Action                          | Learnings                                                  |
| ---------- | ------------------------------- | ---------------------------------------------------------- |
| 2026-02-13 | Created from PR #11 code review | P3 reliability finding - prevents silent config corruption |

## Resources

- PR: #11 (yellow-browser-test plugin code review)
- Related files: commands/browser-test/setup.md
