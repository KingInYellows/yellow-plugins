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
    elif [ "${install_path:-global}" = "npm-global" ]; then
      warning "To clean up: npm uninstall -g @openai/codex --prefix ~/.npm-global"
    else
      warning "To clean up: npm uninstall -g @openai/codex"
    fi
  fi
}
trap cleanup EXIT

# Compare two semver strings. Returns 0 if $1 >= $2, 1 otherwise.
# POSIX-compatible: no bash arrays, herestrings, or (( )) arithmetic.
version_gte() {
  local left="$1" right="$2"
  local left_major left_minor left_patch
  local right_major right_minor right_patch

  IFS='.' read -r left_major left_minor left_patch <<EOF
$left
EOF
  IFS='.' read -r right_major right_minor right_patch <<EOF
$right
EOF

  # Strip non-numeric suffixes (e.g., "3-beta" -> "3")
  left_major="${left_major%%[^0-9]*}"; left_major="${left_major:-0}"
  left_minor="${left_minor%%[^0-9]*}"; left_minor="${left_minor:-0}"
  left_patch="${left_patch%%[^0-9]*}"; left_patch="${left_patch:-0}"
  right_major="${right_major%%[^0-9]*}"; right_major="${right_major:-0}"
  right_minor="${right_minor%%[^0-9]*}"; right_minor="${right_minor:-0}"
  right_patch="${right_patch%%[^0-9]*}"; right_patch="${right_patch:-0}"

  if [ "$left_major" -gt "$right_major" ]; then return 0; fi
  if [ "$left_major" -lt "$right_major" ]; then return 1; fi
  if [ "$left_minor" -gt "$right_minor" ]; then return 0; fi
  if [ "$left_minor" -lt "$right_minor" ]; then return 1; fi
  if [ "$left_patch" -gt "$right_patch" ]; then return 0; fi
  if [ "$left_patch" -lt "$right_patch" ]; then return 1; fi
  return 0  # equal
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

# --- Try activating Node via version manager if needed ---
_current_node_major=""
if command -v node >/dev/null 2>&1; then
  _current_node_major=$(node -e "console.log(process.versions.node.split('.')[0])" 2>/dev/null || true)
fi
# Normalize non-numeric values to empty so the -z check catches them
case "$_current_node_major" in ''|*[!0-9]*) _current_node_major="" ;; esac
if [ -z "$_current_node_major" ] || [ "$_current_node_major" -lt "$MIN_NODE_MAJOR" ]; then
  if command -v fnm >/dev/null 2>&1; then
    eval "$(fnm env 2>/dev/null)" || true
    fnm use "$MIN_NODE_MAJOR" 2>/dev/null || true
  elif [ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]; then
    # shellcheck disable=SC1091
    . "${NVM_DIR:-$HOME/.nvm}/nvm.sh" 2>/dev/null || true
    nvm use "$MIN_NODE_MAJOR" 2>/dev/null || true
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
path_needs_update=false

# Guard against fnm multishell ephemeral paths — install to ~/.npm-global instead
npm_global_dir=$(npm prefix -g 2>/dev/null || true)
if printf '%s' "$npm_global_dir" | grep -q 'fnm_multishells'; then
  warning "fnm multishell detected — installing to ~/.npm-global to persist across sessions"
  mkdir -p "${HOME}/.npm-global"
  if npm_output=$(npm install -g @openai/codex --prefix "${HOME}/.npm-global" 2>&1); then
    install_path="npm-global"
    npm_bin="${HOME}/.npm-global/bin"
    if ! printf '%s' "$PATH" | tr ':' '\n' | grep -qxF "$npm_bin"; then
      path_needs_update=true
      case "$(basename "${SHELL:-}")" in
        zsh)  rc_file="${HOME}/.zshrc" ;;
        bash) rc_file="${HOME}/.bashrc" ;;
        *)    rc_file="${HOME}/.profile" ;;
      esac
      warning "${npm_bin} is not in PATH."
      warning "Add this line to ${rc_file}:"
      warning "  export PATH=\"${npm_bin}:\$PATH\""
      warning "Then restart your shell or run: source ${rc_file}"
      export PATH="${npm_bin}:${PATH}"
    fi
  else
    printf '%s\n' "$npm_output" >&2
    error "npm install to ~/.npm-global failed."
  fi
elif npm_output=$(npm install -g @openai/codex 2>&1); then
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
elif [ "$install_path" = "npm-global" ]; then
  if [ "${path_needs_update:-false}" = "true" ]; then
    success "codex v${installed_version} installed to ~/.npm-global/bin — restart your shell to use it"
  else
    success "codex v${installed_version} installed to ~/.npm-global/bin (persists across fnm sessions)"
  fi
else
  success "codex v${installed_version} installed successfully (global binary in PATH)"
fi
