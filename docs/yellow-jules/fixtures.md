# yellow-jules illustrative fixtures

**Status:** PR1 baseline (2026-09-10) **Reconciled to:** `main` `8baa0bdd`
**Contract:** [contract-v1.md](contract-v1.md)

Every JSON block in this file is an illustrative shape, not a captured response.
CLI envelopes follow contract-v1.md; vendor bodies are derived from
`dist/types.d.ts` and the mappers in `dist/index.mjs` of
`@google/jules-sdk@0.2.0` (`source-inspected`). Captured request bodies live in
[sdk-investigation.md](sdk-investigation.md) section 7 and never here. The line
above each block is the marker the PR1 verification counts.

## CLI envelopes

### setup

Illustrative only, not a captured response

```json
{
  "ok": true,
  "operation": "setup",
  "credentialSource": "env",
  "sdkResolution": "data-dir",
  "sdkVersion": "0.2.0",
  "sdkIntegrity": "sha512-fKutNR8VvzsxqKA4uYkkJUZauXhiuIu9aVpjgeMuFADKt95y7oQbRJX/QmOS74fy2yAsY6SwKnIY6cJaaG6kpQ==",
  "sourcesReachable": {
    "supported": true,
    "value": { "count": 3, "truncated": false }
  }
}
```

Illustrative only, not a captured response

```json
{
  "ok": false,
  "operation": "setup",
  "error": {
    "code": "JULES_SDK_INTEGRITY",
    "message": "downloaded tarball sha512 does not match the recorded integrity",
    "retryable": false,
    "recoveryAction": "Do not use the downloaded package; re-run /jules:setup after checking the registry, and report the mismatch."
  }
}
```

### delegate

Illustrative only, not a captured response

```json
{
  "ok": true,
  "operation": "delegate",
  "localRequestId": "req-2026-09-10T22:00:00Z-7f3a",
  "localId": "jl-0f3c9a2b7d4e4b1a9c8e6d5f4a3b2c1d",
  "sessionResource": "sessions/314159265358979",
  "vendorState": "queued",
  "condition": "starting",
  "repository": "octo/repo",
  "requestedBranch": "main",
  "observedHead": "8baa0bdd1c2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a",
  "sourceResource": "sources/github/octo/repo"
}
```

Illustrative only, not a captured response

```json
{
  "ok": false,
  "operation": "delegate",
  "localRequestId": "req-2026-09-10T22:00:00Z-7f3a",
  "error": {
    "code": "JULES_UNKNOWN_OUTCOME",
    "message": "network error after POST sessions was dispatched",
    "retryable": false,
    "recoveryAction": "Run `status --reconcile`; the reservation is kept and no replacement session was launched."
  }
}
```

### list

Illustrative only, not a captured response

```json
{
  "ok": true,
  "operation": "list",
  "sessions": [
    {
      "localId": "jl-0f3c9a2b7d4e4b1a9c8e6d5f4a3b2c1d",
      "sessionResource": "sessions/314159265358979",
      "vendorState": "awaitingPlanApproval",
      "condition": "awaiting-approval",
      "title": "Investigate flaky test",
      "createTime": "2026-09-10T22:00:03Z"
    }
  ],
  "nextPageToken": "1757541603000000000",
  "journalOnly": []
}
```

Illustrative only, not a captured response

```json
{
  "ok": false,
  "operation": "list",
  "error": {
    "code": "JULES_JOURNAL_CORRUPT",
    "message": "state/journal.json is not parseable; reads report journal-corrupt instead of an empty id set",
    "retryable": false,
    "recoveryAction": "Inspect and repair the journal by hand; new writes are blocked until it parses."
  }
}
```

### status

Illustrative only, not a captured response

```json
{
  "ok": true,
  "operation": "status",
  "localId": "jl-0f3c9a2b7d4e4b1a9c8e6d5f4a3b2c1d",
  "sessionResource": "sessions/314159265358979",
  "vendorState": "awaitingPlanApproval",
  "condition": "awaiting-approval",
  "activities": {
    "processed": 2,
    "new": 2,
    "pages": 1,
    "partialPagination": false,
    "dedupWindowExceeded": false
  },
  "pendingPlan": {
    "planId": "plan-1",
    "steps": [{ "id": "step-1", "index": 0, "title": "Read the failing test" }],
    "activityCreateTime": "2026-09-10T22:00:41Z"
  },
  "outputs": []
}
```

Illustrative only, not a captured response

```json
{
  "ok": false,
  "operation": "status",
  "error": {
    "code": "JULES_NOT_FOUND",
    "message": "session not found",
    "retryable": false,
    "recoveryAction": "Verify the session reference; the journal entry is kept for reconciliation."
  }
}
```

### reply

Illustrative only, not a captured response

