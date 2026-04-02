#!/bin/bash
set -Eeuo pipefail

# install-codex.sh — Install OpenAI Codex CLI for yellow-codex plugin
# Usage: bash install-codex.sh

readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[0;33m'
readonly NC='\033[0m'

readonly MIN_CODEX_VERSION="0.118.0"
readonly MIN_NODE_MAJOR=22

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
    if [ "${install_path:-global}" = "local" ]; then
      warning "To clean up: npm uninstall -g @openai/codex --prefix ~/.local"
    else
      warning "To clean up: npm uninstall -g @openai/codex"
    fi
  fi
}
trap cleanup EXIT

# --- Semver comparison helper ---
version_gte() {
  local i av bv
  local -a a b
  IFS='.' read -r -a a <<< "$1"
  IFS='.' read -r -a b <<< "$2"
  for ((i=0; i<${#b[@]}; i++)); do
    av="${a[i]:-0}"
    bv="${b[i]:-0}"
    av="${av%%[^0-9]*}"
    bv="${bv%%[^0-9]*}"
    av="${av:-0}"
    bv="${bv:-0}"
    if ((av > bv)); then return 0; fi
    if ((av < bv)); then return 1; fi
  done
  return 0
}

# --- Check if already installed ---
if command -v codex >/dev/null 2>&1; then
  installed_version=$(codex --version 2>/dev/null | grep -Eo '[0-9]+(\.[0-9]+)+' | head -n1 || true)
  if [ -n "$installed_version" ] && version_gte "$installed_version" "$MIN_CODEX_VERSION"; then
    success "codex already installed: v${installed_version}"
    exit 0
  elif [ -n "$installed_version" ]; then
    warning "codex v${installed_version} is installed but v${MIN_CODEX_VERSION}+ is required. Upgrading..."
  else
    warning "codex is installed but version could not be determined. Attempting upgrade..."
  fi
fi

# --- Check for brew cask on macOS ---
os=$(uname -s)
if [ "$os" = "Darwin" ] && command -v brew >/dev/null 2>&1; then
  printf '[yellow-codex] macOS detected with Homebrew. Installing via brew cask...\n'
  if brew install --cask codex 2>&1; then
    if command -v codex >/dev/null 2>&1; then
      installed_version=$(codex --version 2>/dev/null | grep -Eo '[0-9]+(\.[0-9]+)+' | head -n1 || true)
      if [ -n "$installed_version" ] && version_gte "$installed_version" "$MIN_CODEX_VERSION"; then
        success "codex v${installed_version} installed via Homebrew cask"
        exit 0
      fi
      warning "Homebrew codex v${installed_version:-unknown} is below v${MIN_CODEX_VERSION}. Falling back to npm..."
    else
      warning "brew cask install completed but codex not on PATH. Falling back to npm..."
    fi
  else
    warning "brew cask install failed — falling back to npm"
  fi
fi

# --- Check Node.js version ---
if ! command -v node >/dev/null 2>&1; then
  error "Node.js is required but not found. Install Node.js >= ${MIN_NODE_MAJOR} from: https://nodejs.org/"
fi

node_major=$(node -e "console.log(process.versions.node.split('.')[0])")
if [ "$node_major" -lt "$MIN_NODE_MAJOR" ]; then
  error "Node.js >= ${MIN_NODE_MAJOR} required (found v${node_major}). Upgrade Node.js."
fi

# --- Dependency checks ---
if ! command -v npm >/dev/null 2>&1; then
  error "npm is required but not found. Install Node.js from: https://nodejs.org/"
fi

# --- Detect version manager (nvm/fnm) ---
has_version_mgr=false
npm_prefix=$(npm prefix -g 2>/dev/null || true)
if [ -n "${NVM_DIR:-}" ] && printf '%s' "$npm_prefix" | grep -q "${NVM_DIR}"; then
  has_version_mgr=true
  warning "nvm detected (npm managed by nvm). Global npm binaries are per-Node-version."
elif [ -d "${HOME}/.nvm" ] && printf '%s' "$npm_prefix" | grep -q ".nvm"; then
  has_version_mgr=true
  warning "nvm detected (npm managed by nvm). Global npm binaries are per-Node-version."
fi
if { [ -n "${FNM_DIR:-}" ] || [ -d "${HOME}/.fnm" ] || command -v fnm >/dev/null 2>&1; } && printf '%s' "$npm_prefix" | grep -q "fnm"; then
  has_version_mgr=true
  warning "fnm detected (npm managed by fnm). Global npm binaries are per-Node-version."
fi

# --- Detect OS/arch ---
arch=$(uname -m)
printf '[yellow-codex] Platform: %s/%s\n' "$os" "$arch"

# --- Install codex ---
printf '[yellow-codex] Installing @openai/codex via npm...\n'

npm_output=""
install_path="global"

if npm_output=$(npm install -g @openai/codex 2>&1); then
  true
elif [ "$has_version_mgr" = "true" ]; then
  printf '%s\n' "$npm_output" >&2
  error "npm install failed under version manager. Check permissions or try reinstalling npm."
elif printf '%s' "$npm_output" | grep -qi "EACCES\|permission denied\|EPERM"; then
  warning "Global install failed with permission error — retrying with --prefix ~/.local"
  if npm_output=$(npm install -g @openai/codex --prefix "${HOME:?HOME not set}/.local" 2>&1); then
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
    error "npm install -g @openai/codex --prefix ~/.local also failed."
  fi
else
  printf '%s\n' "$npm_output" >&2
  cat >&2 <<'INSTRUCTIONS'
npm install failed. Install codex manually using one of:
  npm install -g @openai/codex     (Node.js 22+)
  brew install --cask codex        (macOS)
  Download from: https://github.com/openai/codex/releases (standalone binary)
Then re-run /codex:setup
INSTRUCTIONS
  error "npm install -g @openai/codex failed."
fi

# --- Verify installation ---
if ! command -v codex >/dev/null 2>&1; then
  npm_global_prefix=$(npm prefix -g 2>/dev/null || true)
  npm_global_bin="${npm_global_prefix}/bin"
  if [ -n "$npm_global_prefix" ] && [ -x "${npm_global_bin}/codex" ]; then
    error "codex installed at ${npm_global_bin} but that directory is not in PATH. Add to your shell profile: export PATH=\"${npm_global_bin}:\$PATH\""
  fi
  error "codex not found in PATH after install."
fi

installed_version=$(codex --version 2>/dev/null | grep -Eo '[0-9]+(\.[0-9]+)+' | head -n1 || true)
if [ -z "$installed_version" ]; then
  error "codex binary found but 'codex --version' failed. Try reinstalling."
fi

if ! version_gte "$installed_version" "$MIN_CODEX_VERSION"; then
  warning "codex v${installed_version} installed but v${MIN_CODEX_VERSION}+ is recommended."
fi

if [ "$install_path" = "local" ]; then
  if [ "${path_needs_update:-false}" = "true" ]; then
    success "codex v${installed_version} installed to ~/.local/bin — restart your shell to use it"
  else
    success "codex v${installed_version} installed to ~/.local/bin (already in PATH)"
  fi
else
  success "codex v${installed_version} installed successfully (global binary in PATH)"
fi
