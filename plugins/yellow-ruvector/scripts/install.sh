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

# --- Verify Node.js version >= 18 ---
node_version=$(node --version 2>/dev/null | sed 's/^v//') || true
node_major="${node_version%%.*}"
# Validate node_major is numeric before arithmetic comparison
case "$node_major" in
  ''|*[!0-9]*) error "Could not parse Node.js version. Found: '${node_version:-none}'. Update from: https://nodejs.org/" ;;
esac
if [ "$node_major" -lt 18 ]; then
  error "Node.js 18+ required. Found: v${node_version}. Update from: https://nodejs.org/"
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
if npm_output=$(npm "${install_args[@]}" 2>&1); then
  true
elif npm_output=$(npm "${install_args[@]}" --prefix "${HOME:?HOME not set}/.local" 2>&1); then
  warning "Installed to ~/.local — ensure ~/.local/bin is in your PATH"
  if ! printf '%s' "$PATH" | grep -qF "$HOME/.local/bin"; then
    warning "Add to your shell profile: export PATH=\"\$HOME/.local/bin:\$PATH\""
  fi
else
  printf '%s\n' "$npm_output" >&2
  error "npm install failed. Try: npm install -g ruvector --ignore-scripts"
fi

# --- Verify installation ---
if ! command -v npx >/dev/null 2>&1; then
  error "npx not found in PATH after install. Check your npm configuration."
fi

installed_version=$(npx ruvector --version 2>/dev/null || true)
if [ -z "$installed_version" ]; then
  error "ruvector installed but 'npx ruvector --version' failed. Check your npm/npx setup."
fi

success "ruvector ${installed_version} installed successfully"
