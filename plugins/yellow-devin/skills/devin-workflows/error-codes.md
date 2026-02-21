# Error Handling Patterns

Every command must implement all three error handling layers.

## Layer 1: curl Exit Code

Check immediately after every curl call:

```bash
response=$(curl -s --connect-timeout 5 --max-time 60 -w "\n%{http_code}" ...)
curl_exit=$?
if [ "$curl_exit" -ne 0 ]; then
  printf 'ERROR: Network failure connecting to Devin API\n' >&2
  printf 'curl exit code: %d\n' "$curl_exit" >&2
  case "$curl_exit" in
    6)  printf 'Could not resolve api.devin.ai — check DNS/internet\n' >&2 ;;
    7)  printf 'Could not connect — Devin API may be down\n' >&2 ;;
    28) printf 'Request timed out — try again or check network\n' >&2 ;;
    *)  printf 'Unexpected network error\n' >&2 ;;
  esac
  if [ "$curl_exit" -eq 6 ] || [ "$curl_exit" -eq 7 ] || [ "$curl_exit" -eq 28 ]; then
    for retry in 1 2 3; do
      delay=$((retry * 5))
      printf 'Retrying in %ds (attempt %d/3)...\n' "$delay" "$retry" >&2
      sleep "$delay"
      response=$(curl -s --connect-timeout 5 --max-time 60 -w "\n%{http_code}" ...)
      curl_exit=$?
      [ "$curl_exit" -eq 0 ] && break
    done
    if [ "$curl_exit" -ne 0 ]; then
      printf 'ERROR: Network failure persisted after 3 retries\n' >&2
      exit 1
    fi
  else
    exit 1
  fi
fi
```

## Layer 2: HTTP Status Code

Extract and check after successful curl:

```bash
http_code=${response##*$'\n'}
body=${response%$'\n'*}

case "$http_code" in
  2[0-9][0-9]) ;; # Success — continue
  401)
    printf 'ERROR: Authentication failed (401)\n' >&2
    printf 'Your DEVIN_SERVICE_USER_TOKEN was rejected.\n' >&2
    printf 'Create a new service user: Enterprise Settings > Service Users\n' >&2
    printf 'Docs: https://docs.devin.ai/api-reference/v3/overview\n' >&2
    exit 1 ;;
  403)
    printf 'ERROR: Permission denied (403)\n' >&2
    printf 'Your service user may lack required permissions.\n' >&2
    printf 'Required: ManageOrgSessions + ManageAccountSessions\n' >&2
    exit 1 ;;
  404)
    printf 'ERROR: Not found (404)\n' >&2
    printf 'Session or resource does not exist.\n' >&2
    exit 1 ;;
  422)
    printf 'ERROR: Request validation failed (422)\n' >&2
    detail=$(printf '%s' "$body" | jq -r '.detail[]? | "\(.loc | join(".")): \(.msg)"' 2>/dev/null)
    if [ -n "$detail" ]; then
      printf 'Details:\n%s\n' "$detail" | sed 's/cog_[a-zA-Z0-9_-]*/***REDACTED***/g' >&2
    else
      printf 'Response: %.200s\n' "$body" | sed 's/cog_[a-zA-Z0-9_-]*/***REDACTED***/g' >&2
    fi
    exit 1 ;;
  429)
    retry_after=$(printf '%s' "$body" | jq -r '.retry_after // 60' 2>/dev/null || printf '60')
    retry_after="${retry_after:-60}"
    if [ "$retry_after" -gt 300 ] 2>/dev/null; then
      printf 'ERROR: Rate limited — API asks for %ss wait (too long)\n' "$retry_after" >&2
      exit 1
    fi
    printf 'Rate limited. Waiting %ss...\n' "$retry_after" >&2
    sleep "$retry_after"
    printf 'ERROR: Rate limited — retry the command or use api_call_with_backoff() for automatic retries\n' >&2
    exit 1 ;;
  5[0-9][0-9])
    printf 'ERROR: Devin API server error (%s)\n' "$http_code" >&2
    printf 'Try again in a few minutes.\n' >&2
    exit 1 ;;
  *)
    printf 'ERROR: Unexpected HTTP status %s\n' "$http_code" >&2
    printf 'Response: %.200s\n' "$body" | sed 's/cog_[a-zA-Z0-9_-]*/***REDACTED***/g' >&2
    exit 1 ;;
esac
```

