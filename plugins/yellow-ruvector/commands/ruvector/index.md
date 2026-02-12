---
name: ruvector:index
description: >
  Index codebase for semantic search. Use when user says "index my code",
  "build search index", "update embeddings", "re-index project", or wants
  to enable semantic code search.
argument-hint: "[path]"
allowed-tools:
  - Bash
  - Read
  - Glob
  - ToolSearch
  - AskUserQuestion
  - mcp__plugin_yellow-ruvector_ruvector__vector_db_insert
  - mcp__plugin_yellow-ruvector_ruvector__vector_db_create
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

- If `$ARGUMENTS` contains a path, index only that path
- If empty, index the full repository from project root
- Validate the path exists before proceeding

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
- Directories: `node_modules/`, `vendor/`, `.git/`, `dist/`, `build/`, `.ruvector/`
- Patterns in `.ruvectorignore` (if it exists)

### Step 4: Chunk Files

For each file:
1. Read the file content
2. Split into chunks at semantic boundaries when possible:
   - Function/method boundaries for supported languages
   - Class/module boundaries
   - Fall back to ~512-token chunks for unsupported formats
3. Each chunk gets metadata: `file_path`, `language`, `chunk_type`, `symbols`

### Step 5: Index via MCP

Use ToolSearch to discover ruvector MCP insert tools, then for each chunk:
1. Call `vector_db_insert` (or equivalent) with content and metadata
2. Use the `code` namespace
3. Process in batches of 100 files for large repos

Show progress: "Indexing 142/350 files..."

### Step 6: Report Results

Display summary:
- Files indexed
- Chunks/vectors created
- Time taken
- Any files skipped (with reasons)

Suggest: "Run `/ruvector:search <query>` to try semantic search."

## Error Handling

See `ruvector-conventions` skill for error catalog (MCP server down, disk full, timeout, permission denied).

### Specific Errors

- **No files to index:** "No indexable files found. Check your path or .ruvectorignore."
- **Large repo (>5000 files):** Use AskUserQuestion to confirm before proceeding. Suggest indexing a subdirectory first.
- **Interrupted:** Report progress so far. Re-running indexes only new/changed files.
