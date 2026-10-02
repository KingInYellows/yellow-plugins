---
name: browser-test:setup
description: "Install agent-browser and discover app configuration. Use when user says 'set up browser testing', 'install agent-browser', or wants to initialize browser testing for a web project."
argument-hint: ''
allowed-tools:
  - Bash
  - Read
  - Write
  - AskUserQuestion
  - Agent
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

Before spawning app discovery, check if this project is a web application.
The signal checks mirror the "Web App Signals" block in yellow-core's
`commands/setup/all.md` (minus its `repo_top` guards, since `repo_top` falls
back to the current directory here) — keep the two in sync when either
changes:

```bash
repo_top=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
web_signals=""
if [ -f "$repo_top/package.json" ] && \
   grep -qE '"(next|react|vue|svelte|astro|nuxt|remix|express|fastify|koa|hono|gatsby|vite|webpack-dev-server|@angular/core|lit|solid-js|preact|alpinejs)"' "$repo_top/package.json" 2>/dev/null; then
  web_signals="$web_signals node"
fi
if [ -f "$repo_top/Gemfile" ] && \
   grep -qE "^[[:space:]]*gem[[:space:]]+['\"]rails['\"]" "$repo_top/Gemfile" 2>/dev/null; then
  web_signals="$web_signals rails"
fi
for f in "$repo_top/requirements.txt" "$repo_top/pyproject.toml"; do
  if [ -f "$f" ] && grep -qiE "(django|flask|fastapi|starlette|sanic)" "$f" 2>/dev/null; then
    web_signals="$web_signals python"
    break
  fi
done
if [ -f "$repo_top/go.mod" ] && \
   grep -qE "(gin-gonic|labstack/echo|gofiber/fiber|go-chi/chi|gorilla/mux)" "$repo_top/go.mod" 2>/dev/null; then
  web_signals="$web_signals go"
fi
if [ -f "$repo_top/Cargo.toml" ] && \
   grep -qE "^[[:space:]]*(\[[^]]*\.)?(axum|actix-web|rocket|warp)(\][[:space:]]*(#.*)?$|[[:space:]]*=)|^[[:space:]]*(axum|actix-web|rocket|warp)\.[A-Za-z_-]+[[:space:]]*=|^[^#]*package[[:space:]]*=[[:space:]]*\"(axum|actix-web|rocket|warp)\"" "$repo_top/Cargo.toml" 2>/dev/null; then
  web_signals="$web_signals rust"
fi
for f in fly.toml render.yaml vercel.json netlify.toml; do
  if [ -f "$repo_top/$f" ]; then
    web_signals="$web_signals paas($f)"
    break
  fi
done
for f in compose.yaml compose.yml docker-compose.yaml docker-compose.yml; do
  if [ -f "$repo_top/$f" ] && \
     grep -qE '^[[:space:]]*-[[:space:]]*"?[0-9]+:(80|443|3000|3001|4000|5000|5173|8000|8080|8888)"?' "$repo_top/$f" 2>/dev/null; then
    web_signals="$web_signals docker_http"
    break
  fi
done
if [ -n "$web_signals" ]; then
  printf 'is_web: true (signals:%s; checked: %s)\n' "$web_signals" "$repo_top"
else
  printf 'is_web: false (checked: %s)\n' "$repo_top"
fi
```

If the output line is `is_web: false`, use AskUserQuestion:

> "No web-app signals found in {the `checked:` path from the output above}
> (checked: package.json, Gemfile, Python deps, go.mod, Cargo.toml, PaaS
> config, Compose ports). Browser testing requires a web app with a dev
> server."
>
> Options:
> - "Continue anyway" — proceed to app discovery
> - "Configure manually" — skip discovery, ask for dev server command and base URL
> - "Skip" — exit setup

The `checked:` path is the git root, or your current directory outside a git
repository.

If the user chooses "Skip", report "Setup skipped — run `/browser-test:setup`
from within a web project." and stop. If "Configure manually", skip Step 3 and
proceed to Step 6 (Review and Confirm Config) with user-provided values.

### Step 3: Run App Discovery

Spawn the `app-discoverer` agent to analyze the codebase:

```
Agent(subagent_type="yellow-browser-test:testing:app-discoverer"): "Discover dev server command, base URL, routes, and auth flow for this project."
```

The agent will return the discovered configuration. If it returns "no web app
detected", or no dev server command, follow the "Configure manually" path from
Step 2.5: ask for the dev server command and base URL, then continue at Step 6.

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
| No web signals       | Step 2.5 reports `is_web: false` — ask: continue / configure manually / skip           |
| No routes discovered | "Could not auto-detect routes. Describe your app's main pages."                        |
| OAuth detected       | Warn user, offer email/password or public-only options                                 |
| Config write fails   | Check directory permissions for `.claude/`                                             |
