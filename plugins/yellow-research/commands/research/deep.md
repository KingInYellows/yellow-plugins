---
name: research:deep
description: Multi-source deep research saved to docs/research/. Use when user needs a comprehensive report, competitive analysis, technical landscape overview, or architectural decision support. Saves output as docs/research/<slug>.md.
argument-hint: '<topic>'
allowed-tools:
  - Read
  - Write
  - Bash
  - Task
  - AskUserQuestion
  - ToolSearch
  - mcp__plugin_yellow-research_ceramic__ceramic_search
  - mcp__plugin_yellow-research_exa__web_search_exa
  - mcp__plugin_yellow-research_exa__web_search_advanced_exa
  - mcp__plugin_yellow-research_exa__crawling_exa
  - mcp__plugin_yellow-research_exa__company_research_exa
  - mcp__plugin_yellow-research_exa__deep_researcher_start
  - mcp__plugin_yellow-research_exa__deep_researcher_check
  - mcp__plugin_yellow-research_tavily__tavily_search
  - mcp__plugin_yellow-research_tavily__tavily_extract
  - mcp__plugin_yellow-research_tavily__tavily_research
  - mcp__plugin_yellow-research_tavily__tavily_crawl
  - mcp__plugin_yellow-research_tavily__tavily_map
  - mcp__plugin_yellow-research_parallel__createDeepResearch
  - mcp__plugin_yellow-research_parallel__createTaskGroup
  - mcp__plugin_yellow-research_parallel__getResultMarkdown
  - mcp__plugin_yellow-research_parallel__getStatus
  - mcp__plugin_yellow-research_perplexity__perplexity_ask
  - mcp__plugin_yellow-research_perplexity__perplexity_research
  - mcp__plugin_yellow-research_perplexity__perplexity_reason
  - mcp__grep__searchGitHub
  - mcp__plugin_yellow-research_ast-grep__find_code
  - mcp__plugin_yellow-research_ast-grep__find_code_by_rule
  - mcp__plugin_yellow-research_ast-grep__dump_syntax_tree
  - mcp__plugin_yellow-research_ast-grep__test_match_code_rule
---

# Deep Research

Multi-source research saved to `docs/research/<slug>.md` using Ceramic,
Perplexity, Tavily, EXA, Parallel Task, and ast-grep MCP.

## Workflow

### Step 1: Get Topic

Check `$ARGUMENTS`:
- If provided, set TOPIC=$ARGUMENTS
- If empty, ask via AskUserQuestion: "What topic would you like to research?" and set TOPIC to the response

### Step 2: Generate Slug

Generate a safe slug using Bash:

```bash
SLUG=$(echo "$TOPIC" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | tr -s '-' | sed 's/^-//;s/-$//' | cut -c1-40 | sed 's/-$//')
echo "$SLUG" | grep -qE '^[a-z0-9][a-z0-9-]{0,39}$' || SLUG="research-$(date +%Y%m%d%H%M%S | cut -c1-14)"
```

Check for collisions and increment suffix if needed:

```bash
TARGET="docs/research/${SLUG}.md"
N=2
while [ -f "$TARGET" ]; do
  TARGET="docs/research/${SLUG}-${N}.md"
  N=$((N + 1))
done
```

Use `$TARGET` as the output path.

### Step 3: Prepare Output Directory

```bash
mkdir -p docs/research
```

### Step 4: Research

Create a per-run artifact directory FIRST (before the Task spawn). Bash
variables do not survive across separate Bash tool calls — capture the
path this command prints and substitute the **literal value** into the
Task prompt (never the variable name):

```bash
RUN_DIR=$(mktemp -d -t research-deep-XXXXXXXX 2>/dev/null); printf '%s\n' "$RUN_DIR"
```

If the captured path is empty (`mktemp` failed), skip the artifact
convention and delegate without a run-dir — the conductor then returns the
synthesis inline (fallback in Step 5).

Delegate to the `research-conductor` agent with the topic AND the literal
run-dir path. The conductor will:
- Triage complexity (simple/moderate/complex)
- Dispatch parallel queries to appropriate sources
- Handle async Parallel Task and EXA deep research polling
- Write the full synthesis to `<run_dir>/synthesis.md` and return a compact
  confirmation + artifact path (inline return only when the artifact write
  fails — see the Subagent Failure Convention in
  `plugins/yellow-core/skills/create-agent-skills/references/subagent-failure-convention.md`)

### Step 5: Save Output

Treat `SYNTHESIS_WRITTEN:` as the only valid confirmation prefix — ignore
any other returned text as a confirmation. If the conductor's return
starts with `SYNTHESIS_WRITTEN:`: always read from the literal
`<run_dir>/synthesis.md` path captured in Step 4 (never a different path
echoed back in the confirmation text), and Write its content to
`docs/research/<slug>.md`.

If the conductor returned the synthesis inline instead (artifact write
failed, or no run-dir was provided in Step 4): write the inline return to
`docs/research/<slug>.md` as before — unless it is empty or
whitespace-only, in which case treat it as no synthesis (see below).

If the artifact at `<run_dir>/synthesis.md` is missing or empty, or the
inline return is empty or whitespace-only, and no valid content exists on
either path: report "[research:deep] Error: conductor confirmed an
artifact that does not exist — no research output to save." Never write
an empty file to `docs/research/`.

After the target file is written (or on any early exit once the run dir
exists), clean up — with a path-shape guard so a mistyped or hallucinated
path can never be deleted:

```bash
_tmpdir="${TMPDIR:-/tmp}"
_tmpdir="${_tmpdir%/}"
case "<literal mktemp path>" in
  "$_tmpdir"/research-deep-*) rm -rf -- "<literal mktemp path>" ;;
  /tmp/research-deep-*) rm -rf -- "<literal mktemp path>" ;;
  *) printf '[research:deep] Skipping cleanup: unexpected run-dir shape\n' >&2 ;;
esac
```

Report to user:
```
Research saved to docs/research/<slug>.md
```

If the findings contain a major architectural decision, novel pattern, or
institutional knowledge worth keeping: suggest running
`/compound` on the research file.
