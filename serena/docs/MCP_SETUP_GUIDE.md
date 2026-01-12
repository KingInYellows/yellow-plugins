# MCP Server Setup Guide for Claude Code

Complete guide for setting up Claude Flow and Serena MCP servers with Claude Code CLI.

## Table of Contents
- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [Claude Flow MCP Setup](#claude-flow-mcp-setup)
- [Serena MCP Setup](#serena-mcp-setup)
- [Verification](#verification)
- [Troubleshooting](#troubleshooting)
- [Key Differences: Claude Desktop vs Claude Code](#key-differences-claude-desktop-vs-claude-code)

## Overview

This guide covers setting up two essential MCP (Model Context Protocol) servers:

1. **Claude Flow** - Multi-agent swarm orchestration and coordination
2. **Serena** - Language-aware code operations with LSP integration

**Important**: Claude Code (CLI) and Claude Desktop (GUI) use **different configuration methods**. This guide is for **Claude Code CLI**.

## Prerequisites

### Required Software
- **Node.js** (v18 or higher) - For Claude Flow
- **Python** (3.11) - For Serena
- **uv** - Python package manager
- **Claude Code CLI** - Anthropic's CLI tool

### Install Prerequisites

```bash
# Install uv (if not already installed)
curl -LsSf https://astral.sh/uv/install.sh | sh

# Verify installations
node --version    # Should be v18+
python --version  # Should be 3.11.x
uv --version      # Should be latest
claude --version  # Should be latest
```

## Claude Flow MCP Setup

Claude Flow provides swarm orchestration, agent coordination, and distributed task execution.

### Installation Steps

1. **Add Claude Flow MCP to Claude Code:**

```bash
claude mcp add claude-flow npx claude-flow@alpha mcp start
```

2. **Verify Installation:**

```bash
claude mcp list
```

You should see:
```
claude-flow: npx claude-flow@alpha mcp start - ✓ Connected
```

### Claude Flow Features

- 🤖 **54 specialized agents** (researcher, coder, tester, reviewer, etc.)
- 🔄 **Multi-agent coordination** (hierarchical, mesh, ring, star topologies)
- 🧠 **Neural training** with WASM SIMD acceleration
- 💾 **Persistent memory** across sessions
- 📊 **Performance benchmarking** and optimization
- 🔧 **GitHub integration** (PR management, code review, issue tracking)
- ⚡ **Hooks system** for automation

### Basic Usage

```bash
# Initialize a swarm
npx claude-flow@alpha swarm init --topology mesh --max-agents 8

# Spawn agents
npx claude-flow@alpha agent spawn researcher
npx claude-flow@alpha agent spawn coder

# Orchestrate tasks
npx claude-flow@alpha task orchestrate "Build a REST API with authentication"

# Check swarm status
npx claude-flow@alpha swarm status
```

## Serena MCP Setup

Serena provides language-aware code operations using Language Server Protocol (LSP) for precise symbol-level editing.

### Installation Steps

1. **Navigate to Serena directory:**

```bash
cd /path/to/serena
```

2. **Install Serena globally with uv:**

```bash
uv tool install --editable .
```

This installs three executables:
- `serena` - Main CLI
- `serena-mcp-server` - MCP server
- `index-project` - Project indexing utility

3. **Add Serena MCP to Claude Code:**

```bash
claude mcp add serena serena-mcp-server
```

4. **Verify Installation:**

```bash
claude mcp list
```

You should see:
```
serena: serena-mcp-server - ✓ Connected
```

### Serena Features

- 🎯 **Symbol-level editing** - Find and edit functions, classes, methods
- 🌐 **30+ languages supported** - Python, TypeScript, Java, Rust, Go, and more
- 🔍 **LSP-powered understanding** - Precise code comprehension
- 💾 **Project memory** - Persistent knowledge across sessions
- 🛠️ **File operations** - Search, regex, replacements
- 📝 **Workflow tools** - Onboarding and meta-operations

### Basic Usage

```bash
# Start MCP server
serena-mcp-server

# Start with specific project
serena-mcp-server --project /path/to/project

# Index a project for faster performance
index-project

# Configure context and modes
serena-mcp-server --context desktop-app --mode interactive,editing
```

## Verification

### Check All MCP Servers

```bash
claude mcp list
```

Expected output:
```
Checking MCP server health...

claude-flow: npx claude-flow@alpha mcp start - ✓ Connected
serena: serena-mcp-server - ✓ Connected
```

### Test MCP Tools in Claude Code

After setup, you should have access to MCP tools in Claude Code:

**Claude Flow Tools:**
- `mcp__claude-flow__swarm_init`
- `mcp__claude-flow__agent_spawn`
- `mcp__claude-flow__task_orchestrate`
- `mcp__claude-flow__memory_usage`
- `mcp__claude-flow__neural_train`

**Serena Tools:**
- Symbol finding and editing
- File operations
- Project memory
- Configuration management

## Troubleshooting

### Issue: MCP Server Not Showing in `claude mcp list`

**Solution**: Ensure you're using `claude mcp add` command (for Claude Code CLI), not editing config files manually.

```bash
# ✅ Correct (Claude Code CLI)
claude mcp add serena serena-mcp-server

# ❌ Wrong (this is for Claude Desktop GUI)
# Editing ~/.config/claude/claude_desktop_config.json
```

### Issue: `uvx --from` Command Fails

**Solution**: Install globally with `uv tool install` first:

```bash
cd /path/to/serena
uv tool install --editable .
claude mcp add serena serena-mcp-server
```

### Issue: Serena MCP Server Not Found

**Solution**: Verify Serena is installed:

```bash
which serena-mcp-server
# Should output: /home/user/.local/bin/serena-mcp-server

# Test server directly
serena-mcp-server --help
```

### Issue: Claude Flow Not Connecting

**Solution**: Ensure Node.js is installed and npx works:

```bash
node --version  # Should be v18+
npx claude-flow@alpha --version
```

### Issue: Permission Denied

**Solution**: Make sure scripts are executable:

```bash
chmod +x ~/.local/bin/serena-mcp-server
```

## Key Differences: Claude Desktop vs Claude Code

| Feature | Claude Desktop (GUI) | Claude Code (CLI) |
|---------|---------------------|-------------------|
| **Configuration File** | `~/.config/claude/claude_desktop_config.json` | Managed by `claude mcp` commands |
| **Adding MCP Servers** | Edit JSON file manually | `claude mcp add <name> <command>` |
| **Listing Servers** | View in GUI settings | `claude mcp list` |
| **Configuration Format** | JSON with `mcpServers` object | CLI command-based |

### Claude Desktop Configuration Example
```json
{
  "mcpServers": {
    "serena": {
      "command": "uvx",
      "args": ["--from", "/path/to/serena", "serena-mcp-server"]
    }
  }
}
```

### Claude Code Configuration Example
```bash
# Just use CLI commands
claude mcp add serena serena-mcp-server
claude mcp add claude-flow npx claude-flow@alpha mcp start
```

## Advanced Configuration

### Serena Configuration

Create `~/.serena/serena_config.yml`:

```yaml
# Default context (desktop-app, agent, ide-assistant)
default_context: desktop-app

# Default modes (planning, editing, interactive, one-shot)
default_modes:
  - interactive
  - editing

# Tool timeout in seconds
tool_timeout: 30.0

# Enable web dashboard
enable_web_dashboard: false

# Enable GUI log window
enable_gui_log_window: false

# Log level (DEBUG, INFO, WARNING, ERROR, CRITICAL)
log_level: INFO

# Trace LSP communication (for debugging)
trace_lsp_communication: false
```

### Claude Flow Hooks Configuration

Enable automatic coordination via hooks:

```bash
# Enable pre-task hook
npx claude-flow@alpha hooks pre-task --description "Task description"

# Enable post-edit hook for memory storage
npx claude-flow@alpha hooks post-edit --file "path/to/file" --memory-key "swarm/agent/step"

# Session management
npx claude-flow@alpha hooks session-restore --session-id "swarm-123"
npx claude-flow@alpha hooks session-end --export-metrics true
```

## Optional MCP Servers

### Flow Nexus (Advanced Cloud Features)

For cloud-based orchestration and additional features:

```bash
# Install Flow Nexus
claude mcp add flow-nexus npx flow-nexus@latest mcp start

# Requires registration
npx flow-nexus@latest register
npx flow-nexus@latest login
```

Flow Nexus provides:
- ☁️ Cloud sandbox execution
- 🧠 Neural AI training
- 🎯 Template marketplace
- 💳 Credit management
- 📊 Real-time monitoring

### RUV Swarm (Enhanced Coordination)

Alternative swarm coordination (optional):

```bash
claude mcp add ruv-swarm npx ruv-swarm mcp start
```

## Development Workflow

### Using Claude Flow + Serena Together

```bash
# 1. Initialize swarm coordination
npx claude-flow@alpha swarm init --topology mesh

# 2. Spawn specialized agents
npx claude-flow@alpha agent spawn researcher
npx claude-flow@alpha agent spawn coder

# 3. Use Serena for precise code operations
# (Available as MCP tools in Claude Code)

# 4. Orchestrate tasks across swarm
npx claude-flow@alpha task orchestrate "Implement authentication system"

# 5. Monitor progress
npx claude-flow@alpha swarm status
```

## Testing Your Setup

### Test Claude Flow

```bash
# Test swarm initialization
npx claude-flow@alpha swarm init --topology mesh --max-agents 5

# Test agent spawning
npx claude-flow@alpha agent spawn researcher

# Test memory
npx claude-flow@alpha memory store test-key "test-value"
npx claude-flow@alpha memory retrieve test-key
```

### Test Serena

```bash
# Test MCP server startup
serena-mcp-server --help

# Test with a project
cd /path/to/your/project
serena-mcp-server --project .

# Test indexing
index-project
```

## Next Steps

1. **Read the documentation:**
   - Claude Flow: [GitHub Repository](https://github.com/ruvnet/claude-flow)
   - Serena: Check `docs/` directory in Serena repository

2. **Explore example workflows:**
   - See `CLAUDE.md` in Serena for development patterns
   - Check Claude Flow examples for swarm coordination

3. **Join the community:**
   - Report issues on GitHub
   - Contribute improvements
   - Share your use cases

## Support

### Claude Flow
- Documentation: https://github.com/ruvnet/claude-flow
- Issues: https://github.com/ruvnet/claude-flow/issues

### Serena
- Documentation: Serena `docs/` directory
- Issues: Report to Serena repository

### Claude Code
- Documentation: https://claude.ai/code
- Issues: https://github.com/anthropics/claude-code/issues

---

**Last Updated**: 2025-01-26

**Version**: 1.0.0

**Tested With**:
- Claude Code: Latest
- Claude Flow: @alpha
- Serena: v0.1.4
- Node.js: v18+
- Python: 3.11
- uv: Latest