```json
{
  "ok": true,
  "operation": "reply",
  "localRequestId": "req-2026-09-10T22:05:00Z-a1b2",
  "sessionResource": "sessions/314159265358979",
  "sent": true
}
```

Illustrative only, not a captured response

```json
{
  "ok": false,
  "operation": "reply",
  "localRequestId": "req-2026-09-10T22:05:00Z-a1b2",
  "error": {
    "code": "JULES_CONFIRMATION_REQUIRED",
    "message": "reply is a mutating operation and no grant or confirmation token was supplied",
    "retryable": false,
    "recoveryAction": "Run `reply --dry-run`, confirm through the wrapper, then re-run with the token in the YELLOW_JULES_CONFIRMATION environment variable, or pass --grant-id."
  }
}
```

### approve

Illustrative only, not a captured response

```json
{
  "ok": true,
  "operation": "approve",
  "localRequestId": "req-2026-09-10T22:06:00Z-c3d4",
  "sessionResource": "sessions/314159265358979",
  "approvedPlanId": "plan-1",
  "observedPlanIdAfter": "plan-1",
  "verificationDeferred": false
}
```

Illustrative only, not a captured response

```json
{
  "ok": false,
  "operation": "approve",
  "localRequestId": "req-2026-09-10T22:06:00Z-c3d4",
  "error": {
    "code": "JULES_POLICY_DEVIATION",
    "message": "pending plan plan-2 differs from evaluated plan plan-1; not approved",
    "retryable": false,
    "recoveryAction": "Run `status`, evaluate the current plan, and approve it by its id."
  }
}
```

### collect

Illustrative only, not a captured response

```json
{
  "ok": true,
  "operation": "collect",
  "localId": "jl-0f3c9a2b7d4e4b1a9c8e6d5f4a3b2c1d",
  "artifacts": [
    {
      "kind": "patch",
      "path": "artifacts/jl-0f3c9a2b7d4e4b1a9c8e6d5f4a3b2c1d/patch.diff",
      "sha256": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
      "baseCommit": "8baa0bdd1c2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a",
      "secretShapedContent": false,
      "verification": "unverified"
    }
  ],
  "activities": { "pages": 1, "partialPagination": false },
  "noSupportedArtifact": false
}
```

Illustrative only, not a captured response

```json
{
  "ok": false,
  "operation": "collect",
  "error": {
    "code": "JULES_DATA_DIR",
    "message": "artifact staging directory is group-writable",
    "retryable": false,
    "recoveryAction": "Fix ownership and mode of the yellow-jules data directory (0700 directories, 0600 files), then retry; nothing was staged."
  }
}
```

### authorize, supervise, integrate

No fixtures. contract-v1.md defers these result shapes to shells 03 (PR3) and 04
(PR4); illustrating them here would invent fields that drift once those shells
fix the real shape.

## Vendor request and response bodies

REST field names as the SDK serializes them (`index.mjs` L2743-2746, L1508-1511,
L1527-1530) and response shapes as `types.d.ts` declares them.

### Create session

Request `POST /v1alpha/sessions`:

Illustrative only, not a captured response

```json
{
  "prompt": "Investigate the flaky test in tests/integration/foo.test.ts and propose a fix.",
  "title": "Investigate flaky test",
  "sourceContext": {
    "source": "sources/github/octo/repo",
    "githubRepoContext": { "startingBranch": "main" }
  },
  "automationMode": "AUTOMATION_MODE_UNSPECIFIED",
  "requirePlanApproval": true
}
```

Response:

Illustrative only, not a captured response

```json
{
  "name": "sessions/314159265358979",
  "id": "314159265358979",
  "prompt": "Investigate the flaky test in tests/integration/foo.test.ts and propose a fix.",
  "title": "Investigate flaky test",
  "sourceContext": {
    "source": "sources/github/octo/repo",
    "githubRepoContext": { "startingBranch": "main" }
  },
  "requirePlanApproval": true,
  "automationMode": "AUTOMATION_MODE_UNSPECIFIED",
  "state": "QUEUED",
  "createTime": "2026-09-10T22:00:03Z",
  "updateTime": "2026-09-10T22:00:03Z",
  "url": "https://jules.google.com/session/314159265358979",
  "outputs": []
}
```

### Reply (send message)

Request `POST /v1alpha/sessions/314159265358979:sendMessage`:

Illustrative only, not a captured response

```json
{ "prompt": "Please keep the change limited to the test file." }
```

Response (the SDK returns `{}` for an empty body):

Illustrative only, not a captured response

```json
{}
```

### Approve plan

Request `POST /v1alpha/sessions/314159265358979:approvePlan` (no plan id):

Illustrative only, not a captured response

```json
{}
```

Response:

Illustrative only, not a captured response

```json
{}
```
