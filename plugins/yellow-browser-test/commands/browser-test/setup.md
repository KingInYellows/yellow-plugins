---
name: browser-test:setup
description: "Install agent-browser and discover app configuration. Use when user says 'set up browser testing', 'install agent-browser', or wants to initialize browser testing for a web project."
argument-hint: ''
allowed-tools:
  - Bash
  - Read
  - Write
  - AskUserQuestion
  - Task
  - Glob
  - Grep
---

# Set Up Browser Testing

Install agent-browser and auto-discover the app's dev server, routes, and auth
flow.

## Workflow

### Step 1: Check Prerequisites

Verify required tools:

```bash
node --version  # Must be >= 22.22.0
npm --version
```

If missing, report: "Node.js required. Install from https://nodejs.org/"

### Step 2: Install agent-browser

Run the install script:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/install-agent-browser.sh"
```

If install fails, report error and suggest manual installation.

### Step 2.5: Check for Web Application

Before spawning app discovery, check if this project is a web application:

```bash
repo_top=$(git rev-parse --show-toplevel 2>/dev/null || echo ".")
is_web=false
if [ -f "$repo_top/package.json" ]; then
  if grep -qE '"(next|react|vue|svelte|astro|nuxt|remix|express|fastify|koa|hono|gatsby|vite|webpack-dev-server|@angular/core|lit|solid-js|preact|alpinejs)"' "$repo_top/package.json" 2>/dev/null; then
    is_web=true
  fi
fi
printf 'is_web: %s\n' "$is_web"
```

If `is_web` is `false`, use AskUserQuestion:

> "No web framework detected in package.json. Browser testing requires a web
> app with a dev server. (Non-Node.js web apps like Django, Rails, or Go
> servers won't be detected here — choose 'Continue anyway' for those.)"
>
> Options:
> - "Continue anyway" — proceed to app discovery
> - "Configure manually" — skip discovery, ask for dev server command and base URL
> - "Skip" — exit setup

If the user chooses "Skip", report "Setup skipped — run `/browser-test:setup`
from within a web project." and stop. If "Configure manually", skip Step 3 and
proceed to Step 6 (Review and Confirm Config) with user-provided values.

### Step 3: Run App Discovery

Spawn the `app-discoverer` agent to analyze the codebase:

```
Task(app-discoverer): "Discover dev server command, base URL, routes, and auth flow for this project."
```

The agent will return the discovered configuration.

### Step 4: Handle Multiple Dev Commands

If the discoverer found multiple dev server commands, ask the user to choose:

Use AskUserQuestion with the discovered options (e.g., "npm run dev", "npm
start", "docker-compose up").

### Step 5: Handle OAuth Detection

If the discoverer detected OAuth-based auth (`auth.type: oauth-unsupported`):

Report: "OAuth authentication detected. Browser testing v1 requires
email/password auth. Options:"

1. "Configure a test account with email/password login"
2. "Skip authentication (test public pages only)"

Use AskUserQuestion to let the user decide.

### Step 6: Review and Confirm Config

Display a summary of the discovered configuration:

- Dev server command
- Base URL and port
- Number of routes discovered
- Auth type and login path
- Required environment variables (if auth enabled)

Use AskUserQuestion: "Does this look correct? Should I save this config?"

### Step 7: Write Config

Write the confirmed config to `.claude/yellow-browser-test.local.md`.

If auth is enabled, check that required env vars are accessible:

```bash
printenv BROWSER_TEST_EMAIL 2>/dev/null
printenv BROWSER_TEST_PASSWORD 2>/dev/null
```

If missing, report which env vars need to be set.

### Step 8: Validate Written Config

Read back the written config file and verify:

1. Extract YAML frontmatter (between `---` delimiters)
2. Check that `schema`, `devServer.command`, and `devServer.baseURL` fields
   exist
3. If validation fails: report error with
   `printf '[browser-test] Config validation failed: missing required fields\n' >&2`
   and suggest re-running setup

Use basic pattern matching — no need for YAML parser. Check for lines matching
`schema:`, `command:`, `baseURL:`.

### Step 9: Suggest Next Steps

Report setup complete and suggest:

- Run `/browser-test:test` to run the structured test suite
- Run `/browser-test:explore` for autonomous exploratory testing
- Set required env vars if auth credentials are missing

## Error Handling

| Error                | Action                                                                                 |
| -------------------- | -------------------------------------------------------------------------------------- |
| Node.js not found    | "Node.js 22.22.0 or later required. Install from https://nodejs.org/"                  |
| npm install fails    | Show error, suggest `sudo npm install -g agent-browser`                                |
| No package.json      | "No package.json found. Is this a web project?" then AskUserQuestion for manual config |
| No routes discovered | "Could not auto-detect routes. Describe your app's main pages."                        |
| OAuth detected       | Warn user, offer email/password or public-only options                                 |
| Config write fails   | Check directory permissions for `.claude/`                                             |
