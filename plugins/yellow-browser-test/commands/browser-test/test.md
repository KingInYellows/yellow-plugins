---
name: browser-test:test
description: >
  Run structured browser test suite. Use when user says "test the app",
  "run browser tests", "check if the UI works", "verify routes", or
  wants to run the full structured test suite against discovered routes.
argument-hint: "[route-filter]"
allowed-tools:
  - Bash
  - Read
  - Write
  - AskUserQuestion
  - Task
  - Glob
  - Grep
---

# Run Browser Test Suite

Start the dev server (if needed), run structured tests against all discovered routes, and generate a report.

## Workflow

### Step 1: Check Prerequisites

Verify agent-browser is installed:

```bash
command -v agent-browser >/dev/null 2>&1
```

If not found: "agent-browser not installed. Run `/browser-test:setup` first."

### Step 2: Read Config

Read `.claude/yellow-browser-test.local.md` for dev server command, base URL, auth settings, and routes.

If not found: "No config found. Run `/browser-test:setup` to discover app configuration."

Validate config after reading:

```bash
if [ ! -f .claude/yellow-browser-test.local.md ]; then
  printf '[browser-test] Error: Config not found.\n' >&2
  printf '[browser-test] Run /browser-test:setup to discover app configuration.\n' >&2
  exit 1
fi

# Check YAML is parseable and required fields exist
if ! grep -q 'devServer:' .claude/yellow-browser-test.local.md || \
   ! grep -q 'baseURL:' .claude/yellow-browser-test.local.md || \
   ! grep -q 'command:' .claude/yellow-browser-test.local.md; then
  printf '[browser-test] Error: Config malformed.\n' >&2
  printf '[browser-test] Re-run /browser-test:setup to regenerate.\n' >&2
  exit 1
fi
```

If `$ARGUMENTS` is provided, use it as a route filter — only test routes matching the filter pattern. Validate route filter:

```bash
if [ -n "$ARGUMENTS" ]; then
  if ! printf '%s' "$ARGUMENTS" | grep -qE '^/[a-zA-Z0-9/_-]*$'; then
    printf '[browser-test] Error: Invalid route filter format.\n' >&2
    printf '[browser-test] Use: /path/to/route (alphanumeric, /, -, _ only)\n' >&2
    exit 1
  fi
fi
```

### Step 3: Manage Dev Server

Check if the server is already running:

```bash
CURL_ERROR=$(mktemp)
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL" 2>"$CURL_ERROR")
CURL_EXIT=$?
rm -f "$CURL_ERROR"
```

**If running (HTTP 200-399):** Use existing server. Do NOT stop it when tests finish.

**If not running:** Start it:

```bash
$DEV_SERVER_CMD > .claude/browser-test-server.log 2>&1 &
echo $! > .claude/browser-test-server.pid
```

Poll for readiness every 2 seconds up to `readyTimeout`:

```bash
MAX_ATTEMPTS=$((READY_TIMEOUT / 2))
ATTEMPT=0
LAST_CURL_ERROR=""

while [ "$ATTEMPT" -lt "$MAX_ATTEMPTS" ]; do
  ATTEMPT=$((ATTEMPT + 1))
  printf '[browser-test] Waiting for dev server (%d/%d)...\n' "$ATTEMPT" "$MAX_ATTEMPTS" >&2
  
  CURL_ERROR=$(mktemp)
  if curl -s -o /dev/null "$BASE_URL$READY_PATH" 2>"$CURL_ERROR"; then
    rm -f "$CURL_ERROR"
    break
  fi
  LAST_CURL_ERROR=$(cat "$CURL_ERROR")
  rm -f "$CURL_ERROR"
  
  if [ "$ATTEMPT" -lt "$MAX_ATTEMPTS" ]; then
    sleep 2
  fi
done

if [ "$ATTEMPT" -ge "$MAX_ATTEMPTS" ]; then
  printf '[browser-test] Error: Server timeout after %d seconds.\n' "$READY_TIMEOUT" >&2
  if [ -n "$LAST_CURL_ERROR" ]; then
    printf '[browser-test] Last curl error: %s\n' "$LAST_CURL_ERROR" >&2
  fi
  tail -20 .claude/browser-test-server.log >&2
  exit 1
fi
```

If timeout: show last 20 lines of `.claude/browser-test-server.log` and report error.

### Step 4: Prepare Output Directories

```bash
mkdir -p test-reports/screenshots

# Cleanup old screenshots (older than 7 days)
find test-reports/screenshots -name '*.png' -mtime +7 -delete 2>/dev/null || true
```

### Step 5: Run Tests

Ask user for confirmation before spawning test-runner:

```
AskUserQuestion: "About to test {N} routes at {baseURL}. Proceed?"
```

If user confirms, spawn the `test-runner` agent in structured mode:

```
Task(test-runner): "Run structured browser tests. Config at .claude/yellow-browser-test.local.md. Write results to test-reports/results.json. Test mode: structured."
```

### Step 6: Generate Report

After tests complete, spawn the `test-reporter` agent:

```
Task(test-reporter): "Generate report from test-reports/results.json. Write report and offer GitHub issue creation."
```

### Step 7: Cleanup

If this command started the dev server (PID file exists at `.claude/browser-test-server.pid`):

```bash
if [ -f .claude/browser-test-server.pid ]; then
  PID=$(cat .claude/browser-test-server.pid)
  if printf '%s' "$PID" | grep -qE '^[0-9]+$' && kill -0 "$PID" 2>/dev/null; then
    # Verify this PID is actually a node/npm process before killing
    PROC_CMD=$(ps -p "$PID" -o comm= 2>/dev/null || true)
    case "$PROC_CMD" in
      node|npm|npx|sh|bash)
        # Kill child processes first (e.g., node spawned by npm run dev)
        pkill -P "$PID" 2>/dev/null || true
        kill "$PID" || printf '[browser-test] Warning: Failed to stop server\n' >&2
        ;;
      *)
        printf '[browser-test] Warning: PID %s is not a dev server process (%s), skipping kill\n' "$PID" "$PROC_CMD" >&2
        ;;
    esac
  fi
  rm -f .claude/browser-test-server.pid
fi
```

Display inline summary of test results.

## Error Handling

| Error | Action |
|-------|--------|
| agent-browser not found | "Run `/browser-test:setup` to install agent-browser" |
| Config not found | "Run `/browser-test:setup` to discover app configuration" |
| Dev server start fails | Show last 20 lines of `.claude/browser-test-server.log` |
| Dev server timeout | "Server didn't respond within {timeout}s. Check: `{command}`" |
| Port in use (server down) | "Port {port} occupied. Stop the process or change port in config" |
| Auth env vars missing | "Set {VAR_NAME} in your environment or .env.local" |
| All tests fail | "All routes failed. Is the base URL correct? Try: `curl {baseURL}`" |
| Route filter matches nothing | "No routes match filter '{filter}'. Available: {route list}" |
