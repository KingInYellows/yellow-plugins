---
name: browser-test:explore
description: "Run autonomous exploratory browser testing. Use when user says \"explore the app\", \"find bugs\", \"test everything\", \"autonomous testing\", or wants the agent to freely navigate and discover issues without predefined test flows."
argument-hint: '[starting-route]'
allowed-tools:
  - Bash
  - Read
  - Write
  - AskUserQuestion
  - Task
  - Glob
  - Grep
---

# Autonomous Exploratory Testing

Let the agent freely explore the app, click interactive elements, try edge
cases, and discover bugs.

## Workflow

### Step 1: Check Prerequisites

Same as `/browser-test:test` — verify agent-browser installed and config exists.

If not found: "Run `/browser-test:setup` first."

### Step 2: Read Config and Manage Dev Server

Read `.claude/yellow-browser-test.local.md`.

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

Start dev server if not already running (same logic as `/browser-test:test`).

### Step 3: Determine Starting Point

If `$ARGUMENTS` provides a starting route, validate it:

```bash
if [ -n "$ARGUMENTS" ]; then
  if ! printf '%s' "$ARGUMENTS" | grep -qE '^/[a-zA-Z0-9/_-]*$'; then
    printf '[browser-test] Error: Invalid route filter format.\n' >&2
    printf '[browser-test] Use: /path/to/route (alphanumeric, /, -, _ only)\n' >&2
    exit 1
  fi
fi
```

Use validated argument as the exploration starting point.

If no argument: start from the first authenticated route in config (usually
`/dashboard` or `/`).

### Step 4: Prepare Output

```bash
mkdir -p test-reports/screenshots

# Cleanup old screenshots (older than 7 days)
find test-reports/screenshots -name '*.png' -mtime +7 -delete 2>/dev/null || true
```

### Step 5: Run Exploration

Ask user for confirmation before spawning test-runner:

```
AskUserQuestion: "About to explore app starting from {starting_route} at {baseURL}. Proceed?"
```

If user confirms, spawn the `test-runner` agent in exploratory mode:

```
Task(test-runner): "Run exploratory browser tests. Config at .claude/yellow-browser-test.local.md. Write results to test-reports/results.json. Test mode: exploratory. Starting route: {route}."
```

The agent will:

- Authenticate if needed
- Navigate to the starting page
- Click every interactive element (breadth-first, max 3 levels)
- Skip destructive actions (delete, remove, destroy, etc.)
- Try edge cases on forms
- Capture console errors and screenshots
- Stop after 10 minutes or when all reachable elements are explored

### Step 6: Generate Report

Spawn the `test-reporter` agent:

```
Task(test-reporter): "Generate report from test-reports/results.json. Write report and offer GitHub issue creation."
```

### Step 7: Cleanup

If this command started the dev server, stop it via PID file:

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

Display inline summary.

## Error Handling

| Error                    | Action                                                                                 |
| ------------------------ | -------------------------------------------------------------------------------------- |
| agent-browser not found  | "Run `/browser-test:setup` to install agent-browser"                                   |
| Config not found         | "Run `/browser-test:setup` to discover app configuration"                              |
| Dev server not reachable | "Server not responding at {baseURL}. Start it manually or check config"                |
| Auth fails (CAPTCHA)     | "CAPTCHA detected. Disable bot protection in test environment"                         |
| Starting route not found | "Route {route} returned 404. Check the URL or run `/browser-test:setup` to rediscover" |
| Exploration timeout      | Report partial results — findings up to timeout are still valuable                     |
