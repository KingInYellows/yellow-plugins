---
name: git-worktree
description: Git worktree management for isolated parallel development. Use when reviewing PRs in isolation, working on multiple features simultaneously, or when workflows offer worktree option.
argument-hint: "[create|list|switch|cleanup] <name>"
user-invocable: true
---

# Git Worktree Manager

Manage git worktrees for isolated parallel development with a simple, safe interface.

## What It Does

Creates and manages git worktrees — separate working directories from the same repository that allow you to:
- Work on multiple branches simultaneously without stashing
- Review PRs in complete isolation from your current work
- Test features without switching branches in your main working directory
- Keep separate .env configurations per worktree

## Critical Rule

**ALWAYS use the manager script. NEVER use raw `git worktree add` directly.**

The manager script provides:
- Automatic .env file copying
- .gitignore management
- Safety validations
- Consistent directory structure
- Color-coded output

## Manager Script Location

```bash
${CLAUDE_PLUGIN_ROOT}/skills/git-worktree/scripts/worktree-manager.sh
```

Replace `${CLAUDE_PLUGIN_ROOT}` with the actual plugin installation path.

## Usage

### create

Create a new worktree:

```bash
worktree-manager.sh create <branch-name> [from-branch]
```

**Behavior:**
- Creates worktree in `.worktrees/<branch-name>/`
- Branches from `main` by default (or specify `from-branch`)
- Copies all `.env*` files from main repo
- Adds `.worktrees/` to `.gitignore` if missing
- Fails safely if worktree already exists

**Examples:**
```bash
# Create worktree for feature branch
worktree-manager.sh create feature-auth

# Create worktree from specific branch
worktree-manager.sh create hotfix-security develop
```

### list / ls

List all worktrees:

```bash
worktree-manager.sh list
worktree-manager.sh ls
```

**Output:**
```
Worktrees:
  main            /home/user/repo (clean)
  feature-auth    /home/user/repo/.worktrees/feature-auth (modified)
  pr-review-123   /home/user/repo/.worktrees/pr-review-123 (clean)
```

### switch / go

Switch to a worktree directory:

```bash
worktree-manager.sh switch <name>
worktree-manager.sh go <name>
```

**Note:** Prints `cd` command for shell evaluation:

```bash
# Use with eval or source
eval "$(worktree-manager.sh switch feature-auth)"

# Or create shell alias
alias wtgo='eval "$(worktree-manager.sh go $1)"'
```

### copy-env

Copy .env files to a worktree:

```bash
worktree-manager.sh copy-env <name>
```

Copies all `.env*` files from main repo to specified worktree. Useful if you've updated environment configuration and need to sync.

### cleanup / clean

Remove inactive worktrees:

```bash
worktree-manager.sh cleanup
worktree-manager.sh clean
```

**Behavior:**
- Lists all worktrees
- Prompts for confirmation
- Removes worktrees one by one
- Skips currently active worktree
- Removes empty `.worktrees/` directory if all cleaned up

## When to Use

### Code Review (/workflows:review)

When reviewing a PR and you're not on the target branch:

```bash
# Workflow offers worktree option
/workflows:review

# Choose worktree option
# Skill automatically creates worktree for PR branch
# You can review without affecting your current work
```

### Parallel Feature Development (/workflows:work)

When working on multiple features:

```bash
# Start feature 1
/workflows:work
# Creates worktree for feature-1

# In another terminal, start feature 2
cd .worktrees/feature-2
/workflows:work
# Both features developed independently
```

### Manual Worktree Management

When you need direct control:

```bash
# Create worktree
worktree-manager.sh create experimental-refactor

# Switch to it
eval "$(worktree-manager.sh go experimental-refactor)"

# List all
worktree-manager.sh list

# Clean up when done
worktree-manager.sh cleanup
```

## Workflow Examples

### Example 1: Code Review with Worktree

```bash
# You're on feature-auth branch, working on authentication
$ git branch --show-current
feature-auth

# PR needs review on different branch
$ /workflows:review pr-123

# Workflow detects branch mismatch, offers worktree option
# Select "Create worktree for isolated review"

# Worktree created automatically:
# - Branch: pr-review-123
# - Location: .worktrees/pr-review-123/
# - .env files copied
# - Ready for isolated review

# After review, cleanup:
$ worktree-manager.sh cleanup
```

### Example 2: Parallel Feature Development

```bash
# Main repo: working on feature A
$ pwd
/home/user/myproject

# Need to quickly prototype feature B
$ worktree-manager.sh create feature-b
Created worktree: .worktrees/feature-b

$ eval "$(worktree-manager.sh go feature-b)"
$ pwd
/home/user/myproject/.worktrees/feature-b

# Work on feature B
$ nvim src/feature-b.ts
$ git commit -m "feat: prototype feature B"

# Switch back to main repo
$ cd /home/user/myproject

# Both features isolated, no stashing needed
```

## Integration with Workflows

### /workflows:review Integration

When `/workflows:review` detects you're not on the target branch:

1. Offers worktree option
2. Calls this skill: `/git-worktree create pr-review-<number>`
3. Switches to worktree
4. Proceeds with review in isolation

### /workflows:work Integration

When starting feature work:

1. Asks if you want isolated environment
2. Calls: `/git-worktree create <branch-name>`
3. Copies .env files automatically
4. Starts feature work in worktree

## Troubleshooting

### "Worktree already exists"

**Cause:** Worktree directory or branch name already in use.

**Solution:**
```bash
# List existing worktrees
worktree-manager.sh list

# Remove specific worktree
git worktree remove .worktrees/<name>

# Or cleanup all inactive
worktree-manager.sh cleanup
```

### "Cannot remove current worktree"

**Cause:** Trying to remove the worktree you're currently in.

**Solution:**
```bash
# Switch to main repo or different worktree first
cd /path/to/main/repo

# Then cleanup
worktree-manager.sh cleanup
```

### Lost in Worktree

**Symptom:** Not sure which worktree you're in.

**Solution:**
```bash
# Check current branch
git branch --show-current

# List all worktrees with paths
worktree-manager.sh list

# Check current directory
pwd | grep -q ".worktrees" && echo "In worktree" || echo "In main repo"
```

### Missing .env Files

**Cause:** .env files not copied to worktree.

**Solution:**
```bash
# Copy .env files manually
worktree-manager.sh copy-env <worktree-name>
```

## Design Principles

### KISS (Keep It Simple, Stupid)

- One script does everything
- Clear command names
- No complex configuration
- Fails fast with clear errors

### Opinionated Defaults

- Worktrees always in `.worktrees/` directory
- Always branch from `main` (unless specified)
- Always copy .env files
- Branch name = worktree name (1:1 mapping)

### Safety First

- Never overwrites existing worktrees
- Requires confirmation for cleanup
- Adds .gitignore automatically
- Color-coded warnings and errors

## Reference

**Git worktree documentation:**
```bash
man git-worktree
```

**Common git worktree commands:**
```bash
git worktree list                    # List worktrees
git worktree remove <path>           # Remove specific worktree
git worktree prune                   # Clean up stale references
```

**But use the manager script instead** for consistent, safe operations.
