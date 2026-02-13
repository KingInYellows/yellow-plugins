---
title: "feat: Add yellow-browser-test plugin for autonomous web app testing"
type: feat
date: 2026-02-13
brainstorm: docs/brainstorms/2026-02-13-yellow-browser-test-plugin-brainstorm.md
---

# feat: Add yellow-browser-test plugin

## Overview

A Claude Code plugin that gives agents the ability to autonomously test web applications using [agent-browser](https://github.com/vercel-labs/agent-browser) (Vercel's AI-optimized browser CLI). The plugin auto-discovers how to start the dev server, authenticate, navigate the app, and find bugs — without manual config or test scripts.

**Multi-agent pipeline:** app-discoverer → test-runner → test-reporter

## Problem Statement

Testing web applications during development requires writing and maintaining test scripts, configuring test frameworks, and manually verifying behavior. AI agents can now operate browsers efficiently, but there's no Claude Code plugin that:

1. Auto-discovers app configuration from the codebase
2. Manages the dev server lifecycle
3. Runs both structured and exploratory browser tests
4. Reports findings with screenshots and optional GitHub issues

## Proposed Solution

A plugin with 3 specialized agents, 4 slash commands, and 2 reference skills, built on agent-browser (82.5% less context than Playwright MCP).

## Technical Approach

### Architecture

```
┌──────────────────────────────────────────────────────┐
│                Claude Code Session                    │
├──────────────────────────────────────────────────────┤
│  Agents (3)                                          │
│  ├── app-discoverer    → reads codebase, writes      │
│  │                       .local.md config            │
│  ├── test-runner       → agent-browser structured +  │
│  │                       exploratory tests           │
│  └── test-reporter     → markdown report + GH issues │
├──────────────────────────────────────────────────────┤
│  Commands (4)                                        │
│  ├── /browser-test:setup     → install + discover    │
│  ├── /browser-test:test      → run test suite        │
│  ├── /browser-test:explore   → autonomous exploration│
│  └── /browser-test:report    → generate report       │
├──────────────────────────────────────────────────────┤
│  Skills (2)                                          │
│  ├── agent-browser-patterns  → ref workflow, session │
│  │                             mgmt, error recovery  │
│  └── test-conventions        → report format,        │
│                                severities, schema    │
└──────────────────────────────────────────────────────┘
```

### Implementation Phases

#### Phase 1: Foundation — Plugin Scaffold + Skills (Files: 8)

Create the plugin skeleton and reference skills that all agents/commands depend on.

**Deliverables:**

1. **`plugins/yellow-browser-test/.claude-plugin/plugin.json`** — Plugin manifest

```json
{
  "name": "yellow-browser-test",
  "version": "0.1.0",
  "description": "Autonomous web app testing with agent-browser — auto-discovery, structured flows, exploratory testing, and bug reporting",
  "author": {
    "name": "KingInYellows",
    "url": "https://github.com/kinginyellow"
  },
  "homepage": "https://github.com/kinginyellow/yellow-plugins#yellow-browser-test",
  "repository": {
    "type": "git",
    "url": "https://github.com/kinginyellow/yellow-plugins"
  },
  "license": "MIT",
  "keywords": ["testing", "browser", "e2e", "agent-browser", "autonomous-qa"],
  "entrypoints": {
    "commands": [
      "commands/browser-test/setup.md",
      "commands/browser-test/test.md",
      "commands/browser-test/explore.md",
      "commands/browser-test/report.md"
    ],
    "agents": [
      "agents/testing/app-discoverer.md",
      "agents/testing/test-runner.md",
      "agents/testing/test-reporter.md"
    ],
    "skills": [
      "skills/agent-browser-patterns/SKILL.md",
      "skills/test-conventions/SKILL.md"
    ]
  },
  "compatibility": {
    "claudeCodeMin": "2.0.0"
  },
  "permissions": [
    {
      "scope": "shell",
      "reason": "Run agent-browser CLI for browser automation, npm for installation, process management for dev servers",
      "commands": ["agent-browser", "npm", "npx", "kill", "lsof", "curl"]
    },
    {
      "scope": "filesystem",
      "reason": "Read codebase for discovery, write test reports and screenshots, manage plugin config",
      "paths": [".claude/", "test-reports/"]
    }
  ]
}
```

2. **`plugins/yellow-browser-test/.gitattributes`** — LF line endings

```
* text=auto eol=lf
*.md text eol=lf
*.json text eol=lf
*.sh text eol=lf
```

3. **`plugins/yellow-browser-test/CLAUDE.md`** — Plugin context

```markdown
# yellow-browser-test Plugin

Autonomous web app testing with agent-browser. Auto-discovers dev server, routes, and auth flows. Runs structured and exploratory browser tests.

## Conventions

- agent-browser is the ONLY browser tool — never fall back to Playwright or puppeteer
- Reference env var names for credentials — never store actual passwords
- Always check `command -v agent-browser` before first use in any command
- Use ref-based elements (@e1, @e2) from `agent-browser snapshot -i`
- Manage dev server lifecycle: track PID, don't kill user-started servers
- Save auth state to `.claude/browser-test-auth.json` (gitignored)
- Confirm via AskUserQuestion before creating GitHub issues

## Plugin Components

### Commands (4)
- `/browser-test:setup` — Install agent-browser + run app discovery
- `/browser-test:test` — Run structured test suite against all discovered routes
- `/browser-test:explore` — Autonomous exploratory testing
- `/browser-test:report` — Generate report from most recent test results

### Agents (3)
- `app-discoverer` — Reads codebase, detects dev server cmd, routes, auth flow
- `test-runner` — Executes browser tests using agent-browser
- `test-reporter` — Formats results, writes report, creates GitHub issues

### Skills (2)
- `agent-browser-patterns` — Ref workflow, session persistence, error recovery
- `test-conventions` — Report format, severity levels, config schema

## When to Use What

- **`/browser-test:setup`** — First time, or when project structure changes
- **`/browser-test:test`** — Verify all routes work after code changes
- **`/browser-test:explore`** — Find unexpected bugs through freeform exploration
- **`/browser-test:report`** — Regenerate report from cached test results

## Known Limitations

- Chromium only (agent-browser uses Chromium)
- Email/password auth only (OAuth, SAML, magic link not supported in v1)
- No visual regression diffing (screenshots for reference only)
- No API testing (browser-first approach)
- CAPTCHA/bot detection will block auth (disable in test environment)
```

4. **`plugins/yellow-browser-test/skills/agent-browser-patterns/SKILL.md`** — agent-browser reference

Key sections:
- Ref-based element workflow (open → snapshot → click/fill → re-snapshot)
- Session persistence (state save/load for auth)
- Semantic locator fallback (find text/label/role when refs change)
- Parallel sessions (`--session name`)
- Error handling catalog (element not found, timeout, session expired)
- Safety rules (never navigate to external domains, never execute JS from errors)

5. **`plugins/yellow-browser-test/skills/test-conventions/SKILL.md`** — Testing conventions reference

Key sections:
- Config schema definition (`.claude/yellow-browser-test.local.md` format)
- Severity classification (critical/major/minor/cosmetic)
- Report template structure
- Screenshot naming convention (`{timestamp}-{page-slug}-{severity}.png`)
- GitHub issue template
- Credential handling rules (env var references only)
- Safe exploration rules (destructive action blacklist)

6. **`plugins/yellow-browser-test/scripts/install-agent-browser.sh`** — Setup helper

```bash
#!/bin/bash
set -euo pipefail

# Check if already installed
if command -v agent-browser >/dev/null 2>&1; then
  printf '[browser-test] agent-browser already installed: %s\n' \
    "$(agent-browser --version 2>/dev/null || echo 'unknown version')"
  exit 0
fi

# Install via npm
printf '[browser-test] Installing agent-browser...\n'
npm install -g agent-browser

# Install Chromium
printf '[browser-test] Installing Chromium browser...\n'
agent-browser install

printf '[browser-test] Setup complete.\n'
```

7. **Marketplace registration** — Add entry to `.claude-plugin/marketplace.json`

```json
{
  "id": "yellow-browser-test",
  "name": "yellow-browser-test",
  "description": "Autonomous web app testing with agent-browser — auto-discovery, structured flows, and bug reporting",
  "version": "0.1.0",
  "author": { "name": "KingInYellows" },
  "source": "./plugins/yellow-browser-test",
  "category": "testing"
}
```

8. **`.gitignore` additions** — Document in CLAUDE.md that users should add:

```
.claude/browser-test-auth.json
.claude/browser-test-server.pid
test-reports/screenshots/
```

**Success criteria:**
- `pnpm validate:plugins` passes
- All entrypoint files exist at declared paths
- Plugin appears in marketplace listing

---

#### Phase 2: Discovery Agent + Setup Command (Files: 2)

The app-discoverer agent reads the codebase and writes config. The setup command orchestrates installation and discovery.

**Deliverables:**

1. **`plugins/yellow-browser-test/agents/testing/app-discoverer.md`**

Agent workflow:
1. Read `package.json` → extract `scripts` (dev, start, serve, preview)
2. Check for `Makefile`, `docker-compose.yml`, `Procfile` as fallbacks
3. If multiple dev commands found → list them, let the calling command use AskUserQuestion
4. Determine base URL:
   - Check `.env`, `.env.local`, `.env.development` for `PORT=`, `BASE_URL=`
   - Check framework defaults (Next.js: 3000, Vite: 5173, CRA: 3000, Rails: 3000, Django: 8000)
   - Check `package.json` for port flags (`--port`, `-p`)
5. Discover routes:
   - Next.js: scan `app/` or `pages/` directory structure
   - React Router: grep for `<Route` or `createBrowserRouter`
   - Vue Router: grep for `routes:` array
   - Express/Fastify: grep for `.get(`, `.post(` route definitions
   - Rails: read `config/routes.rb`
   - Django: read `urls.py`
6. Identify auth flow:
   - Find login route (grep for `/login`, `/signin`, `/auth`)
   - Check for auth middleware / protected routes
   - Identify form fields on login page (email, password, username)
   - Detect auth type: email/password vs OAuth vs other
7. Write config to `.claude/yellow-browser-test.local.md`

Config schema (defined in test-conventions skill):

```yaml
---
schema: 1
generated: "2026-02-13T10:30:00Z"
devServer:
  command: "npm run dev"
  port: 3000
  baseURL: "http://localhost:3000"
  readyTimeout: 60
  readyPath: "/"
auth:
  type: "email-password"       # email-password | oauth-unsupported | none
  loginPath: "/login"
  credentials:
    email: "$TEST_USER_EMAIL"
    password: "$TEST_USER_PASSWORD"
  formFields:
    email: "email"             # input name/placeholder hint
    password: "password"
routes:
  - path: "/"
    name: "Home"
    auth: false
  - path: "/dashboard"
    name: "Dashboard"
    auth: true
  - path: "/settings"
    name: "Settings"
    auth: true
  - path: "/post/[id]"
    name: "Post Detail"
    auth: false
    dynamic: true
---

# App Discovery Notes

- Framework: Next.js 14 (App Router)
- Dev command source: package.json scripts.dev
- Routes discovered from: app/ directory structure
- Auth detected: email/password form at /login
- Dynamic routes marked — test-runner should skip or use example IDs from seed data
```

Allowed-tools: `Read`, `Grep`, `Glob`, `Bash` (for `jq` only)

**Security decisions:**
- Discovery reads code only — never executes the dev server
- Route paths validated: only `[a-zA-Z0-9/_\-\[\].]` allowed
- Dev command from package.json is trusted (user's own code)
- If OAuth detected: write `auth.type: oauth-unsupported`, don't attempt login

2. **`plugins/yellow-browser-test/commands/browser-test/setup.md`**

Command workflow:
1. Check prerequisites: `command -v npm`, `command -v node`
2. Run `scripts/install-agent-browser.sh` via Bash
3. Spawn app-discoverer agent via Task tool
4. If multiple dev commands found → AskUserQuestion to choose
5. If OAuth detected → warn user, recommend email/password for testing
6. Display discovered config summary
7. Prompt for missing env vars if auth is enabled
8. Confirm config via AskUserQuestion before writing

Allowed-tools: `Bash`, `Read`, `Write`, `AskUserQuestion`, `Task`, `Glob`, `Grep`

Error handling:

| Error | Action |
|-------|--------|
| npm not found | "Node.js required. Install from https://nodejs.org" |
| agent-browser install fails | Show npm error, suggest `sudo npm install -g agent-browser` |
| No package.json found | "No package.json detected. Is this a Node.js project?" then AskUserQuestion for manual config |
| No routes found | "Could not auto-detect routes. Please describe your app's main pages." |
| OAuth detected | "OAuth auth detected. Browser testing requires email/password. Do you have a test account with email/password login?" |

**Success criteria:**
- `.claude/yellow-browser-test.local.md` written with valid YAML frontmatter
- agent-browser installed and responsive (`agent-browser --version`)
- Config reviewed and confirmed by user

---

#### Phase 3: Test Runner Agent + Test/Explore Commands (Files: 3)

The core testing engine — structured flows and autonomous exploration.

**Deliverables:**

1. **`plugins/yellow-browser-test/agents/testing/test-runner.md`**

Agent workflow:

**Pre-test setup:**
1. Read config from `.claude/yellow-browser-test.local.md`
2. Check agent-browser is available
3. Load auth state if exists: `agent-browser state load .claude/browser-test-auth.json`
4. If no auth state and auth required: run login flow (see below)

**Login flow:**
1. `agent-browser open $BASE_URL$LOGIN_PATH`
2. `agent-browser snapshot -i` to get form field refs
3. Resolve env vars for credentials, error if missing
4. `agent-browser fill @email_ref "$EMAIL"` + `agent-browser fill @password_ref "$PASSWORD"`
5. `agent-browser click @submit_ref`
6. `agent-browser wait --url "**/$EXPECTED_PATH"` with 15s timeout
7. If CAPTCHA detected (page contains "captcha", "recaptcha", "verify you're human"): error with guidance
8. `agent-browser state save .claude/browser-test-auth.json`

**Structured testing mode:**
For each non-dynamic route in config:
1. `agent-browser open $BASE_URL$ROUTE_PATH`
2. `agent-browser wait --load networkidle`
3. `agent-browser snapshot -i` to get page elements
4. Verify page loaded (not error page, not redirect to login)
5. If redirected to login → session expired → re-auth → retry once
6. Take screenshot: `agent-browser screenshot test-reports/screenshots/{slug}-loaded.png`
7. Identify interactive elements (forms, buttons, links)
8. For forms: fill with valid data, submit, verify success response
9. For forms: fill with edge cases (empty, max length, special chars), verify error handling
10. Record results: route, status (pass/fail/skip), console errors, screenshot paths

**Exploratory testing mode:**
1. Start from authenticated dashboard (or home page)
2. `agent-browser snapshot -i` to discover all interactive elements
3. For each element (breadth-first, max 3 levels deep, max 10 minutes):
   - **Safety check:** skip if element text matches destructive patterns: `/delete|remove|destroy|drop|reset|purge|erase|clear all/i`
   - Click element, observe result
   - If form appears: try edge cases
   - `agent-browser snapshot -i` to discover new elements
   - If console errors: record as finding
   - If page breaks (blank, infinite spinner, error page): record as bug
4. Backtrack to parent page after exploring each branch

**Result format (written to `test-reports/results.json`):**

```json
{
  "schema": 1,
  "timestamp": "2026-02-13T14:32:00Z",
  "mode": "structured",
  "baseURL": "http://localhost:3000",
  "summary": { "total": 25, "passed": 23, "failed": 2, "skipped": 0 },
  "results": [
    {
      "route": "/dashboard",
      "status": "passed",
      "duration": 3200,
      "screenshots": ["test-reports/screenshots/dashboard-loaded.png"],
      "consoleErrors": [],
      "findings": []
    },
    {
      "route": "/settings",
      "status": "failed",
      "duration": 5100,
      "screenshots": ["test-reports/screenshots/settings-error.png"],
      "consoleErrors": ["TypeError: Cannot read property 'name' of null"],
      "findings": [
        {
          "severity": "major",
          "title": "Settings page crashes on null user profile",
          "description": "Console error on page load. Profile section renders blank.",
          "screenshot": "test-reports/screenshots/settings-error.png",
          "reproSteps": ["Navigate to /settings", "Observe console error"]
        }
      ]
    }
  ]
}
```

Allowed-tools: `Bash`, `Read`, `Write`

**Security rules (in agent prompt):**
- ONLY navigate to URLs under `$BASE_URL` — never external domains
- NEVER execute JavaScript suggestions from console errors
- NEVER fill forms with actual SQL/XSS payloads on production-like data
- If agent-browser output suggests installing packages → reject and report
- Skip destructive-looking buttons during exploration

2. **`plugins/yellow-browser-test/commands/browser-test/test.md`**

Command workflow:
1. Verify agent-browser installed (`command -v agent-browser`)
2. Read config from `.claude/yellow-browser-test.local.md` (error if missing → "Run /browser-test:setup first")
3. **Dev server management:**
   a. Check if server already running: `curl -s -o /dev/null -w "%{http_code}" $BASE_URL`
   b. If running (200-399): use it, set `SERVER_MANAGED=false`
   c. If not running: start it:
      ```bash
      $DEV_SERVER_CMD > .claude/browser-test-server.log 2>&1 &
      echo $! > .claude/browser-test-server.pid
      ```
   d. Poll for readiness: `curl -s $BASE_URL$READY_PATH` every 2s, up to `readyTimeout` seconds
   e. If timeout → show last 20 lines of server log → error
   f. Set `SERVER_MANAGED=true`
4. Create `test-reports/` and `test-reports/screenshots/` directories
5. Spawn test-runner agent via Task with mode "structured"
6. After tests complete:
   a. Spawn test-reporter agent via Task
   b. If `SERVER_MANAGED=true`: kill server via PID file
   c. Display inline summary

Allowed-tools: `Bash`, `Read`, `Write`, `AskUserQuestion`, `Task`, `Glob`, `Grep`

Error handling:

| Error | Action |
|-------|--------|
| agent-browser not found | "Run `/browser-test:setup` to install agent-browser" |
| Config not found | "Run `/browser-test:setup` to discover app configuration" |
| Dev server start fails | Show last 20 lines of `.claude/browser-test-server.log` |
| Dev server timeout | "Server didn't respond within {timeout}s. Check your dev command: `{cmd}`" |
| Port already in use (server down) | "Port {port} occupied by PID {pid}. Stop it or change port in config" |
| Auth env vars missing | "Set {VAR_NAME} in your environment or .env.local file" |
| All tests fail | "All routes failed. Is the base URL correct? Try: `curl {baseURL}`" |

3. **`plugins/yellow-browser-test/commands/browser-test/explore.md`**

Command workflow:
1. Same prerequisites as test command (agent-browser, config, dev server)
2. Spawn test-runner agent via Task with mode "exploratory"
3. Optional: `$ARGUMENTS` can specify a starting URL or route filter
   - Validate: must start with `/`, only `[a-zA-Z0-9/_\-]` chars
4. After exploration: spawn test-reporter agent
5. Cleanup dev server if managed

Allowed-tools: `Bash`, `Read`, `Write`, `AskUserQuestion`, `Task`, `Glob`, `Grep`

**Success criteria:**
- Structured tests exercise all non-dynamic routes
- Exploratory tests discover interactive elements breadth-first
- Results written to `test-reports/results.json`
- Dev server cleaned up after testing
- Session expired mid-test → automatic re-auth → resume

---

#### Phase 4: Reporter Agent + Report Command (Files: 2)

**Deliverables:**

1. **`plugins/yellow-browser-test/agents/testing/test-reporter.md`**

Agent workflow:
1. Read `test-reports/results.json`
2. Generate markdown report at `test-reports/YYYY-MM-DD-HH-MM.md`:

```markdown
# Browser Test Report — 2026-02-13 14:32

**Mode:** Structured | **Base URL:** http://localhost:3000
**Duration:** 3m 42s | **Routes:** 23/25 passed, 2 failed

## Summary

| Status | Count |
|--------|-------|
| Passed | 23 |
| Failed | 2 |
| Skipped | 0 |

## Failures

### /settings — Console Error (Major)

**TypeError: Cannot read property 'name' of null**

![Settings Error](./screenshots/settings-error.png)

**Reproduction steps:**
1. Navigate to /settings
2. Observe console error — profile section renders blank

---

### /admin/users — Timeout (Minor)

Page did not finish loading within 30s.

![Admin Users Timeout](./screenshots/admin-users-timeout.png)

## Warnings

- `/post/[id]` — Skipped (dynamic route, no example ID)

<details>
<summary>Passed Routes (23)</summary>

| Route | Duration |
|-------|----------|
| / | 1.2s |
| /dashboard | 3.2s |
| /profile | 2.1s |
...
</details>
```

3. Present inline summary to conversation
4. If failures found, ask via AskUserQuestion:
   "Found {N} failures. Create GitHub issues?"
   - Options: "Yes, create issues" / "No, report only" / "Let me review first"
5. If yes: for each failure with severity >= major:
   - Create GitHub issue via `gh issue create`
   - Title: `[browser-test] {route} — {finding title}`
   - Body: severity, description, screenshot, repro steps
   - Labels: `bug`, `browser-test`
   - Show issue URLs after creation

Allowed-tools: `Bash`, `Read`, `Write`, `AskUserQuestion`

**Security: human-in-the-loop** — ALWAYS AskUserQuestion before creating GitHub issues. Never auto-create.

2. **`plugins/yellow-browser-test/commands/browser-test/report.md`**

Command workflow:
1. Find most recent `test-reports/results.json`
2. If not found → "No test results found. Run `/browser-test:test` or `/browser-test:explore` first"
3. Spawn test-reporter agent via Task
4. Display report path

Allowed-tools: `Bash`, `Read`, `Write`, `AskUserQuestion`, `Task`

**Success criteria:**
- Markdown report readable and well-formatted
- Screenshots referenced with relative paths
- GitHub issues created only after user confirmation
- Each issue has repro steps and screenshot

---

## Alternative Approaches Considered

### Single agent (rejected)

One agent doing discovery + testing + reporting. Rejected because context window fills up — discovery reads dozens of files, testing generates screenshots and element snapshots, reporting formats everything. Splitting into 3 agents keeps each focused.

### Playwright MCP (rejected as primary)

Richer features (network interception, multi-tab, cross-browser) but 5.7x fewer test cycles per context budget. Agent-browser's 82.5% context reduction is critical for deep autonomous testing.

### Skill-only approach (rejected)

Skills + commands without dedicated agents. More flexible but less autonomous — user must invoke commands manually for each step. The multi-agent pipeline enables full automation via the test command.

## Acceptance Criteria

### Functional Requirements

- [x] `/browser-test:setup` installs agent-browser and discovers app config
- [x] `/browser-test:test` starts dev server, runs structured tests, generates report
- [x] `/browser-test:explore` runs autonomous exploratory testing
- [x] `/browser-test:report` regenerates report from cached results
- [x] App-discoverer detects dev server command from package.json
- [x] App-discoverer maps routes from framework-specific patterns
- [x] App-discoverer identifies auth flow (email/password)
- [x] Test-runner authenticates using env var credentials + session persistence
- [x] Test-runner detects session expiration and re-authenticates
- [x] Test-runner takes screenshots of each tested page
- [x] Test-reporter writes structured markdown report
- [x] Test-reporter creates GitHub issues after user confirmation
- [x] Dev server started/stopped automatically when not already running
- [x] User-started dev server left running after tests

### Non-Functional Requirements

- [x] Agent .md files under 120 lines each
- [x] Every description includes "Use when..." trigger clause
- [x] `allowed-tools` matches actual tool usage in each file
- [x] `pnpm validate:plugins` passes
- [x] Credentials stored as env var references only (never actual values)
- [x] All shell scripts pass ShellCheck
- [x] LF line endings enforced via .gitattributes

### Quality Gates

- [x] All entrypoint files exist at declared paths
- [x] Marketplace entry added and validates
- [x] CLAUDE.md component counts match actual file counts
- [x] Error handling tables present in all commands
- [x] Security rules documented in agent prompts (no external navigation, no destructive clicks)

## Dependencies & Prerequisites

- **agent-browser** — npm package, installs Chromium
- **Node.js** — Required for npm/agent-browser installation
- **gh CLI** — Required for GitHub issue creation (optional feature)
- **curl** — Required for dev server readiness polling
- **lsof** — Required for port conflict detection (optional)

## Risk Analysis & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Dev server command injection | Low | Critical | Command comes from user's own package.json — trusted source |
| Exploratory agent clicks destructive button | Medium | High | Blacklist pattern matching on element text before clicking |
| Session expires mid-test | High | Medium | Detect login redirect → re-auth → retry once |
| OAuth app can't authenticate | Medium | Medium | Detect OAuth early in discovery, error with clear guidance |
| CAPTCHA blocks auth | Medium | Medium | Detect CAPTCHA keywords in page, error with "disable for test env" |
| Agent-browser API changes | Low | High | Pin version in install script, document minimum version |
| Screenshots contain PII | Medium | Medium | Warn user before creating public GitHub issues with screenshots |
| Context window overflow in test-runner | Medium | High | Limit routes per session, save results incrementally |

## Future Considerations (v2+)

- **Visual regression diffing** — Compare screenshots across runs
- **API testing** — curl-based API endpoint verification
- **Accessibility auditing** — axe-core integration via agent-browser eval
- **Cross-browser testing** — When agent-browser adds Firefox/Safari support
- **CI mode** — Non-interactive, exit codes, JUnit XML output
- **Test history** — Compare results across runs, detect regressions
- **Multiple auth roles** — Admin, user, guest configs for role-based testing
- **Dynamic route testing** — Auto-find example IDs from seed data or database
- **Route skip/focus** — Config flags to include/exclude specific routes

## File Structure Summary

```
plugins/yellow-browser-test/
├── .claude-plugin/
│   └── plugin.json
├── .gitattributes
├── CLAUDE.md
├── agents/
│   └── testing/
│       ├── app-discoverer.md          # Phase 2
│       ├── test-runner.md             # Phase 3
│       └── test-reporter.md           # Phase 4
├── commands/
│   └── browser-test/
│       ├── setup.md                   # Phase 2
│       ├── test.md                    # Phase 3
│       ├── explore.md                 # Phase 3
│       └── report.md                  # Phase 4
├── skills/
│   ├── agent-browser-patterns/
│   │   └── SKILL.md                   # Phase 1
│   └── test-conventions/
│       └── SKILL.md                   # Phase 1
└── scripts/
    └── install-agent-browser.sh       # Phase 1
```

**Total files:** 15 (including plugin.json, .gitattributes, CLAUDE.md)

## References & Research

### Internal References

- Plugin structure: `plugins/yellow-review/.claude-plugin/plugin.json`
- Agent format: `plugins/yellow-review/agents/review/pr-test-analyzer.md`
- Command format: `plugins/yellow-ruvector/commands/ruvector/setup.md`
- Skill format: `plugins/yellow-ruvector/skills/ruvector-conventions/SKILL.md`
- Hooks pattern: `plugins/yellow-ruvector/hooks/hooks.json`
- Shell security: `docs/solutions/security-issues/agent-workflow-security-patterns.md`
- Validation guide: `docs/plugin-validation-guide.md`

### External References

- agent-browser repo: https://github.com/vercel-labs/agent-browser
- agent-browser SKILL.md: https://github.com/vercel-labs/agent-browser/blob/main/skills/agent-browser/SKILL.md
- Self-verifying agents pattern: https://www.pulumi.com/blog/self-verifying-ai-agents-vercels-agent-browser-in-the-ralph-wiggum-loop/
- Brainstorm: `docs/brainstorms/2026-02-13-yellow-browser-test-plugin-brainstorm.md`
