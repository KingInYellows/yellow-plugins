---
date: 2026-02-22
topic: yellow-core-compound-command
status: Decided
approach: Port + Smart Routing (Approach A)
---

# yellow-core `/workflows:compound` Command

## What We're Building

A `/workflows:compound` command for yellow-core that captures solutions while
context is fresh. Triggered manually after solving a non-trivial problem in any
session (not just PR reviews). The command uses parallel subagents to extract
the solution thoroughly, then routes the output to the right place — MEMORY.md
for recurring patterns, `docs/solutions/` for deep technical references, or
both.

This fills two gaps:
1. **No manual trigger** — currently compounding only happens automatically via
   `learning-compounder` after PR reviews. Ad-hoc session solutions go
   undocumented unless written manually.
2. **yellow-core completeness** — compound-engineering's version exists but uses
   Rails-specific reviewers and no MEMORY.md routing.

## Why This Approach

Approach A (Port + Smart Routing) was chosen over a single-agent lightweight
version because:
- compound-engineering's 5-parallel-agent Phase 1 structure exists for a reason:
  solo agents underextract. Prevention strategies and cross-references
  consistently get dropped in single-agent extraction.
- The routing decision (MEMORY.md vs docs/solutions/ vs both) is a small
  addition to Phase 1's Context Analyzer output — low cost, high value.
- Yellow-core becomes self-contained: no dependency on compound-engineering
  being installed.

## Key Decisions

### 1. Routing Logic (B-style)

Context Analyzer outputs a routing decision alongside YAML skeleton:

| Pattern type | Destination |
|---|---|
| Recurring/class-of-mistake (will recur) | MEMORY.md entry only |
| Deep technical solution (one-time, complex) | `docs/solutions/` only |
| Recurring AND complex | Both: solution doc + MEMORY.md entry pointing to it |

MEMORY.md entries: max 5–7 lines + link to solution doc if one exists.

### 2. Phase 1: 5 Parallel Agents (identical structure to compound-engineering)

- **Context Analyzer** — extracts problem type, symptoms, routing decision
- **Solution Extractor** — root cause + working fix with code examples
- **Related Docs Finder** — searches `docs/solutions/` for cross-references
- **Prevention Strategist** — recurring patterns, how to avoid next time
- **Category Classifier** — optimal `docs/solutions/` category + filename

All return text data only — no file writes.

### 3. Phase 2: Orchestrator Assembly

Waits for all Phase 1 agents, assembles, writes:
- `docs/solutions/<category>/<slug>.md` (if routing says so)
- Appends to `~/.claude/projects/.../memory/MEMORY.md` (if routing says so)

### 4. Phase 3: Optional Enhancement (yellow-core agents)

Based on problem type, invoke yellow-core-specific specialists:

| Problem type | Agent |
|---|---|
| Security issue | `security-sentinel` |
| Performance issue | `performance-oracle` |
| Architecture/pattern | `architecture-strategist` |
| Code quality | `code-simplicity-reviewer` |
| Any code-heavy | `polyglot-reviewer` |

No Rails-specific agents (kieran-rails-reviewer, cora-test-reviewer,
data-integrity-guardian are compound-engineering specifics).

### 5. Solution Doc Format

Same YAML frontmatter + structure as existing `docs/solutions/` files:
- `title`, `date`, `category` in frontmatter
- Sections: Problem, Detection, Fix, Prevention

### 6. Auto-invoke Triggers

Same trigger phrases as compound-engineering: "that worked", "it's fixed",
"working now", "problem solved" — but advisory only (user confirms before
running).

## Open Questions

- Should the command also update MEMORY.md for the project when it writes a
  solution doc? (Currently MEMORY.md entries are written manually inline.)
- Should Phase 3 be opt-in (only runs if user confirms) or auto-triggered?

## Next Steps

→ `/workflows:plan` to create the implementation plan for:
1. `plugins/yellow-core/commands/workflows/compound.md`
2. Update `plugins/yellow-core/CLAUDE.md` to document the command
3. Update `plugins/yellow-core/.claude-plugin/plugin.json` commands list
