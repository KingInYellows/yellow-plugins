# Brainstorm: AST-Grep Integration Across the Yellow-Plugins Ecosystem

**Date:** 2026-03-16
**Status:** Brainstorm complete, ready for planning
**Approach:** Setup-first, then selective agent expansion (two PRs)

## What We're Building

Two workstreams to make AST-Grep a reliable, well-used tool across the
yellow-plugins ecosystem:

**Workstream 1 — Fix the installation pipeline (PR 1):**

The current `install-ast-grep.sh` script and `research:setup` flow install the
`ast-grep` binary correctly, but the ast-grep MCP server fails to start on most
machines because it requires Python >= 3.13 (via `uvx` from the upstream
`ast-grep-mcp` project). Most developer machines run Python 3.10-3.12. The fix:
have `uv` manage Python 3.13 in its own cache transparently, install `uv` as
part of setup if missing, and add a full MCP smoke test that proves the entire
chain works (uvx -> Python 3.13 -> ast-grep-server -> ast-grep binary ->
result).

**Workstream 2 — Expand ast-grep usage to high-value agents (PR 2):**

Currently only yellow-research agents (code-researcher, research-conductor) use
the ast-grep MCP tools. Four agents in yellow-review and yellow-debt would
materially benefit from structural code search:

1. **silent-failure-hunter** (yellow-review) — detecting swallowed errors,
   empty catch blocks, and silent return patterns is far more precise with AST
   matching than regex
2. **duplication-scanner** (yellow-debt) — structural token comparison for
   near-duplicate detection (Type-3 clones) is the exact use case ast-grep was
   built for
3. **complexity-scanner** (yellow-debt) — counting nesting depth, branch
   complexity, and function size is more accurate with AST traversal than
   line-counting heuristics
4. **type-design-analyzer** (yellow-review) — matching type annotation
   patterns, interface shapes, and generic constraints requires structural
   understanding

These agents gain the ast-grep tools as a soft dependency with graceful
degradation: they use ToolSearch at runtime to check if
`mcp__plugin_yellow-research_ast-grep__find_code` is available. If
yellow-research is not installed or ast-grep is not working, they fall back to
their current Grep-based workflow unchanged.

## Why This Approach

**Setup-first because the install is the actual blocker.** No agent can benefit
from ast-grep if the MCP server fails to start on Python 3.12. Fixing the
installation pipeline removes the gate for all downstream usage. The `uv`
managed Python approach is clean: `uvx` already supports auto-downloading
Python versions into its own cache (`~/.local/share/uv/python/`), so the
system Python is never touched. The install script just needs to ensure `uv` is
present and let `uvx --python 3.13` handle the rest.

**Selective agent expansion because not every agent benefits.** AST structural
search is powerful but adds latency and complexity. Only agents whose core
detection heuristics are fundamentally improved by structural matching get the
tools. The code-reviewer agent, for example, does broad quality checks where
regex is sufficient. The 4 selected agents perform pattern detection where the
difference between "matches text that looks like a catch block" and "matches an
actual empty catch block in the AST" is the difference between false positives
and accurate findings.

**Autonomous agent decision-making because the agent knows best.** Each agent
gets prompt guidance about when AST search beats regex (function signatures,
control flow patterns, type annotations = AST; string literals, comments,
simple text = Grep). The agent checks availability via ToolSearch and decides
per-query. No orchestrator routing needed.

## Key Decisions

1. **Cross-plugin access model: soft dependency with graceful degradation.**
   Review and debt agents list ast-grep MCP tools in their `tools:` frontmatter.
   At runtime they use ToolSearch to check if the tools exist. If
   yellow-research is not installed, they silently fall back to Grep. This means
   yellow-review and yellow-debt do not take a hard dependency on
   yellow-research.

