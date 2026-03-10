#!/bin/bash
set -Eeuo pipefail

# install-semgrep.sh — Install or upgrade Semgrep CLI for yellow-semgrep plugin
# Usage: bash install-semgrep.sh

readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[0;33m'
readonly NC='\033[0m'

# Minimum version required for built-in MCP server (semgrep mcp subcommand)
readonly MIN_VERSION="1.146.0"

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

# Compare two semver strings. Returns 0 if $1 >= $2, 1 otherwise.
version_gte() {
  local IFS=.
  local i a=($1) b=($2)
  for ((i=0; i<${#b[@]}; i++)); do
    local av="${a[i]:-0}" bv="${b[i]:-0}"
    if ((av > bv)); then return 0; fi
    if ((av < bv)); then return 1; fi
  done
  return 0
}

cleanup() {
  local exit_code=$?
  if [ $exit_code -ne 0 ]; then
    warning "Installation failed. Partial install may remain."
    if [ "${INSTALL_METHOD:-}" = "pipx" ]; then
      warning "To clean up: pipx uninstall semgrep"
    elif [ "${INSTALL_METHOD:-}" = "pip" ]; then
      warning "To clean up: pip uninstall semgrep"
    fi
  fi
}
trap cleanup EXIT

# --- Check if already installed ---
if command -v semgrep >/dev/null 2>&1; then
  installed_version=$(semgrep --version 2>/dev/null || true)
  if [ -n "$installed_version" ] && version_gte "$installed_version" "$MIN_VERSION"; then
    success "semgrep ${installed_version} already installed (>= ${MIN_VERSION})"
    exit 0
  fi

  # Installed but below minimum version — offer upgrade
  if [ -n "$installed_version" ]; then
    printf '[yellow-semgrep] semgrep %s installed but MCP support requires >= %s\n' "$installed_version" "$MIN_VERSION"
    printf '[yellow-semgrep] Attempting upgrade...\n'

    INSTALL_METHOD=""
    if command -v pipx >/dev/null 2>&1; then
      INSTALL_METHOD="pipx"
      printf '[yellow-semgrep] Upgrading semgrep via pipx...\n'
      if ! pipx upgrade semgrep 2>&1; then
        # pipx upgrade fails if not installed via pipx — try reinstall
        printf '[yellow-semgrep] pipx upgrade failed — trying pipx install...\n'
        if ! pipx install semgrep 2>&1; then
          warning "pipx upgrade/install failed. Try manually: pipx upgrade semgrep"
        fi
      fi
    elif command -v pip3 >/dev/null 2>&1 || command -v pip >/dev/null 2>&1; then
      INSTALL_METHOD="pip"
      if command -v python3 >/dev/null 2>&1; then
        pip_cmd="python3 -m pip"
      elif command -v pip3 >/dev/null 2>&1; then
        pip_cmd="pip3"
      else
        pip_cmd="pip"
      fi
      printf '[yellow-semgrep] Upgrading semgrep via %s...\n' "$pip_cmd"
      if ! $pip_cmd install --upgrade semgrep 2>&1; then
        warning "pip upgrade failed. Try manually: pip install --upgrade semgrep"
      fi
    else
      warning "Cannot auto-upgrade — no pipx or pip found."
      warning "Upgrade manually: pipx upgrade semgrep"
    fi

    # Re-check version after upgrade attempt
    upgraded_version=$(semgrep --version 2>/dev/null || true)
    if [ -n "$upgraded_version" ] && version_gte "$upgraded_version" "$MIN_VERSION"; then
      success "semgrep upgraded to ${upgraded_version} (>= ${MIN_VERSION})"
      exit 0
    fi

    warning "semgrep ${upgraded_version:-${installed_version}} is below ${MIN_VERSION}."
    warning "MCP tools will not be available. Upgrade manually: pipx upgrade semgrep"
    exit 0
  fi
fi

# --- Detect OS/arch ---
os=$(uname -s)
arch=$(uname -m)
printf '[yellow-semgrep] Platform: %s/%s\n' "$os" "$arch"

# --- Install semgrep ---
INSTALL_METHOD=""

# Try pipx first (officially recommended by Semgrep, avoids PEP 668)
if command -v pipx >/dev/null 2>&1; then
  INSTALL_METHOD="pipx"
  printf '[yellow-semgrep] Installing semgrep via pipx (recommended)...\n'
  pipx_output=""
  if ! pipx_output=$(pipx install semgrep 2>&1); then
    printf '%s\n' "$pipx_output" >&2
    error "pipx install semgrep failed. Try manually: pipx install semgrep"
  fi

# Fall back to pip
elif command -v pip3 >/dev/null 2>&1 || command -v pip >/dev/null 2>&1; then
  INSTALL_METHOD="pip"
  # Prefer python3 -m pip (ensures correct interpreter) over raw pip3/pip
  if command -v python3 >/dev/null 2>&1; then
    pip_cmd="python3 -m pip"
  elif command -v pip3 >/dev/null 2>&1; then
    pip_cmd="pip3"
  else
    pip_cmd="pip"
  fi

  # Warn about active virtual environment
  if [ -n "${VIRTUAL_ENV:-}" ]; then
    warning "Active virtual environment detected at ${VIRTUAL_ENV}"
    warning "semgrep will only be available while this venv is active."
    warning "Consider deactivating first, or use pipx for a global install."
  fi

  printf '[yellow-semgrep] pipx not found — falling back to pip.\n'
  printf '[yellow-semgrep] Installing semgrep via %s...\n' "$pip_cmd"

  pip_output=""
  if ! pip_output=$($pip_cmd install semgrep 2>&1); then
    # Detect PEP 668 externally-managed-environment error
    if printf '%s' "$pip_output" | grep -qi "externally-managed-environment"; then
      printf '%s\n' "$pip_output" >&2
      error "pip blocked by PEP 668 (externally-managed-environment). Install pipx first: brew install pipx or python3 -m pip install --user pipx"
    fi
    printf '%s\n' "$pip_output" >&2
    error "pip install semgrep failed. Try: pipx install semgrep"
  fi

# Neither pipx nor pip available
else
  cat >&2 <<'INSTRUCTIONS'
Neither pipx nor pip found. Install semgrep manually using one of:
  pipx install semgrep          (recommended — install pipx: brew install pipx)
  pip install semgrep           (requires Python 3.9+)
  brew install semgrep          (macOS only)
Then re-run /semgrep:setup
INSTRUCTIONS
  error "No supported package manager found for semgrep installation."
fi

# --- Verify installation ---
if ! command -v semgrep >/dev/null 2>&1; then
  # pipx/pip may have installed to ~/.local/bin which might not be in PATH
  local_bin="${HOME}/.local/bin"
  if [ -x "${local_bin}/semgrep" ]; then
    if ! printf '%s' "$PATH" | tr ':' '\n' | grep -qxF "$local_bin"; then
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
  fi
fi

if ! command -v semgrep >/dev/null 2>&1; then
  error "semgrep not found in PATH after install. Check that your PATH includes the install location."
fi

installed_version=$(semgrep --version 2>/dev/null || true)
if [ -z "$installed_version" ]; then
  error "semgrep binary found but 'semgrep --version' failed. Try reinstalling."
fi

if ! version_gte "$installed_version" "$MIN_VERSION"; then
  warning "semgrep ${installed_version} installed but MCP support requires >= ${MIN_VERSION}."
  warning "Upgrade with: pipx upgrade semgrep"
  warning "Scan and fix commands will work, but MCP tools will not be available."
fi

success "semgrep ${installed_version} installed successfully via ${INSTALL_METHOD}"
