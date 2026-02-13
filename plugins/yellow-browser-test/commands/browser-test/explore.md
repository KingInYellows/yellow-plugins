---
name: browser-test:explore
description: >
  Run autonomous exploratory browser testing. Use when user says "explore the
  app", "find bugs", "test everything", "autonomous testing", or wants the
  agent to freely navigate and discover issues without predefined test flows.
argument-hint: "[starting-route]"
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

Let the agent freely explore the app, click interactive elements, try edge cases, and discover bugs.

## Workflow

### Step 1: Check Prerequisites

Same as `/browser-test:test` — verify agent-browser installed and config exists.

If not found: "Run `/browser-test:setup` first."

### Step 2: Read Config and Manage Dev Server

Read `.claude/yellow-browser-test.local.md`. Start dev server if not already running (same logic as `/browser-test:test`).

### Step 3: Determine Starting Point

If `$ARGUMENTS` provides a starting route:
- Validate: must start with `/`, only `[a-zA-Z0-9/_\-]` characters
- Use as the exploration starting point

If no argument: start from the first authenticated route in config (usually `/dashboard` or `/`).

### Step 4: Prepare Output

```bash
mkdir -p test-reports/screenshots
```

### Step 5: Run Exploration

Spawn the `test-runner` agent in exploratory mode:

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

If this command started the dev server, stop it via PID file. Display inline summary.

## Error Handling

| Error | Action |
|-------|--------|
| agent-browser not found | "Run `/browser-test:setup` to install agent-browser" |
| Config not found | "Run `/browser-test:setup` to discover app configuration" |
| Dev server not reachable | "Server not responding at {baseURL}. Start it manually or check config" |
| Auth fails (CAPTCHA) | "CAPTCHA detected. Disable bot protection in test environment" |
| Starting route not found | "Route {route} returned 404. Check the URL or run `/browser-test:setup` to rediscover" |
| Exploration timeout | Report partial results — findings up to timeout are still valuable |
