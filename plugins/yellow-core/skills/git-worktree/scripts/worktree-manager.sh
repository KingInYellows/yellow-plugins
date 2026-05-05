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

# Get repository root (worktree-relative — returns the worktree root when run
# inside a worktree, not the main repo root). Use get_main_repo_root for the
# main repo path.
get_repo_root() {
    git rev-parse --show-toplevel 2>/dev/null || error "Not in a git repository"
}

# Get the MAIN repo root (not a worktree root, not the .git dir). Required for
# operations that must point at the main repo from any worktree (e.g. the
# .ruvector symlink target). Requires git >= 2.5 (--git-common-dir).
#
# git rev-parse --git-common-dir is asymmetric:
#   - main repo root           : ".git"          (literal, relative)
#   - main repo subdirectory   : "../../.git"    (relative)
#   - linked worktree (any)    : "/abs/.git"     (absolute)
#   - git < 2.5                : "--git-common-dir" (echoed back unchanged)
get_main_repo_root() {
    # Capture stdout+stderr together: on success $common is the common dir;
    # on failure it carries git's diagnostic, which we surface in the error
    # message so corrupt-repo / permission failures aren't silent "not a repo".
    if ! common=$(git rev-parse --git-common-dir 2>&1); then
        error "git rev-parse --git-common-dir failed: ${common:-unknown}"
    fi

    case "$common" in
        --*)
            error "git >= 2.5 required for --git-common-dir; got: ${common}"
            ;;
        .git)
            printf '%s' "$PWD"
            ;;
        */.git)
            # Absolute (worktree) or relative-with-slash (subdir) — strip /.git.
            # Resolve via cd to handle the relative case uniformly.
            stripped="${common%/.git}"
            case "$stripped" in
                /*) printf '%s' "$stripped" ;;
                *)
                    resolved=$(cd "$stripped" 2>/dev/null && pwd) \
                        || error "could not resolve git common dir: ${common}"
                    printf '%s' "$resolved"
                    ;;
            esac
            ;;
        *)
            # Bare repo or unusual setup; resolve as-is via cd
            resolved=$(cd "$common" 2>/dev/null && pwd) \
                || error "could not resolve git common dir: ${common}"
            printf '%s' "$resolved"
            ;;
    esac
}

# Ensure .worktrees directory exists.
# POSIX sh has no `local`; use unique variable names to avoid clobbering
# globals in callers (e.g. cmd_create's `worktree_path`).
ensure_worktree_dir() {
    _ewd_root="$1"
    _ewd_dir="${_ewd_root}/${WORKTREE_DIR}"

    if [ ! -d "$_ewd_dir" ]; then
        mkdir -p "$_ewd_dir"
        info "Created ${WORKTREE_DIR}/ directory"
    fi
}

# Ensure .worktrees is in .gitignore.
# Same naming discipline as ensure_worktree_dir.
ensure_gitignore() {
    _eg_root="$1"
    _eg_file="${_eg_root}/.gitignore"

    if [ ! -f "$_eg_file" ]; then
        echo "${WORKTREE_DIR}/" > "$_eg_file"
        success "Created .gitignore with ${WORKTREE_DIR}/"
        return
    fi

    if ! grep -qF "${WORKTREE_DIR}/" "$_eg_file"; then
        echo "${WORKTREE_DIR}/" >> "$_eg_file"
        success "Added ${WORKTREE_DIR}/ to .gitignore"
    fi
}

# Copy .env files from main repo to worktree (skip symlinks).
# Same naming discipline as ensure_worktree_dir / link_ruvector_db: namespaced
# prefixes so no caller's globals get clobbered (POSIX sh has no `local`).
copy_env_files() {
    _cef_root="$1"
    _cef_target="$2"

    # Find all .env* files in repo root, skip symlinks to prevent leaking external files
    for _cef_file in "${_cef_root}"/.env*; do
        if [ -f "$_cef_file" ] && [ ! -L "$_cef_file" ]; then
            _cef_name=$(basename "$_cef_file")
            cp -- "$_cef_file" "${_cef_target}/${_cef_name}"
            info "Copied ${_cef_name}"
        elif [ -L "$_cef_file" ]; then
            warning "Skipping symlink: $(basename "$_cef_file")"
        fi
    done
}

# Link the main repo's .ruvector/ into a worktree so the ruvector MCP server
# (RUVECTOR_STORAGE_PATH=${PWD}/.ruvector/) reaches the project DB instead of a
# missing directory. Idempotent.
#
# Skips with info if a symlink already exists.
# Skips with warning if a real .ruvector/ directory exists (preserves user's
# intentional isolated DB if they bypassed worktree-manager.sh).
# Skips with warning if main has no .ruvector/ yet (no dangling links).
link_ruvector_db() {
    _lrd_main="$1"
    _lrd_wt="$2"
    _lrd_link="${_lrd_wt}/.ruvector"
    _lrd_target="${_lrd_main}/.ruvector"

    if [ -L "$_lrd_link" ]; then
        # [ -L ] is true for both live and dangling symlinks. [ -e ] follows
        # the link; false → dangling. Repair by removing the stale link and
        # falling through to recreate (so copy-env actually fixes things).
        if [ ! -e "$_lrd_link" ]; then
            warning "Removing dangling .ruvector symlink at ${_lrd_link} (target no longer exists)"
            rm -- "$_lrd_link" || {
                warning "Could not remove dangling symlink at ${_lrd_link}; leaving as-is"
                return 0
            }
        else
            info "ruvector DB symlink already present in worktree"
            return 0
        fi
    fi
    if [ -e "$_lrd_link" ] && [ ! -L "$_lrd_link" ]; then
        warning "Worktree has a real .ruvector/ directory; skipping symlink (this worktree uses an isolated DB)"
        return 0
    fi
    if [ ! -d "$_lrd_target" ]; then
        warning "Main .ruvector/ not found at ${_lrd_target}; skipping symlink (initialize ruvector first, then run copy-env)"
        return 0
    fi

    # Use warning (not error) on ln failure: the worktree was already created
    # by git worktree add. Aborting here leaves an orphan worktree the user
    # may not notice. Degraded state (worktree without symlink) is recoverable
    # via `worktree-manager.sh copy-env <name>` — surface that path explicitly.
    #
    # No `--` separator: POSIX `ln` does not specify it and BSD/macOS `ln`
    # rejects it. Both paths originate from git/validate_name and cannot
    # begin with `-`, so the separator is unnecessary.
    if ! ln -s "$_lrd_target" "$_lrd_link"; then
        warning "Failed to create .ruvector symlink at ${_lrd_link}; worktree usable without ruvector. Retry: worktree-manager.sh copy-env <name>"
        return 0
    fi
    info "Linked .ruvector -> ${_lrd_target}"
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

    # Link main repo's .ruvector/ so MCP server and hooks reach the shared DB.
    # `|| exit 1` is required: dash's `set -e` does not propagate failures from
    # command substitutions inside assignments, so without this an empty
    # main_root would silently link to /.ruvector.
    main_root=$(get_main_repo_root) || exit 1
    link_ruvector_db "$main_root" "$worktree_path"

    success "Created worktree: ${WORKTREE_DIR}/${branch_name}"
    info "Switch to it: cd ${worktree_path}"
}

# List worktrees
cmd_list() {
    repo_root=$(get_repo_root)

    info "Worktrees:"
    git worktree list | while IFS= read -r line; do
        # Extract path and branch
        path=$(printf '%s' "$line" | awk '{print $1}')
        branch=$(printf '%s' "$line" | grep -o '\[.*\]' | tr -d '[]')
        status=$(printf '%s' "$line" | grep -o '([^)]*)' | tr -d '()')

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

    # Repair missing ruvector symlink for retroactive worktree fixups.
    # See cmd_create for why `|| exit 1` is required (dash command-sub gotcha).
    main_root=$(get_main_repo_root) || exit 1
    link_ruvector_db "$main_root" "$worktree_path"

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

        # Remove worktree. git's internal remove_dir_recurse uses lstat+unlink
        # so the .ruvector symlink is unlinked (never followed) as part of the
        # directory walk. On failure (dirty/locked worktree, no --force), the
        # whole tree is left intact so the worktree remains functional.
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
