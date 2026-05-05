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

## Missing `.ruvector/` Symlink in Worktree

**Symptom:** Inside the worktree, ruvector recall returns empty results,
`/ruvector:status` shows zero memories, or hooks log nothing — even though
the main repo's `.ruvector/` has an active DB.

**Cause:** The worktree was created before yellow-core started injecting the
`.ruvector` symlink, OR the main repo had no `.ruvector/` when the worktree
was created (so the symlink was skipped to avoid a dangling link).

**Solution:**

```bash
# 1. Make sure the main repo has a .ruvector/ directory
cd /path/to/main/repo
ls -d .ruvector/   # must exist; if not, run /ruvector:setup

# 2. Repair the symlink in the existing worktree
worktree-manager.sh copy-env <worktree-name>

# 3. Verify
ls -la .worktrees/<worktree-name>/.ruvector
# expected: lrwxrwxrwx  ...  .ruvector -> /path/to/main/repo/.ruvector
```

If the worktree already has a real `.ruvector/` directory (from a previous
isolated setup), `copy-env` will warn and skip — preserving your isolated
DB. To switch that worktree to the shared main DB, remove the real
directory first (`rm -rf .worktrees/<name>/.ruvector`) and re-run `copy-env`.
