# Git Worktree Troubleshooting

## "Worktree already exists"

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

## "Cannot remove current worktree"

**Cause:** Trying to remove the worktree you're currently in.

**Solution:**
```bash
# Switch to main repo or different worktree first
cd /path/to/main/repo

# Then cleanup
worktree-manager.sh cleanup
```

## Lost in Worktree

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

## Missing .env Files

**Cause:** .env files not copied to worktree.

**Solution:**
```bash
# Copy .env files manually
worktree-manager.sh copy-env <worktree-name>
```
