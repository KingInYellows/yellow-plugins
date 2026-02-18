---
date: 2026-02-17
topic: marketplace-readiness-audit
---

# Marketplace Readiness Audit — Final Review Before Going Public

## What We're Building

A two-phase review to make `yellow-plugins` production-ready for personal use:

1. **Phase 1 — Install flow + public repo readiness**: Fix the install documentation, verify the exact commands to add this marketplace in a fresh Claude Code project, and ensure the repository is safe to make public (no secrets, no private content).
2. **Phase 2 — Plugin quality audit**: Review all 10 plugins against Claude Code 2026 best practices — agent line budgets, trigger clauses, tool declarations, LF line endings, and component completeness.

## Current State

- **10 plugins** in marketplace.json: gt-workflow, yellow-browser-test, yellow-chatprd, yellow-ci, yellow-core, yellow-debt, yellow-devin, yellow-linear, yellow-review, yellow-ruvector
- All pass schema validation (`pnpm validate:plugins` ✓)
- Correct `.claude-plugin/plugin.json` structure in every plugin

## Known Issues to Fix

### Phase 1 — Install + Public Repo Readiness

| Issue | Detail |
|-------|--------|
| README install command unverified | Current: `/plugin marketplace add kinginyellow/yellow-plugins` — Reference marketplaces (EveryInc) use full GitHub URL: `/plugin marketplace add https://github.com/...` |
| README only lists 2/10 plugins | gt-workflow + yellow-core documented; 8 more not listed |
| gt-workflow command count wrong | README says 4 commands, directory has 5 |
| No local install docs | Users on dev machine need a way to add plugins without GitHub remote |
| Repo not yet public | Must audit for secrets, private API keys, internal URLs, private content before making public |
| No `.gitignore` / secret check | Verify no credentials, tokens, or private config are committed |

### Phase 2 — Plugin Quality

Per project memory (confirmed best practices):
- Agent `.md` files must be < 120 lines
- Every agent/skill description must include a "Use when..." trigger clause
- Command `allowed-tools` must list every tool used in the body
- All files must use LF line endings (CRLF is a known WSL2 issue)
- Skills use `## Usage` heading (not `## Commands`)

## Approach

**Both sequentially (user-selected):**

### Approach A: Phase 1 First (Install + Public Safety)
Determine exact install commands for both GitHub remote and local path. Audit entire repo for anything that shouldn't be public. Fix README to reflect all 10 plugins accurately. Then make repo public.

**Why first:** A broken install story or accidental secret leak makes everything else moot.

### Approach B: Phase 2 After (Plugin Quality Audit)
Multi-agent review of all 10 plugins. Check each agent file against 2026 best practices. Fix any issues found. Run validation again.

**Why after:** Quality polish only matters once the install story is correct and the repo is safe.

## Key Decisions

- **Install command format**: Use full GitHub HTTPS URL (matches EveryInc/every-marketplace reference)
- **Local install**: Document `--plugin-dir` flag for dev machine use
- **Public safety**: Scan for secrets before Phase 2 (secrets > quality)
- **Audit scope**: All 10 plugins (not just the 2 documented in README)
- **Multi-agent approach**: Run plugin quality reviewers in parallel for efficiency

## Open Questions

- Does `/plugin marketplace add owner/repo` (short form) work, or does it require the full HTTPS URL?
- Is there a local-path install command (e.g., `claude --plugin-dir ./plugins/yellow-core`)?
- Are any plugins (yellow-ruvector, yellow-devin) using third-party services that need credential docs?

## Next Steps

→ `/workflows:plan` to sequence the implementation
