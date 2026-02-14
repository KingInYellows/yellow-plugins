---
status: complete
priority: p3
issue_id: "044"
tags: [code-review, reliability, error-handling]
dependencies: []
---

# Config Malformation Resilience

## Problem Statement
Commands read config from `.claude/yellow-browser-test.local.md` but don't handle case where file exists but has malformed YAML or missing required fields. Commands fail with cryptic yq/jq parse errors instead of actionable error messages.

## Findings
- Files: commands/browser-test/test.md, explore.md
- Current behavior:
  - Commands assume config file is well-formed if it exists
  - No validation before reading fields
  - Malformed YAML causes yq parse errors
  - Missing required fields cause empty variable errors later
  - User sees generic "cannot parse" or "field not found" errors
- Failure scenarios:
  - User manually edits config and introduces YAML syntax error
  - Write tool creates malformed YAML (rare but possible)
  - User deletes required field from config
  - Config file corruption (disk error, interrupted write)
- Related to TODO 039 (setup validation) but this is runtime resilience

## Proposed Solutions
### Option A: Add YAML Parsing with Field Validation (Recommended)
- Before using config, validate it's well-formed YAML
- Check all required fields are present
- Validate field values (e.g., baseURL format)
- Show clear error with remediation steps if invalid
- Suggest re-running setup if config is malformed

### Option B: Re-run Setup if Config is Malformed
- Detect malformed config automatically
- Prompt user: "Config is invalid, re-run setup? [y/n]"
- If yes, run setup command inline
- If no, show error and exit
- More user-friendly but requires command composition

## Recommended Action
Implement Option A with Option B as fallback. Validate config at start of test/explore commands. Show clear error if malformed. Suggest running `yellow-browser-test setup` to recreate config. Optional: add `--force-setup` flag to automatically re-run setup on invalid config.

## Technical Details
```bash
# Add to test.md and explore.md before using config
config_file="${project_dir}/.claude/yellow-browser-test.local.md"

# Check file exists
if [[ ! -f "$config_file" ]]; then
  printf '[browser-test] Error: Config file not found\n' >&2
  printf 'Run: yellow-browser-test setup\n' >&2
  exit 1
fi

# Validate YAML is well-formed
if ! yq eval '.' "$config_file" >/dev/null 2>&1; then
  printf '[browser-test] Error: Config file has malformed YAML\n' >&2
  printf 'File: %s\n' "$config_file" >&2
  printf 'Run: yellow-browser-test setup (to recreate config)\n' >&2
  exit 1
fi

# Validate required fields
required_fields=("baseURL" "authType" "authCredentials")
for field in "${required_fields[@]}"; do
  value=$(yq eval ".$field" "$config_file")
  if [[ -z "$value" ]] || [[ "$value" == "null" ]]; then
    printf '[browser-test] Error: Config is missing required field: %s\n' "$field" >&2
    printf 'Run: yellow-browser-test setup (to recreate config)\n' >&2
    exit 1
  fi
done

# Validate baseURL format
base_url=$(yq eval '.baseURL' "$config_file")
if ! [[ "$base_url" =~ ^https?:// ]]; then
  printf '[browser-test] Error: Invalid baseURL in config: %s\n' "$base_url" >&2
  printf 'baseURL must start with http:// or https://\n' >&2
  printf 'Run: yellow-browser-test setup (to fix config)\n' >&2
  exit 1
fi

printf '[browser-test] Config validated\n'
```

## Acceptance Criteria
- [ ] Add config validation to test.md command
- [ ] Add config validation to explore.md command
- [ ] Check YAML is well-formed with yq
- [ ] Check all required fields are present
- [ ] Validate baseURL format
- [ ] Show clear error if validation fails
- [ ] Suggest running setup to fix config
- [ ] Test with malformed YAML (should show clear error)
- [ ] Test with missing required field (should show clear error)

## Work Log
| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-13 | Created from PR #11 code review | P3 reliability finding - prevents cryptic errors from bad config |

## Resources
- PR: #11 (yellow-browser-test plugin code review)
- Related files: commands/browser-test/test.md, explore.md
- Related TODO: 039 (setup validation)
