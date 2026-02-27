---
name: ruvector:setup
description: "Install ruvector and initialize vector storage. Use when user says \"set up ruvector\", \"install vector search\", \"enable semantic search\", \"initialize ruvector\", or wants persistent agent memory for a project."
argument-hint: ''
allowed-tools:
  - Bash
  - Read
  - Write
  - AskUserQuestion
---

# Set Up ruvector

Install the ruvector CLI and initialize `.ruvector/` for the current project.

## CLI Reference (verified against v0.1.96+)

- `npx ruvector hooks init` — Initialize `.ruvector/` directory
- `npx ruvector mcp start` — Start the MCP server (stdio transport)
- `npx ruvector hooks verify` — Verify hooks are working
- `npx ruvector doctor` — System health check

**Commands that do NOT exist:** `ruvector init`, `ruvector mcp-server`.

## Workflow

**Goal: complete setup in 3 tool calls** (check → init → verify). Batch
operations into single Bash calls to minimize round-trips.

### Step 1: Check prerequisites + existing state (ONE Bash call)

Run all prerequisite checks in a single command:

```bash
printf '=== Prerequisites ===\n' && \
node --version && \
npm --version && \
(command -v jq >/dev/null 2>&1 && jq --version || printf 'jq: not found\n') && \
printf '\n=== ruvector ===\n' && \
(npx ruvector --version 2>/dev/null || printf 'not installed\n') && \
printf '\n=== .ruvector/ ===\n' && \
(ls -d .ruvector/ 2>/dev/null && printf 'exists\n' || printf 'not initialized\n') && \
printf '\n=== .gitignore ===\n' && \
(grep -q '\.ruvector' .gitignore 2>/dev/null && printf 'entry present\n' || printf 'entry missing\n')
```

**Decision tree from output:**

- Node.js missing or < 18 → stop, report install URL
- ruvector not installed → proceed to Step 2a (install)
- ruvector installed but `.ruvector/` missing → proceed to Step 2b (init only)
- Everything present → skip to Step 3 (verify)

### Step 2a: Install ruvector (only if not installed)

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/install.sh"
```

If install fails, report the error and suggest:
`npm install -g ruvector --ignore-scripts`

### Step 2b: Initialize + gitignore (ONE Bash call)

Combine initialization and .gitignore update:

```bash
npx ruvector hooks init --minimal --no-claude-md --no-permissions --no-env --no-mcp --no-statusline && \
(grep -q '\.ruvector' .gitignore 2>/dev/null || printf '\n# ruvector vector storage (per-developer)\n.ruvector/\n' >> .gitignore) && \
printf '\nInitialized .ruvector/ and updated .gitignore\n'
```

The `--no-*` flags prevent `hooks init` from creating configs that conflict with
what the plugin already manages (CLAUDE.md, MCP server, hooks, env vars).

If `.ruvector/` already exists, skip this step entirely.

### Step 3: Verify (ONE Bash call)

Run health checks and report:

```bash
printf '=== Doctor ===\n' && \
npx ruvector doctor 2>&1 && \
printf '\n=== Hooks Verify ===\n' && \
npx ruvector hooks verify 2>&1
```

Summarize results in a table:

```
## ruvector Setup Complete

| Component            | Status      |
|----------------------|-------------|
| Node.js vXX          | Ready       |
| ruvector vX.X.XX     | Installed   |
| .ruvector/ directory | Initialized |
| .gitignore entry     | Present     |
| Health check         | Passing     |
```

### Step 4: Offer next steps

Use AskUserQuestion to offer:

1. **Index now (Recommended)** — Run `/ruvector:index` to build vector index
2. **Skip for now** — User can index later
3. **Check status** — Run `/ruvector:status` to see current DB stats

## Error Handling

| Error                   | Action                                       |
| ----------------------- | -------------------------------------------- |
| Node.js not found       | Stop. Report: install from https://nodejs.org/ |
| Node.js < 18            | Stop. Report version, suggest upgrade        |
| npm install failed      | Suggest `--prefix "$HOME/.local"`            |
| hooks init failed       | Check disk space, permissions, try `--force` |
| doctor reports failures | Show output, suggest `/ruvector:status`      |
| .gitignore not writable | Report and suggest manual edit               |
