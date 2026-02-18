---
name: gt-stack-plan
description: "Plan a series of stacked PRs for a feature, ordered by dependency"
argument-hint: "[feature-description]"
allowed-tools:
  - Bash
  - Read
  - Glob
  - Grep
  - Task
  - AskUserQuestion
---

# Stack Plan

Given a feature description, break it into a plan of stacked PRs ordered by dependency. Each PR in the stack builds on the previous one, keeping changes small and reviewable.

## Input

Provide a feature description:

#$ARGUMENTS

If no arguments are provided, use `AskUserQuestion` to ask: "What feature do you want to plan a stack for?"

## Phase 1: Understand the Feature

### 1. Analyze the Feature Scope

Read the feature description and identify:
- What new functionality is being added
- What existing code will be touched
- What the key components/layers are (types, logic, API, UI, tests)

### 2. Explore the Codebase

Use Glob and Grep to understand the project structure:
- Find files related to the feature area
- Understand the dependency graph (what imports what)
- Identify existing patterns for similar features
- Note the testing strategy in use

Use the Task tool with `subagent_type: "Explore"` if the scope is large and requires deep exploration.

### 3. Check Current Stack State

```bash
gt log short
```

```bash
gt trunk
```

Note the current branch position — the stack will be planned on top of the current branch.

## Phase 2: Design the Stack

### 1. Break Down into PRs

Split the feature into the smallest meaningful PRs, ordered by dependency. Each PR should:
- Be independently reviewable
- Have a clear, single responsibility
- Build on the previous PR in the stack
- Be as small as possible while still being coherent

Common layering patterns:
1. **Types/Schema first** — domain models, interfaces, types
2. **Core logic** — business logic, validation, transformations
3. **Data layer** — database migrations, queries, repositories
4. **API/Interface** — endpoints, handlers, controllers
5. **UI/Frontend** — components, pages, styling
6. **Tests** — integration tests, e2e tests (or co-locate with each PR)

### 2. Present the Stack Plan

Output the plan in this format:

```
Stack Plan: <feature name>

Current position: <current branch>

┌─ <trunk branch>
├── 1. <type>/<branch-slug>
│       <commit type>: <description>
│       Scope: <files/areas touched>
│       Size: ~<estimated lines>
│
├── 2. <type>/<branch-slug>
│       <commit type>: <description>
│       Scope: <files/areas touched>
│       Size: ~<estimated lines>
│       Depends on: #1
│
├── 3. <type>/<branch-slug>
│       <commit type>: <description>
│       Scope: <files/areas touched>
│       Size: ~<estimated lines>
│       Depends on: #2
│
└── 4. <type>/<branch-slug>
        <commit type>: <description>
        Scope: <files/areas touched>
        Size: ~<estimated lines>
        Depends on: #3
```

### 3. Ask for Confirmation

Use AskUserQuestion to ask the user:
- "Create these branches now (Recommended)" — scaffold all branches with empty commits
- "Adjust the plan" — let the user modify before creating
- "Save plan only" — write the plan to `.gt-stack-plan.md` in the repo root and display the path
- "Cancel"

### If "Save plan only"

Write the formatted stack plan (the output from Phase 2 Step 2) to `.gt-stack-plan.md` in the repository root:

```bash
cat > .gt-stack-plan.md << 'EOF'
<stack plan content here>
EOF
echo "Stack plan saved to .gt-stack-plan.md"
```

Then exit without creating any branches.

## Phase 3: Create Branches (if confirmed)

### 1. Scaffold the Stack

For each PR in the plan, starting from the bottom of the stack:

```bash
gt create "<branch-name>" -m "<commit-type>: scaffold for <description>"
```

**After each `gt create`**, verify it succeeded before proceeding to the next branch. If a branch creation fails, stop immediately and report:
- Which branches were successfully created
- Which branch failed and why
- The current stack state via `gt log short`

Do not continue creating branches on a broken stack.

This creates the branch chain in Graphite. Each subsequent `gt create` stacks on top of the previous branch automatically.

### 2. Show the Created Stack

```bash
gt log short
```

### 3. Output Next Steps

Tell the user:
- Which branch they're currently on (the top of the new stack)
- How to navigate: `gt checkout <branch>` or `gt up`/`gt down`
- How to start working: begin on the bottom branch and work up
- How to submit when ready: `gt submit --no-interactive` or `/smart-submit`

## Success Criteria

- Feature broken into small, dependency-ordered PRs
- Each PR has a clear scope and conventional commit type
- Stack plan presented clearly with dependency chain
- Branches created in correct order via Graphite (if user confirms)
- User understands how to navigate and work on the stack
