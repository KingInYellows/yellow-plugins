# Changelog Fallback Statuses

**Task:** I3.T2 - Changelog-aware update pipeline
**Specification:** CRIT-008 - Changelog display with timeout fallback
**Generated:** 2026-01-12

---

## Overview

This document summarizes the changelog fetch statuses and fallback behaviors implemented per CRIT-008 requirements. The update pipeline gracefully degrades when changelog fetching fails, ensuring updates can proceed even with network issues.

## Fallback Status Catalog

### 1. SUCCESS

**Trigger:** Changelog successfully fetched from URL within timeout (default 5 seconds)

**HTTP Status:** 200 OK

**Display Message:** Changelog content (truncated to 1000 characters)

**Behavior:**
- Content cached for 24 hours
- Subsequent fetches return `CACHED` status
- Full content stored in cache, display truncated

**Telemetry:**
- `changelogsFetched`: incremented
- `durationMs`: recorded

**Example:**
```json
{
  "status": "success",
  "content": "Version 1.3.0\n\n- Added feature X\n- Fixed bug Y",
  "displayMessage": "Version 1.3.0\n\n- Added feature X\n- Fixed bug Y",
  "metadata": {
    "url": "https://example.com/changelog.md",
    "httpStatus": 200,
    "durationMs": 142
  }
}
```

---

### 2. CACHED

**Trigger:** Changelog retrieved from cache (previous successful fetch within 24 hours)

**HTTP Status:** N/A (cache hit)

**Display Message:** Cached changelog content (truncated to 1000 characters)

**Behavior:**
- No HTTP request made
- Faster response time
- Cache entry remains valid

**Telemetry:**
- `changelogCacheHits`: incremented
- `durationMs`: minimal (< 10ms typically)

**Example:**
```json
{
  "status": "cached",
  "content": "Version 1.3.0\n\n- Added feature X\n- Fixed bug Y",
  "displayMessage": "Version 1.3.0\n\n- Added feature X\n- Fixed bug Y",
  "metadata": {
    "url": "https://example.com/changelog.md",
    "timestamp": "2026-01-12T10:30:00Z"
  }
}
```

---

### 3. NOT_PROVIDED

**Trigger:** Plugin author did not specify `docs.changelog` URL in plugin.json

**HTTP Status:** N/A (no URL to fetch)

**Display Message:** `"Changelog not provided by plugin author"`

**Behavior:**
- No HTTP request attempted
- Update proceeds normally
- User informed that changelog is unavailable

**Telemetry:**
- Not counted in `changelogsFetched`

**Example:**
```json
{
  "status": "not-provided",
  "displayMessage": "Changelog not provided by plugin author",
  "metadata": {
    "timestamp": "2026-01-12T10:30:00Z"
  }
}
```

---

### 4. TIMEOUT

**Trigger:** HTTP request exceeded timeout limit (default 5 seconds)

**HTTP Status:** N/A (connection timed out)

**Display Message:** `"Changelog unavailable (network error)"`

**Behavior:**
- Request aborted after timeout
- Failure recorded in cache (consecutive failures tracked)
- Update proceeds normally
- User can bypass cache on next attempt

**Telemetry:**
- `changelogsFetched`: incremented
- `durationMs`: >= timeout threshold (e.g., 5000ms)

**Example:**
```json
{
  "status": "timeout",
  "displayMessage": "Changelog unavailable (network error)",
  "metadata": {
    "url": "https://example.com/changelog.md",
    "durationMs": 5003,
    "timestamp": "2026-01-12T10:30:00Z"
  }
}
```

---

### 5. NOT_FOUND

**Trigger:** HTTP 404 - Changelog URL returned "Not Found"

**HTTP Status:** 404

**Display Message:** `"Changelog unavailable (not found)"`

**Behavior:**
- Fetch failed with HTTP 404
- Failure recorded in cache
- Update proceeds normally
- Suggests URL may be incorrect or removed

**Telemetry:**
- `changelogsFetched`: incremented
- `durationMs`: recorded

**Example:**
```json
{
  "status": "not-found",
  "displayMessage": "Changelog unavailable (not found)",
  "metadata": {
    "url": "https://example.com/changelog.md",
    "httpStatus": 404,
    "durationMs": 285,
    "timestamp": "2026-01-12T10:30:00Z"
  }
}
```

