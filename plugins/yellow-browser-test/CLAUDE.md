# yellow-browser-test Plugin

Autonomous web app testing with agent-browser. Auto-discovers dev server,
routes, and auth flows. Runs structured and exploratory browser tests.

## Conventions

- agent-browser is the ONLY browser tool — never fall back to Playwright or
  puppeteer
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
- **`/browser-test:explore`** — Find unexpected bugs through freeform
  exploration
- **`/browser-test:report`** — Regenerate report from cached test results

## Artifacts and Data Flow

`/browser-test:setup` writes `.claude/yellow-browser-test.local.md` (discovered
dev-server command, `baseURL`, routes, auth flow), which every other command
reads. `/browser-test:test` and `/browser-test:explore` write
`test-reports/results.json`; `/browser-test:report` renders it to
`test-reports/<timestamp>.md` (plus `issues.md` and `screenshots/`).
Dev-server lifecycle state lives in `.claude/browser-test-server.pid` and
`.claude/browser-test-server.log`.

- `scripts/install-agent-browser.sh` (run by `/browser-test:setup`) pins the
  `agent-browser` version. It skips the Node check entirely if `agent-browser`
  is already on `PATH`; otherwise it hard-fails below Node 22.22.0, or warns
  and continues if Node itself can't be found or its version can't be parsed.
- Dispatch agents by their three-segment runtime names
  (`yellow-browser-test:testing:app-discoverer`,
  `yellow-browser-test:testing:test-runner`,
  `yellow-browser-test:testing:test-reporter`) — bare agent names do not
  resolve (fixed across all dispatch sites in 1.1.5).

## Testing

No plugin-local suite. Validate with `pnpm validate:plugins` and
`pnpm validate:agents`.

## Git Operations

This plugin does not perform git operations. Graphite commands and git workflows
do not apply.

## Known Limitations

- Chromium only (agent-browser uses Chromium)
- Email/password auth only (OAuth, SAML, magic link not supported in v1)
- No visual regression diffing (screenshots for reference only)
- No API testing (browser-first approach)
- CAPTCHA/bot detection will block auth (disable in test environment)
