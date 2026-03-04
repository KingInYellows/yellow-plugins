# Semgrep Triage State Reference

## State Mapping: MCP ↔ REST API ↔ UI

| MCP `status` Parameter | REST API `triage_state` | UI Label | Meaning |
|---|---|---|---|
| `ISSUE_TAB_OPEN` | `open` | Open | New or reopened, needs triage |
| `ISSUE_TAB_REVIEWING` | `reviewing` | Reviewing | Under investigation |
| `ISSUE_TAB_FIXING` | `fixing` | To Fix | Scheduled for remediation |
| `ISSUE_TAB_IGNORED` | `ignored` | Ignored | Deprioritized or false positive |
| `ISSUE_TAB_CLOSED` | `fixed` | Fixed | Remediated, no longer present |
| *(not available via MCP)* | `provisionally_ignored` | Provisionally Ignored | AI-flagged as likely false positive (Semgrep Assistant only) |

## State Transitions

```
open → reviewing → fixing → fixed
  ↓         ↓         ↓
  └─────────┴─────────┴──→ ignored
```

- `fixed` is set automatically when a finding disappears on full re-scan
- `fixing` is the target state for this plugin's workflow ("to fix" queue)
- Triage state propagation: during full scans, prior triage carries over to new
  branches. Does NOT apply to diff-aware scans.

## REST API Triage Mutation

```bash
curl -s -X POST --connect-timeout 5 --max-time 15 \
  -w "\n%{http_code}" \
  -H "Authorization: Bearer $SEMGREP_APP_TOKEN" \
  -H "Content-Type: application/json" \
  "https://semgrep.dev/api/v1/deployments/${SLUG}/triage" \
  -d "$(jq -n --argjson ids "[$FINDING_ID]" '{
    issue_type: "sast",
    issue_ids: $ids,
    new_triage_state: "fixed",
    new_note: "Fixed via yellow-semgrep plugin"
  }')"
```

**Response fields:** `succeeded[]`, `failed[]`, `skipped[]` — always parse all
three and report accordingly.

## Ignored State (Special Rules)

Setting `triage_state=ignored` **requires** a `new_triage_reason` field:

```json
{
  "issue_type": "sast",
  "issue_ids": [12345],
  "new_triage_state": "ignored",
  "new_triage_reason": "False positive confirmed by manual review"
}
```

## MCP `semgrep_findings` Parameters

```python
semgrep_findings(
    issue_type="ISSUE_TYPE_SAST",    # or "ISSUE_TYPE_SCA"
    repos=["org/repo-name"],          # REQUIRED — auto-detect from git remote
    status="ISSUE_TAB_FIXING",        # maps to "fixing" in REST
    severities=["SEVERITY_CRITICAL", "SEVERITY_HIGH"],  # optional filter
    confidence=["CONFIDENCE_HIGH"],   # optional filter
    autotriage_verdict="VERDICT_TRUE_POSITIVE",  # default
    limit=10                          # default — increase for batch operations
)
```

**Note:** MCP returns `list[Finding]` or the string `"No findings found"`.
Check for both formats.
