---
name: mempalace:navigate
description: "Browse palace structure — list wings, rooms, and traverse cross-wing connections via tunnels. Use when exploring what memories exist or finding connections between topics."
argument-hint: '[wing] [--tunnels <wingA> <wingB>]'
allowed-tools:
  - ToolSearch
---

# Navigate Palace

Browse the palace structure and discover connections between wings.

## Workflow

### Step 1: Parse arguments

Extract from `$ARGUMENTS`:
- **wing** (optional): Show rooms within a specific wing
- **--tunnels** `<wingA>` `<wingB>` (optional): Find connections between two
  wings

If no arguments: show top-level wing listing.

### Step 2: Discover MCP tools

Use ToolSearch with query `"+mempalace list"` to find navigation tools.

### Step 3: Execute navigation

**No arguments (wing listing)**:
Call `mempalace_list_wings`. Display each wing with drawer count.

**Wing specified (room listing)**:
Call `mempalace_list_rooms` with wing filter. Display rooms within that wing
with drawer counts.

**--tunnels (cross-wing connections)**:
Call `mempalace_find_tunnels` with wing_a and wing_b. Display rooms that
appear in both wings, forming cross-domain connections.

### Step 4: Display results

For wing listing:
```
Palace Wings
─────────────
wing_myproject      [42 drawers]
wing_auth           [18 drawers]
wing_infrastructure [7 drawers]
```

For room listing within a wing:
```
Rooms in wing_myproject
───────────────────────
auth-migration      [12 drawers]
graphql-switch       [8 drawers]
deployment-pipeline  [6 drawers]
```

For tunnel connections:
```
Tunnels: wing_myproject ↔ wing_auth
──────────────────────────────────
jwt-implementation  (appears in both wings)
session-management  (appears in both wings)
```

Suggest next steps: "Use `/mempalace:search <query>` to find specific content
within a wing or room."
