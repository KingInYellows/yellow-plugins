---
name: devin:wiki
description: Query DeepWiki or Devin Wiki about a GitHub repository's indexed wiki. Use when user asks "how does X work in repo Y", "explain the architecture of <repo>", or wants AI-generated docs for a codebase (defaults to the origin repo when --repo is omitted). Not for quick questions answerable by reading the local code directly — use Grep/semantic search for those.
argument-hint: '<question> [--repo owner/repo]'
allowed-tools:
  - Bash
  - Skill
  - ToolSearch
  - AskUserQuestion
  - mcp__plugin_yellow-research_deepwiki__ask_question
  - mcp__plugin_yellow-research_deepwiki__read_wiki_structure
  - mcp__plugin_yellow-research_deepwiki__read_wiki_contents
  - mcp__plugin_yellow-devin_deepwiki__ask_question
  - mcp__plugin_yellow-devin_deepwiki__read_wiki_structure
  - mcp__plugin_yellow-devin_deepwiki__read_wiki_contents
  - mcp__plugin_yellow-devin_devin__ask_question
  - mcp__plugin_yellow-devin_devin__read_wiki_structure
  - mcp__plugin_yellow-devin_devin__read_wiki_contents
---

# Query Repository Documentation

Search DeepWiki or Devin Wiki for documentation about a repository's
architecture, patterns, and implementation details.

**DeepWiki ownership moved:** the DeepWiki MCP server now ships with the
`yellow-research` plugin, not `yellow-devin`. This command keeps working
for backward compatibility — it discovers the right DeepWiki tools at
runtime (see Step 3) — but for new setups the canonical way to query
DeepWiki directly is via `yellow-research` (`/research:setup` reports its
status). The Devin Wiki path below is unaffected; it stays owned by
`yellow-devin`.

## Workflow

### Step 1: Parse Arguments

Parse `$ARGUMENTS` for:

- **Question:** The main query text
- **`--repo owner/repo`:** Optional repository override

If no question provided, ask the user what they want to know.

### Step 2: Determine Repository

- If `--repo` flag provided, set `REPO` to that value
- Otherwise, detect from current git remote and assign to `REPO`:

  ```bash
  REPO=$(git remote get-url origin 2>/dev/null | sed -E 's#^.*(://|@)[^/:]+[:/]##; s#\.git$##')
  ```
- If no repository can be determined, ask the user

### Step 3: Query Wiki

**Primary: Try Devin MCP first** (supports both public and private repos):

Call the Devin MCP tools pinned in `allowed-tools`
(`mcp__plugin_yellow-devin_devin__*`):

- `ask_question` with the repository and question for AI-powered answers
- `read_wiki_structure` to browse the wiki page tree if more context is needed
- `read_wiki_contents` for specific page details

**Note on V3 auth:** The Devin MCP server at `mcp.devin.ai` may use
`DEVIN_SERVICE_USER_TOKEN` (`cog_` prefix) or a separate auth mechanism. If MCP
calls fail with auth errors, announce the fallback to DeepWiki.

**Fallback: If Devin MCP fails**, announce the fallback explicitly:

"Devin Wiki unavailable — falling back to DeepWiki (public repos only)."

Determine visibility with
`gh repo view "$REPO" --json isPrivate -q .isPrivate 2>/dev/null`:

- If repo is private (`true`): report "Cannot query private repos via
  DeepWiki. Check that Devin MCP is configured correctly."
- If repo is public (`false`): discover the DeepWiki tools before calling
  anything — DeepWiki's plugin home changed, so the tool name is no longer
  a static pin. Use ToolSearch with keyword `read_wiki_structure`:
  - If `mcp__plugin_yellow-research_deepwiki__*` is found, use it — this is
    the canonical home for DeepWiki as of yellow-research's bundling of the
    server.
  - Else if `mcp__plugin_yellow-devin_deepwiki__*` is found, use it and
    note in the output: "Using yellow-devin's bundled DeepWiki server —
    newer yellow-devin releases no longer ship it; install or enable
    yellow-research to keep DeepWiki working after upgrading."
  - Else, do not attempt the query. Report: "DeepWiki now ships with the
    yellow-research plugin — install/enable yellow-research."
- If the lookup fails (`gh` missing, unauthenticated, network error) —
  visibility is unknown: do NOT query DeepWiki silently, since the repo
  identifier and question would go to a third-party service that only
  serves public repos. Ask the user to confirm the repository is public
  (or authenticate `gh`) before falling back.

**Important:** The Devin MCP tool names are pinned in this command's
`allowed-tools` frontmatter and called directly — no discovery needed for
that path. The DeepWiki tool names are NOT pinned to a single source
anymore (see the ToolSearch discovery above); both the `yellow-research`-
and `yellow-devin`-qualified DeepWiki names are declared in
`allowed-tools` so either can be called once discovered.

### Step 4: Present Results

Display the wiki response:

- Architecture overview (if applicable)
- Relevant code patterns
- Key files and their purposes
- Source links for further reading

Keep results focused and actionable — summarize rather than dumping raw wiki
content.

## Error Handling

- If both Devin MCP and DeepWiki MCP fail, report the error and suggest checking
  network connectivity
- Never silently fall back — always announce which data source is being used
