#!/bin/bash
set -Eeuo pipefail

# install-ast-grep.sh — Install ast-grep CLI for yellow-research plugin
# Usage: bash install-ast-grep.sh [--yes]

readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[0;33m'
readonly NC='\033[0m'

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
    warning "To clean up: npm uninstall -g @ast-grep/cli"
  fi
}
trap cleanup EXIT

# --- Parse arguments ---
AUTO_YES=false
while [ $# -gt 0 ]; do
  case "$1" in
    --yes)
      AUTO_YES=true
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

# --- Check if already installed ---
if command -v ast-grep >/dev/null 2>&1; then
  installed_version=$(ast-grep --version 2>/dev/null || true)
  success "ast-grep already installed: ${installed_version:-unknown version}"
  exit 0
fi

# --- Dependency checks ---
if ! command -v npm >/dev/null 2>&1; then
  error "npm is required but not found. Install Node.js from: https://nodejs.org/"
fi

# --- Detect version manager (nvm/fnm) ---
has_nvm=false
if [ -n "${NVM_DIR:-}" ] || [ -d "${HOME}/.nvm" ]; then
  has_nvm=true
  warning "nvm detected. Global npm binaries are per-Node-version and may disappear after 'nvm use <other-version>'."
fi
if [ -n "${FNM_DIR:-}" ] || [ -d "${HOME}/.fnm" ] || command -v fnm >/dev/null 2>&1; then
  warning "fnm detected. Global npm binaries are per-Node-version and may not persist across shell restarts."
fi

# --- Detect OS/arch ---
os=$(uname -s)
arch=$(uname -m)
printf '[yellow-research] Platform: %s/%s\n' "$os" "$arch"

# --- Install ast-grep ---
printf '[yellow-research] Installing ast-grep via npm...\n'

# @ast-grep/cli ships pre-built native binaries via optionalDependencies
# (no source compilation or node-gyp needed)
npm_output=""
install_path="global"

if npm_output=$(npm install -g @ast-grep/cli 2>&1); then
  true
elif [ "$has_nvm" = "true" ]; then
  # NVM manages its own prefix — don't fall back to --prefix ~/.local
  # as it would install to a different location than NVM expects
  printf '%s\n' "$npm_output" >&2
  error "npm install failed under nvm. Check nvm permissions or try: nvm install-latest-npm"
elif npm_output=$(npm install -g @ast-grep/cli --prefix "${HOME:?HOME not set}/.local" 2>&1); then
  install_path="local"
  warning "Installed to ~/.local prefix"
  local_bin="${HOME}/.local/bin"
  path_needs_update=false
  if ! printf '%s' "$PATH" | tr ':' '\n' | grep -qxF "$local_bin"; then
    path_needs_update=true
    case "$(basename "${SHELL:-}")" in
      zsh)  rc_file="${HOME}/.zshrc" ;;
      bash) rc_file="${HOME}/.bashrc" ;;
      *)    rc_file="${HOME}/.profile" ;;
    esac
    warning "${local_bin} is not in PATH."
    warning "Add this line to ${rc_file}:"
    warning "  export PATH=\"${local_bin}:\$PATH\""
    warning "Then restart your shell or run: source ${rc_file}"
    export PATH="${local_bin}:${PATH}"
  fi
else
  printf '%s\n' "$npm_output" >&2
  cat >&2 <<'INSTRUCTIONS'
npm install failed. Install ast-grep manually using one of:
  npm install -g @ast-grep/cli   (Node.js)
  brew install ast-grep          (macOS/Linux)
  pip install ast-grep-cli       (Python)
  cargo install ast-grep --locked (Rust)
Then re-run /research:setup
INSTRUCTIONS
  error "npm install -g @ast-grep/cli failed."
fi

# --- Verify installation ---
if ! command -v ast-grep >/dev/null 2>&1; then
  npm_global_prefix=$(npm prefix -g 2>/dev/null || true)
  npm_global_bin="${npm_global_prefix}/bin"
  if [ -n "$npm_global_prefix" ] && [ -x "${npm_global_bin}/ast-grep" ]; then
    error "ast-grep installed at ${npm_global_bin}/ast-grep but that directory is not in PATH. Add to your shell profile: export PATH=\"${npm_global_bin}:\$PATH\""
  fi
  error "ast-grep not found in PATH after install."
fi

installed_version=$(ast-grep --version 2>/dev/null || true)
if [ -z "$installed_version" ]; then
  error "ast-grep binary found but 'ast-grep --version' failed. Try reinstalling."
fi

if [ "$install_path" = "local" ]; then
  if [ "${path_needs_update:-false}" = "true" ]; then
    success "ast-grep ${installed_version} installed to ~/.local/bin — restart your shell to use it"
  else
    success "ast-grep ${installed_version} installed to ~/.local/bin (already in PATH)"
  fi
else
  success "ast-grep ${installed_version} installed successfully (global binary in PATH)"
fi
