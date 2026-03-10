#!/bin/bash
set -Eeuo pipefail

# install.sh — Install ruvector CLI for yellow-ruvector plugin
# Usage: bash install.sh [--version <version>]

readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[0;33m'
readonly NC='\033[0m'

RUVECTOR_DEFAULT_VERSION="latest"
RUVECTOR_VERSION=""
REQUIRED_NODE_VERSION="22.22.0"

version_lt() {
  local left="$1"
  local right="$2"
  local left_major left_minor left_patch
  local right_major right_minor right_patch

  IFS='.' read -r left_major left_minor left_patch <<EOF
$left
EOF
  IFS='.' read -r right_major right_minor right_patch <<EOF
$right
EOF

  left_minor=${left_minor:-0}
  left_patch=${left_patch:-0}
  right_minor=${right_minor:-0}
  right_patch=${right_patch:-0}

  if [ "$left_major" -lt "$right_major" ]; then
    return 0
  fi
  if [ "$left_major" -gt "$right_major" ]; then
    return 1
  fi
  if [ "$left_minor" -lt "$right_minor" ]; then
    return 0
  fi
  if [ "$left_minor" -gt "$right_minor" ]; then
    return 1
  fi
  if [ "$left_patch" -lt "$right_patch" ]; then
    return 0
  fi

  return 1
}

error() {
  printf '%bError: %s%b\n' "$RED" "$1" "$NC" >&2
  exit 1
}

warning() {
  printf '%bWarning: %s%b\n' "$YELLOW" "$1" "$NC" >&2
}

success() {
  printf '%b%s%b\n' "$GREEN" "$1" "$NC"
}

cleanup() {
  local exit_code=$?
  if [ $exit_code -ne 0 ]; then
    warning "Installation failed. Partial install may remain."
    warning "To clean up: npm uninstall -g ruvector"
  fi
}
trap cleanup EXIT

# --- Parse arguments ---
while [ $# -gt 0 ]; do
  case "$1" in
    --version)
      shift
      RUVECTOR_VERSION="${1:-}"
      if [ -z "$RUVECTOR_VERSION" ]; then
        error "--version requires a value (e.g., --version 0.1.23)"
      fi
      shift
      ;;
    --)
      shift
      break
      ;;
    -*)
      error "Unknown option: $1"
      ;;
    *)
      break
      ;;
  esac
done

# --- Dependency checks ---
check_dependency() {
  local cmd="$1"
  local install_url="$2"

  if ! command -v "$cmd" >/dev/null 2>&1; then
    error "$cmd is required but not found. Install from: $install_url"
  fi
}

check_dependency "node" "https://nodejs.org/"
check_dependency "npm" "https://nodejs.org/"
check_dependency "jq" "https://jqlang.github.io/jq/"

# --- Verify Node.js version >= 22.22.0 ---
node_version=$(node --version 2>/dev/null | sed 's/^v//') || true
case "$node_version" in
  ''|*[!0-9.]*|*.*.*.*) error "Could not parse Node.js version. Found: '${node_version:-none}'. Update from: https://nodejs.org/" ;;
esac
if version_lt "$node_version" "$REQUIRED_NODE_VERSION"; then
  error "Node.js ${REQUIRED_NODE_VERSION} or later required. Found: v${node_version}. Update from: https://nodejs.org/"
fi

# --- Detect version manager (nvm/fnm) ---
if [ -n "${NVM_DIR:-}" ] || [ -d "${HOME}/.nvm" ]; then
  warning "nvm detected. Global npm binaries are per-Node-version and may disappear after 'nvm use <other-version>'."
fi
if [ -n "${FNM_DIR:-}" ] || [ -d "${HOME}/.fnm" ] || command -v fnm >/dev/null 2>&1; then
  warning "fnm detected. Global npm binaries are per-Node-version and may not persist across shell restarts."
fi

# --- Detect OS/arch ---
os=$(uname -s)
arch=$(uname -m)
printf 'Platform: %s/%s, Node: v%s\n' "$os" "$arch" "$node_version"

# --- Install ruvector ---
printf 'Installing ruvector...\n'

install_version="${RUVECTOR_VERSION:-$RUVECTOR_DEFAULT_VERSION}"
install_args=("install" "-g" "--ignore-scripts")
if [ "$install_version" != "latest" ]; then
  install_args+=("ruvector@${install_version}")
else
  install_args+=("ruvector")
fi

# Try global install first; fall back to --prefix if no permissions
npm_output=""
install_path="global"
if npm_output=$(npm "${install_args[@]}" 2>&1); then
  true
elif npm_output=$(npm "${install_args[@]}" --prefix "${HOME:?HOME not set}/.local" 2>&1); then
  install_path="local"
  warning "Installed to ~/.local prefix"
  # Ensure ~/.local/bin is in PATH for verification and inform user
  local_bin="${HOME}/.local/bin"
  path_needs_update=false
  if ! printf '%s' "$PATH" | tr ':' '\n' | grep -qxF "$local_bin"; then
    path_needs_update=true
    # Detect user's login shell rc file for the suggestion
    case "$(basename "${SHELL:-}")" in
      zsh)  rc_file="${HOME}/.zshrc" ;;
      bash) rc_file="${HOME}/.bashrc" ;;
      *)    rc_file="${HOME}/.profile" ;;
    esac
    warning "${local_bin} is not in PATH."
    warning "Add this line to ${rc_file}:"
    warning "  export PATH=\"${local_bin}:\$PATH\""
    warning "Then restart your shell or run: source ${rc_file}"
    # Export for current subshell (won't propagate to parent, but helps verification below)
    export PATH="${local_bin}:${PATH}"
  fi
else
  printf '%s\n' "$npm_output" >&2
  error "npm install failed. Try: npm install -g ruvector --ignore-scripts"
fi

# --- Verify installation (global binary required) ---
if ! command -v ruvector >/dev/null 2>&1; then
  # Try to detect where npm installed it
  npm_global_prefix=$(npm prefix -g 2>/dev/null || true)
  npm_global_bin="${npm_global_prefix}/bin"
  if [ -n "$npm_global_prefix" ] && [ -x "${npm_global_bin}/ruvector" ]; then
    error "ruvector installed at ${npm_global_bin}/ruvector but that directory is not in PATH. Add to your shell profile: export PATH=\"${npm_global_bin}:\$PATH\""
  fi
  error "ruvector global binary not found in PATH after install. Hooks with 1-second budgets require the global binary (npx adds ~1900ms overhead). Try: npm install -g ruvector --ignore-scripts"
fi

installed_version=$(ruvector --version 2>/dev/null || true)
if [ -z "$installed_version" ]; then
  error "ruvector binary found but 'ruvector --version' failed. Try reinstalling: npm install -g ruvector --ignore-scripts"
fi

if [ "$install_path" = "local" ]; then
  if [ "$path_needs_update" = "true" ]; then
    success "ruvector ${installed_version} installed to ~/.local/bin — restart your shell to use it"
  else
    success "ruvector ${installed_version} installed to ~/.local/bin (already in PATH)"
  fi
else
  success "ruvector ${installed_version} installed successfully (global binary in PATH)"
fi
