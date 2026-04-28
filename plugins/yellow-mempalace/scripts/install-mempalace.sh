#!/bin/bash
set -Eeuo pipefail

# install-mempalace.sh — Install or upgrade MemPalace CLI for yellow-mempalace plugin
# Usage: bash install-mempalace.sh

# Minimum version required for MCP server support
readonly MIN_VERSION="3.0.0"

error() {
  printf '\033[0;31mError: %s\033[0m\n' "$1" >&2
  exit 1
}

warning() {
  printf '\033[0;33mWarning: %s\033[0m\n' "$1" >&2
}

success() {
  printf '\033[0;32m%s\033[0m\n' "$1"
}

# Run pip with the first available invocation: `python3 -m pip` > `pip3` > `pip`.
# Returns 1 if no pip is available; otherwise propagates pip's exit code.
# Prints the chosen invocation to PIP_CMD_USED for caller-facing messages.
PIP_CMD_USED=""
have_pip() {
  if command -v python3 >/dev/null 2>&1 && python3 -m pip --version >/dev/null 2>&1; then
    PIP_CMD_USED="python3 -m pip"
    return 0
  elif command -v pip3 >/dev/null 2>&1; then
    PIP_CMD_USED="pip3"
    return 0
  elif command -v pip >/dev/null 2>&1; then
    PIP_CMD_USED="pip"
    return 0
  fi
  return 1
}

run_pip() {
  case "$PIP_CMD_USED" in
    "python3 -m pip") python3 -m pip "$@" ;;
    pip3) pip3 "$@" ;;
    pip)  pip "$@" ;;
    *) return 1 ;;
  esac
}

extract_version() {
  # grep returns 1 when no version pattern matches — that's the empty-version
  # signal callers handle below. Suppress only that exit code, not the input.
  printf '%s\n' "$1" | grep -Eo '[0-9]+(\.[0-9]+)+' | head -n1 || return 0
}

# Compare two semver strings. Returns 0 if $1 >= $2, 1 otherwise.
version_gte() {
  local left="$1" right="$2"
  local left_major left_minor left_patch
  local right_major right_minor right_patch

  IFS='.' read -r left_major left_minor left_patch <<__EOF_VERSION_LEFT__
$left
__EOF_VERSION_LEFT__
  IFS='.' read -r right_major right_minor right_patch <<__EOF_VERSION_RIGHT__
$right
__EOF_VERSION_RIGHT__

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

cleanup() {
  local exit_code=$?
  if [ $exit_code -ne 0 ] && [ -n "${INSTALL_METHOD:-}" ]; then
    case "${INSTALL_METHOD:-}" in
      pipx|pipx-upgrade) warning "To clean up: pipx uninstall mempalace" ;;
      pip|pip-upgrade) warning "To clean up: pip uninstall mempalace" ;;
      *) return ;;
    esac
    warning "Installation failed. Partial install may remain."
  fi
}
trap cleanup EXIT

# --- Check if already installed ---
if command -v mempalace >/dev/null 2>&1; then
  if ! mp_version_output=$(mempalace --version 2>&1); then
    error "mempalace binary found but '--version' exited non-zero. Output: ${mp_version_output:-<empty>}"
  fi
  installed_version=$(extract_version "$mp_version_output")
  if [ -z "$installed_version" ]; then
    warning "mempalace is installed but '--version' returned: ${mp_version_output:-<empty>}"
    warning "Try reinstalling with: bash \"${0}\""
    exit 1
  fi

  if version_gte "$installed_version" "$MIN_VERSION"; then
    success "mempalace ${installed_version} already installed (>= ${MIN_VERSION})"
    exit 0
  fi

  # Installed but below minimum version — attempt upgrade
  printf '[yellow-mempalace] mempalace %s installed but MCP support requires >= %s\n' "$installed_version" "$MIN_VERSION"
  printf '[yellow-mempalace] Attempting upgrade...\n'

  INSTALL_METHOD=""
  if command -v pipx >/dev/null 2>&1; then
    INSTALL_METHOD="pipx-upgrade"
    printf '[yellow-mempalace] Upgrading mempalace via pipx...\n'
    pipx_output=""
    if ! pipx_output=$(pipx upgrade mempalace 2>&1); then
      printf '[yellow-mempalace] pipx upgrade failed — trying pipx install --force...\n'
      pipx_output=""
      if ! pipx_output=$(pipx install --force mempalace 2>&1); then
        printf '%s\n' "$pipx_output" >&2
        error "pipx upgrade and pipx install --force both failed. Try manually: pipx upgrade mempalace"
      fi
    fi
  elif have_pip; then
    INSTALL_METHOD="pip-upgrade"
    printf '[yellow-mempalace] Upgrading mempalace via %s...\n' "$PIP_CMD_USED"
    pip_upgrade_output=""
    if ! pip_upgrade_output=$(run_pip install --upgrade mempalace 2>&1); then
      printf '%s\n' "$pip_upgrade_output" >&2
      error "pip upgrade failed. Try manually: pip install --upgrade mempalace"
    fi
  else
    error "Cannot auto-upgrade — no pipx or pip found. Install pipx first: brew install pipx or python3 -m pip install --user pipx"
  fi

  # Re-check version after upgrade attempt — preserve exit code & stderr
  if ! upgraded_version_output=$(mempalace --version 2>&1); then
    error "mempalace '--version' exited non-zero after upgrade. Output: ${upgraded_version_output:-<empty>}"
  fi
  upgraded_version=$(extract_version "$upgraded_version_output")
  if [ -n "$upgraded_version" ] && version_gte "$upgraded_version" "$MIN_VERSION"; then
    success "mempalace upgraded to ${upgraded_version} (>= ${MIN_VERSION})"
    exit 0
  fi

  if [ -z "$upgraded_version" ]; then
    warning "mempalace '--version' returned unexpected value after upgrade: ${upgraded_version_output:-<empty>}"
    exit 2
  fi

  warning "mempalace ${upgraded_version:-${installed_version}} is below ${MIN_VERSION}."
  warning "Upgrade manually: pipx upgrade mempalace"
  exit 2
