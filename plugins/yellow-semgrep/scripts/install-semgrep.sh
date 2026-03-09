#!/bin/bash
set -Eeuo pipefail

# install-semgrep.sh — Install Semgrep CLI for yellow-semgrep plugin
# Usage: bash install-semgrep.sh [--yes]

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
    if [ "${INSTALL_METHOD:-}" = "pipx" ]; then
      warning "To clean up: pipx uninstall semgrep"
    elif [ "${INSTALL_METHOD:-}" = "pip" ]; then
      warning "To clean up: pip uninstall semgrep"
    fi
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
if command -v semgrep >/dev/null 2>&1; then
  installed_version=$(semgrep --version 2>/dev/null || true)
  success "semgrep already installed: ${installed_version:-unknown version}"
  exit 0
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
  if ! pipx install semgrep 2>&1; then
    error "pipx install semgrep failed. Try manually: pipx install semgrep"
  fi

# Fall back to pip
elif command -v pip3 >/dev/null 2>&1 || command -v pip >/dev/null 2>&1; then
  INSTALL_METHOD="pip"
  pip_cmd="pip3"
  command -v pip3 >/dev/null 2>&1 || pip_cmd="pip"

  # Warn about active virtual environment
  if [ -n "${VIRTUAL_ENV:-}" ]; then
    warning "Active virtual environment detected at ${VIRTUAL_ENV}"
    warning "semgrep will only be available while this venv is active."
    warning "Consider deactivating first, or use pipx for a global install."
  fi

  printf '[yellow-semgrep] pipx not found — falling back to pip.\n'
  printf '[yellow-semgrep] Installing semgrep via %s...\n' "$pip_cmd"

  pip_output=""
  if ! pip_output=$(python3 -m pip install semgrep 2>&1); then
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

success "semgrep ${installed_version} installed successfully via ${INSTALL_METHOD}"
