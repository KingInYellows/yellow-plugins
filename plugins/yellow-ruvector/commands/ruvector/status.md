---
name: ruvector:status
description: "Show ruvector health, DB stats, and queue status. Use when user says \"ruvector status\", \"check vector DB\", \"how many vectors\", \"is ruvector working\", or wants to verify the installation."
argument-hint: ''
allowed-tools:
  - Bash
  - ToolSearch
  - mcp__plugin_yellow-ruvector_ruvector__hooks_stats
  - mcp__plugin_yellow-ruvector_ruvector__hooks_capabilities
---

# ruvector Status

Show installation health, database statistics, and queue status.

## Workflow

### Step 1: Check Installation

```bash
ruvector --version 2>/dev/null
```

Report: installed version or "not installed".

### Step 2: Check .ruvector/ Directory

```bash
ls -la .ruvector/ 2>/dev/null
du -sh .ruvector/ 2>/dev/null
```

Report: directory exists/missing, total disk usage.

### Step 3: MCP Server Health Check

1. Call ToolSearch with query `"hooks_stats"`. If not found, mark MCP as
   unavailable.
2. Warmup: call `mcp__plugin_yellow-ruvector_ruvector__hooks_capabilities()`.
   If it errors, mark MCP as unavailable.
3. If warmup succeeds, call `mcp__plugin_yellow-ruvector_ruvector__hooks_stats`
   to verify the server responds.

**Healthy:** "MCP server: connected (responded in Xms)"

**Unhealthy or unavailable:**

```
MCP server: not responding

Recovery options:
1. Restart the session (MCP server starts automatically on session start)
2. Check manually: ruvector mcp start
3. Re-install: /ruvector:setup
```

This makes MCP health agent-detectable — agents can call `/ruvector:status` and
parse the output to decide whether to fall back to Grep.

### Step 4: Database Statistics

If MCP is available, report the overall statistics returned by `hooks_stats`
and any engine capabilities returned by `hooks_capabilities`, such as:

- Total memories
- Patterns learned
- Trajectories recorded
- Storage path
- Engine features or embedding mode when present

### Step 5: Queue Health

```bash
# Check queue file
if [ -f .ruvector/pending-updates.jsonl ]; then
  wc -l < .ruvector/pending-updates.jsonl
  wc -c < .ruvector/pending-updates.jsonl
  head -1 .ruvector/pending-updates.jsonl | jq -r '.timestamp // "unknown"'
fi
```

Report:

- Pending entries count
- Queue file size
- Age of oldest entry

Warn if queue > 5MB or > 1000 entries.

### Step 6: Display Summary

```
## ruvector Status

| Property | Value |
|----------|-------|
| CLI Version | 0.1.23 |
| MCP Server | Available |
| Storage | .ruvector/ (12.4 MB) |

### Intelligence

| Property | Value |
|----------|-------|
| Total memories | 208 |
| Patterns learned | 13 |
| Trajectories | 52 |
| Engine features | VectorDB, SONA, Attention |

### Queue

| Property | Value |
|----------|-------|
| Pending entries | 7 |
| Queue size | 2.1 KB |
| Oldest entry | 2 hours ago |
```

## Error Handling

- **Not installed:** "ruvector not found. Run `/ruvector:setup` to install."
- **No .ruvector/ directory:** "Not initialized. Run `/ruvector:setup` to set
  up."
- **MCP unavailable:** Show CLI info only, note MCP status as unavailable.
