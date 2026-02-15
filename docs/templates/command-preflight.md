# Command Preflight Template

Add these checks to commands that modify state (create branches, commits, PRs, etc.). Only include checks relevant to your command — don't add unnecessary validation.

## Template

```bash
# === PREFLIGHT CHECKS ===

# 1. Verify git repository
if ! git rev-parse --git-dir > /dev/null 2>&1; then
  printf 'Error: Not a git repository\n' >&2
  exit 1
fi

# 2. Verify required commands
for cmd in git gh gt jq; do  # Adjust per command
  if ! command -v "$cmd" > /dev/null 2>&1; then
    printf 'Error: Required command not found: %s\n' "$cmd" >&2
    exit 1
  fi
done

# 3. Verify clean working tree (if command requires it)
if ! git diff-index --quiet HEAD --; then
  printf 'Error: Working tree has uncommitted changes. Commit or stash first.\n' >&2
  exit 1
fi

# 4. Warn if on main branch
current_branch=$(git branch --show-current)
case "$current_branch" in
  main|master)
    printf 'Warning: Currently on %s branch\n' "$current_branch" >&2
    ;;
esac

# === END PREFLIGHT ===
```

## Which Checks to Include

| Command Type | Git Repo | Commands | Clean Tree | Branch Check |
|-------------|----------|----------|-----------|-------------|
| Read-only (status, search) | Yes | Minimal | No | No |
| Creates branches/commits | Yes | git, gt | Yes | Yes |
| Creates PRs | Yes | git, gt, gh | Yes | Yes |
| API calls (curl) | No | curl, jq | No | No |
| MCP operations | No | None | No | No |

## Guidelines

- Keep preflight under 30 lines
- Provide remediation in error messages (not just "failed")
- Use `command -v` not `which` (POSIX portable)
- Quote all variables: `"$cmd"` not `$cmd`
- Exit early on first failure — don't accumulate errors
