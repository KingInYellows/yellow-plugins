---
title: "File-Based Agent Grouping for Parallel Todo Resolution Without Edit Conflicts"
problem_type: code-quality
component: parallel-agent-orchestration
symptoms:
  - "Spawning one agent per todo causes concurrent edit conflicts when multiple todos target the same file"
  - "Within-file todo dependencies are violated when separate agents edit the same file out of order"
  - "YAGNI resolutions leave orphaned validation todos open that no longer have a target to validate"
tags: [parallel-agents, todo-resolution, multi-agent, conflict-prevention, orchestration]
related_prs: ["#37"]
date: "2026-02-22"
---

# File-Based Agent Grouping for Parallel Todo Resolution Without Edit Conflicts

## Problem

The `/compound-engineering:resolve_todo_parallel` skill instructs spawning one
agent per todo. When multiple todos target the same file, concurrent agents
attempt simultaneous writes — last writer wins, earlier writes are silently
overwritten. With 14 todos across 7 files (averaging 5-6 todos per file), naive
1:1 spawning produces near-certain data loss.

The skill's parallelism premise holds only when todos map 1:1 to distinct files.
Real plugin work rarely satisfies this condition: command files, agent files, and
shared skill files are touched by many review findings simultaneously.

## Symptoms

- Two agents write to the same file; only the last agent's output persists
- Sequential todo dependencies violated (agent B modifies a section that agent A
  hadn't added yet, because they ran concurrently)
- A YAGNI removal todo closes out another todo that was assigned to an agent,
  resulting in the second agent trying to edit a section that no longer exists

## Root Cause

The naive "one agent per todo" strategy assumes independence — it's only safe
when every todo maps exclusively to a file that no other todo touches.

## Solution: File-Based Grouping

Group todos by target file, assign one agent per group, run all groups in
parallel. Agents within a group apply their todos sequentially; agents across
groups run concurrently with zero write conflicts.

### Step 1: Build the todo-to-file mapping table

For each todo, extract every target file it touches. Produce a table:

```text
TODO  | Files touched
------|-------------------------------------------------------------
T-045 | plugins/yellow-chatprd/commands/chatprd/setup.md
T-046 | setup.md, create.md, list.md, search.md, update.md,
      |   agents/workflow/document-assistant.md,
      |   skills/chatprd-conventions/SKILL.md
T-047 | commands/chatprd/search.md, commands/chatprd/update.md,
      |   agents/workflow/document-assistant.md
T-050 | commands/chatprd/setup.md          (depends on T-045)
T-058 | commands/chatprd/setup.md          (YAGNI removal)
T-049 | commands/chatprd/setup.md          (cascade-closed by T-058)
```

*(Abbreviated — showing todos with non-trivial file overlap. Todos T-048, T-051–T-057 map to the same file groups and are covered by Step 2's inverted mapping.)*

### Step 2: Invert to file-to-todos mapping

```text
setup.md              → [045, 046, 048, 049, 050, 051, 057, 058]
create.md             → [052, 053, 055, 056]
list.md               → [046, 048, 054, 055, 056]
search.md             → [046, 047, 048, 054, 055, 056]
update.md             → [046, 047, 054, 055, 056]
document-assistant.md → [046, 047, 048, 053]
chatprd-conventions/  → [046, 048, 051]
```

### Step 3: Identify cascade closures before spawning

YAGNI removals can close sibling todos. In this session:
- **T-058** removes Step 8 from setup.md
- **T-049** validates input for Step 8 — becomes moot

Check: for each todo that deletes a block/step/function, grep other todos'
bodies for references to that artifact. Mark cascade-closed todos — assign them
to the closing agent with the note "close without changes."

### Step 4: Identify within-group ordering constraints

For each file group, mark sequential dependencies:

```text
setup.md group ordering:
  1. T-058 (removes Step 8, renumbers Step 9 → Step 8) — do first
  2. T-049 (cascade-closed by T-058)                   — mark done, no edits
  3. T-045 (fixes Step 7 grep)
  4. T-050 (adds readback in Step 7, builds on T-045)  — do after T-045
  5. T-046, T-048, T-051, T-057                        — independent, any order
```

### Step 5: Spawn all file-group agents in parallel

With 7 file groups in this session, 7 agents ran concurrently — no conflicts:

```text
Parallel batch:
  Agent 1 → setup.md               (8 todos, ordered per Step 4)
  Agent 2 → create.md              (4 todos)
  Agent 3 → list.md                (5 todos)
  Agent 4 → search.md              (6 todos)
  Agent 5 → update.md              (5 todos)
  Agent 6 → document-assistant.md  (4 todos)
  Agent 7 → chatprd-conventions    (3 todos)
```

No two agents share a file → zero write conflicts.

### Step 6: Handle cross-file todo renaming

Some todos (e.g., T-046 applied to 7 files) appear in multiple groups. The
physical todo file in `todos/` must be renamed exactly **once**. Designate one
agent as the canonical closer — typically the agent handling the primary file
for that todo. All other agents that touch the same todo must be instructed:
"Do not rename the todo file for T-046 — another agent handles that."

After all agents complete, verify no `*-ready-*.md` files remain:

```bash
ls todos/ | grep '\-ready\-'
# rename any stragglers manually
```

### Step 7: Commit once after all agents complete

Use `gt modify -c -m "subject" -m "body"` — separate `-m` flags per paragraph.
Do **not** use heredoc syntax with `gt modify` (the heredoc is passed as a
single argument and fails):

```bash
# Correct
gt modify -c \
  -m "fix(chatprd): resolve 14 code review findings" \
  -m "- 045: anchor grep to frontmatter
- 046: combine existence + content check
- 058: remove YAGNI Step 8, cascade-close 049"

# Wrong — heredoc treated as single argument, fails
gt modify -c "$(cat <<'EOF'
subject
body
EOF
)"
```

## Decision Tree

```text
N todos to resolve in parallel
          |
          v
    Map todos → files
          |
          v
  Any file shared by 2+ todos?
    |              |
   NO             YES
    |              |
  One agent     Compute conflict sets
  per todo       (transitive closure)
  (safe)             |
                     v
               Check cascade closures
               (YAGNI removals → sibling moot)
                     |
                     v
               One agent per conflict set
               Within-set: sequential
               Across sets: parallel
```

**Two-question test before spawning:**

1. Do any two todos touch the same file? → If yes, group them.
2. Does applying any todo eliminate the need for another? → If yes, remove the
   downstream todo from agent assignments.

If both answers are no, one agent per todo is safe. If either is yes, do the
grouping work first.

## Agent Prompt Template

Each file-agent prompt must include:

1. **Exclusive ownership list**: "You own exactly these files: [list]. Do not
   write to any file not on this list."
2. **Ordered todo list**: Full todo description for each, with explicit sequence
   numbers. "Apply in this order: (1) T-058, (2) T-045, (3) T-050…"
3. **Renaming scope**: "You are the designated closer for T-045 and T-050. Do
   NOT rename the todo file for T-046."
4. **Cascade instructions**: "After applying T-058, close T-049 without changes."
5. **Completion report**: "Report: 'Todos closed: [list]. Files modified: [list].'"

## Key Metrics (This Session)

| Metric | Value |
|--------|-------|
| Todos resolved | 14 (045–058) |
| Files modified | 7 |
| Agents spawned | 7 (one per file group) |
| Write conflicts | 0 |
| Cascade closures | 1 (T-049 via T-058) |
| Agent run mode | Fully parallel |

## Related Documentation

- [`parallel-multi-agent-review-orchestration.md`](./parallel-multi-agent-review-orchestration.md) —
  File-ownership grouping for review agents (wave-based); same core algorithm
  applied to code review findings (not todo resolution)
- [`multi-agent-re-review-false-positive-patterns.md`](./multi-agent-re-review-false-positive-patterns.md) —
  Diminishing returns in re-review rounds; empirical verification patterns
- [`claude-code-command-authoring-anti-patterns.md`](./claude-code-command-authoring-anti-patterns.md) —
  Anti-patterns identified in PR #35; many of the todos in this session fixed
  these patterns in the yellow-chatprd plugin
