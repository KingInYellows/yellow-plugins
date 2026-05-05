---
name: memory-remember-pattern
description: "Tiered-Remember-After-Act pattern for ruvector — record learnings via hooks_remember at workflow completion with signal-strength tiers (Auto/Prompted/Skip). Use when authoring commands that should compound institutional memory from workflow outcomes."
user-invokable: false
---

# Pattern: Tiered-Remember-After-Act

Record learnings to ruvector memory after workflow completion, with signal
strength determining whether to record automatically, prompt the user, or skip.

## What It Does

Calls `hooks_remember` against the ruvector MCP server at workflow end, with
content classified by signal strength (Auto/Prompted/Skip) per plugin and
event type. Includes a near-duplicate dedup check (score > 0.82) and quality
gates on content length and structure.

## When to Use

When authoring a command that produces durable insight worth surfacing in
future sessions — root causes, security findings, novel solutions, decision
rationale. Skip for low-signal events (status checks, passing tests, plan
context already captured in files).

## Usage

> **Design reference.** Each command adapts the signal classification and
> dedup strategy to its own workflow outcomes. When updating tier rules,
> dedup windows, or the signal classification table, update this document
> AND all consuming commands:
> `plugins/yellow-core/commands/workflows/brainstorm.md`,
> `plugins/yellow-core/commands/workflows/plan.md`,
> `plugins/yellow-core/commands/workflows/compound.md`,
> `plugins/yellow-core/commands/workflows/work.md`,
> `plugins/yellow-review/commands/review/review-pr.md`,
> `plugins/yellow-review/commands/review/resolve-pr.md`,
> `plugins/yellow-review/commands/review/review-all.md` (allowed-tools only
> — no inline steps), and `plugins/yellow-ruvector/commands/ruvector/learn.md`.
>
> (`plugins/yellow-ruvector/commands/ruvector/memory.md` is read-only and only
> calls `hooks_recall` — see `memory-recall-pattern` skill instead.)

### Signal Classification Table

| Tier | Signal Strength | Behavior |
|---|---|---|
| **Auto** | High | Record via hooks_remember without asking |
| **Prompted** | Medium | Ask user via AskUserQuestion: "Save this learning to memory?" |
| **Skip** | Low | Silent no-op |

**Classification by plugin and event type:**

| Plugin | Auto (high-signal) | Prompted (medium-signal) | Skip (low-signal) |
|---|---|---|---|
| yellow-review | P0/P1 security/correctness findings | P2 design/performance findings | P3 style/nits |
| yellow-ci | Root cause identified | Workaround found | Status checks |
| yellow-debt | Security debt patterns | Complexity/duplication hotspots | Minor style debt |
| yellow-browser-test | Critical bugs (crash, data loss) | UI issues | Passing test summaries |
| yellow-core (work) | Implementation insights | — | — |
| yellow-core (compound) | All (user already opted in) | — | — |
| yellow-core (brainstorm) | — | Decision rationale | — |
| yellow-core (plan) | — | — | Plan context (already in file) |
| yellow-research | — | Novel findings | — |
| yellow-devin | — | Delegation failures | — |
| yellow-linear | — | — | Issue patterns |
| yellow-chatprd | — | — | PRD decisions (already in doc) |
| gt-workflow | — | — | Stack info |

### Quality Requirements

All remembered content must meet these gates:

- **Length:** 20+ words
- **Structure (all three required):**
  - **Context:** What was built/fixed and where (file paths, commands)
  - **Insight:** Why a key decision was made or what failed
  - **Action:** Concrete steps for a future agent in the same situation
- **Specificity:** Name concrete files, commands, or error messages.
  "Fixed CRLF in hooks.sh by running `sed -i 's/\r$//'`" not "Fixed a bug"

### Type Guidance

| Type | Use for |
|---|---|
| `decision` | Successful patterns, techniques, conventions |
| `context` | Mistakes, failures, and their fixes |
| `project` | Session summaries, high-level outcomes |
| `code` | Code-specific implementation notes |
| `general` | Fallback when none of the above fit cleanly |

### Deduplication Check

Before storing, check for near-duplicates:

```text
1. Call hooks_recall(query=content, top_k=1)
2. If score > 0.82: skip ("near-duplicate exists")
3. If hooks_recall errors (timeout, connection refused, service
   unavailable): wait approximately 500 milliseconds, retry exactly
   once. If retry also fails: skip dedup check, proceed to store.
   Do NOT retry on validation errors or parameter errors.
```

### Execution

```text
1. If .ruvector/ does not exist: skip
2. Call ToolSearch("hooks_remember"). If not found: skip
3. Classify signal tier using the table above
4. If Auto: call hooks_remember(content, type) directly
5. If Prompted: AskUserQuestion "Save this learning to memory?" with
   preview of the content. Record if confirmed.
6. If Skip: no-op
7. If hooks_remember errors (timeout, connection refused, or service
   unavailable): wait approximately 500 milliseconds, retry exactly
   once. If retry also fails: note "[ruvector] Warning: remember
   failed after retry — learning not persisted" and continue.
   Do NOT retry on validation errors or parameter errors.
```

Note: If `memory-recall-pattern` already ran earlier in the same session,
the MCP server is warm and the warmup step is not needed before this
pattern. Only add a warmup call before this pattern if it runs in a
workflow that does not use `memory-recall-pattern` (e.g.,
`/workflows:compound`).

## Anti-Patterns

- **Do not** omit the dedup check before hooks_remember
- **Do not** remember low-signal events (status checks, passing tests, style nits)
- **Do not** omit the `hooks_remember` execution-error handler — ToolSearch
  passing does not mean the MCP server is running

## Related

- `memory-recall-pattern` — query past learnings at workflow start.
- `morph-discovery-pattern` — discover morph tools at runtime.
