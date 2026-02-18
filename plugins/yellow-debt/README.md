# yellow-debt

Technical debt audit and remediation plugin for Claude Code.

## Overview

The `yellow-debt` plugin runs comprehensive technical debt audits using 5
parallel specialized scanner agents, produces prioritized markdown reports with
actionable todo files, and provides remediation workflows including interactive
triage, agent-driven fixes, and Linear issue sync.

## Problem

AI coding tools generate functional code that accumulates technical debt through
patterns invisible to traditional linting:

- **Excessive commenting** that inflates cognitive load
- **By-the-book implementations** ignoring domain-specific context
- **Refactoring avoidance** — no method extraction or consolidation
- **Over-specification** of edge cases that never occur in practice
- **Bugs déjà-vu** — same bugs replicated across files

## Solution

**Scanner Fleet Architecture** — 5 parallel specialized agents that analyze your
codebase:

1. **AI Pattern Scanner** — Detects AI-specific anti-patterns (excessive
   comments, boilerplate, over-specification)
2. **Complexity Scanner** — Finds high cyclomatic/cognitive complexity, deep
   nesting, god functions
3. **Duplication Scanner** — Identifies code duplication and near-duplicates
4. **Architecture Scanner** — Detects circular dependencies, boundary
   violations, god modules
5. **Security Debt Scanner** — Finds security-related technical debt (not active
   vulnerabilities)

## Commands

### `/debt:audit [path] [--category <name>] [--severity <level>]`

Run a comprehensive or targeted technical debt audit.

```bash
# Full codebase audit
/debt:audit

# Audit specific directory
/debt:audit src/

# Run only complexity scanner
/debt:audit --category complexity

# Filter to high severity findings
/debt:audit --severity high
```

**Output:**

- Audit report at `docs/audits/YYYY-MM-DD-audit-report.md`
- Todo files at `todos/debt/NNN-pending-SEVERITY-slug.md`

### `/debt:triage [--category <name>] [--priority <level>]`

Interactively review and prioritize pending findings.

```bash
# Triage all pending findings
/debt:triage

# Triage only complexity findings
/debt:triage --category complexity

# Triage high priority findings
/debt:triage --priority p1
```

**Actions:** Accept (→ ready), Reject (→ deleted), Defer (→ deferred with
reason)

### `/debt:fix <path>`

Agent-driven remediation of a specific finding with human approval.

```bash
# Fix a specific todo
/debt:fix todos/debt/042-ready-high-complexity.md
```

**Safety:** Shows diff and requires explicit approval before committing.

### `/debt:status [--json]`

Dashboard of current debt levels.

```bash
# View dashboard
/debt:status

# Machine-readable output
/debt:status --json
```

### `/debt:sync [--team <name>] [--project <name>]`

Push accepted findings to Linear as issues.

```bash
# Sync all ready findings to Linear
/debt:sync

# Override team/project
/debt:sync --team Engineering --project Tech-Debt
```

**Requirements:** yellow-linear plugin must be installed.

## Workflow

1. **Run audit**: `/debt:audit` to scan your codebase
2. **Review findings**: `/debt:triage` to accept/reject/defer
3. **Fix issues**: `/debt:fix <path>` for agent-assisted remediation
4. **Track progress**: `/debt:status` to see current state
5. **Sync to Linear**: `/debt:sync` for team visibility

## Todo File Format

Each finding becomes a todo file with:

```markdown
---
id: '042'
status: pending
priority: p2
category: complexity
severity: high
effort: small
scanner: complexity-scanner
audit_date: '2026-02-13'
affected_files:
  - src/services/user-service.ts:45-89
linear_issue_id: null
deferred_until: null
deferred_reason: null
content_hash: 'a3f2b1c4'
---

# High Cyclomatic Complexity in UserService

## Finding

[Description of the issue]

## Context

[Code snippet]

## Suggested Remediation

[How to fix it]

## Effort Estimate

**Small** (30min-2hr): Extract 2-3 methods, flatten nesting.
```

## State Machine

```
pending → ready/deleted/deferred
ready → in-progress/deleted
in-progress → complete/ready
deferred → pending
```

All state transitions are atomic and TOCTOU-safe via `flock`.

## Dependencies

- **Required**: git, jq, yq, realpath, flock, Graphite CLI (gt)
- **Optional**: yellow-linear plugin (for `/debt:sync`)

**Note on yq**: This plugin is compatible with kislyuk/yq (Python-based YAML
processor). Todo files are markdown with YAML frontmatter, which requires
special handling via the `extract_frontmatter()` and `update_frontmatter()`
helpers in `lib/validate.sh`. These functions extract the YAML section before
passing to yq, ensuring compatibility across different yq implementations.

## Installation

```bash
# Install from marketplace
/plugin marketplace add KingInYellows/yellow-plugins

# Enable yellow-debt
/plugin enable yellow-debt
```

## Configuration

No configuration required. Optional Linear sync settings stored in
`.debt/linear-config.json`.

## Security

- All path arguments validated (rejects `..`, `/`, `~`)
- Scanner agents include prompt injection fencing
- Fix agent requires human approval before commits
- State transitions are atomic with file locks
- Scanner outputs excluded from version control

## Performance

- **File enumeration**: 10K files in 5-10 seconds (extension-based filtering)
- **Deduplication**: 1000 findings in <1 second (O(n log n) algorithm)
- **Query performance**: 1000 findings in 10-15 seconds (optimized), 1-2 seconds
  (cached)
- **Parallel scanners**: All 5 run concurrently
- **Partial results**: Continues even if scanners fail (≤50% threshold)
- **Total audit time**: 30-60 minutes for large codebases (LLM scanner latency
  dominates)

## Known Limitations

- Scanners are LLM-based, not deterministic static analysis
- Large codebases (100K+ LOC) require chunking
- Fix agent modifies working directory — commit/stash first
- Concurrent audits not supported (single-user CLI)

## Error Recovery

If a scanner fails:

1. Check `.debt/scanner-output/<scanner>.json` for error details
2. Re-run with `--category <name>` to retry that scanner
3. Partial results still available from successful scanners

If synthesis fails:

1. Scanner outputs preserved in `.debt/scanner-output/`
2. Re-run `/debt:audit` to retry synthesis
3. Check logs for specific error messages

## License

MIT
