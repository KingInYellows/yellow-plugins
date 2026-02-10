---
name: gt-nav
description: "Visualize your Graphite stack and navigate between branches"
allowed-tools:
  - Bash
  - AskUserQuestion
---

# Stack Navigator

Visualize your current Graphite stack and quickly navigate between branches.

## Input

Optional arguments:
- `--pr` — Also show PR status for each branch
- `--top` — Jump directly to the top of the stack
- `--bottom` — Jump directly to the bottom of the stack

#$ARGUMENTS

## Phase 1: Visualize Stack

### 1. Show Full Stack

```bash
gt log
```

### 2. Show Current Position

```bash
echo "Current branch: $(git branch --show-current)"
```

### 3. Show PR Status (if `--pr` is provided)

```bash
gt pr
```

### 4. Handle Direct Navigation Arguments

If `--top` was passed:
```bash
gt top
echo "Jumped to top: $(git branch --show-current)"
gt log short
Then show the stack and exit.

If `--bottom` was passed:
```bash
gt bottom
gt log short
```
Then show the stack and exit.

## Phase 2: Interactive Navigation

If no direct navigation argument was given, present options using AskUserQuestion:

Ask: "Where do you want to go?"

Options:
- **Go up** — Move to the child branch (`gt up`)
- **Go down** — Move to the parent branch (`gt down`)
- **Jump to top** — Move to the top of the stack (`gt top`)
- **Jump to bottom** — Move to the bottom of the stack (`gt bottom`)

The user can also type a specific branch name via the "Other" option.

### Execute Navigation

Based on the user's choice:

**Go up:**
```bash
gt up
```

**Go down:**
```bash
gt down
```

**Jump to top:**
```bash
gt top
```

**Jump to bottom:**
```bash
gt bottom
```

**Specific branch (from "Other" input):**
```bash
gt checkout -- "<branch-name>"
```

### Show New Position

After navigating:

```bash
echo "Now on: $(git branch --show-current)"
gt log short
```

## Success Criteria

- Stack is clearly visualized with current position highlighted
- PR status shown for context
- User can navigate up/down/top/bottom or to a specific branch
- New position confirmed after navigation
