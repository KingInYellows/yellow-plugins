---
name: ruvector:setup
description: >
  Install ruvector and initialize vector storage. Use when user says "set up
  ruvector", "install vector search", "enable semantic search", "initialize
  ruvector", or wants persistent agent memory for a project.
allowed-tools:
  - Bash
  - Read
  - Write
  - AskUserQuestion
---

# Set Up ruvector

Install the ruvector CLI and initialize the `.ruvector/` vector storage directory for the current project.

## Workflow

### Step 1: Check Prerequisites

Verify required tools are available:

```bash
node --version  # Must be >= 18
npm --version
jq --version
```

If any are missing, report which ones and provide install URLs:
- Node.js: https://nodejs.org/
- jq: https://jqlang.github.io/jq/

### Step 2: Check Existing Installation

Check if ruvector is already installed:

```bash
npx ruvector --version 2>/dev/null
```

If already installed, skip to Step 4. If not, proceed to Step 3.

### Step 3: Install ruvector

Run the install script:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/install.sh"
```

If install fails, report the error and suggest manual installation:
- `npm install -g ruvector --ignore-scripts`
- If permission denied: `npm install -g ruvector --ignore-scripts --prefix "$HOME/.local"`

### Step 4: Initialize .ruvector/ Directory

Check if `.ruvector/` already exists in the project root:

```bash
ls -la .ruvector/ 2>/dev/null
```

If it doesn't exist, initialize:

```bash
npx ruvector init
```

Verify the directory was created successfully.

### Step 5: Update .gitignore

Check if `.ruvector/` is already in `.gitignore`:

```bash
grep -q '^\.ruvector/' .gitignore 2>/dev/null
```

If not present, append it:

```bash
printf '\n# ruvector vector storage (per-developer)\n.ruvector/\n' >> .gitignore
```

### Step 6: Verify MCP Server

Test that the MCP server can start:

```bash
timeout 5 npx ruvector mcp-server </dev/null 2>&1 || true
```

If it starts without errors, report success. If it fails, report the error and suggest checking the installation.

### Step 7: Offer Next Steps

Report setup complete and suggest:
- Run `/ruvector:index` to index the codebase for semantic search
- Run `/ruvector:status` to verify everything is working

Use AskUserQuestion to ask if they want to index now.

## Error Handling

| Error | Action |
|-------|--------|
| Node.js not found | Report and provide install URL |
| Node.js < 18 | Report version and suggest upgrade |
| npm install failed | Suggest manual install with `--prefix` |
| ruvector init failed | Check disk space, permissions |
| MCP server won't start | Verify `npx ruvector mcp-server` manually |
| .gitignore not writable | Report and suggest manual edit |
