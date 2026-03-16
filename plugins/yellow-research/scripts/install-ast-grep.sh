#!/bin/bash
set -Eeuo pipefail

# install-ast-grep.sh — Install ast-grep CLI for yellow-research plugin
# Usage: bash install-ast-grep.sh

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
    if [ "${install_path:-global}" = "local" ]; then
      warning "To clean up: npm uninstall -g @ast-grep/cli --prefix ~/.local"
    else
      warning "To clean up: npm uninstall -g @ast-grep/cli"
    fi
  fi
}
trap cleanup EXIT

# --- Check if already installed ---
# @ast-grep/cli provides both 'sg' and 'ast-grep' binaries.
# Note: 'sg' can collide with shadow-utils on Linux, so verify via --version.
AST_GREP_CMD=""
if command -v ast-grep >/dev/null 2>&1; then
  AST_GREP_CMD="ast-grep"
elif command -v sg >/dev/null 2>&1 && sg --version 2>&1 | grep -qi 'ast-grep'; then
  AST_GREP_CMD="sg"
fi

if [ -n "$AST_GREP_CMD" ]; then
  installed_version=$("$AST_GREP_CMD" --version 2>/dev/null || true)
  success "ast-grep already installed (${AST_GREP_CMD}): ${installed_version:-unknown version}"
fi

# --- Ensure uv is installed (needed for ast-grep MCP server) ---
if ! command -v uv >/dev/null 2>&1; then
  if ! command -v curl >/dev/null 2>&1; then
    warning "curl not found. Cannot auto-install uv."
    warning "Install uv manually: https://docs.astral.sh/uv/getting-started/installation/"
    printf '[yellow-research] uv: NOT FOUND (curl missing, cannot auto-install)\n'
  else
    printf '[yellow-research] uv not found — installing (needed for ast-grep MCP server)...\n'
    # Note: uv installer is from Astral (uv maintainers). User confirmation
    # happens in research:setup via AskUserQuestion before this script runs.
    if curl -LsSf https://astral.sh/uv/install.sh | sh; then
      # Source uv into current session
      export PATH="${HOME}/.local/bin:${PATH}"
      if command -v uv >/dev/null 2>&1; then
        success "uv installed: $(uv --version 2>/dev/null)"
      else
        warning "uv installed but not in PATH for current session. Add ~/.local/bin to PATH permanently."
        printf '[yellow-research] uv: NOT FOUND (not in PATH after install)\n'
      fi
    else
      warning "uv installation failed. ast-grep MCP server will not work without uv."
      warning "Install manually: curl -LsSf https://astral.sh/uv/install.sh | sh"
      printf '[yellow-research] uv: NOT FOUND (installation failed)\n'
    fi
  fi
else
  printf '[yellow-research] uv: ok (%s)\n' "$(uv --version 2>/dev/null)"
fi

# --- Pre-warm Python 3.13 for ast-grep MCP server ---
if command -v uv >/dev/null 2>&1; then
  printf '[yellow-research] Pre-warming Python 3.13 for ast-grep MCP...\n'
  uv python install 3.13 2>&1 || warning "Python 3.13 pre-warm failed (uvx will retry on first use)"
fi

# If ast-grep binary was already found, exit now (after ensuring uv + Python)
if [ -n "$AST_GREP_CMD" ]; then
  exit 0
fi

# --- Dependency checks ---
if ! command -v npm >/dev/null 2>&1; then
  error "npm is required but not found. Install Node.js from: https://nodejs.org/"
fi

# --- Detect version manager (nvm/fnm) ---
# When a version manager is actively managing npm, skip --prefix ~/.local fallback
# on failure (it installs to a different location than the version manager expects).
# A dormant ~/.nvm directory alone doesn't count — check if npm is actually
# running from the version manager's prefix.
has_version_mgr=false
npm_prefix=$(npm prefix -g 2>/dev/null || true)
if [ -n "${NVM_DIR:-}" ] && printf '%s' "$npm_prefix" | grep -q "${NVM_DIR}"; then
  has_version_mgr=true
  warning "nvm detected (npm managed by nvm). Global npm binaries are per-Node-version and may disappear after 'nvm use <other-version>'."
elif [ -d "${HOME}/.nvm" ] && printf '%s' "$npm_prefix" | grep -q ".nvm"; then
  has_version_mgr=true
  warning "nvm detected (npm managed by nvm). Global npm binaries are per-Node-version and may disappear after 'nvm use <other-version>'."
fi
if { [ -n "${FNM_DIR:-}" ] || [ -d "${HOME}/.fnm" ] || command -v fnm >/dev/null 2>&1; } && printf '%s' "$npm_prefix" | grep -q "fnm"; then
  has_version_mgr=true
  warning "fnm detected (npm managed by fnm). Global npm binaries are per-Node-version and may not persist across shell restarts."
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
elif [ "$has_version_mgr" = "true" ]; then
  # Version managers (nvm/fnm) manage their own prefix — don't fall back to
  # --prefix ~/.local as it would install to a different location
  printf '%s\n' "$npm_output" >&2
  error "npm install failed under version manager. Check permissions or try reinstalling npm."
elif printf '%s' "$npm_output" | grep -qi "EACCES\|permission denied\|EPERM"; then
  # Only fall back to --prefix ~/.local on permission errors (not network/other failures)
  warning "Global install failed with permission error — retrying with --prefix ~/.local"
  if npm_output=$(npm install -g @ast-grep/cli --prefix "${HOME:?HOME not set}/.local" 2>&1); then
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
    error "npm install -g @ast-grep/cli --prefix ~/.local also failed."
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
# @ast-grep/cli provides both 'sg' and 'ast-grep' binaries — check both
VERIFIED_CMD=""
if command -v sg >/dev/null 2>&1; then
  VERIFIED_CMD="sg"
elif command -v ast-grep >/dev/null 2>&1; then
  VERIFIED_CMD="ast-grep"
fi

if [ -z "$VERIFIED_CMD" ]; then
  npm_global_prefix=$(npm prefix -g 2>/dev/null || true)
  npm_global_bin="${npm_global_prefix}/bin"
  if [ -n "$npm_global_prefix" ] && { [ -x "${npm_global_bin}/ast-grep" ] || [ -x "${npm_global_bin}/sg" ]; }; then
    error "ast-grep installed at ${npm_global_bin} but that directory is not in PATH. Add to your shell profile: export PATH=\"${npm_global_bin}:\$PATH\""
  fi
  error "ast-grep not found in PATH after install."
fi

installed_version=$("$VERIFIED_CMD" --version 2>/dev/null || true)
if [ -z "$installed_version" ]; then
  error "${VERIFIED_CMD} binary found but '${VERIFIED_CMD} --version' failed. Try reinstalling."
fi

if [ "$install_path" = "local" ]; then
  if [ "${path_needs_update:-false}" = "true" ]; then
    success "ast-grep ${installed_version} installed to ~/.local/bin (${VERIFIED_CMD}) — restart your shell to use it"
  else
    success "ast-grep ${installed_version} installed to ~/.local/bin (${VERIFIED_CMD}, already in PATH)"
  fi
else
  success "ast-grep ${installed_version} installed successfully (${VERIFIED_CMD}, global binary in PATH)"
fi
