---
name: git-worktree
description: "Git worktree management for isolated parallel development. Use when reviewing PRs in isolation, working on multiple features simultaneously, or when workflows offer worktree option."
argument-hint: '[create|list|switch|cleanup] <name>'
user-invokable: true
---

# Git Worktree Manager

Manage git worktrees for isolated parallel development with a simple, safe
interface.

## What It Does

Creates and manages git worktrees — separate working directories from the same
repository that allow you to:

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

# Or create shell function
wtgo() { eval "$(worktree-manager.sh go "$1")"; }
```

### copy-env

Copy .env files to a worktree:

```bash
worktree-manager.sh copy-env <name>
```

Copies all `.env*` files from main repo to specified worktree. Useful if you've
updated environment configuration and need to sync.

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

## Auto-Trust mise/direnv After Worktree Creation

If your project uses [mise](https://mise.jdx.dev/) (`.mise.toml`,
`.tool-versions`) or [direnv](https://direnv.net/) (`.envrc`), the new
worktree directory starts **untrusted** — the tool refuses to load
configs until the user explicitly opts in. This breaks the principle of
least surprise: you create a worktree, `cd` in, and tooling silently
fails to load.

The fix is to auto-trust the new worktree directory at creation time.
The manager script handles common cases; the patterns below show how to
do it explicitly when needed (e.g., a CI runner creating a throwaway
worktree).

**mise:**

```bash
# After: worktree-manager.sh create feature-auth
cd .worktrees/feature-auth

# Trust the worktree's mise config
mise trust 2>/dev/null || true

# Or trust without cd (mise --cwd is supported on recent versions)
mise --cwd .worktrees/feature-auth trust 2>/dev/null || true
```

**direnv:**

```bash
# direnv requires both `allow` and a load on entry
cd .worktrees/feature-auth
direnv allow 2>/dev/null || true

# Or non-interactively
direnv allow .worktrees/feature-auth 2>/dev/null || true
```

**Suppress on absent tools:** `2>/dev/null || true` keeps the trust step
quiet when neither mise nor direnv is installed. Do **not** drop the
redirect — without it, missing-binary stderr leaks into worktree
creation logs.

**Why this is per-worktree:** mise and direnv key trust on the absolute
path of the directory containing the config. A worktree at
`.worktrees/feature-auth/` is a different absolute path from the main
repo, even when the `.mise.toml` content is identical.

## `.git`-Is-a-File Detection (Submodule and Worktree Cases)

In a normal repo, `.git` is a directory. But in two important cases it
is a **plain file** containing a `gitdir: <path>` pointer:

1. **Inside a submodule:** the submodule's `.git` is a file pointing at
   `<superproject>/.git/modules/<submodule-name>`.
2. **Inside an existing worktree:** the worktree's `.git` is a file
   pointing at `<main-repo>/.git/worktrees/<worktree-name>`.

Naive scripts that do `[ -d .git ]` to detect a git repo will misclassify
both cases as "not a git repo" and fail in confusing ways.

**Detection pattern:**

```bash
# Correct: handles both directory and file forms
is_git_repo() {
    [ -e .git ] && git rev-parse --git-dir >/dev/null 2>&1
}

# Or check the type explicitly
git_dir_kind() {
    if [ -d .git ]; then
        echo "directory"   # main repo
    elif [ -f .git ]; then
        # Read the gitdir pointer to know whether it's a worktree or submodule
        case "$(head -n 1 .git)" in
            "gitdir: "*/.git/worktrees/*) echo "worktree" ;;
            "gitdir: "*/.git/modules/*)   echo "submodule" ;;
            "gitdir: "*)                  echo "linked" ;;
            *)                            echo "unknown" ;;
        esac
    else
        echo "none"
    fi
}
```

**Worktree creation inside a submodule:** Avoid creating a worktree
**inside** a directory whose `.git` is the submodule pointer file —
`git worktree add` from a submodule treats the submodule's gitdir as
the parent, which lands the new worktree under
`<superproject>/.git/modules/<sub>/worktrees/`, far from where users
expect. Always run worktree commands from the **superproject root**, or
explicitly pass `-C <superproject-root>` to `git worktree add`.

**Why this matters for the manager script:** the helper resolves
`get_repo_root` via `git rev-parse --show-toplevel`, which already
returns the correct top-level whether `.git` is a file or directory.
But any caller that pre-checks `[ -d .git ]` before invoking the helper
will short-circuit incorrectly. Use `git rev-parse --git-dir` (which
handles both forms) instead.

## Troubleshooting

See [troubleshooting.md](troubleshooting.md) for common issues and solutions.

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