fi

# --- Detect platform ---
os=$(uname -s)
arch=$(uname -m)
printf '[yellow-mempalace] Platform: %s/%s\n' "$os" "$arch"

# --- Check Python 3.10+ is available ---
if ! command -v python3 >/dev/null 2>&1; then
  error "Python 3 is required but not found. Install Python 3.10+ first."
fi

py_minor=$(python3 -c "import sys; print(sys.version_info.minor)" 2>/dev/null || echo "0")
py_major=$(python3 -c "import sys; print(sys.version_info.major)" 2>/dev/null || echo "0")
if [ "$py_major" -lt 3 ] || { [ "$py_major" -eq 3 ] && [ "$py_minor" -lt 10 ]; }; then
  warning "Python 3.${py_minor} detected. mempalace requires 3.10+ (3.11+ recommended)."
  warning "onnxruntime/PyTorch dependencies may fail to install on Python < 3.10."
fi

# --- Install mempalace ---
INSTALL_METHOD=""

# Try pipx first (avoids PEP 668 issues on modern distros)
if command -v pipx >/dev/null 2>&1; then
  INSTALL_METHOD="pipx"
  printf '[yellow-mempalace] Installing mempalace via pipx (recommended)...\n'
  pipx_output=""
  if ! pipx_output=$(pipx install "mempalace>=${MIN_VERSION},<4.0.0" 2>&1); then
    printf '%s\n' "$pipx_output" >&2
    error "pipx install mempalace failed. Try manually: pipx install mempalace"
  fi

# Fall back to pip
elif have_pip; then
  INSTALL_METHOD="pip"

  if [ -n "${VIRTUAL_ENV:-}" ]; then
    warning "Active virtual environment detected at ${VIRTUAL_ENV}"
    warning "mempalace will only be available while this venv is active."
    warning "Consider deactivating first, or use pipx for a global install."
  fi

  printf '[yellow-mempalace] pipx not found — falling back to pip.\n'
  printf '[yellow-mempalace] Installing mempalace via %s...\n' "$PIP_CMD_USED"

  pip_output=""
  if ! pip_output=$(run_pip install "mempalace>=${MIN_VERSION},<4.0.0" 2>&1); then
    if printf '%s' "$pip_output" | grep -qi "externally-managed-environment"; then
      printf '%s\n' "$pip_output" >&2
      error "pip blocked by PEP 668. Install pipx first: brew install pipx or python3 -m pip install --user pipx"
    fi
    printf '%s\n' "$pip_output" >&2
    error "pip install mempalace failed. Try: pipx install mempalace"
  fi

# Neither pipx nor pip available
else
  cat >&2 <<'INSTRUCTIONS'
Neither pipx nor pip found. Install mempalace manually using one of:
  pipx install mempalace          (recommended — install pipx: brew install pipx)
  pip install mempalace           (requires Python 3.10+)
Then re-run /mempalace:setup
INSTRUCTIONS
  error "No supported package manager found for mempalace installation."
fi

# --- Verify installation in PATH ---
if ! command -v mempalace >/dev/null 2>&1; then
  local_bin="${HOME}/.local/bin"
  if [ -x "${local_bin}/mempalace" ]; then
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

if ! command -v mempalace >/dev/null 2>&1; then
  error "mempalace not found in PATH after install. Check that your PATH includes the install location."
fi

if ! mp_version_output=$(mempalace --version 2>&1); then
  error "mempalace binary found but '--version' exited non-zero. Output: ${mp_version_output:-<empty>}"
fi
installed_version=$(extract_version "$mp_version_output")
if [ -z "$installed_version" ]; then
  error "mempalace binary found but '--version' returned: ${mp_version_output:-<empty>}"
fi

if ! version_gte "$installed_version" "$MIN_VERSION"; then
  warning "mempalace ${installed_version} installed but MCP support requires >= ${MIN_VERSION}."
  warning "Upgrade with: pipx upgrade mempalace"
fi

# Smoke-test the MCP entrypoint that plugin.json will invoke. If this
# subcommand is absent, the MCP server silently fails to start with no
# diagnostics, leaving the user with 0 tools.
if ! mempalace mcp --help >/dev/null 2>&1; then
  warning "'mempalace mcp --help' failed — the MCP entrypoint may differ in this version."
  warning "Verify plugin.json mcpServers.mempalace.command matches the installed CLI."
fi

success "mempalace ${installed_version} installed successfully via ${INSTALL_METHOD}"
