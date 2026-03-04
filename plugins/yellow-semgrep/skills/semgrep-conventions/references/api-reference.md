# Semgrep REST API Quick Reference

## Base URL

`https://semgrep.dev/api/v1/`

## Authentication

```http
Authorization: Bearer $SEMGREP_APP_TOKEN
```

Token must have **Web API** scope. CI-scoped tokens return 404 on REST
endpoints.

## Rate Limit

~60 requests/minute. Add 1-second delay between calls in batch mode.

## Endpoints

### Validate Token

```http
GET /me

Response 200:
{
  "user": {
    "id": "user_12345",
    "email": "user@example.com",
    "organizations": [{ "id": "org_67890", "name": "My Org" }]
  }
}
```

### List Deployments

```http
GET /deployments

Response 200:
{
  "deployments": [
    { "id": 12345, "slug": "my-org", "name": "My Organization" }
  ]
}
```

### List Findings

```http
GET /deployments/{slug}/findings

Query Parameters:
  triage_state  string   "fixing" for to-fix findings
  repos         string[] Filter by repo name(s)
  severity      string   "CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"
  confidence    string   "HIGH", "MEDIUM", "LOW"
  check_id      string   Filter by rule ID
  ref           string   Git branch (e.g., "main") — omit to search all branches
  dedup         string   "true" — ALWAYS USE THIS
  page          int      0-indexed page number
  page_size     int      Results per page (default: 100)

Response 200:
{
  "findings": [
    {
      "id": 12345,
      "check_id": "python.lang.security.audit.dangerous-eval",
      "severity": "HIGH",
      "confidence": "HIGH",
      "message": "Detected use of eval()...",
      "path": "src/utils/parser.py",
      "line": 42,
      "fixable": true,
      "cwe": "CWE-95",
      "triage_state": "fixing",
      "ref": "main",
      "created_at": "2026-01-15T09:00:00Z",
      "syntactic_id": "abc123...",
      "match_based_id": "def456..."
    }
  ]
}
```

**Pagination:** Offset-based. Increment `page` until `findings` array is empty.

**Dedup warning:** Without `dedup=true`, counts may be significantly higher
than the Semgrep UI shows.

### Bulk Triage

```http
POST /deployments/{slug}/triage
Content-Type: application/json

Request:
{
  "issue_type": "sast",
  "issue_ids": [12345, 67890],
  "new_triage_state": "fixed",
  "new_note": "Fixed via yellow-semgrep plugin"
}

Response 200:
{
  "succeeded": [{ "issue_ids": [12345, 67890] }],
  "failed": [{ "error": "Finding not found", "issue_ids": [99999] }],
  "skipped": [{ "reason": "Already in target state", "issue_ids": [11111] }]
}
```

**Required fields:** `issue_type` + `issue_ids` + (`new_triage_state` OR
`new_note`).

**SAFETY RULE:** Always use explicit `issue_ids`. The API also accepts filter
params instead of IDs, but this plugin **never** uses filter-based selection —
it risks unintended mass state changes.

## HTTP Status Codes

| Code | Meaning | Action |
|---|---|---|
| 200 | Success | Parse response |
| 401 | Invalid/expired token | Re-run `/semgrep:setup` |
| 403 | Insufficient permissions | Check token scope |
| 404 | Not found (or CI-scoped token) | Check token has Web API scope |
| 429 | Rate limit exceeded | Wait 60s, retry once |
| 5xx | Server error | Retry once after 5s |

## curl Exit Codes

| Code | Meaning | Action |
|---|---|---|
| 0 | Success | Continue |
| 6 | DNS resolution failed | Check network connectivity |
| 7 | Connection refused | Check semgrep.dev is accessible |
| 28 | Timeout | Retry once |
| Other | Unexpected error | Report and exit |
