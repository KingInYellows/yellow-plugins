---
status: complete
priority: p2
issue_id: "081"
tags: [code-review, yellow-ci, error-handling]
dependencies: []
---

# Session Start jq JSON Validation

## Problem Statement

The session-start.sh script parses GitHub API responses with jq without validating the JSON structure. If the API returns an error object instead of the expected array, `jq 'length'` fails, but `|| failure_count=0` masks the error. Users see "0 failures" instead of an API error message, and rate limit responses go undetected.

## Findings

**File:** `plugins/yellow-ci/hooks/scripts/session-start.sh`

**Lines 67-69:**
```bash
# Parse failure count (defaults to 0 if parsing fails)
failure_count=$(printf '%s' "$workflow_runs_json" | \
    jq '[.workflow_runs[] | select(.conclusion == "failure")] | length') \
    || failure_count=0
```

**Problem Analysis:**

1. **No Structure Validation:**
   - Assumes `workflow_runs_json` contains `.workflow_runs[]` array
   - API errors return different structure (e.g., `{"message": "..."}`)
   - Rate limit responses: `{"message": "API rate limit exceeded", ...}`

2. **Error Masking:**
   - `|| failure_count=0` converts all errors to "0 failures"
   - jq parsing failure is indistinguishable from legitimate 0 count
   - User sees successful result for failed API call

3. **Undetected Rate Limiting:**
   - GitHub API returns 429 with error object
   - Script treats this as "0 failures"
   - No indication that data is stale/unavailable
   - User is unaware of rate limit issue

4. **Misleading Output:**
   ```
   GitHub CI Status: 0 failures
   # Actually: API returned error, no data available
   ```

## Proposed Solutions

**Step 1: Validate JSON Structure**

Check that the response is an array before parsing:

```bash
# Validate API response structure
if ! printf '%s' "$workflow_runs_json" | jq -e 'type == "object" and has("workflow_runs")' >/dev/null 2>&1; then
    printf '[yellow-ci] Error: Invalid API response format\n' >&2
    # Optionally: log the error message from API
    error_msg=$(printf '%s' "$workflow_runs_json" | jq -r '.message // "Unknown error"' 2>/dev/null || echo "Parse error")
    printf '[yellow-ci] API error: %s\n' "$error_msg" >&2
    return 1
fi
```

**Step 2: Explicit Array Validation**

```bash
# Check workflow_runs is an array
if ! printf '%s' "$workflow_runs_json" | jq -e '.workflow_runs | type == "array"' >/dev/null 2>&1; then
    printf '[yellow-ci] Error: workflow_runs is not an array\n' >&2
    return 1
fi
```

**Step 3: Safe Parsing with Validation**

```bash
# Parse failure count with validation
failure_count=$(printf '%s' "$workflow_runs_json" | \
    jq -e '.workflow_runs | type == "array" // error("Not an array") |
           map(select(.conclusion == "failure")) | length')

if [ $? -ne 0 ]; then
    printf '[yellow-ci] Error: Failed to parse workflow data\n' >&2
    return 1
fi
```

**Step 4: Rate Limit Detection**

```bash
# Check for rate limit response
if printf '%s' "$workflow_runs_json" | jq -e 'has("message") and (.message | contains("rate limit"))' >/dev/null 2>&1; then
    printf '[yellow-ci] Warning: GitHub API rate limit exceeded\n' >&2
    printf '[yellow-ci] Using cached data or skipping check\n' >&2
    return 1
fi
```

## Technical Details

**File:** `plugins/yellow-ci/hooks/scripts/session-start.sh:67-69`

**GitHub API Error Responses:**

1. **Rate Limit (HTTP 429):**
   ```json
   {
     "message": "API rate limit exceeded for ...",
     "documentation_url": "https://..."
   }
   ```

2. **Not Found (HTTP 404):**
   ```json
   {
     "message": "Not Found",
     "documentation_url": "https://..."
   }
   ```

3. **Unauthorized (HTTP 401):**
   ```json
   {
     "message": "Bad credentials",
     "documentation_url": "https://..."
   }
   ```

**Expected Success Response:**
```json
{
  "total_count": 42,
  "workflow_runs": [
    {
      "id": 123,
      "conclusion": "success",
      ...
    }
  ]
}
```

**jq Flags:**
- `-e` / `--exit-status`: Exit with status 1 if output is false/null
- Enables distinguishing between "value is 0" and "parsing failed"

## Acceptance Criteria

- [ ] JSON structure validation added before parsing
- [ ] Check that `.workflow_runs` exists and is an array
- [ ] Rate limit responses detected and logged
- [ ] API error messages extracted and displayed
- [ ] Component prefix `[yellow-ci]` used in all error messages
- [ ] No false positives ("0 failures" when API failed)
- [ ] Script exits or handles error gracefully (doesn't display misleading counts)
- [ ] Manual testing with mocked API error responses
- [ ] Existing functionality preserved for valid responses