---

### 6. SERVER_ERROR

**Trigger:** HTTP 403, 500, 503, or 5xx error from changelog URL

**HTTP Status:** 403, 500, 503, etc.

**Display Message:** `"Changelog unavailable (server error)"`

**Behavior:**
- Server rejected request or encountered internal error
- Failure recorded in cache
- Update proceeds normally
- Temporary server issues may resolve on retry

**Telemetry:**
- `changelogsFetched`: incremented
- `durationMs`: recorded
- `httpStatus`: recorded (403, 500, etc.)

**Example (403 Forbidden):**
```json
{
  "status": "server-error",
  "displayMessage": "Changelog unavailable (server error)",
  "metadata": {
    "url": "https://example.com/changelog.md",
    "httpStatus": 403,
    "durationMs": 198,
    "timestamp": "2026-01-12T10:30:00Z"
  }
}
```

**Example (500 Internal Server Error):**
```json
{
  "status": "server-error",
  "displayMessage": "Changelog unavailable (server error)",
  "metadata": {
    "url": "https://example.com/changelog.md",
    "httpStatus": 500,
    "durationMs": 421,
    "timestamp": "2026-01-12T10:30:00Z"
  }
}
```

---

### 7. NETWORK_ERROR

**Trigger:** DNS failure, connection refused, or other network-level error

**HTTP Status:** N/A (network unreachable)

**Display Message:** `"Changelog unavailable (network error)"`

**Behavior:**
- Network connectivity issue prevented request
- Could be DNS failure, offline mode, firewall block
- Failure recorded in cache
- Update proceeds normally

**Telemetry:**
- `changelogsFetched`: incremented
- `durationMs`: recorded (variable based on failure type)

**Example (DNS failure):**
```json
{
  "status": "network-error",
  "displayMessage": "Changelog unavailable (network error)",
  "metadata": {
    "url": "https://nonexistent.example.com/changelog.md",
    "durationMs": 2341,
    "timestamp": "2026-01-12T10:30:00Z"
  }
}
```

---

## CRIT-008 Compliance Matrix

| Scenario | Status | Display Message | Update Blocked? | Spec Reference |
|----------|--------|-----------------|-----------------|----------------|
| No URL in plugin.json | `NOT_PROVIDED` | "Changelog not provided by plugin author" | No | CRIT-008.2 |
| HTTP 200 < 5s | `SUCCESS` | Changelog content (1000 chars) | No | CRIT-008.1 |
| HTTP 200 cached | `CACHED` | Cached content (1000 chars) | No | CRIT-008 cache behavior |
| Timeout >= 5s | `TIMEOUT` | "Changelog unavailable (network error)" | No | CRIT-008.3a |
| HTTP 404 | `NOT_FOUND` | "Changelog unavailable (not found)" | No | CRIT-008.3b |
| HTTP 403 | `SERVER_ERROR` | "Changelog unavailable (server error)" | No | CRIT-008.3c |
| HTTP 500/5xx | `SERVER_ERROR` | "Changelog unavailable (server error)" | No | CRIT-008.3c |
| DNS/network fail | `NETWORK_ERROR` | "Changelog unavailable (network error)" | No | CRIT-008.3d |

**Key Principle:** In ALL cases, the update continues. Changelog fetch failures NEVER block plugin updates per CRIT-008.

---

## Cache Behavior

### Cache Entry Structure

```typescript
{
  pluginId: "example-plugin",
  version: "1.3.0",
  url: "https://example.com/changelog.md",
  status: "success" | "not-found" | "timeout" | "server-error" | "network-error",
  content?: "...", // Only for successful fetches
  fullContentLength?: 1542,
  lastFetchedAt: "2026-01-12T10:30:00Z",
  consecutiveFailures: 0,
  lastHttpStatus?: 200
}
```

### Cache Retention Rules

1. **Successful fetches:** Cached for 24 hours
2. **Failed fetches:** Recorded but do not prevent retries
3. **Cache size limit:** Maximum 100 entries
4. **Age limit:** Entries older than 30 days are pruned
5. **Bypass cache:** Use `--bypass-cache` flag to force fresh fetch

### Cache Invalidation

Users can manually invalidate cache entries:

```bash
# Via update service API
changelogService.invalidateCache('example-plugin', '1.3.0')
```

