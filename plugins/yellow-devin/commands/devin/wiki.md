---
name: devin:wiki
description: Query DeepWiki or Devin Wiki about a repository. Use when user asks "how does X work in repo Y", "explain the architecture of Z", "search docs for", or wants to understand an external codebase.
argument-hint: '<question> [--repo owner/repo]'
allowed-tools:
  - Bash
  - Skill
  - ToolSearch
  - AskUserQuestion
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

## Workflow

### Step 1: Parse Arguments

Parse `$ARGUMENTS` for:

- **Question:** The main query text
- **`--repo owner/repo`:** Optional repository override

If no question provided, ask the user what they want to know.

### Step 2: Determine Repository

- If `--repo` flag provided, use that repository
- Otherwise, detect from current git remote:
  ```bash
  git remote get-url origin 2>/dev/null | sed -E 's#^.*(://|@)[^/:]+[:/]##; s#\.git$##'
  ```
- If no repository can be determined, ask the user

### Step 3: Query Wiki

**Primary: Try Devin MCP first** (supports both public and private repos):

Use ToolSearch to discover available Devin MCP tools, then call:

- `ask_question` with the repository and question for AI-powered answers
- `read_wiki_structure` to browse the wiki page tree if more context is needed
- `read_wiki_contents` for specific page details

**Note on V3 auth:** The Devin MCP server at `mcp.devin.ai` may use
`DEVIN_SERVICE_USER_TOKEN` (`cog_` prefix) or a separate auth mechanism. If MCP
calls fail with auth errors, announce the fallback to DeepWiki.

**Fallback: If Devin MCP fails**, announce the fallback explicitly:

"Devin Wiki unavailable — falling back to DeepWiki (public repos only)."

- If repo is private: report "Cannot query private repos via DeepWiki. Check
  that Devin MCP is configured correctly."
- If repo is public: use DeepWiki MCP tools (`ask_question`,
  `read_wiki_structure`, `read_wiki_contents`)

**Important:** MCP tool names follow the pattern
`mcp__plugin_{pluginName}_{serverName}__{toolName}`. Verify exact names via
ToolSearch during first use — the actual registered names may differ.

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
