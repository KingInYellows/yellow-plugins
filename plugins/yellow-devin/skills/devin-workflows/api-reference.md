# Devin API v1 Reference

Base URL: `https://api.devin.ai/v1/`

Authentication: `Authorization: Bearer $DEVIN_API_TOKEN`

## Sessions

### Create Session

```
POST /v1/sessions
```

Request body (construct via jq):
```json
{
  "prompt": "Task description",
  "idempotent": true,
  "playbook_id": "optional-playbook-id",
  "structured_output_schema": {}
}
```

Response:
```json
{
  "session_id": "ses_...",
  "status": "queued",
  "url": "https://app.devin.ai/sessions/ses_...",
  "is_new_session": true
}
```

Notes:
- Use `idempotent: true` to prevent duplicate sessions on retry
- `is_new_session` distinguishes new vs existing sessions

### Get Session

```
GET /v1/sessions/{session_id}
```

Response:
```json
{
  "session_id": "ses_...",
  "status": "running",
  "url": "https://app.devin.ai/sessions/ses_...",
  "pull_request_url": "https://github.com/...",
  "structured_output": {},
  "status_info": "Working on task..."
}
```

### List Sessions

```
GET /v1/sessions?limit=10&offset=0
```

Response: Array of session objects.

### Cancel Session

```
POST /v1/sessions/{session_id}/cancel
```

**Note:** Verify this endpoint during implementation. API may use `DELETE /v1/sessions/{session_id}` instead.

### Send Message

```
POST /v1/sessions/{session_id}/messages
```

Request body:
```json
{
  "message": "Follow-up text here"
}
```

### Inject Secrets

```
POST /v1/sessions/{session_id}/secrets
```

Request body:
```json
{
  "secrets": {
    "KEY": "value"
  }
}
```

**Security:** Never echo secrets. Construct via jq. Validate format. See SKILL.md for details.

## Playbooks (v2)

### List Playbooks

```
GET /v1/playbooks
```

### Create Playbook

```
POST /v1/playbooks
```

**Note:** Playbook endpoints are unverified. Deferred to v2.

## Knowledge (v2)

### List Knowledge

```
GET /v1/knowledge
```

**Note:** Knowledge base sync is deferred to v2.
