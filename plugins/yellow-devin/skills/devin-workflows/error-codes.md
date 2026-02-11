# Error Handling Patterns

Every command must implement all three error handling layers.

## Layer 1: curl Exit Code

Check immediately after every curl call:

```bash
response=$(curl -s --connect-timeout 5 --max-time 60 -w "\n%{http_code}" ...)
curl_exit=$?
if [ "$curl_exit" -ne 0 ]; then
  printf 'ERROR: Network failure connecting to Devin API\n'
  printf 'curl exit code: %d\n' "$curl_exit"
  case "$curl_exit" in
    6)  printf 'Could not resolve api.devin.ai — check DNS/internet\n' ;;
    7)  printf 'Could not connect — Devin API may be down\n' ;;
    28) printf 'Request timed out — try again or check network\n' ;;
    *)  printf 'Unexpected network error\n' ;;
  esac
  # Retry transient failures (exit 6, 7, 28)
  if [ "$curl_exit" -eq 6 ] || [ "$curl_exit" -eq 7 ] || [ "$curl_exit" -eq 28 ]; then
    for retry in 1 2 3; do
      delay=$((retry * 5))
      printf 'Retrying in %ds (attempt %d/3)...\n' "$delay" "$retry"
      sleep "$delay"
      response=$(curl -s --connect-timeout 5 --max-time 60 -w "\n%{http_code}" ...)
      curl_exit=$?
      [ "$curl_exit" -eq 0 ] && break
    done
    if [ "$curl_exit" -ne 0 ]; then
      printf 'ERROR: Network failure persisted after 3 retries\n'
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
http_code=$(printf '%s' "$response" | tail -n1)
body=$(printf '%s' "$response" | sed '$d')

case "$http_code" in
  2[0-9][0-9]) ;; # Success — continue
  401)
    printf 'ERROR: Authentication failed (401)\n'
    printf 'Your DEVIN_API_TOKEN was rejected.\n'
    printf 'Generate a new token: https://devin.ai/settings/api\n'
    exit 1 ;;
  403)
    printf 'ERROR: Permission denied (403)\n'
    printf 'Your token may lack required scopes.\n'
    exit 1 ;;
  404)
    printf 'ERROR: Not found (404)\n'
    printf 'Session or resource does not exist.\n'
    exit 1 ;;
  429)
    # Note: Extracts retry_after from JSON body (not HTTP Retry-After header) since
    # our curl pattern only captures status code. Falls back to 60s if field absent.
    retry_after=$(printf '%s' "$body" | jq -r '.retry_after // 60' 2>/dev/null || printf '60')
    if [ "$retry_after" -gt 300 ] 2>/dev/null; then
      printf 'ERROR: Rate limited — API asks for %ss wait (too long)\n' "$retry_after"
      exit 1
    fi
    printf 'Rate limited. Waiting %ss...\n' "$retry_after"
    sleep "$retry_after"
    # Retry the Devin API request once after the wait, then re-run this status check.
    ;;
  5[0-9][0-9])
    printf 'ERROR: Devin API server error (%s)\n' "$http_code"
    printf 'Try again in a few minutes.\n'
    exit 1 ;;
  *)
    printf 'ERROR: Unexpected HTTP status %s\n' "$http_code"
    printf 'Response: %.200s\n' "$body"
    exit 1 ;;
esac
```

## Layer 3: jq Parse Errors

Check jq exit code when extracting fields:

```bash
session_id=$(printf '%s' "$body" | jq -r '.session_id // empty' 2>/dev/null)
jq_exit=$?
if [ $jq_exit -ne 0 ]; then
  printf 'ERROR: Failed to parse API response\n'
  printf 'Response preview: %.200s\n' "$body"
  printf 'This may indicate an API change or proxy interference.\n'
  exit 1
fi
if [ -z "$session_id" ]; then
  printf 'ERROR: Response missing expected field '\''session_id'\''\n'
  printf '%s' "$body" | jq . 2>/dev/null || printf '%s\n' "$body"
  exit 1
fi
```

## Error Summary Table

| Error | Code | Action |
|-------|------|--------|
| Token not set | — | Show setup instructions with URL |
| Token invalid format | — | Show expected format |
| Network failure | curl 6/7/28 | Retry 3 times with backoff, then fail |
| Auth rejected | HTTP 401 | Suggest regenerating token |
| Permission denied | HTTP 403 | Suggest checking token scopes |
| Not found | HTTP 404 | Session or resource doesn't exist |
| Rate limited | HTTP 429 | Wait Retry-After (max 300s), retry once |
| Server error | HTTP 5xx | Suggest trying again later |
| Parse failure | jq non-zero | Show response preview, suggest API change |
| Missing field | empty value | Show full response, suggest checking docs |