2. **Python version management: `uv` manages Python 3.13 transparently.** The
   install script ensures `uv` is installed (via `curl -LsSf
   https://astral.sh/uv/install.sh | sh`), then `uvx` auto-downloads Python
   3.13 into its managed cache. The system Python is never modified. This
   removes the Python >= 3.13 gate that blocks most machines. The
   `research:setup` command and `setup:all` dashboard should stop checking
   system Python version for ast-grep and instead rely on the smoke test.

3. **Post-install validation: full MCP smoke test.** After installation,
   `research:setup` does not just check for the binary (`sg --version`). It
   runs a ToolSearch probe for `ast-grep__find_code`, and if found, executes a
   real `find_code` call with a trivial pattern (e.g., `function $NAME() {}` in
   JavaScript) to prove the entire chain works. This catches MCP server startup
   failures, Python version mismatches, and uvx cache issues that binary-only
   checks miss.

4. **Only 4 agents get ast-grep tools.** Not a blanket addition. The selected
   agents are: silent-failure-hunter, duplication-scanner, complexity-scanner,
   type-design-analyzer. Each gets tailored prompt guidance about when to use
   `find_code`/`find_code_by_rule` vs Grep.

5. **Two-PR delivery.** PR 1 fixes the setup pipeline (install script, setup
   commands, dashboard checks). PR 2 adds ast-grep tools to the 4 agents. PR 2
   depends on PR 1 being merged and validated.

## Files Affected

### PR 1 — Setup pipeline fixes

- `plugins/yellow-research/scripts/install-ast-grep.sh` — add `uv`
  installation, remove Python 3.13 system check, ensure `uvx` can manage its
  own Python
- `plugins/yellow-research/commands/research/setup.md` — update Step 0 to
  install `uv` if missing, update Step 1 to remove `python313_check` for
  ast-grep, update Step 3.5 ast-grep MCP health check to be the full smoke
  test (real `find_code` call, not just ToolSearch probe)
- `plugins/yellow-research/CLAUDE.md` — update Prerequisites section to reflect
  that `uv` manages Python (not a system requirement)
- `plugins/yellow-core/commands/setup/all.md` — update dashboard to check for
  `uv` instead of `python313_check` for ast-grep readiness; update
  yellow-research classification logic

### PR 2 — Agent ast-grep expansion

- `plugins/yellow-review/agents/review/silent-failure-hunter.md` — add
  ast-grep tools to `tools:` list, add AST vs Grep routing guidance
- `plugins/yellow-review/agents/review/type-design-analyzer.md` — add
  ast-grep tools to `tools:` list, add type pattern matching guidance
- `plugins/yellow-debt/agents/scanners/duplication-scanner.md` — add ast-grep
  tools to `tools:` list, add structural clone detection guidance
- `plugins/yellow-debt/agents/scanners/complexity-scanner.md` — add ast-grep
  tools to `tools:` list, add AST nesting/branching analysis guidance

## Open Questions

- **Which ast-grep tools per agent?** All 4 agents probably need `find_code`
  and `find_code_by_rule`. Do any need `dump_syntax_tree` or
  `test_match_code_rule`? The duplication-scanner might benefit from
  `dump_syntax_tree` for structural comparison. Decide during planning.

- **Should `setup:all` install `uv` proactively?** Currently `setup:all`
  delegates to `research:setup` which handles `uv` installation. Should
  `setup:all` pre-install `uv` in its dashboard phase since it is also used by
  yellow-semgrep and potentially other future plugins? Or keep it scoped to
  `research:setup` only?

- **ast-grep MCP pin update?** The current MCP server is pinned to a specific
  git commit (`674272f`). Should we check if a newer version has lowered the
  Python requirement or added features? This could be moot if `uv` manages the
  Python version, but worth checking during implementation.

- **Prompt guidance specificity.** How detailed should the AST vs Grep routing
  guidance be in each agent? A general 2-3 sentence guideline, or a detailed
  table like the one in code-researcher.md? Decide per-agent during planning
  based on the agent's detection heuristics.
