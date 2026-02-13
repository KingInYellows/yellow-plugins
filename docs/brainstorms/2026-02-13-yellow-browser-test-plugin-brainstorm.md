# Brainstorm: yellow-browser-test Plugin

**Date:** 2026-02-13
**Status:** Draft
**Author:** AI-assisted brainstorm

## What We're Building

A Claude Code plugin that gives agents the ability to autonomously test web applications using [agent-browser](https://github.com/vercel-labs/agent-browser) (Vercel's AI-optimized browser CLI). Agents can discover how to start the dev server, authenticate, explore the UI, run structured test flows, find bugs, and report results — all without manual configuration.

**Core value proposition:** Point an agent at your codebase and it figures out how to start, login, test, and debug your web app. No test scripts to write. No config files to maintain.

## Why agent-browser

agent-browser is purpose-built for AI agents and outperforms alternatives for autonomous testing:

1. **82.5% less context** than Playwright MCP — critical for long testing sessions
2. **Ref-based elements** (`@e1`, `@e2`) — agents click refs, not CSS selectors
3. **Session persistence** — save/load auth state, skip re-login between tests
4. **Parallel sessions** — `--session checkout` and `--session browse` run simultaneously
5. **Semantic locators** — fallback to `find text "Submit"` when refs change
6. **Mobile testing** — `-p ios --device "iPhone 16 Pro"` for Safari testing
7. **Lightweight CLI** — Rust binary, no heavy framework overhead

Compared to Playwright MCP (richer but 5.7x fewer test cycles per context budget) and Claude in Chrome (development-focused, not autonomous testing).

## Why This Approach (Multi-Agent Pipeline)

We chose a multi-agent pipeline over a single agent or skill-only approach because:

- **Context management** — Discovery, testing, and reporting are distinct phases that benefit from isolated context windows. A single agent doing all three fills its context before deep testing begins.
- **Specialization** — The discovery agent reads code (package.json, routes, env files). The test runner agent operates the browser. The reporter agent formats results. Each stays focused.
- **Reusability** — The discovery agent's output (`.local.md` config) persists across sessions. Run discovery once, test many times.
- **Composability** — Users can invoke just the test runner with a URL if they don't need auto-discovery.

## Architecture Overview

```
┌──────────────────────────────────────────────────────┐
│                Claude Code Session                    │
├──────────────────────────────────────────────────────┤
│  Agents (AI-invoked, multi-agent pipeline)           │
│  ├── app-discoverer    → reads codebase, finds dev   │
│  │                       server cmd, routes, auth    │
│  │                       flow, writes .local.md      │
│  ├── test-runner       → uses agent-browser to       │
│  │                       execute structured flows +  │
│  │                       autonomous exploration      │
│  └── test-reporter     → collects results, writes    │
│                          report, creates GH issues   │
├──────────────────────────────────────────────────────┤
│  Commands (user-invoked)                             │
│  ├── /browser-test:setup     → install agent-browser │
│  │                             + discover app config │
│  ├── /browser-test:test      → run test suite        │
│  ├── /browser-test:explore   → autonomous exploration│
│  └── /browser-test:report    → generate test report  │
├──────────────────────────────────────────────────────┤
│  Skills (shared context)                             │
│  ├── agent-browser-patterns  → ref workflow, session │
│  │                             mgmt, error recovery  │
│  └── test-conventions        → reporting format,     │
│                                severity levels,      │
│                                screenshot naming     │
└──────────────────────────────────────────────────────┤
│  Config (per-project, auto-generated)                │
│  └── .claude/yellow-browser-test.local.md            │
│      - dev server command                            │
│      - base URL                                      │
│      - auth credentials ref (env var names)          │
│      - known routes                                  │
│      - login flow steps                              │
└──────────────────────────────────────────────────────┘
```

## Key Decisions

### 1. Auto-discovery over manual config

The app-discoverer agent reads the codebase to determine:
- **Dev server command** — reads `package.json` scripts, `Makefile`, `docker-compose.yml`, `Procfile`
- **Base URL** — checks `.env`, `config/`, framework defaults (Next.js → 3000, Rails → 3000, Django → 8000)
- **Auth flow** — finds login routes, auth middleware, identifies form fields
- **Route structure** — reads router files, page directories, API routes
- **Key pages** — identifies the most important pages to test (dashboard, settings, etc.)

Output is written to `.claude/yellow-browser-test.local.md` as YAML frontmatter + markdown description — standard plugin settings pattern.

### 2. Structured flows + autonomous exploration

Two testing modes, both using agent-browser:

**Structured flows** — Agent follows discovered routes and performs predictable actions:
- Navigate to each known page, verify it loads
- Fill forms with valid data, submit, verify success
- Fill forms with edge cases (empty, too long, special chars), verify error handling
- Test navigation between pages, verify links work

**Autonomous exploration** — Agent freely explores:
- Click every interactive element on a page
- Try unexpected input combinations
- Navigate off the happy path
- Look for console errors, broken layouts, dead links
- Test back/forward behavior, deep linking

### 3. Session persistence for auth

```bash
# Discovery agent logs in once, saves state
agent-browser open $BASE_URL/login
agent-browser fill @email "$LOGIN_EMAIL"
agent-browser fill @password "$LOGIN_PASSWORD"
agent-browser click @submit
agent-browser wait --url "**/dashboard"
agent-browser state save .claude/browser-test-auth.json

# Test runner loads saved state for each test
agent-browser state load .claude/browser-test-auth.json
```

Auth credentials referenced via env var names (never stored in config). Login flow steps recorded by the discovery agent for reproducibility.

### 4. Multi-tier reporting

Results flow through three channels:

| Channel | Content | When |
|---------|---------|------|
| **Inline** | Summary in conversation with key screenshots | Always |
| **Report file** | Full markdown report at `test-reports/YYYY-MM-DD-HH-MM.md` | Always |
| **GitHub issues** | One issue per bug with screenshots + repro steps | User confirms via AskUserQuestion |

Report format includes:
- Test summary (pass/fail/skip counts)
- Per-page results with screenshots
- Console errors captured
- Severity classification (critical/major/minor/cosmetic)
- Reproduction steps for each failure

### 5. Dev server lifecycle management

The plugin manages the full lifecycle:
1. **Detect** — Discovery agent finds the start command
2. **Start** — `bash -c "$DEV_SERVER_CMD" &` with PID tracking
3. **Wait** — Poll base URL until it responds (with timeout)
4. **Test** — Run all test flows
5. **Stop** — Kill the server process (or leave running if user-started)

If a server is already running at the base URL, skip start/stop.

### 6. Credential handling

- Never store actual credentials in config or reports
- Reference env var names: `LOGIN_EMAIL`, `LOGIN_PASSWORD`
- Discovery agent identifies which env vars are needed
- If env vars missing, prompt user via AskUserQuestion
- Auth state file (`.claude/browser-test-auth.json`) is gitignored

## Plugin Structure

```
plugins/yellow-browser-test/
├── .claude-plugin/
│   └── plugin.json
├── .gitattributes                    # LF line endings
├── CLAUDE.md                         # Plugin context
├── agents/
│   ├── testing/
│   │   ├── app-discoverer.md         # Reads codebase, writes config
│   │   ├── test-runner.md            # Executes browser tests
│   │   └── test-reporter.md          # Formats results, creates issues
├── commands/
│   └── browser-test/
│       ├── setup.md                  # Install + discover
│       ├── test.md                   # Run test suite
│       ├── explore.md                # Autonomous exploration
│       └── report.md                 # Generate report
├── skills/
│   ├── agent-browser-patterns/
│   │   └── SKILL.md                  # agent-browser usage patterns
│   └── test-conventions/
│       └── SKILL.md                  # Reporting format, severities
└── scripts/
    └── install-agent-browser.sh      # Setup helper
```

## Open Questions

1. **Screenshot storage** — Where to save screenshots? `test-reports/screenshots/` in project root? Or a temp directory?
2. **Test history** — Should we keep previous test reports for trend analysis? How many?
3. **CI integration** — Should the plugin support running in CI (headless, no user prompts)?
4. **Parallel test execution** — Use agent-browser's `--session` for parallel page testing, or keep it sequential for v1?
5. **Custom test scenarios** — Should users be able to define custom test flows in the `.local.md` config, beyond what auto-discovery finds?

## Out of Scope (v1)

- API testing (curl/httpie) — browser-first
- Performance/load testing
- Accessibility auditing (could be v2)
- Cross-browser testing (agent-browser uses Chromium only)
- Mobile Safari testing (requires macOS + Xcode)
- Visual regression diffing (screenshot comparison tooling)
