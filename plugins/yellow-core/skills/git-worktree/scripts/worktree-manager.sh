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

# Helper functions
error() {
    printf "${RED}Error: %s${NC}\n" "$1" >&2
    exit 1
}

warning() {
    printf "${YELLOW}Warning: %s${NC}\n" "$1" >&2
}

success() {
    printf "${GREEN}%s${NC}\n" "$1"
}

info() {
    printf "${BLUE}%s${NC}\n" "$1"
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

    if ! grep -q "^${WORKTREE_DIR}/" "$gitignore"; then
        echo "${WORKTREE_DIR}/" >> "$gitignore"
        success "Added ${WORKTREE_DIR}/ to .gitignore"
    fi
}

# Copy .env files from main repo to worktree
copy_env_files() {
    repo_root="$1"
    target_path="$2"

    # Find all .env* files in repo root
    for env_file in "${repo_root}"/.env*; do
        if [ -f "$env_file" ]; then
            filename=$(basename "$env_file")
            cp "$env_file" "${target_path}/${filename}"
            info "Copied ${filename}"
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
    git worktree add -b "$branch_name" "$worktree_path" "$from_branch" || error "Failed to create worktree"

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

        # Highlight current worktree
        if echo "$path" | grep -q "$(pwd)"; then
            printf "  ${GREEN}* %s${NC}\t%s %s\n" "$branch" "$path" "${status:+($status)}"
        else
            printf "    %s\t%s %s\n" "$branch" "$path" "${status:+($status)}"
        fi
    done
}

# Switch to worktree
cmd_switch() {
    name="$1"

    if [ -z "$name" ]; then
        error "Worktree name required: worktree-manager.sh switch <name>"
    fi

    repo_root=$(get_repo_root)

    # Try exact match first
    worktree_path="${repo_root}/${WORKTREE_DIR}/${name}"

    if [ -d "$worktree_path" ]; then
        # Output cd command for shell evaluation
        echo "cd \"${worktree_path}\""
        return
    fi

    # Try to find by branch name
    target_path=$(git worktree list | grep "\[${name}\]" | awk '{print $1}')

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

    printf "\n${YELLOW}Remove all inactive worktrees? (y/N): ${NC}"
    read -r response

    if [ "$response" != "y" ] && [ "$response" != "Y" ]; then
        info "Cleanup cancelled"
        return
    fi

    # Get list of worktrees (skip main repo)
    git worktree list --porcelain | grep "^worktree " | cut -d' ' -f2 | while IFS= read -r path; do
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