## Layer 3: jq Parse Errors

Check jq exit code when extracting fields:

```bash
session_id=$(printf '%s' "$body" | jq -r '.session_id // empty' 2>/dev/null)
jq_exit=$?
if [ $jq_exit -ne 0 ]; then
  printf 'ERROR: Failed to parse API response\n' >&2
  printf 'Response preview: %.200s\n' "$body" | sed 's/cog_[a-zA-Z0-9_-]*/***REDACTED***/g' >&2
  printf 'This may indicate a V3 API change or proxy interference.\n' >&2
  exit 1
fi
if [ -z "$session_id" ]; then
  printf 'ERROR: Response missing expected field '\''session_id'\''\n' >&2
  { printf '%s' "$body" | jq . 2>/dev/null || printf '%s\n' "$body"; } | sed 's/cog_[a-zA-Z0-9_-]*/***REDACTED***/g' >&2
  exit 1
fi
```

## Exponential Backoff on 429

For operations that may hit rate limits repeatedly:

```bash
api_call_with_backoff() {
  local max_retries=5
  local backoff=1
  local retry=1

  while [ $retry -le $max_retries ]; do
    # ... make curl call ...

    if [ "$http_code" = "429" ]; then
      local wait_time
      wait_time=$(printf '%s' "$body" | jq -r '.retry_after // 0' 2>/dev/null || printf '0')
      wait_time="${wait_time:-0}"
      if [ "$wait_time" -eq 0 ] 2>/dev/null; then
        wait_time=$backoff
      fi
      if [ "$wait_time" -gt 300 ] 2>/dev/null; then
        printf 'ERROR: Rate limited — wait too long (%ss)\n' "$wait_time" >&2
        exit 1
      fi
      printf 'Rate limited. Waiting %ss (attempt %d/%d)...\n' "$wait_time" "$retry" "$max_retries" >&2
      sleep "$wait_time"
      backoff=$((backoff * 2))
      retry=$((retry + 1))
    else
      break
    fi
  done

  if [ $retry -gt $max_retries ]; then
    printf 'ERROR: Rate limited after %d retries. Try again later.\n' "$max_retries" >&2
    exit 1
  fi
}
```

## Error Sanitization

All error output must sanitize tokens before display:

```bash
sanitize_output() {
  sed 's/cog_[a-zA-Z0-9_-]*/***REDACTED***/g'
}

# Usage in error reporting:
printf '%s' "$body" | sanitize_output >&2
```

## Error Summary Table

| Error | Code | Action |
|---------------------|-------------|-------------------------------------------|
| Token not set | — | Show setup instructions with service user URL |
| V1 token detected | — | Show migration message (`apk_` → `cog_`) |
| Token invalid format | — | Show expected format (cog_...) |
| Network failure | curl 6/7/28 | Retry 3 times with backoff, then fail |
| Auth rejected | HTTP 401 | Suggest creating new service user |
| Permission denied | HTTP 403 | Show required permissions |
| Not found | HTTP 404 | Session or resource doesn't exist |
| Validation error | HTTP 422 | Show field-level validation details |
| Rate limited | HTTP 429 | Exponential backoff (max 5 retries, 300s cap) |
| Server error | HTTP 5xx | Suggest trying again later |
| Parse failure | jq non-zero | Show sanitized response preview |
| Missing field | empty value | Show sanitized response, suggest V3 API change |
