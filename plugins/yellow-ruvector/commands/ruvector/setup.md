---
name: ruvector:setup
description: >
  Install ruvector and initialize vector storage. Use when user says "set up
  ruvector", "install vector search", "enable semantic search", "initialize
  ruvector", or wants persistent agent memory for a project.
argument-hint: ''
allowed-tools:
  - Bash
  - Read
  - Write
  - AskUserQuestion
---

# Set Up ruvector

Install the ruvector CLI and initialize the `.ruvector/` vector storage
directory for the current project.

## CLI Reference

These are the actual ruvector CLI commands (verified against v0.1.96+):

- `npx ruvector hooks init` — Initialize `.ruvector/` directory and hooks
- `npx ruvector mcp start` — Start the MCP server (stdio transport)
- `npx ruvector hooks verify` — Verify hooks are working
- `npx ruvector hooks doctor` — Diagnose setup issues
- `npx ruvector info` — Show ruvector system information
- `npx ruvector doctor` — System health check

**Commands that do NOT exist:** `ruvector init`, `ruvector mcp-server`,
`ruvector server` (HTTP/gRPC only, not MCP stdio).

## Workflow

### Step 1: Check Prerequisites

Verify required tools are available:

```bash
node --version  # Must be >= 18
npm --version
command -v jq >/dev/null 2>&1 && jq --version
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
- If permission denied:
  `npm install -g ruvector --ignore-scripts --prefix "$HOME/.local"`

### Step 4: Initialize .ruvector/ Directory

Check if `.ruvector/` already exists in the project root:

```bash
ls -la .ruvector/ 2>/dev/null
```

If it doesn't exist, initialize using `hooks init` with flags to skip
configurations the plugin already manages:

```bash
npx ruvector hooks init --minimal --no-claude-md --no-permissions --no-env --no-mcp --no-statusline
```

This creates the `.ruvector/` directory and basic hook configuration. The plugin
already configures MCP, hooks, and CLAUDE.md — `--no-*` flags prevent conflicts.

Verify the directory was created:

```bash
ls -la .ruvector/
```

### Step 5: Update .gitignore

Check if `.ruvector/` is already in `.gitignore`:

```bash
grep -q '^\.ruvector/' .gitignore 2>/dev/null
```

If not present, append it:

```bash
printf '\n# ruvector vector storage (per-developer)\n.ruvector/\n' >> .gitignore
```

### Step 6: Verify Installation

Run the built-in doctor and verify commands:

```bash
npx ruvector doctor 2>&1
npx ruvector hooks verify 2>&1
```

Report any warnings or failures. If everything passes, setup is complete.

### Step 7: Offer Next Steps

Report setup complete and suggest:

- Run `/ruvector:index` to index the codebase for semantic search
- Run `/ruvector:status` to verify everything is working
- Run `npx ruvector hooks pretrain` to bootstrap intelligence from the repo

Use AskUserQuestion to ask if they want to index now.

## Error Handling

| Error                   | Action                                          |
| ----------------------- | ----------------------------------------------- |
| Node.js not found       | Report and provide install URL                  |
| Node.js < 18            | Report version and suggest upgrade              |
| npm install failed      | Suggest manual install with `--prefix`          |
| hooks init failed       | Check disk space, permissions, try `--force`    |
| MCP server won't start  | Run `npx ruvector hooks doctor` to diagnose     |
| .gitignore not writable | Report and suggest manual edit                  |
