---
name: ruvector:index
description: "Index codebase for semantic search. Use when user says \"index my code\", \"build search index\", \"update embeddings\", \"re-index project\", or wants to enable semantic code search."
argument-hint: '[path]'
allowed-tools:
  - Bash
  - Read
  - Glob
  - ToolSearch
  - AskUserQuestion
  - mcp__plugin_yellow-ruvector_ruvector__hooks_pretrain
  - mcp__plugin_yellow-ruvector_ruvector__hooks_capabilities
---

# Index Codebase

Index source code files for semantic search using ruvector's embedding engine.

## Workflow

### Step 1: Validate Setup

Check `.ruvector/` exists in the project root:

```bash
ls -d .ruvector/ 2>/dev/null
```

If not found, suggest: "Run `/ruvector:setup` first to initialize ruvector."

### Step 2: Determine Scope

- If `$ARGUMENTS` contains a path, validate it exists — then tell the user
  up front: "Note: ruvector's `hooks_pretrain` has no path parameter — it
  always indexes the entire repository. The requested path is used only for
  validation and the file-list preview below." Do not imply scoped indexing
  will occur.
- If empty, index the full repository from project root

### Step 3: Gather File List

Use `git ls-files` to respect `.gitignore`:

```bash
git ls-files -- "${target_path:-.}"
```

If not a git repo, fall back to finding files with Glob.

Filter out:

- Binary files (images, compiled output, archives)
- Minified files (`*.min.js`, `*.min.css`)
- Files > 1MB
- Directories: `node_modules/`, `vendor/`, `.git/`, `dist/`, `build/`,
  `.ruvector/`
- Patterns in `.ruvectorignore` (if it exists)

### Step 4: Index via MCP

1. Call ToolSearch with query `"hooks_pretrain"`. If not found, report that
   ruvector indexing is unavailable and stop.
2. Warmup: call `mcp__plugin_yellow-ruvector_ruvector__hooks_capabilities()`.
   If it errors, report that ruvector MCP is unavailable and stop.
3. Call `mcp__plugin_yellow-ruvector_ruvector__hooks_pretrain`. The tool
   takes no file-list or path parameter — it analyzes repository structure
   and git history itself from the project root, repository-wide, even when
   a path argument was given (per the Step 2 disclosure). The Step 3 file
   list is preview/validation display only; it is not passed to the tool,
   and progress/summary output must describe repository-wide indexing — do
   not present per-path counts as if only the requested path was indexed.
4. If the MCP call errors with timeout, connection refused, or service
   unavailable: wait approximately 500 milliseconds and retry exactly once.
   If the retry also fails, report the failure and stop.

Use `hooks_pretrain` as the authoritative bulk-indexing path. Do not document
manual `hooks_remember` indexing flows that rely on unsupported metadata or
namespace parameters.

Show progress: "Indexing 142/350 files..."

### Step 5: Report Results

Display summary:

- Files indexed
- Chunks/vectors created
- Time taken
- Any files skipped (with reasons)

Suggest: "Run `/ruvector:search <query>` to try semantic search."

## Error Handling

See `ruvector-conventions` skill for error catalog (MCP server down, disk full,
timeout, permission denied).

### Specific Errors

- **No files to index:** "No indexable files found. Check your path or
  .ruvectorignore."
- **Large repo (>5000 files):** Use AskUserQuestion to confirm before
  proceeding. Suggest indexing a subdirectory first.
- **Interrupted:** Report progress so far. Re-running re-indexes all files
  through `hooks_pretrain`.
