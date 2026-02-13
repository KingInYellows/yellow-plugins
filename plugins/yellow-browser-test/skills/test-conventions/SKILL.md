---
name: test-conventions
description: >
  Testing conventions and configuration reference. Use when agents or commands
  need config schema, severity classification, report templates, screenshot
  naming, credential rules, or safe exploration patterns.
user-invocable: false
---

# Test Conventions

## What It Does

Reference conventions for the yellow-browser-test plugin's testing workflow. Defines the config schema, report format, severity levels, and safety rules.

## When to Use

Use when yellow-browser-test commands or agents need the config schema, report template, severity classification, or credential handling rules.

## Usage

This skill is not user-invocable. It provides shared context for the yellow-browser-test plugin.

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
  type: "email-password"        # email-password | oauth-unsupported | none
  loginPath: "/login"
  credentials:
    email: "$TEST_USER_EMAIL"   # env var reference, never actual value
    password: "$TEST_USER_PASSWORD"
  formFields:
    email: "email"
    password: "password"
routes:
  - path: "/"
    name: "Home"
    auth: false
  - path: "/dashboard"
    name: "Dashboard"
    auth: true
  - path: "/post/[id]"
    name: "Post Detail"
    auth: false
    dynamic: true
---

# App Discovery Notes

- Framework detected and discovery method notes here
```

**Required fields:** `schema`, `devServer.command`, `devServer.baseURL`
**Optional fields:** `auth` (default: none), `routes` (default: empty)

## Severity Classification

| Severity | Criteria | Example |
|----------|----------|---------|
| **critical** | App crashes, data loss, security hole | Unhandled exception on form submit |
| **major** | Feature broken, console error, blank section | Settings page renders empty |
| **minor** | Slow load, UI glitch, non-blocking error | Button misaligned, 5s load time |
| **cosmetic** | Visual imperfection, typo | Font inconsistency, extra whitespace |

## Report Template

Reports are written to `test-reports/YYYY-MM-DD-HH-MM.md`:

```markdown
# Browser Test Report — YYYY-MM-DD HH:MM

**Mode:** Structured | **Base URL:** http://localhost:3000
**Duration:** Xm Ys | **Routes:** X/Y passed, Z failed

## Summary

| Status | Count |
|--------|-------|
| Passed | X |
| Failed | Y |
| Skipped | Z |

## Failures

### /route — Finding Title (Severity)

**Error description**

![Screenshot](./screenshots/route-slug-severity.png)

**Reproduction steps:**
1. Step one
2. Step two

---

## Warnings

- Skipped routes and non-critical observations

<details>
<summary>Passed Routes (N)</summary>

| Route | Duration |
|-------|----------|
| / | 1.2s |

</details>
```

## Results JSON Schema

Test results are persisted at `test-reports/results.json`:

```json
{
  "schema": 1,
  "timestamp": "ISO-8601",
  "mode": "structured|exploratory",
  "baseURL": "http://localhost:3000",
  "summary": { "total": 0, "passed": 0, "failed": 0, "skipped": 0 },
  "results": [
    {
      "route": "/path",
      "status": "passed|failed|skipped",
      "duration": 0,
      "screenshots": ["test-reports/screenshots/slug.png"],
      "consoleErrors": [],
      "findings": [
        {
          "severity": "critical|major|minor|cosmetic",
          "title": "Short description",
          "description": "Detailed observation",
          "screenshot": "path/to/screenshot.png",
          "reproSteps": ["Step 1", "Step 2"]
        }
      ]
    }
  ]
}
```

## Screenshot Naming

Format: `{page-slug}-{context}.png`

- `dashboard-loaded.png` — Page loaded successfully
- `settings-error.png` — Error observed on page
- `login-captcha.png` — CAPTCHA blocking auth

Store in `test-reports/screenshots/`. Use lowercase kebab-case.

## GitHub Issue Template

When creating issues for failures (severity >= major):

- **Title:** `[browser-test] /route — finding title`
- **Labels:** `bug`, `browser-test`
- **Body:**

```markdown
## Browser Test Finding

**Severity:** major
**Route:** /settings
**Mode:** structured

## Description

Settings page throws console error on load.

## Console Errors

```
TypeError: Cannot read property 'name' of null
```

## Reproduction Steps

1. Navigate to /settings
2. Observe console error

## Screenshot

![Screenshot](url-or-path)
```

**Security:** ALWAYS use AskUserQuestion before creating GitHub issues. Never auto-create. Warn that screenshots may contain sensitive data.

## Credential Handling Rules

1. **Never store actual credentials** — config references env var NAMES only (`$TEST_USER_EMAIL`)
2. **Auth state file** — `.claude/browser-test-auth.json` must be gitignored
3. **Missing vars** — If env vars are not set, error with: "Set {VAR_NAME} in your environment or .env.local"
4. **PID file** — `.claude/browser-test-server.pid` must be gitignored

## Safe Exploration Rules

During autonomous exploration, the test-runner agent MUST:

1. **Skip destructive elements** — Text matching: `/delete|remove|destroy|drop|reset|purge|erase|clear all/i`
2. **Stay within baseURL** — Never navigate to external domains
3. **Limit depth** — Max 3 levels from starting page
4. **Limit time** — Max 10 minutes per exploration session
5. **Save incrementally** — Write partial results every 5 routes to prevent data loss
