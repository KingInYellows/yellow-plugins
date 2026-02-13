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

If `$ARGUMENTS` is provided, use it as a route filter — only test routes matching the filter pattern. Validate: must start with `/`, only `[a-zA-Z0-9/_\-]` characters.

### Step 3: Manage Dev Server

Check if the server is already running:

```bash
curl -s -o /dev/null -w "%{http_code}" "$BASE_URL" 2>/dev/null
```

**If running (HTTP 200-399):** Use existing server. Do NOT stop it when tests finish.

**If not running:** Start it:

```bash
$DEV_SERVER_CMD > .claude/browser-test-server.log 2>&1 &
echo $! > .claude/browser-test-server.pid
```

Poll for readiness every 2 seconds up to `readyTimeout`:

```bash
curl -s -o /dev/null "$BASE_URL$READY_PATH"
```

If timeout: show last 20 lines of `.claude/browser-test-server.log` and report error.

### Step 4: Prepare Output Directories

```bash
mkdir -p test-reports/screenshots
```

### Step 5: Run Tests

Spawn the `test-runner` agent in structured mode:

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
kill "$(cat .claude/browser-test-server.pid)" 2>/dev/null || true
rm -f .claude/browser-test-server.pid
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
