# yellow-browser-test

Autonomous web app testing with agent-browser — auto-discovery, structured
flows, exploratory testing, and bug reporting.

## Install

```
/plugin marketplace add KingInYellows/yellow-plugins
/plugin install yellow-browser-test@yellow-plugins
```

## Prerequisites

- [agent-browser](https://github.com/ArcadeLabsInc/agent-browser) CLI installed
  (`npm install -g agent-browser`)
- Chromium-based browser available
- Dev server for your app (auto-detected during setup)

## Commands

| Command                 | Description                                             |
| ----------------------- | ------------------------------------------------------- |
| `/browser-test:setup`   | Install agent-browser and run app discovery             |
| `/browser-test:test`    | Run structured test suite against all discovered routes |
| `/browser-test:explore` | Autonomous exploratory testing                          |
| `/browser-test:report`  | Generate report from most recent test results           |

## Agents

| Agent            | Description                                                       |
| ---------------- | ----------------------------------------------------------------- |
| `app-discoverer` | Reads codebase, detects dev server command, routes, and auth flow |
| `test-runner`    | Executes browser tests using agent-browser                        |
| `test-reporter`  | Formats results, writes report, creates GitHub issues             |

## Skills

| Skill                    | Description                                       |
| ------------------------ | ------------------------------------------------- |
| `agent-browser-patterns` | Ref workflow, session persistence, error recovery |
| `test-conventions`       | Report format, severity levels, config schema     |

## Limitations

- Chromium only (agent-browser uses Chromium)
- Email/password auth only (OAuth, SAML, magic link not supported)
- No visual regression diffing
- CAPTCHA/bot detection will block auth (disable in test environment)

## License

MIT
