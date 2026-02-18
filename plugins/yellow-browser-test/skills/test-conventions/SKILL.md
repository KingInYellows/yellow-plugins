---
name: test-conventions
description: Testing conventions and configuration reference. Use when agents or commands need config schema, severity classification, report templates, or credential rules for browser testing.
user-invokable: false
---

# Test Conventions

## What It Does

Reference conventions for the yellow-browser-test plugin's testing workflow. Defines the config schema, report format, severity levels, and safety rules.

## When to Use

Use when yellow-browser-test commands or agents need the config schema, severity classification, or credential handling rules.

## Usage

This skill is not user-invokable. It provides shared context for the yellow-browser-test plugin.

## Config Schema

Config is stored at `.claude/yellow-browser-test.local.md` as YAML frontmatter + markdown notes.

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
  type: "email-password"
  loginPath: "/login"
  credentials:
    email: "$BROWSER_TEST_EMAIL"
    password: "$BROWSER_TEST_PASSWORD"
  formFields:
    email: "email"
    password: "password"
routes:
  - path: "/dashboard"
    name: "Dashboard"
    auth: true
---
```

**Required fields:** `schema`, `devServer.command`, `devServer.baseURL`

## Severity Classification

| Severity | Criteria | Example |
|----------|----------|---------|
| **critical** | App crashes, data loss, security hole | Unhandled exception on form submit |
| **major** | Feature broken, console error, blank section | Settings page renders empty |
| **minor** | Slow load, UI glitch, non-blocking error | Button misaligned, 5s load time |
| **cosmetic** | Visual imperfection, typo | Font inconsistency, extra whitespace |

## Credential Handling Rules

1. **Never store actual credentials** — config references env var NAMES only (`$BROWSER_TEST_EMAIL`)
2. **Auth state file** — `.claude/browser-test-auth.json` must be gitignored
3. **Missing vars** — If env vars are not set, error with: "Set {VAR_NAME} in your environment or .env.local"
4. **PID file** — `.claude/browser-test-server.pid` must be gitignored
5. **Env var naming** — Use `BROWSER_TEST_*` prefix for all test credentials (e.g., `BROWSER_TEST_EMAIL`, `BROWSER_TEST_PASSWORD`)
6. **Never log credentials** — Mask credential values in reports with `***`
7. **Auth state expiry** — If tests fail with auth errors, delete `.claude/browser-test-auth.json` and re-run setup to refresh auth state

## Safe Exploration Rules

During autonomous exploration, the test-runner agent MUST:

1. Follow safety rules from agent-browser-patterns skill
2. **Limit depth** — Max 3 levels from starting page
3. **Limit time** — Max 10 minutes per exploration session
4. **Save incrementally** — Write partial results every 5 routes to prevent data loss

## Report Template

Reports are written to `test-reports/YYYY-MM-DD-HH-MM.md`. See test-reporter agent for full template and GitHub issue creation flow.

**Security:** ALWAYS use AskUserQuestion before creating GitHub issues. Never auto-create. Warn that screenshots may contain sensitive data.