---

## CLI Integration

### check-updates Command

Displays changelog status in output:

```bash
$ plugin check-updates example-plugin

Available updates:
- example-plugin: 1.2.3 → 1.3.0
  Changelog: Version 1.3.0 - Added feature X, Fixed bug Y... (998 more chars)

$ plugin check-updates failing-plugin

Available updates:
- failing-plugin: 1.0.0 → 1.1.0
  Changelog unavailable (network error)
  URL: https://unreachable.example.com/changelog.md
```

### update Command

Shows changelog before confirmation:

```bash
$ plugin update example-plugin

Updating example-plugin: 1.2.3 → 1.3.0

Changelog:
Version 1.3.0

- Added feature X
- Fixed bug Y
- Performance improvements

Continue with update? (y/n)
```

### JSON Output

All changelog statuses available in JSON contract:

```json
{
  "data": {
    "availableUpdates": [
      {
        "pluginId": "example-plugin",
        "currentVersion": "1.2.3",
        "latestVersion": "1.3.0",
        "changelogUrl": "https://example.com/changelog.md",
        "changelogStatus": "success",
        "changelogMessage": "Version 1.3.0...",
        "changelogFetchDurationMs": 142
      }
    ]
  },
  "telemetry": {
    "changelogsFetched": 3,
    "changelogCacheHits": 1
  }
}
```

---

## Testing Scenarios

### Simulated Failures (Test Suite)

The test suite verifies all fallback scenarios:

1. **Timeout simulation:** Mock 5+ second delay
2. **HTTP 404:** Mock server returns 404
3. **HTTP 500:** Mock server returns 500
4. **Network error:** Mock DNS/connection failure
5. **Cache hit:** Verify cached content reused
6. **Cache bypass:** Verify fresh fetch with `bypassCache: true`

### Manual Testing

```bash
# Test timeout (requires slow endpoint)
plugin check-updates --fetch-changelogs slow-plugin

# Test 404 (invalid URL)
plugin update broken-url-plugin

# Test server error (maintenance mode)
plugin update unavailable-server-plugin

# Test cache behavior (repeat command within 24h)
plugin check-updates cached-plugin
plugin check-updates cached-plugin  # Should be instant
```

---

## Error Code Mapping

| Error Code | Status | Description |
|------------|--------|-------------|
| N/A | `SUCCESS` | No error |
| N/A | `CACHED` | No error (cache hit) |
| N/A | `NOT_PROVIDED` | No error (expected) |
| N/A | `TIMEOUT` | Graceful degradation |
| N/A | `NOT_FOUND` | Graceful degradation |
| N/A | `SERVER_ERROR` | Graceful degradation |
| N/A | `NETWORK_ERROR` | Graceful degradation |

**Note:** Changelog failures do NOT generate error codes. They are logged warnings that do not affect update success.

---

## Logging and Telemetry

### Structured Log Format

```json
{
  "level": "info",
  "transactionId": "tx-1736611200000-a1b2c3d4",
  "correlationId": "corr-xyz123",
  "phase": "UPDATE",
  "pluginId": "example-plugin",
  "version": "1.3.0",
  "changelogFetch": {
    "status": "timeout",
    "url": "https://example.com/changelog.md",
    "durationMs": 5003,
    "message": "Changelog unavailable (network error)"
  }
}
```

### Prometheus Metrics

```
# Changelog fetch success rate
changelog_fetch_total{status="success"} 42
changelog_fetch_total{status="timeout"} 3
changelog_fetch_total{status="not-found"} 1

# Changelog cache performance
changelog_cache_hits_total 18
changelog_cache_misses_total 5

# Fetch duration histogram
changelog_fetch_duration_ms_bucket{le="100"} 30
changelog_fetch_duration_ms_bucket{le="1000"} 40
changelog_fetch_duration_ms_bucket{le="5000"} 45
```

---

## References

- **Specification:** `docs/SPECIFICATION-PART1-v1.1.md` (CRIT-008)
- **Update Journey:** Section 3.4 - Update flow with changelog display
- **CLI Contract:** `api/cli-contracts/update.json` (v1.1.0)
- **Implementation:** `packages/domain/src/changelog/changelogService.ts`
- **Tests:** `packages/domain/src/changelog/__tests__/changelogService.test.ts`
