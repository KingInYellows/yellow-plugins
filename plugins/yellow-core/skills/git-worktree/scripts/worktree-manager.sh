#!/bin/sh
# Git Worktree Manager
# POSIX-compatible script for managing git worktrees

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
WORKTREE_DIR=".worktrees"
DEFAULT_BASE_BRANCH="main"

# Validate a branch/worktree name to prevent path traversal and injection
validate_name() {
    name="$1"
    label="${2:-Name}"

    if [ -z "$name" ]; then
        return 0  # Empty check handled by callers
    fi

    # Reject path traversal
    case "$name" in
        *..* | /* | *~*)
            error "${label} contains forbidden characters: ${name}"
            ;;
    esac

    # Only allow alphanumeric, hyphens, underscores, slashes, and dots (no leading dot/dash)
    if ! printf '%s' "$name" | grep -qE '^[a-zA-Z0-9][a-zA-Z0-9._/-]*$'; then
        error "${label} must start with alphanumeric and contain only [a-zA-Z0-9._/-]: ${name}"
    fi
}

# Helper functions
error() {
    printf '%sError: %s%s\n' "$RED" "$1" "$NC" >&2
    exit 1
}

warning() {
    printf '%sWarning: %s%s\n' "$YELLOW" "$1" "$NC" >&2
}

success() {
    printf '%s%s%s\n' "$GREEN" "$1" "$NC"
}

info() {
    printf '%s%s%s\n' "$BLUE" "$1" "$NC"
}

# Get repository root
get_repo_root() {
    git rev-parse --show-toplevel 2>/dev/null || error "Not in a git repository"
}

# Ensure .worktrees directory exists
ensure_worktree_dir() {
    repo_root="$1"
    worktree_path="${repo_root}/${WORKTREE_DIR}"

    if [ ! -d "$worktree_path" ]; then
        mkdir -p "$worktree_path"
        info "Created ${WORKTREE_DIR}/ directory"
    fi
}

# Ensure .worktrees is in .gitignore
ensure_gitignore() {
    repo_root="$1"
    gitignore="${repo_root}/.gitignore"

    if [ ! -f "$gitignore" ]; then
        echo "${WORKTREE_DIR}/" > "$gitignore"
        success "Created .gitignore with ${WORKTREE_DIR}/"
        return
    fi

    if ! grep -qF "${WORKTREE_DIR}/" "$gitignore"; then
        echo "${WORKTREE_DIR}/" >> "$gitignore"
        success "Added ${WORKTREE_DIR}/ to .gitignore"
    fi
}

# Copy .env files from main repo to worktree (skip symlinks)
copy_env_files() {
    repo_root="$1"
    target_path="$2"

    # Find all .env* files in repo root, skip symlinks to prevent leaking external files
    for env_file in "${repo_root}"/.env*; do
        if [ -f "$env_file" ] && [ ! -L "$env_file" ]; then
            filename=$(basename "$env_file")
            cp -- "$env_file" "${target_path}/${filename}"
            info "Copied ${filename}"
        elif [ -L "$env_file" ]; then
            warning "Skipping symlink: $(basename "$env_file")"
        fi
    done
}

# Create worktree
cmd_create() {
    branch_name="$1"
    from_branch="${2:-${DEFAULT_BASE_BRANCH}}"

    if [ -z "$branch_name" ]; then
        error "Branch name required: worktree-manager.sh create <branch-name> [from-branch]"
    fi

    validate_name "$branch_name" "Branch name"
    validate_name "$from_branch" "Base branch"

    repo_root=$(get_repo_root)
    worktree_path="${repo_root}/${WORKTREE_DIR}/${branch_name}"

    # Check if worktree already exists
    if [ -d "$worktree_path" ]; then
        error "Worktree already exists: ${worktree_path}"
    fi

    ensure_worktree_dir "$repo_root"
    ensure_gitignore "$repo_root"

    # Create worktree
    info "Creating worktree: ${branch_name} from ${from_branch}"
    # Try creating with new branch (-b), fall back to existing branch
    if ! git worktree add -b "$branch_name" "$worktree_path" -- "$from_branch" 2>/dev/null; then
        git worktree add "$worktree_path" "$branch_name" || error "Failed to create worktree"
    fi

    # Copy .env files
    copy_env_files "$repo_root" "$worktree_path"

    success "Created worktree: ${WORKTREE_DIR}/${branch_name}"
    info "Switch to it: cd ${worktree_path}"
}

# List worktrees
cmd_list() {
    repo_root=$(get_repo_root)

    info "Worktrees:"
    git worktree list | while IFS= read -r line; do
        # Extract path and branch
        path=$(echo "$line" | awk '{print $1}')
        branch=$(echo "$line" | grep -o '\[.*\]' | tr -d '[]')
        status=$(echo "$line" | grep -o '([^)]*)' | tr -d '()')

        # Highlight current worktree (exact match, not substring)
        if [ "$path" = "$(pwd)" ]; then
            printf '  %s* %s%s\t%s %s\n' "$GREEN" "$branch" "$NC" "$path" "${status:+($status)}"
        else
            printf '    %s\t%s %s\n' "$branch" "$path" "${status:+($status)}"
        fi
    done
}

# Switch to worktree
cmd_switch() {
    name="$1"

    if [ -z "$name" ]; then
        error "Worktree name required: worktree-manager.sh switch <name>"
    fi

    validate_name "$name" "Worktree name"

    repo_root=$(get_repo_root)

    # Try exact match first
    worktree_path="${repo_root}/${WORKTREE_DIR}/${name}"

    if [ -d "$worktree_path" ]; then
        # Output cd command for shell evaluation
        echo "cd \"${worktree_path}\""
        return
    fi

    # Try to find by branch name (use porcelain for robust parsing)
    target_path=$(git worktree list --porcelain | awk -v branch="refs/heads/${name}" '
        /^worktree /{ path = substr($0, 10) }
        /^branch / && $2 == branch { print path }
    ')

    if [ -z "$target_path" ]; then
        error "Worktree not found: ${name}"
    fi

    echo "cd \"${target_path}\""
}

# Copy .env files to worktree
cmd_copy_env() {
    name="$1"

    if [ -z "$name" ]; then
        error "Worktree name required: worktree-manager.sh copy-env <name>"
    fi

    validate_name "$name" "Worktree name"

    repo_root=$(get_repo_root)
    worktree_path="${repo_root}/${WORKTREE_DIR}/${name}"

    if [ ! -d "$worktree_path" ]; then
        error "Worktree not found: ${worktree_path}"
    fi

    copy_env_files "$repo_root" "$worktree_path"
    success "Copied .env files to ${name}"
}

# Cleanup worktrees
cmd_cleanup() {
    repo_root=$(get_repo_root)
    current_path=$(pwd)

    info "Current worktrees:"
    git worktree list

    printf '\n%sRemove all inactive worktrees? (y/N): %s' "$YELLOW" "$NC"
    read -r response

    if [ "$response" != "y" ] && [ "$response" != "Y" ]; then
        info "Cleanup cancelled"
        return
    fi

    # Get list of worktrees (skip main repo)
    git worktree list --porcelain | grep "^worktree " | sed 's/^worktree //' | while IFS= read -r path; do
        # Skip if it's the current directory
        if [ "$path" = "$current_path" ]; then
            warning "Skipping current worktree: ${path}"
            continue
        fi

        # Skip if it's the main repo
        if [ "$path" = "$repo_root" ]; then
            continue
        fi

        # Remove worktree
        info "Removing: ${path}"
        git worktree remove "$path" || warning "Failed to remove: ${path}"
    done

    # Remove .worktrees directory if empty
    if [ -d "${repo_root}/${WORKTREE_DIR}" ]; then
        if [ -z "$(ls -A "${repo_root}/${WORKTREE_DIR}")" ]; then
            rmdir "${repo_root}/${WORKTREE_DIR}"
            success "Removed empty ${WORKTREE_DIR}/ directory"
        fi
    fi

    success "Cleanup complete"
}

# Main command router
main() {
    if [ $# -eq 0 ]; then
        error "Command required. Usage: worktree-manager.sh <command> [args]\nCommands: create, list, switch, copy-env, cleanup"
    fi

    command="$1"
    shift

    case "$command" in
        create)
            cmd_create "$@"
            ;;
        list|ls)
            cmd_list
            ;;
        switch|go)
            cmd_switch "$@"
            ;;
        copy-env)
            cmd_copy_env "$@"
            ;;
        cleanup|clean)
            cmd_cleanup
            ;;
        *)
            error "Unknown command: ${command}\nCommands: create, list, switch, copy-env, cleanup"
            ;;
    esac
}

main "$@"
