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
- `npx ruvector doctor` — System health check

**Commands that do NOT exist:** `ruvector init`, `ruvector mcp-server`.

**Do NOT use** `npx ruvector hooks verify` — it checks `.claude/settings.json`
for hooks, but Claude Code reads hooks from `plugin.json` at runtime. The verify
command will always report false negatives for plugin-managed hooks.

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
(ruvector --version 2>/dev/null || printf 'not installed\n') && \
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

Run health check and hook status in a single command:

```bash
printf '=== Doctor ===\n'
npx ruvector doctor 2>&1 || printf '(doctor exited non-zero — see above)\n'

printf '\n=== Hook Scripts ===\n'
PLUGIN_DIR="${CLAUDE_PLUGIN_ROOT:?CLAUDE_PLUGIN_ROOT must be set}"
for script in pre-tool-use.sh user-prompt-submit.sh session-start.sh post-tool-use.sh stop.sh; do \
  if [ -r "${PLUGIN_DIR}/hooks/scripts/${script}" ]; then \
    printf '  ✓ %s (readable)\n' "$script"; \
  elif [ -f "${PLUGIN_DIR}/hooks/scripts/${script}" ]; then \
    printf '  ⚠ %s (not readable)\n' "$script"; \
  else \
    printf '  ✗ %s (missing)\n' "$script"; \
  fi; \
done

printf '\n=== Global Binary (REQUIRED) ===\n'
if command -v ruvector >/dev/null 2>&1; then \
  printf 'ruvector in PATH: %s\n' "$(command -v ruvector)"; \
  printf '\n=== Smoke Test (must complete in <1s) ===\n'; \
  TIMEOUT_CMD=""; \
  if command -v timeout >/dev/null 2>&1; then TIMEOUT_CMD="timeout"; \
  elif command -v gtimeout >/dev/null 2>&1; then TIMEOUT_CMD="gtimeout"; fi; \
  if [ -n "$TIMEOUT_CMD" ]; then \
    if [ ! -d ".ruvector" ]; then \
      printf 'Smoke test skipped: .ruvector/ not initialized in current directory\n'; \
    else \
      "$TIMEOUT_CMD" 1 ruvector hooks recall --top-k 1 "setup-test" >/dev/null 2>&1 && \
        printf 'Smoke test passed\n' || \
        printf 'FAILED: Smoke test failed (recall took >1s or errored)\n'; \
    fi; \
  else \
    printf 'Smoke test skipped: no timeout/gtimeout utility\n'; \
  fi; \
else \
  printf 'FAILED: ruvector NOT in PATH.\n'; \
  printf 'Global binary is REQUIRED — hooks with 1s budgets will not function without it.\n'; \
  printf 'npx adds ~1900ms overhead, exceeding hook timeouts.\n'; \
  printf 'Fix: npm install -g ruvector --ignore-scripts\n'; \
  printf 'If using nvm/fnm: binary is per-Node-version.\n'; \
fi
```

**Important:** Do NOT run `npx ruvector hooks verify` — it checks
`.claude/settings.json` which is the wrong place. Claude Code reads hooks
from `plugin.json` at runtime. Instead, verify by checking that the hook
scripts exist and are executable (as above).

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
| Hooks (5)            | Active via plugin.json |
| Global binary        | REQUIRED: In PATH / FAILED: Not found |
| Smoke test (<1s)     | Passed / Failed / Skipped |
```

If global binary is not found, **stop setup and report failure:**

> Setup incomplete: global `ruvector` binary is REQUIRED but not found in PATH.
> Without it, hooks with 1-second budgets (PreToolUse, UserPromptSubmit,
> PostToolUse) cannot function — npx adds ~1900ms overhead.
>
> Remediation:
>
> 1. `npm install -g ruvector --ignore-scripts`
> 2. Verify: `command -v ruvector` (should print a path)
> 3. Re-run `/ruvector:setup`
>
> If using nvm/fnm: global installs are per-Node-version.

If the smoke test failed, **stop setup and report failure:**

> Setup incomplete: `ruvector hooks recall` did not complete within the
> required 1-second budget.
> This means Claude Code hooks with 1-second budgets are still unreliable even
> though the binary is in PATH.
>
> Remediation:
>
> 1. Run `ruvector doctor`
> 2. Re-run `timeout 1 ruvector hooks recall --top-k 1 "setup-test"`
> 3. Re-run `/ruvector:setup` after the latency issue is resolved

Do NOT proceed to Step 4 if the global binary is missing or the smoke test
failed.

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
