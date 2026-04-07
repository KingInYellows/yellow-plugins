---
name: mempalace:mine
description: "Mine project files, conversations, or general content into the palace. Use when importing new content or indexing a project for the first time."
argument-hint: '<path> [--mode projects|convos|general]'
allowed-tools:
  - Bash
  - ToolSearch
  - AskUserQuestion
---

# Mine Content

Mine files from a directory into the palace, organizing them into wings, rooms,
and drawers.

## Workflow

### Step 1: Parse arguments

Extract from `$ARGUMENTS`:
- **path** (required): Directory to mine
- **--mode** (optional): Mining mode — `projects` (default), `convos`, or
  `general`

If path is empty: use AskUserQuestion to ask "What directory should I mine?"
with options: "Current project (.)", "Specify a path"

### Step 2: Validate path

```bash
if [ ! -d "$PATH_ARG" ]; then
  printf '[yellow-mempalace] Error: directory not found: %s\n' "$PATH_ARG"
fi
```

### Step 3: Check palace initialization

```bash
if ! mempalace status >/dev/null 2>&1; then
  printf '[yellow-mempalace] Palace not initialized. Run mempalace init first.\n'
fi
```

If not initialized, use AskUserQuestion to offer `mempalace init .`.

### Step 4: Run mining

Use the CLI directly (mining is a heavy batch operation better suited to CLI):

```bash
mempalace mine "$PATH_ARG" --mode "$MODE" 2>&1
```

Mining modes:
- **projects**: Code, documentation, notes — extracts decisions, patterns,
  architecture
- **convos**: Claude/ChatGPT/Slack conversation exports — preserves dialogue
  context
- **general**: Auto-classifies into decisions, milestones, problems,
  preferences

### Step 5: Report results

Show a summary of what was mined:
- Drawers created
- Wings populated
- Rooms created
- Any errors or skipped files

Suggest: "Run `/mempalace:status` to see the updated palace overview, or
`/mempalace:search <query>` to find specific content."
